/**
 * AgentCraft Genesis — Minimal Contracts (frozen for Genesis Born, Phase 1).
 *
 * TASK-005. These are the ONLY contracts GROUP 1..2 (Genesis Born) needs.
 * Rules honored here:
 *   - no field without a current consumer (compiler, planner, router, or tests);
 *   - no lifecycle mega-state-machine, no enterprise RBAC, no event ontology;
 *   - upstream types are used directly where safe — nothing below copies an
 *     upstream schema (the first real protocol consumers arrive in GROUP 2+);
 *   - Muse/Dot/Bot worker flavors are NOT types: they are presets over one
 *     unified WorkerGenome.
 *
 * Chain expressed by these contracts:
 *   Goal → GoalRequirements → OrganizationPlan → WorkerGenome[] → Provider Decisions
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/**
 * Cognitive resource tier. Deliberately NOT a provider/model name: the
 * Cognitive Router maps tiers to concrete providers (TASK-009), so no
 * provider name ever leaks into plans or genomes.
 */
export type ReasoningTier = 'cheap' | 'default' | 'frontier';

/** Coarse mission classification that drives organization shape (TASK-006/007). */
export type MissionDomain =
  | 'research'
  | 'software-engineering'
  | 'diagnostic'
  | 'general';

/**
 * Mission-level capability need. The five literals are the needs v0.1 knows how
 * to satisfy from the ownership registry; the open `string` lets future (or
 * test) needs flow through the same path and surface as structured capability
 * gaps instead of silent guesses (TASK-008).
 */
export type CapabilityNeed =
  | 'web-research'
  | 'code-execution'
  | 'document-authoring'
  | 'data-analysis'
  | 'browser-verification'
  | (string & {});

// ---------------------------------------------------------------------------
// Goal & compiled requirements (TASK-006)
// ---------------------------------------------------------------------------

/** Human-level spending hint attached to a goal, before compilation. */
export interface BudgetHint {
  /** Maximum total mission spend in USD. */
  readonly maxUsd?: number;
  /** Preferred cognitive tier ceiling for the whole mission. */
  readonly tier?: ReasoningTier;
}

/**
 * A human goal: the outcome Genesis is given. This is the ONLY input the
 * pipeline receives — never a team, never worker names.
 */
export interface Goal {
  /** One or two sentences describing the desired outcome. */
  readonly outcome: string;
  /** Optional background the compiler carries into requirements. */
  readonly context?: string;
  /** Human-stated constraints, e.g. "must run offline". */
  readonly constraints?: readonly string[];
  /** Optional spending hint. */
  readonly budget?: BudgetHint;
  /** Actions requiring human approval, e.g. "sending emails to vendors". */
  readonly approvals?: readonly string[];
}

/** A measurable or checkable success criterion synthesized by the compiler. */
export interface SuccessCriterion {
  readonly description: string;
  readonly kind: 'artifact' | 'tests-pass' | 'evidence';
}

/** Resolved mission budget after compilation (defaults applied). */
export interface Budget {
  /** Maximum total mission spend in USD. */
  readonly maxUsd: number;
  /** Cognitive tier ceiling for the mission. */
  readonly tier: ReasoningTier;
}

/**
 * Structured, provider-agnostic requirements compiled from a Goal.
 * Consumed by the Organization Planner (TASK-007) and the Genome
 * Compiler (TASK-008).
 */
export interface GoalRequirements {
  /** The original goal, unchanged. */
  readonly source: Goal;
  /** Coarse domain classification. */
  readonly domain: MissionDomain;
  /** Success criteria any organization must satisfy. */
  readonly successCriteria: readonly SuccessCriterion[];
  /** Hard constraints echoed from the goal plus domain invariants. */
  readonly hardConstraints: readonly string[];
  /** Capability needs the organization must cover. */
  readonly capabilityNeeds: readonly CapabilityNeed[];
  /** Resolved budget (defaults applied when the goal gave no hint). */
  readonly budget: Budget;
  /** Approvals that force supervised autonomy. */
  readonly approvals: readonly string[];
}

