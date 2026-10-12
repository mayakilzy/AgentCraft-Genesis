/**
 * D+ Task B01 — Responsibility & Artifact Ownership Contract.
 *
 * Closes the "responsibility ≠ capability" gap from Task A. In Task A,
 * `inferDeliverableKind()` read `genome.skills` (which mirrors
 * `capabilityNeeds`) to decide whether the worker must run executable
 * acceptance checks. This is a capability proxy, not an assignment
 * contract: a worker with `code-execution` skill might be assigned a
 * documentation-only task, and vice versa.
 *
 * B01 introduces an explicit `OwnershipContract` that records:
 * - The worker's assigned responsibility (from `ROLE_TEMPLATES`).
 * - The deliverable kind (inferred from capability, but overridable by role).
 * - The artifact paths the worker is expected to own (produce).
 * - The upstream dependencies (artifacts the worker may consume).
 * - The applicable worker-level acceptance checks.
 *
 * ## How it works
 *
 * 1. `ROLE_TEMPLATES` in `organization-planner.ts` (NON-FROZEN) is
 *    extended with an optional 3rd element: `ownedArtifacts` — a list
 *    of glob-like path patterns the role typically produces.
 * 2. `buildSpecialists()` passes the ownedArtifacts into the
 *    `responsibility` string (since `PlannedWorker.responsibility` is
 *    the only field available without frozen changes).
 * 3. `parseOwnershipFromResponsibility()` (this module) parses the
 *    structured prefix back out of the responsibility string, producing
 *    an `OwnershipContract`.
 * 4. The `WorkerAgent` (NON-FROZEN) reads the contract from the task
 *    brief and uses it in `checkCompletion()` to decide which
 *    acceptance checks apply to THIS worker (not the whole mission).
 *
 * ## What this does NOT do
 *
 * - It does NOT modify frozen contracts (`PlannedWorker`, `WorkerGenome`,
 *   `GenomeCompiler`, `orchestrator.ts`).
 * - It does NOT implement cross-worker handoff (Task B02).
 * - It does NOT implement final package acceptance (Task B03).
 * - It does NOT introduce a new role ontology — the existing
 *   `ROLE_TEMPLATES` are reused, just annotated.
 *
 * ## Why responsibility string parsing is acceptable here
 *
 * Task A's `inferDeliverableKind()` reads `genome.skills` — a frozen
 * enum. B01 reads `responsibility` string — but only a structured
 * prefix that B01 itself wrote. The parsing is deterministic (the
 * prefix has a fixed format), and the source of truth is the
 * `ROLE_TEMPLATES` table, not LLM-generated text. If the prefix is
 * absent (e.g., a Sole Operator or Generalist without ownedArtifacts),
 * the contract falls back to the Task A behavior.
 */

import type { CapabilityNeed } from '../contracts/core.js';
import { detectExecutableMentions, type ExecutableAcceptanceMention } from '../runtime/acceptance-integrity.js';
import { inferDeliverableKind, type DeliverableKind } from './completion-policy.js';

// ---------------------------------------------------------------------------
// OwnershipContract — the structured per-worker assignment
// ---------------------------------------------------------------------------

/**
 * The per-worker ownership contract. Records what the worker is
 * responsible for, what it owns, what it consumes, and which
 * acceptance checks apply to it specifically (not the whole mission).
 */
export interface OwnershipContract {
  /** The worker's stable ID (e.g., "software-engineer-1"). */
  readonly workerId: string;
  /** The worker's role name (e.g., "Software Engineer"). */
  readonly role: string;
  /** The human-readable responsibility text. */
  readonly responsibility: string;
  /** The deliverable kind, inferred from capability needs. */
  readonly deliverableKind: DeliverableKind;
  /**
   * Artifact path patterns this worker is expected to OWN (produce).
   * Patterns are glob-like: "src/**" matches any path under src/.
   * Empty array means "no specific ownership declared" — the worker
   * may produce whatever the mission requires.
   */
  readonly ownedArtifacts: readonly string[];
  /**
   * Upstream worker IDs whose artifacts this worker may consume.
   * Empty array means "no upstream dependencies" — the worker is
   * self-contained.
   */
  readonly upstreamDependencies: readonly string[];
  /**
   * The executable acceptance checks that apply to THIS worker.
   * Derived from the goal text's executable mentions, but scoped to
   * this worker's deliverableKind. A documentation worker does not
   * inherit code-test obligations even if the goal mentions "npm test".
   */
  readonly applicableChecks: readonly ExecutableAcceptanceMention[];
}

