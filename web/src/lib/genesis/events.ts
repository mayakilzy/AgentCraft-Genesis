/**
 * AgentCraft Genesis G7-03 — Event type metadata.
 *
 * Maps the gateway's MissionEventRecord.type strings to UI metadata
 * (icon name, tone, human label). The gateway exposes events via
 * GET /v1/missions/{id}/events — each event has {seq, timestamp, type, payload}.
 *
 * The type strings come from src/mission/flight-recorder.ts FlightEvent
 * union + src/worker/worker-agent.ts WorkerLoopEvent + src/worker/handoff.ts
 * HandoffEvent. The UI does NOT invent types; it just renders what the
 * gateway returns. Unknown types get a generic fallback.
 *
 * Per 03_UI_UX_CONTRACT §Visual language: red reserved for confirmed errors;
 * no traffic-light color as sole state representation — every tone also has
 * an icon + text label.
 */

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileText,
  GitBranch,
  Layers,
  RefreshCw,
  Send,
  Settings,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";

export type EventTone = "info" | "success" | "warning" | "danger" | "neutral";

export interface EventTypeMeta {
  /** Human-readable label (NOT the raw type string). */
  label: string;
  /** Lucide icon component. */
  icon: LucideIcon;
  /** Tailwind color tone (with NON-color-only cues: icon + label). */
  tone: EventTone;
  /** One-line description shown in tooltips / a11y descriptions. */
  description: string;
}

const UNKNOWN_META: EventTypeMeta = {
  label: "Event",
  icon: Circle,
  tone: "neutral",
  description: "An event the UI does not have specific metadata for.",
};

const EVENT_TYPE_META: Record<string, EventTypeMeta> = {
  // Mission lifecycle
  "mission-started": {
    label: "Mission started",
    icon: Send,
    tone: "info",
    description: "The mission was accepted and the orchestrator is starting.",
  },
  "requirements-compiled": {
    label: "Requirements compiled",
    icon: Layers,
    tone: "info",
    description: "Goal was compiled into structured requirements.",
  },
  "plan-created": {
    label: "Organization plan created",
    icon: Users,
    tone: "info",
    description: "The planner designed the worker organization.",
  },
  "genomes-compiled": {
    label: "Worker genomes compiled",
    icon: Wrench,
    tone: "info",
    description: "Each planned worker was resolved to a concrete genome.",
  },
  "mission-finished": {
    label: "Mission finished",
    icon: CheckCircle2,
    tone: "success",
    description: "The orchestrator returned a terminal result.",
  },
  "human-intervention": {
    label: "Human intervention",
    icon: AlertTriangle,
    tone: "warning",
    description: "A human-in-the-loop note was recorded.",
  },

  // Worker lifecycle
  "worker-started": {
    label: "Worker started",
    icon: Activity,
    tone: "info",
    description: "A worker began executing its objective.",
  },
  "worker-step": {
    label: "Worker step",
    icon: Activity,
    tone: "neutral",
    description: "A worker performed an action (tool call, finish, etc.).",
  },
  "worker-finished": {
    label: "Worker finished",
    icon: CheckCircle2,
    tone: "info",
    description: "A worker returned a result (success or failure).",
  },
  "worker-retry": {
    label: "Worker retry",
    icon: RefreshCw,
    tone: "warning",
    description: "A worker is retrying a failed operation.",
  },
  handoff: {
    label: "Handoff",
    icon: Send,
    tone: "info",
    description: "One worker delegated a bounded task to another.",
  },

  // Verification + failures
  verification: {
    label: "Verification",
    icon: CheckCircle2,
    tone: "info",
    description: "The verification loop ran on the clean-room copy.",
  },
  "failure-classified": {
    label: "Failure classified",
    icon: AlertTriangle,
    tone: "danger",
    description: "A component classified a failure using the G6-01 taxonomy.",
  },

  // Repository + reasoning substitution
  repository: {
    label: "Repository event",
    icon: GitBranch,
    tone: "neutral",
    description: "Repository-side phase (worktree, integration, rollback).",
  },
  "reasoning-fallback": {
    label: "Reasoning fallback",
    icon: Settings,
    tone: "warning",
    description:
      "A reasoning call was served by the development fallback instead of the configured external provider.",
  },

  // Federation (G6-02)
  "federation-delegated": {
    label: "Federation delegated",
    icon: Send,
    tone: "info",
    description: "A bounded task was delegated to an external A2A agent.",
  },
  "federation-state-change": {
    label: "Federation state change",
    icon: Activity,
    tone: "neutral",
    description: "Remote task state changed (polled).",
  },
  "federation-result-received": {
    label: "Federation result received",
    icon: FileText,
    tone: "success",
    description: "Terminal result received from the remote agent.",
  },
  "federation-failed": {
    label: "Federation failed",
    icon: XCircle,
    tone: "danger",
    description: "Delegation failed.",
  },
  "federation-cancelled": {
    label: "Federation cancelled",
    icon: XCircle,
    tone: "neutral",
    description: "Delegation was cancelled (locally or remotely).",
  },
};

