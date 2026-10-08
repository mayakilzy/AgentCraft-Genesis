"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  HelpCircle,
  Loader2,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type { MissionEventRecord, MissionSnapshot } from "@/lib/genesis/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Metric types (req: clear distinction between measured/derived/unavailable)
// ---------------------------------------------------------------------------

export type MetricKind =
  /** Directly measured by the gateway and returned in MissionResult.cost or
   * MissionSnapshot. The value comes from the server, not derived. */
  | "MEASURED"
  /** Derived from other observed data (e.g., counting flight events). The
   * value is computed by the UI from observed records. */
  | "DERIVED"
  /** Not available — the gateway does not expose this metric, or the value
   * is 0 in a way that means "not measured" (e.g., usd=0 in dev mode means
   * cost is not metered, NOT that the mission cost $0). */
  | "NOT_AVAILABLE";

export interface MetricMeta {
  /** Human-readable label. */
  readonly label: string;
  /** Lucide icon component. */
  readonly icon: typeof Clock;
  /** Whether the value is MEASURED, DERIVED, or NOT_AVAILABLE. */
  readonly kind: MetricKind;
  /** Unit (e.g., 'ms', 'tokens', 'USD', 'count'). */
  readonly unit: string;
  /** One-line honest description of what this metric means + its source. */
  readonly description: string;
}

const METRIC_META: Record<string, MetricMeta> = {
  wallMs: {
    label: "Wall-clock duration",
    icon: Clock,
    kind: "MEASURED",
    unit: "ms",
    description:
      "Real wall-clock time from mission acceptance to terminal. Source: MissionResult.cost.wallMs (gateway-measured).",
  },
  tokens: {
    label: "Tokens consumed",
    icon: Cpu,
    kind: "MEASURED",
    unit: "tokens",
    description:
      "Token count reported by the reasoning provider. Source: MissionResult.cost.tokens. In dev-mode stub, this is 0 (no real LLM).",
  },
  usd: {
    label: "Cost (USD)",
    icon: DollarSign,
    kind: "MEASURED",
    unit: "USD",
    description:
      "Dollar cost reported by the provider. Source: MissionResult.cost.usd. If $0, shown as 'Not measured' (dev-mode stub does not meter cost — NOT a $0 success).",
  },
  humanInterventions: {
    label: "Human interventions",
    icon: Users,
    kind: "MEASURED",
    unit: "count",
    description:
      "Number of human-in-the-loop interventions recorded. Source: MissionResult.cost.humanInterventions. Always 0 in gateway v1 (no HITL endpoint exposed).",
  },
  reasoningCalls: {
    label: "Reasoning calls",
    icon: Activity,
    kind: "DERIVED",
    unit: "count",
    description:
      "Count of worker-step + worker-finished events in the flight record. Source: derived from GET /v1/missions/{id}/events. Bounded by 100-event cap.",
  },
  workerCount: {
    label: "Worker count",
    icon: Users,
    kind: "DERIVED",
    unit: "count",
    description:
      "Number of workers in the organization plan. Source: derived from plan-created event payload. Bounded by 100-event cap.",
  },
  eventCount: {
    label: "Event count",
    icon: TrendingUp,
    kind: "DERIVED",
    unit: "count",
    description:
      "Total events observed for this mission. Source: derived from GET /v1/missions/{id}/events. Bounded by 100-event cap.",
  },
  verificationOk: {
    label: "Verification result",
    icon: CheckCircle2,
    kind: "DERIVED",
    unit: "boolean",
    description:
      "Whether the verification loop passed. Source: derived from verification event payload (ok field). Bounded by 100-event cap.",
  },
};

const POLL_INTERVAL_MS = 2500;

/**
 * InsightsSection — source-labeled metrics from MissionResult.cost + flight events.
 *
 * Per G7-06 acceptance:
 *   - Per-mission metrics only (no aggregation endpoint exists in gateway v1).
 *   - Clear distinction between MEASURED (gateway-returned), DERIVED (UI-computed
 *     from observed events), and NOT_AVAILABLE (gateway doesn't expose or $0 stub).
 *   - Cost (usd) shown as 'Not measured' when $0 — NEVER as success.
 *   - Learning charts: 'No measurement available' (Experience JSON not served).
 *   - Do NOT claim production readiness merely because the six UI groups pass.
 */