// ---------------------------------------------------------------------------
// Owned-artifact pattern matching
// ---------------------------------------------------------------------------

/**
 * Match an artifact path against an ownership pattern.
 *
 * Patterns support:
 * - Exact path: "package.json" matches "package.json"
 * - Directory glob: "src/**" matches "src/index.js", "src/store.js", etc.
 * - Prefix glob: "test/*" matches "test/app.test.js" (single level)
 *
 * @param pattern the ownership pattern (e.g., "src/**")
 * @param path the artifact path (e.g., "src/index.js")
 * @returns true if the path matches the pattern
 */
export function matchesOwnership(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(prefix + '/');
  }
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    if (!path.startsWith(prefix + '/')) return false;
    const rest = path.slice(prefix.length + 1);
    return !rest.includes('/');
  }
  return false;
}

/**
 * Check if a worker owns a given artifact path.
 *
 * @param contract the worker's ownership contract
 * @param path the artifact path
 * @returns true if the contract's ownedArtifacts match the path
 */
export function ownsArtifact(contract: OwnershipContract, path: string): boolean {
  if (contract.ownedArtifacts.length === 0) return false;
  return contract.ownedArtifacts.some((p) => matchesOwnership(p, path));
}

// ---------------------------------------------------------------------------
// Applicable acceptance checks — scoped to the worker's deliverable kind
// ---------------------------------------------------------------------------

/**
 * Determine which executable acceptance checks apply to a specific worker.
 *
 * The goal text may mention multiple executable checks (e.g., "npm test"
 * and "yarn test"). Not all apply to every worker:
 * - `testable-code` workers must run checks whose `requiredFile` (e.g.,
 *   `package.json`) matches their ownedArtifacts.
 * - `documentation`, `data-analysis`, `research`, `general` workers are
 *   NOT required to run executable checks, even if the goal mentions them.
 *
 * @param mentions all executable mentions detected from the goal text
 * @param contract the worker's ownership contract
 * @returns the subset of mentions that apply to this worker
 */
export function applicableAcceptanceChecks(
  mentions: readonly ExecutableAcceptanceMention[],
  contract: OwnershipContract,
): readonly ExecutableAcceptanceMention[] {
  // Only testable-code workers have executable acceptance obligations.
  if (contract.deliverableKind !== 'testable-code') {
    return [];
  }
  // For testable-code workers, all executable mentions apply IF the
  // worker owns the requiredFile (e.g., package.json). If the worker
  // has no ownedArtifacts declared, all mentions apply (backward compat
  // with Task A behavior).
  if (contract.ownedArtifacts.length === 0) {
    return mentions;
  }
  return mentions.filter((m) => ownsArtifact(contract, m.requiredFile));
}

// ---------------------------------------------------------------------------
// OwnershipContract construction
// ---------------------------------------------------------------------------

/**
 * Build an ownership contract for a worker.
 *
 * @param workerId the worker's stable ID
 * @param role the worker's role name
 * @param responsibility the responsibility string (may contain ownership prefix)
 * @param capabilityNeeds the worker's capability needs (frozen enum)
 * @param ownedArtifacts the artifacts the worker owns (from ROLE_TEMPLATES)
 * @param upstreamDependencies the upstream worker IDs this worker consumes from
 * @param goalText the goal text (for executable mention detection)
 */
export function buildOwnershipContract(
  workerId: string,
  role: string,
  responsibility: string,
  capabilityNeeds: readonly CapabilityNeed[],
  ownedArtifacts: readonly string[],
  upstreamDependencies: readonly string[],
  goalText: string,
): OwnershipContract {
  const deliverableKind = inferDeliverableKind(capabilityNeeds);
  const mentions = detectExecutableMentions(goalText);
  const contract: OwnershipContract = {
    workerId,
    role,
    responsibility,
    deliverableKind,
    ownedArtifacts,
    upstreamDependencies,
    applicableChecks: [], // filled below
  };
  // Use a mutable copy to set applicableChecks
  const applicable = applicableAcceptanceChecks(mentions, contract);
  return { ...contract, applicableChecks: applicable };
}

// ---------------------------------------------------------------------------
// Responsibility string prefix encoding
// ---------------------------------------------------------------------------

