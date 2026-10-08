"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FastForward, Rewind, History, Info, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MissionEventRecord } from "@/lib/genesis/types";
import { getEventSummary, getEventTypeMeta, TONE_CLASS } from "@/lib/genesis/events";
import { cn } from "@/lib/utils";

interface ReplayTimelineProps {
  missionId: string;
  /** The recorded events to navigate. Must be the actual server-returned
   * events with their original seq + timestamp + type + payload. The UI
   * does NOT modify, sort by anything other than seq, or invent events. */
  events: readonly MissionEventRecord[];
  /** Whether the gateway's 100-event cap may have truncated history. */
  truncated: boolean;
}

/**
 * ReplayTimeline — client-side navigation of persisted event records.
 *
 * Per req #5: Replay means navigating persisted event records ONLY. It must
 * never rerun tools, invoke workers, modify files, or imply a complete
 * history when the Gateway's 100-event limit truncates records.
 *
 * Per req #6: Preserve the actual causal order and sequence identifiers.
 * Events are displayed in seq order (server-canonical). The user can step
 * forward/backward through the recorded timeline.
 *
 * NO tool execution, NO worker invocation, NO file mutation. The component
 * is purely a read-only viewer over the events array passed in.
 *
 * Per req #5 (last clause): If the gateway's 100-event limit truncated
 * history, the UI shows an honest notice — "Replay is limited to events
 * you have observed. Earlier events may be missing."
 */
export function ReplayTimeline({ missionId, events, truncated }: ReplayTimelineProps) {
  const [cursor, setCursor] = useState(0); // index into the events array

  const sortedEvents = useMemo(() => {
    // Sort by seq ascending — preserves causal order. Never reorder by
    // timestamp (out-of-order timestamps should not reorder causal transitions).
    return [...events].sort((a, b) => a.seq - b.seq);
  }, [events]);

  const currentEvent = sortedEvents[cursor];

  const stepPrev = () => setCursor((c) => Math.max(0, c - 1));
  const stepNext = () => setCursor((c) => Math.min(sortedEvents.length - 1, c + 1));
  const jumpFirst = () => setCursor(0);
  const jumpLast = () => setCursor(sortedEvents.length - 1);

  if (sortedEvents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground space-y-2">
        <History className="size-6 mx-auto opacity-50" aria-hidden="true" />
        <p className="font-medium">No recorded events to replay.</p>
        <p>
          Events appear here once the mission produces them. Replay navigates
          the recorded event timeline — no mission is being re-executed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Honest "replay is read-only" notice */}
      <div
        role="note"
        className="rounded-md border border-info/30 bg-info/5 p-2 text-[11px] text-info flex items-start gap-1.5"
      >
        <Info className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <strong>Recorded-event replay.</strong> This is a client-side
          navigation of persisted event records. No tools are executed, no
          workers are invoked, no files are modified. The recorded timeline
          is read-only.
        </div>
      </div>

      {/* Truncation notice (req #5 last clause) */}
      {truncated && (
        <div
          role="note"
          className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning flex items-start gap-1.5"
        >
          <Info className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <strong>Replay is limited to events you have observed.</strong>{" "}
            The gateway's polling API returns at most 100 events per request
            with offset hardcoded to 0. Events beyond the first 100 are not
            retrievable through the public API. This replay does NOT imply a
            complete history.
          </div>
        </div>
      )}

      {/* Replay controls */}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={jumpFirst}
          disabled={cursor === 0}
          aria-label="Jump to first event"
          className="h-7 w-7 p-0"
        >
          <Rewind className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={stepPrev}
          disabled={cursor === 0}
          aria-label="Previous event"
          className="h-7 w-7 p-0"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </Button>
        <span className="text-xs text-muted-foreground px-2 min-w-[120px] text-center font-mono">
          {cursor + 1} / {sortedEvents.length}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={stepNext}
          disabled={cursor >= sortedEvents.length - 1}
          aria-label="Next event"
          className="h-7 w-7 p-0"
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={jumpLast}
          disabled={cursor >= sortedEvents.length - 1}
          aria-label="Jump to last event"
          className="h-7 w-7 p-0"
        >
          <FastForward className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Current event detail */}
      {currentEvent && (
        <EventDetailCard event={currentEvent} />
      )}

      {/* Event list (compact) */}
      <ol
        className="space-y-1 max-h-[280px] overflow-y-auto scrollbar-clean pr-1"
        aria-label="Recorded event list"
      >
        {sortedEvents.map((e, i) => {
          const meta = getEventTypeMeta(e.type);
          const Icon = meta.icon;
          const isCurrent = i === cursor;
          return (
            <li key={e.seq}>
              <button
                type="button"
                onClick={() => setCursor(i)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-md border p-1.5 text-left text-[11px] transition-colors",
                  isCurrent
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-accent",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                )}
                aria-label={`Event #${e.seq} ${meta.label} at ${new Date(e.timestamp).toLocaleTimeString()}`}
                aria-current={isCurrent ? "true" : undefined}
              >
                <span
                  className={cn(
                    "inline-flex shrink-0 size-5 items-center justify-center rounded border",
                    TONE_CLASS[meta.tone],
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-3" aria-hidden="true" />
                </span>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  #{e.seq}
                </span>
                <span className="truncate flex-1">{meta.label}</span>
                <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EventDetailCard({ event }: { event: MissionEventRecord }) {
  const meta = getEventTypeMeta(event.type);
  const Icon = meta.icon;
  const summary = getEventSummary(event.type, event.payload);
  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md border",
            TONE_CLASS[meta.tone],
          )}
          aria-hidden="true"
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-sm">{meta.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              seq #{event.seq}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">{meta.description}</p>
        </div>
      </div>
      {summary && (
        <p className="text-xs font-mono text-muted-foreground break-words border-t border-border pt-2">
          {summary}
        </p>
      )}
      <div className="text-[10px] text-muted-foreground">
        <time dateTime={event.timestamp}>
          Recorded at: {new Date(event.timestamp).toLocaleString()}
        </time>
      </div>
      {Object.keys(event.payload).length > 0 && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Raw payload ({Object.keys(event.payload).length} fields)
          </summary>
          <pre className="mt-1 max-h-[200px] overflow-auto scrollbar-clean rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] whitespace-pre-wrap break-words">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// Re-export for parent.
export { Play, Pause };
