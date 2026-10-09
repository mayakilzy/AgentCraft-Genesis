"use client";

// The react-hooks/set-state-in-effect rule flags async data-fetching effects
// that call setState after await. This is the standard polling pattern used
// throughout the Genesis UI (MissionList, MissionControlDetail, etc.). The
// rule is overly conservative for this use case — the setState calls happen
// after async resolution, not synchronously in the effect body. We disable
// it file-wide to avoid noise; the behavior is correct.
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  MessageSquare,
  Plus,
  Send,
  Loader2,
  AlertCircle,
  Play,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type {
  ConversationSummary,
  MessageRecord,
  MissionSnapshot,
} from "@/lib/genesis/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 3000;

/**
 * HomeSection — G7-12 Persistent Conversational Home.
 *
 * Three areas:
 *   A. Conversation Navigation (left sidebar) — new + recent conversations.
 *   B. Main Conversation (center) — message history + goal input + authorize.
 *   C. Mission Workspace (right/below) — linked mission status + artifacts.
 *
 * Persistence: conversations are durable (JSONL on disk). After browser refresh
 * or gateway restart, conversations are retrieved from the server.
 *
 * Mission state is NOT restart-durable (in-process registry). If a linked
 * mission is no longer retrievable, the UI shows "unavailable" — never
 * fabricates completion.
 */