// ---------------------------------------------------------------------------
// Organization plan (TASK-007)
// ---------------------------------------------------------------------------

/** A planned worker as a logical role — not a runtime instance. */
export interface PlannedWorker {
  /** Stable logical id assigned by the planner, e.g. "web-researcher-1". */
  readonly id: string;
  /** Logical role title, e.g. "Web Researcher". */
  readonly role: string;
  /** What this worker is accountable for. */
  readonly responsibility: string;
  /** Mission capability needs this worker must cover. */
  readonly capabilityNeeds: readonly CapabilityNeed[];
}

/** A collaboration edge between two planned workers. */
export interface CollaborationEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'report' | 'handoff';
}

/**
 * The logical organization designed for one mission. Consumed by the Genome
 * Compiler (TASK-008); materialized into runtime workers in GROUP 2.
 */
export interface OrganizationPlan {
  /** Human-readable justification of this organization shape. */
  readonly rationale: string;
  readonly workers: readonly PlannedWorker[];
  readonly collaboration: readonly CollaborationEdge[];
  /** The capability needs this plan is accountable for covering. */
  readonly capabilityNeeds: readonly CapabilityNeed[];
}

// ---------------------------------------------------------------------------
// Worker genome (TASK-005 spec + TASK-008 producer)
// ---------------------------------------------------------------------------

