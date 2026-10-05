import type { GoalRequirements } from '../contracts/core.js';
import type { WorkerLoopEvent } from '../worker/worker-agent.js';
import type { HandoffEvent } from '../worker/handoff.js';

/**
 * Flight Recorder port (TASK-014 delivers the durable file recorder).
 *
 * The vocabulary is defined here because the Mission Orchestrator (TASK-012)
 * is its first consumer: a recorder must capture enough to REBUILD what
 * happened in a mission — the organization, the decisions, the actions, the
 * failures — without storing transcripts as if they were knowledge. Raw logs
 * stay separate from the structured record; no secrets are ever recorded.
 *
 * Worker-scope events (worker-started/step/finished) and handoffs reuse the
 * shapes the worker loop and channel already emit; mission-scope events carry
 * the missionId. A file recorder scopes records per mission file, so worker
 * events do not need to repeat it.
 */

export interface MissionEventMissionStarted {
  readonly type: 'mission-started';
  readonly at: string;
  readonly missionId: string;
  readonly goalOutcome: string;
  readonly budgetUsd: number;
}

export interface MissionEventRequirementsCompiled {
  readonly type: 'requirements-compiled';
  readonly missionId: string;
  readonly domain: GoalRequirements['domain'];
  readonly capabilityNeeds: readonly string[];
  readonly successCriteria: readonly string[];
  readonly budgetUsd: number;
}

export interface MissionEventPlanCreated {
  readonly type: 'plan-created';
  readonly missionId: string;
  readonly workers: readonly { id: string; role: string; needs: readonly string[] }[];
  readonly rationale: string;
}

export interface MissionEventGenomesCompiled {
  readonly type: 'genomes-compiled';
  readonly missionId: string;
  readonly workers: readonly {
    id: string;
    tier: string;
    tools: readonly string[];
    computerRequired: boolean;
  }[];
  readonly gaps: readonly { workerId: string; need: string; reason: string }[];
}

export interface MissionEventVerification {
  readonly type: 'verification';
  readonly missionId: string;
  readonly ok: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly failures: readonly string[];
}

export interface MissionEventWorkerRetry {
  readonly type: 'worker-retry';
  readonly missionId: string;
  readonly workerId: string;
  readonly reason: string;
}

export interface MissionEventMissionFinished {
  readonly type: 'mission-finished';
  readonly at: string;
  readonly missionId: string;
  readonly status: 'success' | 'partial' | 'failure';
  readonly wallMs: number;
  readonly reasoningCalls: number;
}

export interface MissionEventHumanIntervention {
  readonly type: 'human-intervention';
  readonly missionId: string;
  readonly note: string;
}

/** The structured flight record vocabulary. */
export type FlightEvent =
  | MissionEventMissionStarted
  | MissionEventRequirementsCompiled
  | MissionEventPlanCreated
  | MissionEventGenomesCompiled
  | MissionEventVerification
  | MissionEventWorkerRetry
  | MissionEventMissionFinished
  | MissionEventHumanIntervention
  | WorkerLoopEvent
  | HandoffEvent;

/** The port mission components emit structured events through. */
export interface FlightRecorder {
  record(event: FlightEvent): void;
}

/** Collects events in memory — tests and small inline runs. */
export class MemoryFlightRecorder implements FlightRecorder {
  readonly events: FlightEvent[] = [];

  record(event: FlightEvent): void {
    this.events.push(event);
  }
}
