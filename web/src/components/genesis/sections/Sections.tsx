"use client";

import { Target, Users, Activity, FileText, Wrench, BarChart3, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/genesis/EmptyState";
import { useGenesisStore } from "@/lib/genesis/store";
import { GoalComposer } from "@/components/genesis/GoalComposer";
import { MissionList, MissionLookup } from "@/components/genesis/MissionList";
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
  const connectionState = useGenesisStore((s) => s.connectionState);
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Users}
        title="Agent"
        description="Organization list/graph, roles, genomes, capabilities and execution ownership."
      />
      <InfoCard title="G7-03 deliverable" tone="warning">
        The organization list and worker genome inspector are implemented in
        G7-03. Worker genomes are inferred from mission events only — the gateway
        has no <code>/workers</code> endpoint. Missing fields are shown as
        &quot;Not provided&quot;, never guessed.
      </InfoCard>
      <EmptyState
        state={connectionState === "disconnected" ? "disconnected" : "empty"}
        customDescription="No active organization. Worker cards appear here once a mission produces worker-started events."
      />
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
        description="Real-time mission lifecycle, timeline, worker actions, approval/cancel controls and errors."
      />
      <InfoCard title="G7-03 deliverable" tone="warning">
        Lifecycle timeline and worker actions are implemented in G7-03. The
        gateway exposes polling events (max 100 per response, no SSE/WebSocket).
        Approvals / pause / resume controls are NOT shown (the contract field
        exists but is not exposed by gateway v1).
      </InfoCard>
      {missionId ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Active mission <span className="font-mono text-xs text-muted-foreground">{missionId.slice(0, 8)}…</span>
            </CardTitle>
            <CardDescription>
              Detailed timeline arrives in G7-03. The connection state is
              shown in the top-right corner.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState state="empty" customDescription="Mission selected — detail view arrives in G7-03." />
          </CardContent>
        </Card>
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