/** Genome identity: planner-assigned id plus a human-facing display name. */
export interface WorkerIdentity {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Execution environment requirements, mapped from the ownership registry.
 * `computer` fields mirror OpenBot's canonical computer capabilities.
 */
export interface ComputerSpec {
  /** Whether the worker needs a dedicated (OpenBot) computer at all. */
  readonly required: boolean;
  /** Chromium browser with persistent profile. */
  readonly browser: boolean;
  /** Shell execution inside the container. */
  readonly shell: boolean;
  /** Persistent /workspace files. */
  readonly workspace: boolean;
}

/**
 * Worker memory strategy. 'shared-thread' maps to CopilotKit Intelligence
 * threads (canonical owner of threads/memory) — never a Genesis memory engine.
 */
export type MemorySpec = 'none' | 'shared-thread';

/** Spending ceiling for one worker (a slice of the mission budget). */
export interface WorkerBudget {
  readonly maxUsd: number;
  readonly maxTier: ReasoningTier;
}

/**
 * Autonomy level. 'supervised' means the worker must obtain human approval
 * before the actions listed in the goal's approvals.
 */
export type AutonomyLevel = 'autonomous' | 'supervised';

/**
 * The Minimal Worker Genome v0.1 — exactly the ten baseline fields from the
 * founding architecture: identity, role, objective, model, skills, tools,
 * computer, memory, budget, autonomy. No MuseWorker/DotWorker/BotWorker
 * subclasses exist or will exist: flavors are presets over this genome.
 */
export interface WorkerGenome {
  readonly identity: WorkerIdentity;
  readonly role: string;
  readonly objective: string;
  /** Reasoning tier (never a provider name — see ReasoningTier). */
  readonly model: ReasoningTier;
  readonly skills: readonly string[];
  /** Upstream capability grants, as "<owner>:<domain>" registry keys. */
  readonly tools: readonly string[];
  readonly computer: ComputerSpec;
  readonly memory: MemorySpec;
  readonly budget: WorkerBudget;
  readonly autonomy: AutonomyLevel;
}

/**
 * A structured capability gap: returned instead of a guessed genome when a
 * planned worker needs a capability no canonical owner satisfies (TASK-008).
 */
export interface CapabilityGap {
  readonly workerId: string;
  readonly need: CapabilityNeed;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Mission result (frozen now; consumed by the Verification Loop in GROUP 2)
// ---------------------------------------------------------------------------

/** Evidence backing a mission result. */
export interface Evidence {
  readonly kind: 'artifact' | 'log' | 'test-run' | 'metric';
  readonly description: string;
  readonly location: string;
}

/** Measured mission cost. */
export interface MissionCost {
  readonly usd: number;
  readonly tokens: number;
  readonly wallMs: number;
  readonly humanInterventions: number;
}

/** The verified outcome of a mission (produced in GROUP 2). */
export interface MissionResult {
  readonly status: 'success' | 'partial' | 'failure';
  readonly summary: string;
  readonly evidence: readonly Evidence[];
  readonly cost: MissionCost;
}

// ---------------------------------------------------------------------------
// Runtime adapter boundary (frozen now; implemented against OpenBot in TASK-010)
// ---------------------------------------------------------------------------

/** Opaque handle to a running worker environment, produced by a RuntimeAdapter. */
export interface RuntimeHandle {
  readonly workerId: string;
  /** Adapter-specific opaque reference — never interpreted by Genesis core. */
  readonly ref: string;
}

/**
 * The thin boundary to a real execution runtime. OpenBot is the canonical
 * implementation target (GROUP 2); the interface keeps the alpha upstream
 * isolated behind an adapter instead of deep imports.
 */
export interface RuntimeAdapter {
  readonly name: string;
  ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle>;
  stopWorker(handle: RuntimeHandle): Promise<void>;
}

// ---------------------------------------------------------------------------
// Decision & reasoning providers (TASK-009)
// ---------------------------------------------------------------------------

/** A bounded decision: choose exactly one of the named options. */
export interface Decision<T extends string = string> {
  /** Decision kind, e.g. 'reasoning-tier'. */
  readonly kind: string;
  /** The question, human-readable. */
  readonly question: string;
  /** Named options to choose from. */
  readonly options: readonly T[];
  /** Structured facts the decider may use. */
  readonly facts: Readonly<Record<string, string | number | boolean>>;
}

/** A resolved decision with a traceable reason. */
export interface DecisionOutcome<T extends string = string> {
  readonly choice: T;
  readonly reason: string;
  /** Which provider decided (for telemetry, never for plan content). */
  readonly provider: string;
}

/**
 * Chooses among bounded options. Implementations: rules (deterministic),
 * statistics, LLM-backed — and potentially Jev later, which is why Jev needs
 * no interface of its own: it can implement this one once access is verified.
 */
export interface DecisionProvider {
  readonly name: string;
  decide<T extends string>(request: Decision<T>): Promise<DecisionOutcome<T>>;
}

/** Input to an open-ended reasoning call. */
export interface ReasoningInput {
  readonly system?: string;
  readonly prompt: string;
  readonly tier: ReasoningTier;
}

/** Output of an open-ended reasoning call. */
export interface ReasoningOutput {
  readonly text: string;
}

/**
 * Open-ended reasoning capability (an LLM behind a thin interface). Providers
 * are replaceable by design — Genesis must never depend on a single vendor.
 */
export interface ReasoningProvider {
  readonly name: string;
  reason(input: ReasoningInput): Promise<ReasoningOutput>;
}

// ---------------------------------------------------------------------------
// Cognitive routing contract (TASK-008 consumer, TASK-009 producer)
// ---------------------------------------------------------------------------

/** Facts the cognitive router uses to select a reasoning tier for a worker. */
export interface TierSelection {
  readonly roleId: string;
  readonly role: string;
  readonly criticality: 'routine' | 'important' | 'mission-critical';
  readonly missionDomain: MissionDomain;
  /** Tier ceiling imposed by the mission budget, if any. */
  readonly budgetCeiling?: ReasoningTier;
}

/**
 * Structural port consumed by the Genome Compiler. Satisfied by the
 * CognitiveRouter (TASK-009); tests inject deterministic stubs.
 */
export type TierSelector = (selection: TierSelection) => Promise<ReasoningTier>;
