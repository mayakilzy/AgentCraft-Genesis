"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type { MissionSnapshot } from "@/lib/genesis/types";
import { extractWorkers } from "@/lib/genesis/events";
import { EventTimeline } from "@/components/genesis/EventTimeline";
import { WorkerCards } from "@/components/genesis/WorkerCards";
import { CancelFlow } from "@/components/genesis/CancelFlow";
import { EmptyState } from "@/components/genesis/EmptyState";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 1500;

const STATUS_TONE: Record<string, string> = {
  ACCEPTED: "bg-muted text-muted-foreground border-border",
  RUNNING: "bg-primary/10 text-primary border-primary/30",
  SUCCEEDED: "bg-success/15 text-success border-success/30",
  FAILED: "bg-destructive/15 text-destructive border-destructive/30",
  PARTIAL: "bg-warning/15 text-warning border-warning/30",
  CANCELLATION_REQUESTED: "bg-warning/15 text-warning border-warning/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

/**
 * MissionControlDetail — the full Mission Control view for a selected mission.
 *
 * Per 02_PRODUCT_SPECIFICATION §Mission Control + 03_UI_UX_CONTRACT §Mission Control:
 *   - Mission identity, status, last-observed timestamp, active workers,
 *     events, supported actions.
 *   - Polling-based event stream (no SSE/WebSocket in gateway v1).
 *   - Cancellation confirmed server-side.
 *   - Approvals/Pause/Resume controls NOT shown (gateway v1 doesn't expose
 *     the WAITING_FOR_APPROVAL status).
 *
 * Layout: status header → cancel action → event timeline + worker cards.
 */
export function MissionControlDetail({ missionId }: { missionId: string }) {
  const [snapshot, setSnapshot] = useState<MissionSnapshot | undefined>();
  const [lastObservedAt, setLastObservedAt] = useState<string | undefined>();
  const [staleStream, setStaleStream] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const upsertKnownMission = useGenesisStore((s) => s.upsertKnownMission);
  const knownMissions = useGenesisStore((s) => s.knownMissions);

  // Poll the mission snapshot. Stop when terminal.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    const poll = async () => {
      if (cancelled) return;
      const res = await genesisApi.getMission(missionId, controller.signal);
      if (cancelled) return;
      if (res.kind === "ok" && res.data) {
        setSnapshot(res.data);
        const now = new Date().toISOString();
        setLastObservedAt(now);
        setStaleStream(false);
        upsertKnownMission({
          missionId,
          firstSeenAt:
            knownMissions[missionId]?.firstSeenAt ?? new Date().toISOString(),
          lastSnapshot: res.data,
          lastObservedAt: now,
          source: knownMissions[missionId]?.source ?? "lookup",
        });
      } else if (res.kind === "unauthorized") {
        setStaleStream(true);
      } else if (res.kind === "unavailable") {
        setStaleStream(true);
      } else if (res.code === "MISSION_NOT_FOUND") {
        // Mission no longer retrievable (gateway restart lost state).
        setStaleStream(true);
      }
    };

    void poll();
    const isTerminal = snapshot?.terminal ?? false;
    const interval = isTerminal ? null : setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      if (interval) clearInterval(interval);
    };
  }, [missionId, snapshot?.terminal, upsertKnownMission, knownMissions]);

  // Extract workers from the events we've seen.
  // We poll /events separately in EventTimeline; but we need the events
  // to extract workers. We'll keep a local events state here too.
  const [events, setEvents] = useState<
    readonly { seq: number; timestamp: string; type: string; payload: Readonly<Record<string, unknown>> }[]
  >([]);
  const seenSeqsRef = useRef<Set<number>>(new Set());

  // Poll events to populate worker cards. EventTimeline also polls — we
  // duplicate here because the worker extraction needs the raw events.
  // (A future refactor could lift events to a shared hook.)
  useEffect(() => {
    if (snapshot?.terminal) return;
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      if (cancelled) return;
      const res = await genesisApi.getEvents(missionId, controller.signal);
      if (cancelled) return;
      if (res.kind === "ok" && res.data) {
        const newOnes = res.data.events.filter(
          (e) => !seenSeqsRef.current.has(e.seq),
        );
        for (const e of newOnes) seenSeqsRef.current.add(e.seq);
        if (newOnes.length > 0) {
          setEvents((prev) =>
            [...prev, ...newOnes].sort((a, b) => a.seq - b.seq),
          );
        }
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [missionId, snapshot?.terminal]);

  const workers = useMemo(() => extractWorkers(events), [events]);

  const status = snapshot?.status ?? "UNKNOWN";
  const tone = STATUS_TONE[status] ?? STATUS_TONE.UNKNOWN ?? "bg-muted text-muted-foreground border-border";

  return (
    <div className="space-y-4">
      {/* Mission header card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className="font-mono text-xs truncate" title={missionId}>
                {missionId}
              </CardTitle>
              <CardDescription className="text-[11px]">
                {snapshot?.goalOutcome
                  ? truncate(snapshot.goalOutcome, 100)
                  : "Goal outcome not yet observed."}
              </CardDescription>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                tone,
              )}
              aria-label={`Mission status: ${status}`}
            >
              {status}
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 grid-cols-2 sm:grid-cols-4 text-xs">
          <Header label="Accepted at" value={snapshot?.acceptedAt ? new Date(snapshot.acceptedAt).toLocaleString() : undefined} />
          <Header label="Finished at" value={snapshot?.finishedAt ? new Date(snapshot.finishedAt).toLocaleString() : undefined} />
          <Header label="Last observed" value={lastObservedAt ? new Date(lastObservedAt).toLocaleTimeString() : undefined} />
          <Header label="Terminal" value={snapshot?.terminal ? "yes" : "no"} />
        </CardContent>
      </Card>

      {/* Stale indicator */}
      {staleStream && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning flex items-center gap-1.5"
        >
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Connection lost — showing last observed state where applicable.
          {snapshot?.terminal === false && (
            <> Mission may have transitioned without our knowledge.</>
          )}
        </div>
      )}

      {/* Cancel action */}
      <CancelFlow
        missionId={missionId}
        currentStatus={snapshot?.status}
        terminal={snapshot?.terminal ?? false}
      />

      {/* Event timeline + worker cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="size-4" aria-hidden="true" />
              Event timeline
            </CardTitle>
            <CardDescription className="text-xs">
              Polled every 1.5s while the mission is non-terminal. Events
              deduplicated by stable server-side sequence number.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EventTimeline
              missionId={missionId}
              snapshot={snapshot}
              onStaleChange={setStaleStream}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Workers ({Object.keys(workers).length})</CardTitle>
            <CardDescription className="text-xs">
              Extracted from <code className="font-mono">plan-created</code>,{" "}
              <code className="font-mono">genomes-compiled</code>, and worker
              lifecycle events. Missing fields are shown as &quot;Not provided&quot;.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkerCards workers={workers} />
          </CardContent>
        </Card>
      </div>

      {/* Outcome (when terminal) */}
      {snapshot?.terminal && snapshot.result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Outcome</CardTitle>
            <CardDescription className="text-xs">
              Terminal result returned by the gateway.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p>
              <strong>Status:</strong> {snapshot.result.status}
            </p>
            <p>
              <strong>Summary:</strong> {snapshot.result.summary}
            </p>
            {snapshot.failureClass && (
              <p className="text-destructive">
                <strong>Failure class:</strong> {snapshot.failureClass}
                {snapshot.failureMessage && ` — ${snapshot.failureMessage}`}
              </p>
            )}
            {snapshot.result.evidence.length > 0 && (
              <div>
                <strong>Evidence ({snapshot.result.evidence.length}):</strong>
                <ul className="ml-4 list-disc space-y-0.5 mt-1">
                  {snapshot.result.evidence.map((ev, i) => (
                    <li key={i}>
                      <span className="font-mono text-[10px]">{ev.kind}</span>:{" "}
                      {ev.description}{" "}
                      <span className="text-muted-foreground">({ev.location})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="text-muted-foreground">
              <strong>Cost:</strong>{" "}
              wallMs={snapshot.result.cost.wallMs}, tokens={snapshot.result.cost.tokens},
              usd={snapshot.result.cost.usd} (usd shown as $0 if not metered — see
              Insights in G7-06), humanInterventions={snapshot.result.cost.humanInterventions}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approval controls NOT shown — gateway v1 doesn't expose them */}
      <div className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
        <strong>Note:</strong> Approvals / Pause / Resume controls are NOT
        shown. The contract field <code className="font-mono">Goal.approvals</code>{" "}
        exists but is not advertised by gateway v1 (no{" "}
        <code className="font-mono">WAITING_FOR_APPROVAL</code> status). HITL
        would require a material backend change — deferred per operator
        decision.
      </div>
    </div>
  );
}

function Header({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={value ? "text-foreground" : "text-muted-foreground/60 italic"}>
        {value ?? "Not yet observed"}
      </p>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Re-export EmptyState for the parent section.
export { EmptyState };