export function InsightsSection() {
  const missionId = useGenesisStore((s) => s.activeMissionId);
  const connectionState = useGenesisStore((s) => s.connectionState);
  const [snapshot, setSnapshot] = useState<MissionSnapshot | undefined>();
  const [events, setEvents] = useState<readonly MissionEventRecord[]>([]);
  const [lastObserved, setLastObserved] = useState<string | undefined>();
  const [stale, setStale] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!missionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapshot(undefined);
       
      setEvents([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    const poll = async () => {
      if (cancelled) return;
      const [snapRes, eventsRes] = await Promise.all([
        genesisApi.getMission(missionId, controller.signal),
        genesisApi.getEvents(missionId, controller.signal),
      ]);
      if (cancelled) return;
      let anyStale = false;
      if (snapRes.kind === "ok" && snapRes.data) {
        setSnapshot(snapRes.data);
        anyStale = false;
      } else if (snapRes.kind === "unavailable" || snapRes.kind === "unauthorized") {
        anyStale = true;
      }
      if (eventsRes.kind === "ok" && eventsRes.data) {
        setEvents(eventsRes.data.events);
      } else if (eventsRes.kind === "unavailable" || eventsRes.kind === "unauthorized") {
        anyStale = true;
      }
      setStale(anyStale);
      setLastObserved(new Date().toISOString());
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [missionId]);

  if (!missionId) {
    return (
      <div className="space-y-4">
        <SectionHeaderInline
          icon={BarChart3}
          title="Insights"
          description="Observed metrics, durations, failures, costs where metered, and learning evidence where actually wired."
        />
        <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground space-y-2">
          <BarChart3 className="size-6 mx-auto opacity-50" aria-hidden="true" />
          <p className="font-medium">No mission selected.</p>
          <p>
            Submit a goal in Work or look up a known mission ID, then switch
            to Insights to see per-mission metrics.
          </p>
        </div>
        <HonestNotices />
      </div>
    );
  }

  const cost = snapshot?.result?.cost;
  const isTerminal = snapshot?.terminal ?? false;
  const isControlled = connectionState === "stale" || connectionState === "disconnected";

  return (
    <div className="space-y-4">
      <SectionHeaderInline
        icon={BarChart3}
        title="Insights"
        description="Observed metrics, durations, failures, costs where metered, and learning evidence where actually wired."
      />

      <HonestNotices />

      {stale && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning flex items-center gap-1.5"
        >
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Connection lost — showing last observed metrics. Values may be stale.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between gap-2">
            <span>Per-mission metrics</span>
            <span className="text-xs text-muted-foreground font-normal font-mono truncate" title={missionId}>
              {missionId.slice(0, 12)}…
            </span>
          </CardTitle>
          <CardDescription className="text-xs">
            Source-labeled. MEASURED = gateway-returned. DERIVED = UI-computed
            from observed events. NOT_AVAILABLE = gateway doesn&apos;t expose or
            $0 stub.
            {!isTerminal && " Mission is non-terminal — metrics will update as the mission progresses."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* MEASURED metrics */}
          <MetricRow
            meta={METRIC_META.wallMs}
            value={cost?.wallMs}
            display={(v) => `${v} ms`}
            isTerminal={isTerminal}
          />
          <MetricRow
            meta={METRIC_META.tokens}
            value={cost?.tokens}
            display={(v) => v.toLocaleString()}
            isTerminal={isTerminal}
          />
          <MetricRow
            meta={METRIC_META.usd}
            value={cost?.usd}
            // CRITICAL: $0 → NOT_AVAILABLE (NOT $0 success)
            display={(v) => (typeof v === "number" && v > 0 ? `$${v.toFixed(4)}` : "Not measured")}
            overrideKind={cost?.usd === 0 ? "NOT_AVAILABLE" : undefined}
            isTerminal={isTerminal}
          />
          <MetricRow
            meta={METRIC_META.humanInterventions}
            value={cost?.humanInterventions}
            display={(v) => `${v}`}
            isTerminal={isTerminal}
          />

          {/* DERIVED metrics */}
          <MetricRow
            meta={METRIC_META.eventCount}
            value={events.length}
            display={(v) => `${v}`}
            isTerminal={isTerminal}
            note={events.length >= 100 ? "Gateway 100-event cap reached" : undefined}
          />
          <MetricRow
            meta={METRIC_META.workerCount}
            value={deriveWorkerCount(events)}
            display={(v) => `${v}`}
            isTerminal={isTerminal}
          />
          <MetricRow
            meta={METRIC_META.reasoningCalls}
            value={deriveReasoningCalls(events)}
            display={(v) => `${v}`}
            isTerminal={isTerminal}
          />
          <MetricRow
            meta={METRIC_META.verificationOk}
            value={deriveVerificationOk(events)}
            display={(v) => (v === null ? "Not observed" : v ? "Passed" : "Failed")}
            isTerminal={isTerminal}
          />

          {lastObserved && (
            <p className="text-[10px] text-muted-foreground pt-2 border-t border-border">
              Last observed: {new Date(lastObserved).toLocaleString()}
              {isControlled && " · controlled environment (dev-mode stubs)"}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Learning charts — honest 'not available' */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Learning & organizational patterns</CardTitle>
          <CardDescription className="text-xs">
            Experience JSON is not served by the gateway in v1.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground space-y-1">
            <HelpCircle className="size-5 mx-auto opacity-50" aria-hidden="true" />
            <p className="font-medium">No measurement available.</p>
            <p>
              Learning charts (pattern retrieval, application, override) require
              Experience JSON which the gateway does not expose. The{" "}
              <code className="font-mono">src/learning/</code> module exists in
              the engine but is not wired to a public read endpoint in v1.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Derive the worker count from the plan-created event payload.
 * Returns 0 if no plan-created event observed.
 */
function deriveWorkerCount(events: readonly MissionEventRecord[]): number {
  const planCreated = events.find((e) => e.type === "plan-created");
  if (!planCreated) return 0;
  const workers = planCreated.payload.workers;
  return Array.isArray(workers) ? workers.length : 0;
}

/**
 * Derive the reasoning-call count from worker-step events.
 * This is a UI-derived approximation — the gateway's MissionResult.cost
 * has the authoritative reasoningCalls field.
 */
function deriveReasoningCalls(events: readonly MissionEventRecord[]): number {
  return events.filter((e) => e.type === "worker-step").length;
}

/**
 * Derive the verification result from the verification event payload.
 * Returns null if no verification event observed.
 */
function deriveVerificationOk(events: readonly MissionEventRecord[]): boolean | null {
  const verif = events.find((e) => e.type === "verification");
  if (!verif) return null;
  return verif.payload.ok === true;
}

function MetricRow({
  meta,
  value,
  display,
  isTerminal,
  overrideKind,
  note,
}: {
  meta: MetricMeta;
  value: number | boolean | null | undefined;
  display: (v: number | boolean) => string;
  isTerminal: boolean;
  overrideKind?: MetricKind;
  note?: string;
}) {
  const Icon = meta.icon;
  const kind = overrideKind ?? meta.kind;
  const kindTone: Record<MetricKind, string> = {
    MEASURED: "bg-primary/10 text-primary border-primary/30",
    DERIVED: "bg-muted text-muted-foreground border-border",
    NOT_AVAILABLE: "bg-muted text-muted-foreground/60 border-border italic",
  };
  const kindLabel: Record<MetricKind, string> = {
    MEASURED: "Measured",
    DERIVED: "Derived",
    NOT_AVAILABLE: "Not available",
  };

  // If the mission is non-terminal and value is undefined, show "pending"
  const isPending = !isTerminal && value === undefined;
  const displayValue =
    value === undefined || value === null
      ? isPending
        ? "Pending…"
        : "Not available"
      : display(value as number | boolean);

  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-card p-2">
      <span
        className="inline-flex shrink-0 size-7 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium">{meta.label}</span>
          <Badge className={cn("shrink-0 gap-1 text-[10px]", kindTone[kind])}>
            {kindLabel[kind]}
          </Badge>
        </div>
        <p className="text-lg font-semibold font-mono">{displayValue}</p>
        <p className="text-[10px] text-muted-foreground">{meta.description}</p>
        {note && (
          <p className="text-[10px] text-warning">{note}</p>
        )}
      </div>
    </div>
  );
}

function SectionHeaderInline({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof BarChart3;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-4 flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary"
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold leading-tight sm:text-xl">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </header>
  );
}

function HonestNotices() {
  return (
    <div className="space-y-2">
      <div
        role="note"
        className="rounded-md border border-info/30 bg-info/5 p-2 text-[11px] text-info"
      >
        <strong>Per-mission metrics only.</strong> The gateway has no
        aggregation/metrics endpoint in v1. These metrics are for the
        currently selected mission only — no cross-mission totals,
        averages, or trends.
      </div>
      <div
        role="note"
        className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning"
      >
        <strong>Cost = $0 means &quot;Not measured&quot; — NOT $0 success.</strong>{" "}
        In the controlled environment, the dev-mode stub does not meter cost.
        Production cost requires a real provider with a costSource callback
        (not wired in v1).
      </div>
      <div
        role="note"
        className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground"
      >
        <strong>Controlled environment.</strong> Real ZAI/OpenBot integration
        is not claimed. The banner is permanent. Production deployment
        requires independent verification of the G6 operational conditions.
      </div>
    </div>
  );
}
