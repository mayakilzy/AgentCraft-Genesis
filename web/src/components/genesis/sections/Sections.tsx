"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Target, Users, Activity, FileText, Wrench, BarChart3, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/genesis/EmptyState";
import { useGenesisStore } from "@/lib/genesis/store";
import { GoalComposer } from "@/components/genesis/GoalComposer";
import { MissionList, MissionLookup } from "@/components/genesis/MissionList";
import { MissionControlDetail } from "@/components/genesis/MissionControlDetail";
import { WorkerCards } from "@/components/genesis/WorkerCards";
import { ArtifactList } from "@/components/genesis/ArtifactList";
import { ArtifactPreview } from "@/components/genesis/ArtifactPreview";
import { ReplayTimeline } from "@/components/genesis/ReplayTimeline";
import { StudioCatalog } from "@/components/genesis/StudioCatalog";
import { InsightsSection as InsightsSectionImpl } from "@/components/genesis/InsightsSection";
import { extractWorkers } from "@/lib/genesis/events";
import { genesisApi } from "@/lib/genesis/client";
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
                Server-authoritative listing from the gateway&apos;s in-process
                registry. Completed missions are evicted after a retention
                window, and the list is not preserved across gateway restarts.
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
  const missionId = useGenesisStore((s) => s.activeMissionId);
  const connectionState = useGenesisStore((s) => s.connectionState);
  const [selectedArtifact, setSelectedArtifact] = useState<
    import("@/lib/genesis/types").MissionArtifactRecord | null
  >(null);
  // Poll events for the ReplayTimeline.
  const [events, setEvents] = useState<readonly MissionEventRecord[]>([]);
  const seenSeqsRef = useRef<Set<number>>(new Set());

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
    const interval = setInterval(() => void poll(), 2500); // 2.5s for Artifacts section
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [missionId]);

  if (!missionId) {
    return (
      <div className="space-y-4">
        <SectionHeader
          icon={FileText}
          title="Artifacts & Replay"
          description="Actual files/outputs, verification state, provenance and recorded-event replay (not re-run)."
        />
        <EmptyState
          state={connectionState === "disconnected" ? "disconnected" : "empty"}
          customDescription="No mission selected. Submit a goal in Work or look one up by ID, then switch to Artifacts & Replay to inspect outputs and recorded events."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={FileText}
        title="Artifacts & Replay"
        description="Actual files/outputs, verification state, provenance and recorded-event replay (not re-run)."
      />
      <InfoCard title="Verification originates from engine evidence only" tone="info">
        Verification status (VERIFIED / UNVERIFIED / UNKNOWN / NOT_AVAILABLE) is
        read from the gateway&apos;s{" "}
        <code className="font-mono">artifact.verified</code> field — never inferred
        from mission success, artifact presence, filename, or UI heuristics. The
        gateway computes it from the actual VerificationResult captured when the
        mission finished. No separate /verification endpoint exists in v1.
      </InfoCard>
      <InfoCard title="Safe preview + sandboxed download" tone="info">
        Only text/markdown/image/PDF are previewed inline. HTML, SVG, XML, JS,
        CSS, and JSON render as ESCAPED text source code — never executed.
        Downloads use the authenticated BFF boundary (no public URLs, no Gateway
        API key exposure). Filenames are sanitized to basename only.
      </InfoCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Artifacts</h2>
          <ArtifactList
            missionId={missionId}
            onSelectArtifact={setSelectedArtifact}
            selectedPath={selectedArtifact?.path}
          />
          {selectedArtifact && (
            <div className="rounded-lg border border-border bg-card p-3">
              <h3 className="text-xs font-medium mb-2">Preview</h3>
              <ArtifactPreview
                artifact={selectedArtifact}
                onClose={() => setSelectedArtifact(null)}
              />
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-medium">Recorded-event Replay</h2>
          <ReplayTimeline
            missionId={missionId}
            events={events}
            truncated={events.length >= 100}
          />
        </div>
      </div>
    </div>
  );
}

export function StudioSection() {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Wrench}
        title="Studio"
        description="Capabilities, skills, tools, integrations and their trust/connection status (read-only)."
      />
      <InfoCard title="Read-only catalog — no plugin manager" tone="info">
        The gateway has no <code>/capabilities</code> endpoint in v1. This
        catalog is loaded from the controlled <code>data/</code> directory
        (YAML files). Statuses are DOCUMENTED (YAML only) or INTEGRATED
        (verified source wiring). RUNTIME_VERIFIED requires actual runtime
        probing and is NOT claimed. No Install / Connect / Enable / Execute
        actions — read-only.
      </InfoCard>
      <StudioCatalog />
    </div>
  );
}

export function InsightsSection() {
  return <InsightsSectionImpl />;
}
