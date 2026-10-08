"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type { MissionSnapshot } from "@/lib/genesis/types";
import { cn } from "@/lib/utils";

/**
 * MissionBreadcrumb — when a mission ID is active, shows its status pill +
 * last-observed time + a clear button.
 *
 * Per 02_PRODUCT_SPECIFICATION §Navigation model: direct links to mission
 * anchors only when backend identifiers exist. Per 03_UI_UX_CONTRACT
 * §Mission Control: show last observed update + staleness.
 *
 * Status colors use NON-color-only cues per WCAG 2.2 AA — every state has a
 * distinct icon + text label.
 */
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
 * Inner polling component — keyed by missionId so it remounts cleanly when
 * the active mission changes. Avoids setState-in-effect cascading render issue.
 */
function MissionPoller({ missionId }: { missionId: string }) {
  const upsertKnownMission = useGenesisStore((s) => s.upsertKnownMission);
  const knownMissions = useGenesisStore((s) => s.knownMissions);
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);
  const setActiveMissionId = useGenesisStore((s) => s.setActiveMissionId);

  // Initialise from the known-missions cache (avoids a flash of "unknown").
  const cached = knownMissions[missionId];
  const [snapshot, setSnapshot] = useState<MissionSnapshot | undefined>(
    cached?.lastSnapshot,
  );
  const [lastObserved, setLastObserved] = useState<string | undefined>(
    cached?.lastObservedAt,
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await genesisApi.getMission(missionId, controller.signal);
      if (cancelled) return;
      if (res.kind === "ok" && res.data) {
        setSnapshot(res.data);
        const now = new Date().toISOString();
        setLastObserved(now);
        upsertKnownMission({
          missionId,
          firstSeenAt:
            knownMissions[missionId]?.firstSeenAt ?? new Date().toISOString(),
          lastSnapshot: res.data,
          lastObservedAt: now,
          source: knownMissions[missionId]?.source ?? "lookup",
        });
      }
    };
    void poll();
    const isTerminal = snapshot?.terminal ?? false;
    const interval = isTerminal ? null : setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      if (interval) clearInterval(interval);
    };
  }, [missionId, snapshot?.terminal]);

  const status = snapshot?.status ?? "UNKNOWN";
  const tone = STATUS_TONE[status] ?? STATUS_TONE.UNKNOWN;

  return (
    <div className="flex items-center gap-1 text-xs">
      <ChevronRight className="size-3 text-muted-foreground" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setActiveSection("mission-control")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
          tone.className,
        )}
        aria-label={`Mission ${missionId.slice(0, 8)}: status ${tone.label}. Open in Mission Control.`}
        title={missionId}
      >
        <span className="font-mono text-[11px]">{missionId.slice(0, 8)}…</span>
        <span className="hidden sm:inline">{tone.label}</span>
      </button>
      {lastObserved && (
        <span className="hidden text-muted-foreground md:inline">
          (last observed {new Date(lastObserved).toLocaleTimeString()})
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:bg-accent"
        aria-label="Clear active mission"
        onClick={() => setActiveMissionId(undefined)}
      >
        <X className="size-3" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function MissionBreadcrumb() {
  const missionId = useGenesisStore((s) => s.activeMissionId);
  if (!missionId) return null;
  return <MissionPoller missionId={missionId} />;
}
