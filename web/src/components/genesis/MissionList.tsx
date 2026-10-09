"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Inbox, Search, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { EmptyState } from "@/components/genesis/EmptyState";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type { MissionListSummary, MissionSnapshot } from "@/lib/genesis/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 4000;

const STATUS_TONE: Record<string, { className: string; label: string }> = {
  ACCEPTED: { className: "bg-muted text-muted-foreground border-border", label: "Accepted" },
  RUNNING: { className: "bg-primary/10 text-primary border-primary/30", label: "Running" },
  SUCCEEDED: { className: "bg-success/15 text-success border-success/30", label: "Succeeded" },
  FAILED: { className: "bg-destructive/15 text-destructive border-destructive/30", label: "Failed" },
  PARTIAL: { className: "bg-warning/15 text-warning border-warning/30", label: "Partial" },
  CANCELLATION_REQUESTED: { className: "bg-warning/15 text-warning border-warning/30", label: "Cancelling" },
  CANCELLED: { className: "bg-muted text-muted-foreground border-border", label: "Cancelled" },
  UNKNOWN: { className: "bg-muted text-muted-foreground border-border", label: "Unknown" },
};

/**
 * MissionList — server-authoritative mission listing (G7-10).
 *
 * Per 02_PRODUCT_SPECIFICATION §Work §Mission list: "filter/search by
 * server-supported fields or local loaded data, clear pagination/limits, honest
 * empty/error/loading states. Do not promise persistence across restart without
 * proof."
 *
 * G7-10 changes:
 *   - The gateway now exposes GET /v1/missions (list) — server-authoritative.
 *   - This component loads the server list on mount and polls lightly while
 *     visible. Local `knownMissions` (Zustand) is used ONLY as a fallback when
 *     the gateway is unavailable, and stale cached records are visibly marked.
 *   - The disclosure makes the in-process / restart-not-durable limitation
 *     explicit. No claim of persistent mission history.
 *
 * Restart behavior (B8): after a gateway restart, the in-memory registry is
 * empty. The server list returns { missions: [], nextCursor: null }. Stale
 * local records (if any) are shown but marked as "Last known — connection
 * unavailable" — never presented as current server state.
 */