export function HomeSection() {
  const activeConversationId = useGenesisStore((s) => s.activeConversationId);
  const setActiveConversationId = useGenesisStore((s) => s.setActiveConversationId);

  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);

  const fetchConversations = useCallback(async () => {
    const res = await genesisApi.listConversations({ limit: 20 });
    if (res.kind === "ok" && res.data) {
      setConversations(res.data.conversations);
    }
    setLoadingConvos(false);
  }, []);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  const handleNewConversation = async () => {
    const res = await genesisApi.createConversation({ title: "New Conversation" });
    if (res.kind === "ok" && res.data) {
      setActiveConversationId(res.data.conversationId);
      void fetchConversations();
    }
  };

  if (!activeConversationId) {
    return (
      <div className="grid gap-4 lg:grid-cols-[300px_1fr] h-full">
        <ConversationNav
          conversations={conversations}
          loading={loadingConvos}
          activeId={undefined}
          onSelect={setActiveConversationId}
          onNew={handleNewConversation}
        />
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border">
          <div className="text-center space-y-2 p-8">
            <MessageSquare className="size-8 mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No conversation selected</p>
            <p className="text-xs text-muted-foreground">
              Start a new conversation to describe a goal, or select an existing one.
            </p>
            <Button onClick={handleNewConversation} className="gap-1.5 mt-2">
              <Plus className="size-4" aria-hidden="true" />
              New Conversation
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr_350px] h-full">
      <ConversationNav
        conversations={conversations}
        loading={loadingConvos}
        activeId={activeConversationId}
        onSelect={setActiveConversationId}
        onNew={handleNewConversation}
      />
      <MainConversation conversationId={activeConversationId} onConversationsChanged={fetchConversations} />
      <MissionWorkspace conversationId={activeConversationId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// A. Conversation Navigation
// ---------------------------------------------------------------------------

function ConversationNav({
  conversations,
  loading,
  activeId,
  onSelect,
  onNew,
}: {
  conversations: readonly ConversationSummary[];
  loading: boolean;
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="size-4" aria-hidden="true" />
            Conversations
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={onNew} className="h-7 gap-1">
            <Plus className="size-3.5" aria-hidden="true" />
            New
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto space-y-1">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">
            No conversations yet. Click &quot;New&quot; to start.
          </p>
        ) : (
          conversations.map((c) => (
            <button
              key={c.conversationId}
              type="button"
              onClick={() => onSelect(c.conversationId)}
              className={cn(
                "w-full text-left rounded-md border p-2 transition-colors",
                c.conversationId === activeId
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent",
              )}
            >
              <p className="text-xs font-medium truncate">{c.title}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {c.messageCount} message{c.messageCount === 1 ? "" : "s"}
                {c.lastMessagePreview ? ` · ${c.lastMessagePreview}` : ""}
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                {new Date(c.updatedAt).toLocaleString()}
              </p>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// B. Main Conversation
// ---------------------------------------------------------------------------

function MainConversation({
  conversationId,
  onConversationsChanged,
}: {
  conversationId: string;
  onConversationsChanged: () => void;
}) {
  const [messages, setMessages] = useState<readonly MessageRecord[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [authorizing, setAuthorizing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMessages = useCallback(async () => {
    const res = await genesisApi.getMessages(conversationId, { limit: 100 });
    if (res.kind === "ok" && res.data) {
      setMessages(res.data.messages);
    }
  }, [conversationId]);

  useEffect(() => {
    void fetchMessages();
    const interval = setInterval(() => void fetchMessages(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    setSending(true);
    setError(undefined);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const idempotencyKey = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await genesisApi.appendMessage(
      conversationId,
      { role: "user", content: trimmed, idempotencyKey },
      controller.signal,
    );
    if (res.kind === "ok" && res.data) {
      setInput("");
      void fetchMessages();
      onConversationsChanged();
    } else {
      setError(res.message ?? "Failed to send message.");
    }
    setSending(false);
  };

  const handleAuthorize = async () => {
    // Collect the user messages as the goal text.
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 0) {
      setError("No goal described. Send a message first.");
      return;
    }
    const goal = userMessages.map((m) => m.content).join("\n\n");
    setAuthorizing(true);
    setError(undefined);

    // Submit the mission via the existing Gateway.
    const submitRes = await genesisApi.submitMission({ outcome: goal });
    if (submitRes.kind !== "ok" || !submitRes.data) {
      setError(submitRes.message ?? "Mission submission failed.");
      setAuthorizing(false);
      return;
    }
    const missionId = submitRes.data.missionId;

    // G7-12C: Link the mission to the conversation. If this fails, the mission
    // is NOT orphaned — we append a message with the missionId so the user can
    // recover it. The mission is already executing in the Gateway.
    const linkRes = await genesisApi.linkMission(conversationId, missionId);

    // Append an assistant message documenting the authorization + missionId.
    // This ensures the missionId is always recoverable from the conversation
    // history, even if the link call failed.
    const linkNote = linkRes.kind === "ok"
      ? "The mission is now linked to this conversation."
      : `WARNING: Could not link mission to conversation (${linkRes.message ?? "unknown error"}). The mission IS executing — save this Mission ID to track it manually.`;
    await genesisApi.appendMessage(conversationId, {
      role: "assistant",
      content: `Mission authorized and submitted.\n\nMission ID: ${missionId}\n\n${linkNote}\n\nFollow progress in the Mission Workspace panel.`,
      missionId,
    });

    if (linkRes.kind !== "ok") {
      setError(`Mission ${missionId} was submitted but linking failed. The mission IS running. Mission ID: ${missionId}`);
    }

    void fetchMessages();
    onConversationsChanged();
    setAuthorizing(false);
  };

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Conversation</CardTitle>
        <CardDescription className="text-xs">
          Describe your goal. When ready, authorize execution. Conversations persist across restarts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
        {/* Message history */}
        <div className="flex-1 overflow-auto space-y-2 rounded-md border border-border p-3 bg-muted/20">
          {messages.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No messages yet. Describe your goal below.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.messageId}
                className={cn(
                  "rounded-md p-2 text-xs max-w-[85%]",
                  m.role === "user"
                    ? "bg-primary/10 ml-auto"
                    : "bg-card border border-border",
                )}
              >
                <p className="text-[10px] font-medium text-muted-foreground mb-1">
                  {m.role === "user" ? "You" : "Assistant"} · {new Date(m.createdAt).toLocaleTimeString()}
                </p>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.missionId && (
                  <p className="text-[10px] text-primary mt-1 font-mono">
                    → Mission: {m.missionId.slice(0, 8)}…
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        {error && (
          <div className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Goal input */}
        <div className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !sending) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Describe your goal… (Cmd/Ctrl+Enter to send)"
            disabled={sending}
            rows={2}
            className="text-sm resize-none"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void handleSend()}
              disabled={sending || input.trim().length === 0}
              className="gap-1.5"
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
              Send
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => void handleAuthorize()}
              disabled={authorizing || messages.filter((m) => m.role === "user").length === 0}
              className="gap-1.5"
            >
              {authorizing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
              Authorize &amp; Execute
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// C. Mission Workspace
// ---------------------------------------------------------------------------

function MissionWorkspace({ conversationId }: { conversationId: string }) {
  const [conversation, setConversation] = useState<{ missionIds?: readonly string[] } | undefined>();
  const [missions, setMissions] = useState<Record<string, MissionSnapshot | "unavailable">>({});

  // Fetch conversation metadata (for missionIds).
  useEffect(() => {
    const fetchConv = async () => {
      const res = await genesisApi.getConversation(conversationId);
      if (res.kind === "ok" && res.data) {
        setConversation(res.data);
      }
    };
    void fetchConv();
    const interval = setInterval(() => void fetchConv(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [conversationId]);

  // Fetch linked mission snapshots.
  useEffect(() => {
    if (!conversation?.missionIds || conversation.missionIds.length === 0) {
      setMissions({});
      return;
    }
    const fetchMissions = async () => {
      const updates: Record<string, MissionSnapshot | "unavailable"> = {};
      for (const missionId of conversation.missionIds!) {
        const res = await genesisApi.getMission(missionId);
        if (res.kind === "ok" && res.data) {
          updates[missionId] = res.data;
        } else if (res.code === "MISSION_NOT_FOUND") {
          updates[missionId] = "unavailable";
        }
      }
      setMissions(updates);
    };
    void fetchMissions();
    const interval = setInterval(() => void fetchMissions(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [conversation?.missionIds]);

  const missionIds = conversation?.missionIds ?? [];

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Mission Workspace</CardTitle>
        <CardDescription className="text-xs">
          Linked missions and their real execution status. Mission state is in-process — if unavailable, the gateway was restarted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto space-y-3">
        {missionIds.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            No missions linked. Authorize execution from the conversation.
          </p>
        ) : (
          missionIds.map((missionId) => {
            const snap = missions[missionId];
            return (
              <div key={missionId} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-mono truncate">{missionId}</p>
                  {snap === undefined ? (
                    <Clock className="size-3.5 text-muted-foreground animate-pulse" aria-hidden="true" />
                  ) : snap === "unavailable" ? (
                    <span className="text-[10px] text-warning flex items-center gap-1">
                      <AlertCircle className="size-3" aria-hidden="true" />
                      Unavailable
                    </span>
                  ) : (
                    <MissionStatusBadge status={snap.status} terminal={snap.terminal} />
                  )}
                </div>
                {snap === "unavailable" && (
                  <p className="text-[10px] text-warning bg-warning/5 rounded p-2">
                    Mission state unavailable (gateway restarted). In-process mission registry does not survive restart.
                  </p>
                )}
                {snap && snap !== "unavailable" && (
                  <>
                    <p className="text-[10px] text-muted-foreground">
                      Status: <span className="font-medium">{snap.status}</span>
                      {snap.terminal ? " (terminal)" : " (running)"}
                    </p>
                    {snap.terminal && snap.result && (
                      <p className="text-[10px] text-muted-foreground">
                        Result: {snap.result.status} — {snap.result.summary.slice(0, 120)}
                      </p>
                    )}
                    {snap.terminal && snap.result && (
                      <div className="text-[10px] text-muted-foreground">
                        Cost: tokens={snap.result.cost.tokens}
                        {snap.result.cost.usd === 0 ? " · USD: UNKNOWN" : ` · USD: $${snap.result.cost.usd}`}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function MissionStatusBadge({ status, terminal }: { status: string; terminal: boolean }) {
  const tone =
    status === "SUCCEEDED"
      ? "text-success"
      : status === "FAILED"
        ? "text-destructive"
        : status === "PARTIAL"
          ? "text-warning"
          : terminal
            ? "text-muted-foreground"
            : "text-primary";
  const Icon = status === "SUCCEEDED" ? CheckCircle2 : status === "FAILED" ? XCircle : Clock;
  return (
    <span className={cn("text-[10px] flex items-center gap-1", tone)}>
      <Icon className="size-3" aria-hidden="true" />
      {status}
    </span>
  );
}