export function getEventTypeMeta(type: string): EventTypeMeta {
  return EVENT_TYPE_META[type] ?? UNKNOWN_META;
}

export const TONE_CLASS: Record<EventTone, string> = {
  info: "bg-primary/10 text-primary border-primary/30",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

/**
 * Extract a short summary string from an event payload, for the timeline list.
 * Returns the most relevant field per event type. Never invents data — if
 * no relevant field exists, returns "" (the UI shows the type label only).
 */
export function getEventSummary(
  type: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  const p = payload as Record<string, unknown>;
  switch (type) {
    case "mission-started":
      return typeof p.goalOutcome === "string" ? truncate(p.goalOutcome, 80) : "";
    case "requirements-compiled":
      return Array.isArray(p.capabilityNeeds)
        ? `${(p.capabilityNeeds as unknown[]).length} capability needs, domain=${String(p.domain ?? "?")}`
        : "";
    case "plan-created": {
      const workers = p.workers;
      return Array.isArray(workers)
        ? `${(workers as unknown[]).length} workers planned`
        : "";
    }
    case "genomes-compiled": {
      const workers = p.workers;
      const gaps = p.gaps;
      const wCount = Array.isArray(workers) ? (workers as unknown[]).length : 0;
      const gCount = Array.isArray(gaps) ? (gaps as unknown[]).length : 0;
      return `${wCount} genomes compiled${gCount > 0 ? `, ${gCount} capability gaps` : ""}`;
    }
    case "verification": {
      const ok = p.ok;
      const passed = p.passed;
      const failed = p.failed;
      return `ok=${String(ok)}, passed=${String(passed)}, failed=${String(failed)}`;
    }
    case "worker-started":
      return `workerId=${String(p.workerId ?? "?")}, role=${String(p.role ?? "?")}, tier=${String(p.tier ?? "?")}`;
    case "worker-step":
      return `workerId=${String(p.workerId ?? "?")}, step=${String(p.step ?? "?")}, action=${String(p.action ?? "?")}, ok=${String(p.ok ?? "?")}`;
    case "worker-finished":
      return `workerId=${String(p.workerId ?? "?")}`;
    case "worker-retry":
      return `workerId=${String(p.workerId ?? "?")}, reason=${truncate(String(p.reason ?? ""), 80)}`;
    case "handoff":
      return `from=${String(p.from ?? "?")} → to=${String(p.to ?? "?")}, ok=${String(p.ok ?? "?")}`;
    case "mission-finished":
      return `status=${String(p.status ?? "?")}, wallMs=${String(p.wallMs ?? "?")}`;
    case "human-intervention":
      return truncate(String(p.note ?? ""), 80);
    case "repository":
      return `phase=${String(p.phase ?? "?")}${p.branch ? `, branch=${String(p.branch)}` : ""}`;
    case "reasoning-fallback":
      return `phase=${String(p.phase ?? "?")}, actor=${String(p.fallback_actor ?? "?")}, tier=${String(p.tier ?? "?")}`;
    case "failure-classified":
      return `component=${String(p.component ?? "?")}, class=${String(p.failureClass ?? "?")}, retryable=${String(p.retryable ?? "?")}`;
    case "federation-delegated":
      return `agent=${String(p.externalAgentName ?? "?")}, taskChars=${String(p.taskChars ?? "?")}`;
    case "federation-state-change":
      return `task=${String(p.remoteTaskId ?? "?")}, state=${String(p.remoteState ?? "?")}`;
    case "federation-result-received":
      return `task=${String(p.remoteTaskId ?? "?")}, status=${String(p.status ?? "?")}`;
    case "federation-failed":
      return `task=${String(p.remoteTaskId ?? "?")}, class=${String(p.failureClass ?? "?")}`;
    case "federation-cancelled":
      return `task=${String(p.remoteTaskId ?? "?")}, reason=${truncate(String(p.reason ?? ""), 60)}`;
    default:
      return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Extract worker records from mission events. Returns a map of workerId →
 * observed fields. Missing fields are left undefined (the UI shows "Not
 * provided" rather than inventing values).
 *
 * Sources:
 *   - plan-created: {id, role, needs[]}
 *   - genomes-compiled: {id, tier, tools[], computerRequired}
 *   - worker-started: {workerId, role, tier}
 *   - worker-step: {workerId, action, ok, elapsedMs}
 *   - worker-finished: {workerId, result.status, result.summary, ...}
 *   - worker-retry: {workerId, reason}
 *   - handoff: {from, to, ok, reason}
 */
export interface ObservedWorker {
  /** Stable worker id. */
  readonly id: string;
  /** Role (from plan-created or worker-started). */
  readonly role?: string;
  /** Reasoning tier (from genomes-compiled or worker-started). */
  readonly tier?: string;
  /** Tools granted (from genomes-compiled). */
  readonly tools?: readonly string[];
  /** Whether the worker needs a computer (from genomes-compiled). */
  readonly computerRequired?: boolean;
  /** Capability needs (from plan-created). */
  readonly needs?: readonly string[];
  /** Most recent action (from worker-step). */
  readonly lastAction?: string;
  /** Most recent action's ok flag (from worker-step). */
  readonly lastActionOk?: boolean;
  /** Step count (incremented per worker-step). */
  readonly stepCount?: number;
  /** Terminal status (from worker-finished result.status). */
  readonly terminalStatus?: "success" | "failure";
  /** Terminal summary (from worker-finished result.summary). */
  readonly terminalSummary?: string;
  /** Last retry reason (from worker-retry). */
  readonly lastRetryReason?: string;
  /** Number of retries observed (incremented per worker-retry). */
  readonly retryCount?: number;
  /** First-seen event timestamp (ISO). */
  readonly firstSeenAt?: string;
  /** Last-observed event timestamp (ISO). */
  readonly lastObservedAt?: string;
}

export function extractWorkers(
  events: readonly { type: string; timestamp: string; payload: Readonly<Record<string, unknown>>; seq: number }[],
): Record<string, ObservedWorker> {
  const out: Record<string, ObservedWorker> = {};
  const update = (id: string, partial: Partial<ObservedWorker>, ts: string) => {
    const existing = out[id] ?? { id };
    out[id] = {
      ...existing,
      ...partial,
      firstSeenAt: existing.firstSeenAt ?? ts,
      lastObservedAt: ts,
      stepCount:
        partial.stepCount !== undefined
          ? (existing.stepCount ?? 0) + partial.stepCount
          : existing.stepCount,
      retryCount:
        partial.retryCount !== undefined
          ? (existing.retryCount ?? 0) + partial.retryCount
          : existing.retryCount,
    };
  };

  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case "plan-created": {
        const workers = p.workers;
        if (Array.isArray(workers)) {
          for (const w of workers as Array<Record<string, unknown>>) {
            const id = typeof w.id === "string" ? w.id : "";
            if (id) {
              update(
                id,
                {
                  role: typeof w.role === "string" ? w.role : undefined,
                  needs: Array.isArray(w.needs)
                    ? (w.needs as readonly string[])
                    : undefined,
                },
                e.timestamp,
              );
            }
          }
        }
        break;
      }
      case "genomes-compiled": {
        const workers = p.workers;
        if (Array.isArray(workers)) {
          for (const w of workers as Array<Record<string, unknown>>) {
            const id = typeof w.id === "string" ? w.id : "";
            if (id) {
              update(
                id,
                {
                  tier: typeof w.tier === "string" ? w.tier : undefined,
                  tools: Array.isArray(w.tools)
                    ? (w.tools as readonly string[])
                    : undefined,
                  computerRequired:
                    typeof w.computerRequired === "boolean"
                      ? w.computerRequired
                      : undefined,
                },
                e.timestamp,
              );
            }
          }
        }
        break;
      }
      case "worker-started": {
        const id = typeof p.workerId === "string" ? p.workerId : "";
        if (id) {
          update(
            id,
            {
              role: typeof p.role === "string" ? p.role : undefined,
              tier: typeof p.tier === "string" ? p.tier : undefined,
            },
            e.timestamp,
          );
        }
        break;
      }
      case "worker-step": {
        const id = typeof p.workerId === "string" ? p.workerId : "";
        if (id) {
          update(
            id,
            {
              lastAction: typeof p.action === "string" ? p.action : undefined,
              lastActionOk: typeof p.ok === "boolean" ? p.ok : undefined,
              stepCount: 1, // increment via update()
            },
            e.timestamp,
          );
        }
        break;
      }
      case "worker-finished": {
        const id = typeof p.workerId === "string" ? p.workerId : "";
        if (id) {
          const result = p.result as Record<string, unknown> | undefined;
          update(
            id,
            {
              terminalStatus:
                result?.status === "success" || result?.status === "failure"
                  ? result.status
                  : undefined,
              terminalSummary:
                typeof result?.summary === "string" ? result.summary : undefined,
            },
            e.timestamp,
          );
        }
        break;
      }
      case "worker-retry": {
        const id = typeof p.workerId === "string" ? p.workerId : "";
        if (id) {
          update(
            id,
            {
              lastRetryReason:
                typeof p.reason === "string" ? p.reason : undefined,
              retryCount: 1, // increment via update()
            },
            e.timestamp,
          );
        }
        break;
      }
      // handoff events don't create worker records (they reference existing ones)
      default:
        break;
    }
  }
  return out;
}
