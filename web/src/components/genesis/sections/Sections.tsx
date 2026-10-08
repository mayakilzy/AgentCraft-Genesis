"use client";

import { Target, Users, Activity, FileText, Wrench, BarChart3, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/genesis/EmptyState";
import { useGenesisStore } from "@/lib/genesis/store";
import { GoalComposer } from "@/components/genesis/GoalComposer";
import { MissionList, MissionLookup } from "@/components/genesis/MissionList";
import { MissionControlDetail } from "@/components/genesis/MissionControlDetail";
import { WorkerCards } from "@/components/genesis/WorkerCards";
import { extractWorkers } from "@/lib/genesis/events";
import { genesisApi } from "@/lib/genesis/client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MissionEventRecord } from "@/lib/genesis/types";
import { cn } from "@/lib/utils";

/**
 * SectionHeader — accessible title + description for each section.
 */
export function SectionHeader({
  icon: Icon,
  title,
  description,
  badge,
}: {
  icon: typeof Target;
  title: string;
  description: string;
  badge?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-2">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary"
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-tight sm:text-xl">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {badge ? <div>{badge}</div> : null}
    </header>
  );
}

/**
 * InfoCard — a compact callout for honest limitation notices.
 */
export function InfoCard({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "info" | "warning";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning/30 bg-warning/5 text-warning"
      : "border-border bg-muted/50 text-muted-foreground";
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-xs",
        toneClass,
      )}
      role="note"
    >
      <div className="flex items-start gap-2">
        <Info className="size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">{title}</p>
          <div className="text-foreground/80">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work — fully implemented in G7-02 (Goal Composer + Mission List + Lookup).
// ---------------------------------------------------------------------------

export function WorkSection() {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Target}
        title="Work"
        description="Goal composer, submissions, mission list and outcome."
      />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Goal composer</CardTitle>
            <CardDescription>
              Compose a goal, attach optional context and constraints, and submit.
              The gateway returns a canonical mission ID after acceptance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoalComposer />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Mission list</CardTitle>
              <CardDescription>
                Missions known to this browser session. The gateway has no list
                endpoint, so this list is browser-local and not
                server-authoritative.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MissionList />
            </CardContent>
          </Card>
          <MissionLookup />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// G7-03..G7-06 PLACEHOLDER SECTIONS — minimal honest shells. Detailed
// implementation arrives in those groups.
// ---------------------------------------------------------------------------

export function AgentSection() {
  const missionId = useGenesisStore((s) => s.activeMissionId);
  const connectionState = useGenesisStore((s) => s.connectionState);
  const [events, setEvents] = useState<readonly MissionEventRecord[]>([]);
  const seenSeqsRef = useRef<Set<number>>(new Set());

  // Poll events for the active mission to populate the organization list.
  useEffect(() => {
    if (!missionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEvents([]);
      seenSeqsRef.current = new Set();
      return;
    }
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
    const interval = setInterval(() => void poll(), 2000); // 2s for Agent section
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [missionId]);

  const workers = useMemo(() => extractWorkers(events), [events]);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Users}
        title="Agent"
        description="Organization list/graph, roles, genomes, capabilities and execution ownership."
      />
      <InfoCard title="Read-only organization view" tone="info">
        Worker genomes are inferred from mission events only — the gateway has
        no <code>/workers</code> endpoint. Missing fields are shown as
        &quot;Not provided&quot;, never guessed. The list is for the currently
        selected mission; switch to Mission Control to see live event details.
      </InfoCard>
      {missionId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span>Organization for mission {missionId.slice(0, 8)}…</span>
              <span className="text-xs text-muted-foreground font-normal">
                {Object.keys(workers).length} worker{Object.keys(workers).length === 1 ? "" : "s"}
              </span>
            </CardTitle>
            <CardDescription className="text-xs">
              Workers are extracted from <code className="font-mono">plan-created</code>,
              <code className="font-mono">genomes-compiled</code>, and worker
              lifecycle events. Fields not present in event payloads are
              shown as &quot;Not provided&quot;.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkerCards workers={workers} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          state={connectionState === "disconnected" ? "disconnected" : "empty"}
          customDescription="No mission selected. Submit a goal in Work or look up a known mission ID, then switch to Agent to inspect the organization."
        />
      )}
    </div>
  );
}

export function MissionControlSection() {
  const connectionState = useGenesisStore((s) => s.connectionState);
  const missionId = useGenesisStore((s) => s.activeMissionId);
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Activity}
        title="Mission Control"
        description="Real-time mission lifecycle, timeline, worker actions, cancel controls and errors."
      />
      <InfoCard title="Polling-based stream (no SSE/WebSocket)" tone="info">
        The gateway exposes polling events (max 100 per response, no SSE/WebSocket
        in v1). The EventTimeline polls every 1.5s while the mission is
        non-terminal; events are deduplicated by stable server-side sequence
        number. Approvals / pause / resume controls are NOT shown (the contract
        field exists but is not exposed by gateway v1).
      </InfoCard>
      {missionId ? (
        <MissionControlDetail missionId={missionId} />
      ) : (
        <EmptyState
          state={connectionState === "disconnected" ? "disconnected" : "empty"}
          customDescription="No mission selected. Submit a goal in Work to begin, or look one up by ID."
        />
      )}
    </div>
  );
}

export function ArtifactsSection() {
  const connectionState = useGenesisStore((s) => s.connectionState);
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={FileText}
        title="Artifacts & Replay"
        description="Actual files/outputs, verification state, provenance and recorded-event replay (not re-run)."
      />
      <InfoCard title="G7-04 deliverable" tone="warning">
        Artifact list, safe preview, authorized download, verification panel,
        and recorded-event replay arrive in G7-04. Replay is a client-side
        navigation of recorded events — no tool execution or mission mutation.
      </InfoCard>
      <EmptyState
        state={connectionState === "disconnected" ? "disconnected" : "empty"}
        customDescription="No artifacts available. Artifacts appear once a terminal mission produces them."
      />
    </div>
  );
}

export function StudioSection() {
  const connectionState = useGenesisStore((s) => s.connectionState);
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Wrench}
        title="Studio"
        description="Capabilities, skills, tools, integrations and their trust/connection status (read-only)."
      />
      <InfoCard title="G7-05 deliverable" tone="warning">
        Capability catalog arrives in G7-05. The gateway has no
        <code>/capabilities</code> endpoint — Studio renders static
        <code>data/ownership.yaml</code> entries labeled &quot;Documentation
        only — not runtime discovery&quot;. No Install / Connect CTAs without
        real authorized backend workflows.
      </InfoCard>
      <EmptyState
        state={connectionState === "disconnected" ? "disconnected" : "empty"}
        customDescription="No capability discovery endpoint. Static documentation catalog arrives in G7-05."
      />
    </div>
  );
}

export function InsightsSection() {
  const connectionState = useGenesisStore((s) => s.connectionState);
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={BarChart3}
        title="Insights"
        description="Observed metrics, durations, failures, costs where metered, and learning evidence where actually wired."
      />
      <InfoCard title="G7-06 deliverable" tone="warning">
        Source-labeled metrics arrive in G7-06. Cost = $0 is shown as
        &quot;Not measured&quot; (never as success). Learning charts show
        &quot;No measurement available&quot; unless backed by Experience JSON
        (which is not served by the gateway). Per-mission metrics only — no
        aggregation endpoint exists.
      </InfoCard>
      <EmptyState
        state={connectionState === "disconnected" ? "disconnected" : "empty"}
        customDescription="No metrics available. Per-mission metrics arrive in G7-06 once a mission has terminated."
      />
    </div>
  );
}