export function MissionList() {
  const knownMissions = useGenesisStore((s) => s.knownMissions);
  const setActiveMissionId = useGenesisStore((s) => s.setActiveMissionId);
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);

  // Server-authoritative state.
  const [serverMissions, setServerMissions] = useState<readonly MissionListSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "stale" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [lastFetchedAt, setLastFetchedAt] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const fetchList = async () => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const res = await genesisApi.listMissions({ limit: 50 }, controller.signal);

    if (res.kind === "ok" && res.data) {
      setServerMissions(res.data.missions);
      setLoadState("ok");
      setErrorMsg(undefined);
      setLastFetchedAt(new Date().toISOString());
      return;
    }

    // On failure, keep the last server data (if any) and mark stale.
    if (res.kind === "unauthorized") {
      setLoadState("stale");
      setErrorMsg("Authentication failed — the BFF session may have expired. Refresh the page.");
    } else if (res.kind === "unavailable") {
      setLoadState("stale");
      setErrorMsg("Gateway unreachable — showing last known server data where available.");
    } else {
      setLoadState("error");
      setErrorMsg(res.message ?? "Failed to load mission list.");
    }
  };

  // Initial load + bounded polling while the component is mounted.
  // fetchList is async and calls setState only after the await resolves —
  // not synchronously in the effect body. The eslint rule is overly conservative
  // here; we disable it for this specific call.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchList();
    const interval = setInterval(() => {
      // Only poll if the section is likely visible (document has focus).
      // This avoids unnecessary background polling when the user navigates away.
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void fetchList();
      }
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
    // fetchList is intentionally captured once on mount; polling reads fresh
    // state via the async closure. Empty deps is correct for mount-only setup.
  }, []);

  // Build the display list: server records first (authoritative), then any
  // local-only records not present in the server list (fallback when gateway
  // is unavailable). Local-only records are marked as stale.
  const serverIds = new Set(serverMissions.map((m) => m.missionId));
  const localOnlyEntries = Object.values(knownMissions)
    .filter((m) => !serverIds.has(m.missionId))
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));

  const isLoading = loadState === "loading" && serverMissions.length === 0 && localOnlyEntries.length === 0;
  const isStale = loadState === "stale" || loadState === "error";

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Loading mission list from the gateway…
      </div>
    );
  }

  const hasServerMissions = serverMissions.length > 0;
  const hasLocalOnly = localOnlyEntries.length > 0;

  if (!hasServerMissions && !hasLocalOnly) {
    return (
      <div className="space-y-2">
        <PersistenceDisclosure />
        <EmptyState
          state="empty"
          customDescription={
            isStale && errorMsg
              ? `${errorMsg} No missions are currently known.`
              : "No missions found in the gateway registry. Submit a goal above, or look up a known mission ID below."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PersistenceDisclosure />

      {/* Refresh control + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          {lastFetchedAt && (
            <span>Last fetched {new Date(lastFetchedAt).toLocaleTimeString()}</span>
          )}
          {loadState === "ok" && serverMissions.length > 0 && (
            <span> · {serverMissions.length} mission{serverMissions.length === 1 ? "" : "s"} from server</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void fetchList()}
          disabled={loadState === "loading"}
          className="h-7 gap-1 text-[11px]"
        >
          <RefreshCw className={cn("size-3", loadState === "loading" && "animate-spin")} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Stale indicator (B6) */}
      {isStale && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning flex items-start gap-1.5"
        >
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <strong>Last known — connection unavailable.</strong>{" "}
            {errorMsg ?? "Showing cached records which may be stale. Status is not current."}
          </span>
        </div>
      )}

      {/* Server-authoritative records */}
      {hasServerMissions && (
        <div className="space-y-1">
          {serverMissions.map((m) => {
            const status = m.status ?? "UNKNOWN";
            const tone = STATUS_TONE[status] ?? STATUS_TONE.UNKNOWN;
            return (
              <MissionRow
                key={m.missionId}
                missionId={m.missionId}
                status={tone.label}
                statusTone={tone.className}
                subtitle={
                  `Accepted ${new Date(m.acceptedAt).toLocaleString()}` +
                  (m.finishedAt ? ` · finished ${new Date(m.finishedAt).toLocaleTimeString()}` : "") +
                  (m.label ? ` · ${m.label}` : "")
                }
                preview={m.outcomePreview}
                stale={false}
                onClick={() => {
                  setActiveMissionId(m.missionId);
                  setActiveSection("mission-control");
                }}
              />
            );
          })}
        </div>
      )}

      {/* Local-only fallback records (B6: visibly marked as stale) */}
      {hasLocalOnly && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 pt-1">
            Local-only (not confirmed by server)
          </p>
          {localOnlyEntries.map((m) => {
            const status = m.lastSnapshot?.status ?? "UNKNOWN";
            const tone = STATUS_TONE[status] ?? STATUS_TONE.UNKNOWN;
            return (
              <MissionRow
                key={m.missionId}
                missionId={m.missionId}
                status={tone.label}
                statusTone={tone.className}
                subtitle={
                  `First seen ${new Date(m.firstSeenAt).toLocaleString()}` +
                  (m.source === "submit" ? " · submitted" : " · looked up") +
                  (m.lastObservedAt ? ` · last observed ${new Date(m.lastObservedAt).toLocaleTimeString()}` : "")
                }
                preview={m.lastSnapshot?.goalOutcome}
                stale
                onClick={() => {
                  setActiveMissionId(m.missionId);
                  setActiveSection("mission-control");
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function MissionRow({
  missionId,
  status,
  statusTone,
  subtitle,
  preview,
  stale,
  onClick,
}: {
  missionId: string;
  status: string;
  statusTone: string;
  subtitle: string;
  preview?: string;
  stale: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left",
        "transition-colors hover:bg-accent",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        stale && "opacity-60",
      )}
      aria-label={`Open mission ${missionId.slice(0, 8)} in Mission Control. Status: ${status}.${stale ? " Stale — not confirmed by server." : ""}`}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium",
          statusTone,
        )}
      >
        {status}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate font-mono text-xs">{missionId}</p>
        <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
        {preview && (
          <p className="text-[10px] text-muted-foreground/70 truncate">{preview}</p>
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

/**
 * B7 — Persistence disclosure. Makes the in-process / restart-not-durable
 * limitation explicit. Does NOT claim durable mission history.
 *
 * The retention period (5 minutes) is verified against
 * DEFAULT_TERMINAL_RETENTION_MS in src/gateway/mission-service.ts.
 */
function PersistenceDisclosure() {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground" role="note">
      <strong>Server-owned, in-process.</strong> This mission list is maintained
      by the running Gateway. Completed missions may be removed after the
      configured retention period (5 minutes), and the list is{" "}
      <strong>not preserved across Gateway restarts</strong>. Flight records and
      artifact evidence persist separately via their own durable APIs.
    </div>
  );
}

/**
 * MissionLookup — resolve a known mission ID by manual entry.
 *
 * Per 02_PRODUCT_SPECIFICATION §Work §Mission list: "If list unavailable,
 * support known-ID lookup and label limitation; never invent history."
 *
 * Per the gateway contract (G7-01 capability matrix): GET /v1/missions/{id}
 * returns 200 with MissionSnapshot, 404 if not found OR not owned by caller
 * (intentional ambiguity). UI maps both to "not found or not yours" honestly.
 */
export function MissionLookup() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState<string | undefined>();
  const upsertKnownMission = useGenesisStore((s) => s.upsertKnownMission);
  const knownMissions = useGenesisStore((s) => s.knownMissions);
  const setActiveMissionId = useGenesisStore((s) => s.setActiveMissionId);
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const lookup = async () => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setState("error");
      setError("Enter a mission ID to look up.");
      return;
    }
    setState("loading");
    setError(undefined);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const res = await genesisApi.getMission(trimmed, controller.signal);

    if (res.kind === "ok" && res.data) {
      const snap = res.data as MissionSnapshot;
      setState("ok");
      upsertKnownMission({
        missionId: snap.missionId,
        firstSeenAt:
          knownMissions[snap.missionId]?.firstSeenAt ??
          new Date().toISOString(),
        lastSnapshot: snap,
        lastObservedAt: new Date().toISOString(),
        source: "lookup",
      });
      setActiveMissionId(snap.missionId);
      setActiveSection("mission-control");
      return;
    }

    setState("error");
    if (res.kind === "unauthorized") {
      setError(
        "Authentication failed. The BFF session may have expired; refresh the page.",
      );
    } else if (res.kind === "unavailable") {
      setError(
        "Gateway unreachable. Cannot look up the mission. Try when the gateway is back online.",
      );
    } else if (res.code === "MISSION_NOT_FOUND") {
      setError(
        "Mission not found — or it is not owned by this caller. The gateway returns 404 in both cases (intentional ambiguity) to avoid leaking the existence of other callers' missions.",
      );
    } else if (res.code === "ADMISSION_DENIED") {
      setError("Rate limit reached. Wait a moment and try again.");
    } else {
      setError(res.message ?? "Lookup failed.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Look up a mission by ID</CardTitle>
        <CardDescription className="text-xs">
          If you know the server-canonical mission ID (e.g., from a previous
          submission), enter it here to open the mission in Mission Control.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && state !== "loading") {
                e.preventDefault();
                void lookup();
              }
            }}
            placeholder="e.g., 7c8b9a1d-..."
            aria-label="Mission ID to look up"
            aria-invalid={state === "error" ? "true" : undefined}
            aria-describedby={error ? "mission-lookup-error" : undefined}
            disabled={state === "loading"}
            className="font-mono text-sm"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void lookup()}
            disabled={state === "loading" || query.trim().length === 0}
            className="gap-1.5"
          >
            {state === "loading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Look up</span>
          </Button>
        </div>
        {state === "error" && error && (
          <p
            id="mission-lookup-error"
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-1.5 text-xs text-destructive"
          >
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        {state === "ok" && (
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-success"
          >
            Mission resolved. Navigating to Mission Control…
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Re-export Inbox icon for callers.
export { Inbox };
