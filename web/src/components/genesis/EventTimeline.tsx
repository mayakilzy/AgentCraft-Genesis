"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type { MissionEventRecord, MissionSnapshot } from "@/lib/genesis/types";
import { getEventSummary, getEventTypeMeta, TONE_CLASS } from "@/lib/genesis/events";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 1500;
const MAX_EVENTS_LABEL = "100"; // gateway's hardcoded cap

interface EventTimelineProps {
  missionId: string;
  snapshot: MissionSnapshot | undefined;
  onStaleChange?: (stale: boolean) => void;
}

/**
 * EventTimeline — polls /v1/missions/{id}/events every 1.5s while the
 * mission is RUNNING (or non-terminal). Stops polling when terminal.
 *
 * Per 04_GATEWAY_DISCOVERY §Event contract + 03_UI_UX_CONTRACT §Mission Control:
 *   - Dedup events by stable server-side `seq` (never by timestamp).
 *   - NEVER infer terminal status from stream close. Terminal status comes
 *     only from the mission snapshot.
 *   - Show explicit "Last observed at" + stale indicator when polls fail.
 *   - Show the 100-event cap notice (gateway hardcodes offset=0, limit=100).
 *   - Out-of-order timestamps do NOT reorder causal transitions blindly.
 *
 * Polling is bounded: AbortController per poll, cleaned up on unmount.
 */
export function EventTimeline({ missionId, snapshot, onStaleChange }: EventTimelineProps) {
  const [events, setEvents] = useState<readonly MissionEventRecord[]>([]);
  const [lastObservedAt, setLastObservedAt] = useState<string | undefined>();
  const [stale, setStale] = useState(false);
  const [polling, setPolling] = useState(false);
  const seenSeqsRef = useRef<Set<number>>(new Set());

  const isTerminal = snapshot?.terminal ?? false;

  useEffect(() => {
    // Reset state when missionId changes.
    setEvents([]);
    setLastObservedAt(undefined);
    setStale(false);
    seenSeqsRef.current = new Set();
  }, [missionId]);

  useEffect(() => {
    if (isTerminal) {
      // Stop polling once terminal. The events are already captured.
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      if (cancelled) return;
      setPolling(true);
      try {
        const res = await genesisApi.getEvents(missionId, controller.signal);
        if (cancelled) return;
        if (res.kind === "ok" && res.data) {
          const newEvents = res.data.events.filter(
            (e) => !seenSeqsRef.current.has(e.seq),
          );
          for (const e of newEvents) {
            seenSeqsRef.current.add(e.seq);
          }
          // Append in seq order; do NOT reorder by timestamp (causal transitions).
          if (newEvents.length > 0) {
            setEvents((prev) =>
              [...prev, ...newEvents].sort((a, b) => a.seq - b.seq),
            );
          }
          setLastObservedAt(new Date().toISOString());
          setStale(false);
          onStaleChange?.(false);
        } else if (res.kind === "unauthorized") {
          setStale(true);
          onStaleChange?.(true);
        } else if (res.kind === "unavailable") {
          setStale(true);
          onStaleChange?.(true);
        } else {
          setStale(true);
          onStaleChange?.(true);
        }
      } catch {
        if (cancelled) return;
        setStale(true);
        onStaleChange?.(true);
      } finally {
        if (!cancelled) setPolling(false);
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
     
  }, [missionId, isTerminal]);

  if (events.length === 0 && !stale) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-md border border-dashed border-border">
        {polling ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Clock className="size-3.5" aria-hidden="true" />
        )}
        <span>
          {isTerminal
            ? "Mission is terminal. No events to display."
            : polling
              ? "Polling for events…"
              : "Waiting for the first event."}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {events.length} event{events.length === 1 ? "" : "s"} observed
          {lastObservedAt && (
            <> · last observed {new Date(lastObservedAt).toLocaleTimeString()}</>
          )}
        </span>
        {stale && (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1 text-warning"
          >
            <WifiOff className="size-3" aria-hidden="true" />
            Stale — connection lost, showing last observed state
          </span>
        )}
      </div>

      {events.length >= Number(MAX_EVENTS_LABEL) && (
        <div
          role="note"
          className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning"
        >
          <strong>Gateway limit:</strong> the events endpoint returns at most
          the first {MAX_EVENTS_LABEL} events per request (offset is hardcoded
          to 0 in the gateway v1). Events beyond the first {MAX_EVENTS_LABEL}{" "}
          are not retrievable through the public API.
        </div>
      )}

      <ol
        className="space-y-1.5 max-h-[480px] overflow-y-auto scrollbar-clean pr-1"
        aria-label="Mission event timeline"
      >
        {events.map((e) => {
          const meta = getEventTypeMeta(e.type);
          const Icon = meta.icon;
          const summary = getEventSummary(e.type, e.payload);
          return (
            <li
              key={e.seq}
              className="flex items-start gap-2 rounded-md border border-border bg-card p-2 text-xs"
            >
              <span
                className={cn(
                  "inline-flex shrink-0 size-6 items-center justify-center rounded-md border",
                  TONE_CLASS[meta.tone],
                )}
                aria-hidden="true"
              >
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{meta.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    #{e.seq}
                  </span>
                </div>
                {summary && (
                  <p className="text-muted-foreground font-mono text-[10px] break-words">
                    {summary}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  <time dateTime={e.timestamp}>
                    {new Date(e.timestamp).toLocaleString()}
                  </time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {isTerminal && (
        <div className="rounded-md border border-success/30 bg-success/5 p-2 text-[11px] text-success flex items-center gap-1.5">
          <RefreshCw className="size-3" aria-hidden="true" />
          Mission reached terminal state — polling stopped.
        </div>
      )}
    </div>
  );
}

// Re-export icons for the parent component.
export { AlertTriangle };