/**
 * The structured prefix marker. The responsibility string in
 * `PlannedWorker` carries the ownership contract as a parseable prefix
 * so it can flow through the frozen `renderTaskBrief()` without
 * requiring a frozen-contract change.
 *
 * Format: `[owns:pattern1,pattern2] responsibility text`
 *
 * Example: `[owns:src/**,test/**,package.json] Implements, runs and fixes the code changes`
 *
 * If the prefix is absent, the contract falls back to Task A behavior
 * (no ownedArtifacts declared → all applicable checks apply).
 */
const OWNERSHIP_PREFIX_RE = /^\[owns:([^\]]*)\]\s*(.*)$/s;

/**
 * Parse the ownership prefix from a responsibility string.
 *
 * @param responsibility the responsibility string (may contain `[owns:...]` prefix)
 * @returns `{ ownedArtifacts, cleanResponsibility }` — ownedArtifacts is
 *   empty if no prefix is present; cleanResponsibility is the text
 *   without the prefix.
 */
export function parseOwnershipPrefix(responsibility: string): {
  ownedArtifacts: readonly string[];
  cleanResponsibility: string;
} {
  const match = OWNERSHIP_PREFIX_RE.exec(responsibility);
  if (match === null) {
    return { ownedArtifacts: [], cleanResponsibility: responsibility };
  }
  const patterns = match[1]!.trim();
  const ownedArtifacts = patterns === ''
    ? []
    : patterns.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const cleanResponsibility = match[2]!.trim();
  return { ownedArtifacts, cleanResponsibility };
}

/**
 * Encode ownership as a responsibility string prefix.
 *
 * Inverse of `parseOwnershipPrefix()`. Used by `buildSpecialists()` to
 * attach the ownership contract to the `PlannedWorker.responsibility`
 * field.
 *
 * @param ownedArtifacts the owned artifact patterns
 * @param responsibility the clean responsibility text
 * @returns the responsibility string with `[owns:...]` prefix
 */
export function encodeOwnershipPrefix(
  ownedArtifacts: readonly string[],
  responsibility: string,
): string {
  if (ownedArtifacts.length === 0) return responsibility;
  return `[owns: ${ownedArtifacts.join(', ')}] ${responsibility}`;
}

// ---------------------------------------------------------------------------
// Rendering the contract for the worker brief
// ---------------------------------------------------------------------------

/**
 * Render the ownership contract as a human-readable brief suffix.
 *
 * This text is appended to the worker's task brief (via the
 * `workerBriefSuffix` hook or as part of the responsibility string) so
 * the LLM knows:
 * - Which files it owns (must produce).
 * - Which files it may consume from upstream (read-only, in B02).
 * - Which acceptance checks apply to it specifically.
 *
 * The text is informational for the LLM; the enforcement is in
 * `checkCompletion()` and (in B02) the read-only staging mechanism.
 */
export function renderOwnershipBrief(contract: OwnershipContract): string {
  const lines: string[] = [
    'YOUR OWNERSHIP CONTRACT (D+ B01):',
    `- Your role: ${contract.role}`,
    `- Your responsibility: ${contract.responsibility}`,
    `- Your deliverable kind: ${contract.deliverableKind}`,
  ];
  if (contract.ownedArtifacts.length > 0) {
    lines.push(`- Files you OWN (produce): ${contract.ownedArtifacts.join(', ')}`);
    lines.push('  Do NOT reproduce files owned by other workers. If you need a file');
    lines.push('  that another worker produces, wait for their output (B02 handoff).');
  } else {
    lines.push('- Files you OWN: (not specifically declared — produce what the mission requires)');
  }
  if (contract.upstreamDependencies.length > 0) {
    lines.push(`- Upstream dependencies: ${contract.upstreamDependencies.join(', ')}`);
    lines.push('  Their artifacts will be staged to your workspace under upstream/<id>/ (B02).');
  } else {
    lines.push('- Upstream dependencies: (none — you are self-contained)');
  }
  if (contract.applicableChecks.length > 0) {
    lines.push(`- Acceptance checks YOU must satisfy:`);
    for (const check of contract.applicableChecks) {
      lines.push(`  - "${check.command}" must exit ${check.expectExit}`);
    }
    lines.push('  Run these via run_command before calling finish. The completion gate');
    lines.push('  will reject finish if these checks have not passed on your current workspace.');
  } else {
    lines.push('- Acceptance checks YOU must satisfy: (none — executable checks are for code workers)');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { ExecutableAcceptanceMention };
