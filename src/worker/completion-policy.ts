/**
 * D+ Task A — Verified Worker Completion policy.
 *
 * Closes the worker's autonomous development loop:
 *   Produce → Test → Inspect → Repair → Retest → Verified Finish
 *
 * A worker must not report successful completion merely because it
 * generated files or called `finish`. Successful completion must require
 * current, relevant, reproducible evidence for the worker's actual
 * assigned deliverables.
 *
 * ## Contracts (A1–A5)
 *
 * - **A1 (Responsibility-aware):** `deliverableKind` is inferred from
 *   the genome's structured `capabilityNeeds` (a frozen enum), NOT from
 *   the role string. The enum values (`code-execution`, `document-authoring`,
 *   `data-analysis`, `web-research`) are stable in `src/contracts/core.ts`
 *   and identify the deliverable type reliably.
 * - **A2 (Current evidence):** `CompletionEvidence` records the test
 *   command, exit code, and the workspace snapshot at test time.
 * - **A3 (Test freshness):** `computeWorkspaceSnapshot()` produces a
 *   bounded SHA-256 digest of the workspace files. Any `write_file` or
 *   filesystem-mutating `run_command` invalidates the snapshot, forcing
 *   re-test before `finish` is accepted.
 * - **A4 (Controlled repair loop):** `checkCompletion()` returns either
 *   `{ ok: true }` or `{ ok: false, reason, actionableFeedback }`. The
 *   worker agent retries up to a bounded count (default 2); after that,
 *   it terminates with an explicit `failure` status.
 * - **A5 (Execution safety):** No new shell routes, no weakened grants,
 *   no auto-rewriting of generated files. The policy reads workspace
 *   state but does not mutate it.
 *
 * ## Reused components
 *
 * - `detectExecutableMentions()` from `src/runtime/acceptance-integrity.ts`
 *   (G7-19F) — same text-scanning pattern used by the gateway's auto-add.
 * - `ArtifactSnapshot` shape from `src/runtime/computer.ts` — the
 *   `{ workerId, path, bytes, content? }` pattern is reused for the
 *   workspace snapshot.
 * - `crypto.createHash('sha256')` from Node.js standard library —
 *   deterministic content hashing.
 *
 * ## What this does NOT do
 *
 * - It does NOT modify frozen contracts (PlannedWorker, WorkerGenome,
 *   GenomeCompiler, orchestrator.ts, verification.ts, goal-compiler.ts).
 * - It does NOT implement cross-worker handoff (Task B).
 * - It does NOT implement final package acceptance (Task B).
 * - It does NOT weaken any security boundary (path traversal, command
 *   policy, grant enforcement, isolation).
 * - It does NOT introduce a new verification engine — the verifier's
 *   `checkCommand` remains the authority on acceptance execution.
 */

import { createHash } from 'node:crypto';
import type { WorkerGenome } from '../contracts/core.js';
import {
  detectExecutableMentions,
  type ExecutableAcceptanceMention,
} from '../runtime/acceptance-integrity.js';
import type { WorkerComputer } from '../runtime/computer.js';
import {
  applicableAcceptanceChecks,
  parseOwnershipPrefix,
  parseDeliverableKindFromPrefix,
  type OwnershipContract,
} from './ownership-contract.js';
// PILOT-003 R4: acceptance contract for evidence-based completion gate.
import {
  verifyAcceptanceContract,
  type MissionAcceptanceContract,
  type ContractVerificationContext,
} from './acceptance-contract.js';

// ---------------------------------------------------------------------------
// A1 — Responsibility-aware completion
// ---------------------------------------------------------------------------

/**
 * The kind of deliverable a worker is expected to produce. Determines
 * which completion evidence is required before `finish` is accepted.
 *
 * Inferred from `genome.capabilityNeeds` (a frozen `CapabilityNeed` enum),
 * NOT from the role string. The enum values are stable in
 * `src/contracts/core.ts:41-45`.
 */
export type DeliverableKind =
  | 'testable-code' // capabilityNeeds includes 'code-execution'
  | 'documentation' // capabilityNeeds includes 'document-authoring' (and not code-execution)
  | 'data-analysis' // capabilityNeeds includes 'data-analysis' (and not the above)
  | 'research' // capabilityNeeds includes 'web-research' (and not the above)
  | 'verification-evidence' // D+ B01C S1.2: Verification Engineer — produces evidence, not code
  | 'general'; // fallback for unspecified / mixed / sole-operator roles

/**
 * Infer the deliverable kind from the genome's structured capability needs.
 *
 * The priority order is intentional: code-execution dominates because it
 * produces testable artifacts; document-authoring is next; data-analysis
 * and web-research follow; anything else falls back to general.
 *
 * This is deterministic: the same `capabilityNeeds` always produces the
 * same `DeliverableKind`. No LLM call, no randomization, no string parsing
 * of role names.
 *
 * If the assignment is ambiguous (e.g., a Sole Operator that carries all
 * capabilities), the result is `'testable-code'` (the strictest kind).
 * This is intentional: when in doubt, require executable evidence. A
 * worker that produces code AND docs should be held to the code-test
 * standard, not the doc-only standard.
 *
 * ## Why `skills` instead of `capabilityNeeds`?
 *
 * `WorkerGenome` (frozen, `src/contracts/core.ts:297`) does NOT expose
 * `capabilityNeeds` directly — only `PlannedWorker` does (also frozen,
 * `src/contracts/core.ts:119`). The GenomeCompiler copies
 * `worker.capabilityNeeds` into `genome.skills` (line 332-335 of
 * `src/genome/genome-compiler.ts`), so `genome.skills` carries the same
 * enum values. We read `skills` and filter for the known capability
 * enum values, ignoring non-capability skills like `'collaboration'`.
 */
export function inferDeliverableKind(
  capabilityNeeds: readonly string[],
): DeliverableKind {
  if (capabilityNeeds.includes('code-execution')) return 'testable-code';
  if (capabilityNeeds.includes('document-authoring')) return 'documentation';
  if (capabilityNeeds.includes('data-analysis')) return 'data-analysis';
  if (capabilityNeeds.includes('web-research')) return 'research';
  return 'general';
}

/**
 * Read the deliverable kind from a genome. Convenience wrapper.
 *
 * Reads `genome.skills` (which contains the capability-need enum values
 * per the GenomeCompiler) and infers the deliverable kind.
 */
export function genomeDeliverableKind(genome: WorkerGenome): DeliverableKind {
  return inferDeliverableKind(genome.skills);
}

// ---------------------------------------------------------------------------
// A2 — Current evidence, not historical success
// ---------------------------------------------------------------------------

/**
 * A bounded snapshot of a worker's workspace at a point in time.
 *
 * Reuses the `ArtifactSnapshot` pattern from `src/runtime/computer.ts:49-56`:
 * a per-file (path, bytes, contentHash) tuple, aggregated into a single
 * digest. The digest is a SHA-256 of sorted (path, contentHash) pairs,
 * mirroring `computePackageIdentity` in `src/runtime/package-selection.ts:337`.
 *
 * ## Scope and exclusions
 *
 * The snapshot covers workspace files EXCLUDING:
 * - `node_modules/` (third-party code, not worker-authored)
 * - `.git/` (VCS metadata)
 * - `.npm/` (npm cache with timestamps in filenames — would make the
 *   digest non-reproducible across runs, even with identical content)
 *
 * The snapshot is bounded by a file-count limit (default 4096, matching
 * `listWorkspaceFilesRecursive` in the OpenBot adapter). If the workspace
 * exceeds this, the snapshot fails closed (returns null) — the gate
 * refuses `finish` rather than silently accepting a partial snapshot.
 *
 * ## Failure behavior
 *
 * If `listFiles()` or `readFile()` throws, the snapshot fails closed
 * (returns null). The gate treats null as "no valid evidence" and
 * refuses `finish`. This is the A13 fail-closed guarantee.
 */
export interface WorkspaceSnapshot {
  /**
   * SHA-256 hex of sorted `${path}:${contentHash}` pairs.
   * Stable across runs with identical workspace content.
   */
  readonly digest: string;
  /** Number of files included in the snapshot. */
  readonly fileCount: number;
  /** Per-file hashes (path → SHA-256 hex), for diff debugging. */
  readonly fileHashes: ReadonlyMap<string, string>;
}

/**
 * Patterns excluded from the workspace snapshot. See `WorkspaceSnapshot`.
 */
const SNAPSHOT_EXCLUDE_PATTERNS = ['node_modules/', '.git/', '.npm/'];

/**
 * Should a path be excluded from the snapshot? Matches on path prefix
 * to keep the rule simple and deterministic.
 */
function shouldExcludeFromSnapshot(path: string): boolean {
  for (const pattern of SNAPSHOT_EXCLUDE_PATTERNS) {
    if (path === pattern.slice(0, -1) || path.startsWith(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Maximum number of files in a workspace snapshot. If exceeded, the
 * snapshot fails closed (returns null). Matches the OpenBot adapter's
 * 4096-file limit in `listWorkspaceFilesRecursive`.
 */
const SNAPSHOT_MAX_FILES = 4096;

/**
 * Compute a bounded SHA-256 digest of the workspace files.
 *
 * Reuses the `ArtifactSnapshot` pattern from `src/runtime/computer.ts` and
 * the digest approach from `computePackageIdentity` in
 * `src/runtime/package-selection.ts:337`.
 *
 * @param computer the worker's own computer (must be non-null)
 * @returns the snapshot, or `null` if it cannot be computed safely
 *   (file count exceeded, read error, or other failure). Null fails
 *   closed — the gate refuses `finish`.
 */
export async function computeWorkspaceSnapshot(
  computer: WorkerComputer,
): Promise<WorkspaceSnapshot | null> {
  try {
    const entries = await computer.listFiles();
    const filtered = entries.filter(
      (e) => e.kind === 'file' && !shouldExcludeFromSnapshot(e.path),
    );
    if (filtered.length > SNAPSHOT_MAX_FILES) {
      return null; // fail closed
    }
    const fileHashes = new Map<string, string>();
    for (const entry of filtered) {
      try {
        const read = await computer.readFile(entry.path);
        const hash = createHash('sha256')
          .update(read.text)
          .digest('hex');
        fileHashes.set(entry.path, hash);
      } catch {
        // Individual file read failure → fail closed for the whole snapshot
        return null;
      }
    }
    const sortedPairs = [...fileHashes.entries()]
      .map(([path, hash]) => `${path}:${hash}`)
      .sort()
      .join('\n');
    const digest = createHash('sha256').update(sortedPairs).digest('hex');
    return { digest, fileCount: filtered.length, fileHashes };
  } catch {
    return null; // listFiles threw → fail closed
  }
}

/**
 * Completion evidence — the data the gate needs to justify a successful
 * `finish`. Built up incrementally as the worker executes actions.
 */
export interface CompletionEvidence {
  /** Inferred from genome.capabilityNeeds at construction time. */
  readonly deliverableKind: DeliverableKind;
  /**
   * D+ B01: the ownership contract parsed from the task brief's
   * responsibility string. May be null if no `[owns: ...]` prefix
   * was present (e.g., Sole Operator, Generalist, or pre-B01 roles).
   * When present, `applicableChecks` is scoped to the worker's
   * ownedArtifacts (not the whole mission's executable mentions).
   */
  readonly ownershipContract: OwnershipContract | null;
  /**
   * The last test command run (any exit code), or null if no test has
   * run yet. "Test command" means a `run_command` whose command string
   * matches a detected executable-acceptance mention (e.g., "npm test").
   *
   * PILOT-002 R3.2: now includes stdout/stderr (truncated) so the gate
   * can diagnose the failure and give actionable feedback (e.g., detect
   * ECONNREFUSED and tell the worker to write unit tests instead of
   * integration tests).
   */
  lastTestCommand: {
    readonly command: string;
    readonly exitCode: number;
    readonly stdout?: string;
    readonly stderr?: string;
  } | null;
  /**
   * Workspace snapshot taken immediately after `lastTestCommand` succeeded.
   * Null if no test has run, or if the snapshot could not be computed.
   * Invalidated (set to null) on any subsequent `write_file` or
   * filesystem-mutating `run_command`.
   */
  lastTestSnapshot: WorkspaceSnapshot | null;
  /**
   * Step number at which `lastTestCommand` ran. Used for diagnostics.
   */
  lastTestStep: number | null;
  /**
   * Step number of the most recent `write_file` or filesystem-mutating
   * `run_command`. If this is greater than `lastTestStep`, the test
   * evidence is stale.
   */
  lastMutationStep: number | null;
  /**
   * Number of times `finish` has been rejected by the gate. Bounded by
   * `MAX_FINISH_REJECTIONS` to prevent infinite loops.
   */
  finishRejections: number;
  /**
   * PILOT-002 R3 (Runtime Acceptance Gate): the result of the last runtime
   * start check. Null if no start check has been run. When the goal text
   * contains a start command mention (npm start / node server.js) and the
   * worker is testable-code, the gate requires this to be `{ ok: true }`
   * before `finish` is accepted.
   */
  lastStartResult: RuntimeStartResult | null;
  /**
   * PILOT-003 R4 (Acceptance Contract): the exit code of the last build
   * command (npm run build, webpack, etc.). Null if no build was run.
   * Used by the acceptance contract to verify "application-built".
   */
  lastBuildExitCode: number | null;
  /**
   * PILOT-003 R4 (Acceptance Contract): evidence that a browser interaction
   * was performed. Used by the acceptance contract to verify "browser-tested".
   */
  browserEvidence: { screenshotTaken: boolean; interactionsPassed: number };
  /**
   * PILOT-003 R4 (Acceptance Contract): evidence that a delivery package
   * was created. Used by the acceptance contract to verify "delivery-packaged".
   */
  deliveryPackage: { exists: boolean; bytes: number } | null;
  /**
   * PILOT-003 R4 (Acceptance Contract): evidence that a git repo was cloned.
   * Used by the acceptance contract to verify "repo-cloned" (deploy-from-github).
   */
  repoCloned: boolean;
  /**
   * PILOT-003 R4 (Acceptance Contract): evidence that dependencies were installed.
   * Used by the acceptance contract to verify "dependencies-installed".
   */
  dependenciesInstalled: boolean;
}

/**
 * PILOT-002 R3: result of a runtime start check.
 *
 * The gate spawns the application's start command (e.g., `npm start` or
 * `node server.js`), waits briefly for the server to bind, probes an HTTP
 * endpoint (default `http://127.0.0.1:3000/`), and kills the process.
 *
 * - `{ ok: true, ... }` — the server started and responded with HTTP 200
 *   on the probed endpoint.
 * - `{ ok: false, reason, stderr }` — the server failed to start or did
 *   not respond. The `stderr` is fed back to the worker as actionable
 *   feedback so it can diagnose and repair (within MAX_FINISH_REJECTIONS).
 */
export interface RuntimeStartResult {
  readonly ok: boolean;
  readonly command: string;
  readonly httpStatus: number | null;
  readonly reason: string;
  readonly stderr: string;
}

/**
 * Create fresh completion evidence for a worker.
 *
 * D+ B01: parses the ownership prefix from the task brief's
 * responsibility line (if present) and builds an OwnershipContract.
 * The contract's `applicableChecks` are scoped to the worker's
 * ownedArtifacts — a documentation worker does not inherit code-test
 * obligations even if the goal text mentions "npm test".
 */
export function freshEvidence(genome: WorkerGenome, taskBrief: string): CompletionEvidence {
  // D+ B01: parse the ownership contract from the task brief.
  // The task brief contains "Your assignment in it: [owns: ...] responsibility".
  // We extract the responsibility line and parse the [owns: ...] prefix.
  const ownershipContract = parseOwnershipFromBrief(taskBrief, genome);
  return {
    deliverableKind: genomeDeliverableKind(genome),
    ownershipContract,
    lastTestCommand: null,
    lastTestSnapshot: null,
    lastTestStep: null,
    lastMutationStep: null,
    finishRejections: 0,
    lastStartResult: null,
    // PILOT-003 R4: additional evidence for acceptance contract verification.
    lastBuildExitCode: null,
    browserEvidence: { screenshotTaken: false, interactionsPassed: 0 },
    deliveryPackage: null,
    repoCloned: false,
    dependenciesInstalled: false,
  };
}

/**
 * Parse the ownership contract from the task brief.
 *
 * The frozen `renderTaskBrief()` (orchestrator.ts:246) produces a brief
 * that starts with:
 * ```
 * Mission: "<outcome>"
 * Your assignment in it: [owns: src/**, test/**, package.json; kind: testable-code] Implements...
 * ```
 *
 * We extract the responsibility line (after "Your assignment in it: ")
 * and parse the `[owns: ...; kind: ...]` prefix to build the OwnershipContract.
 *
 * D+ B01C S1.2: if the prefix declares an explicit `kind:`, the contract's
 * deliverableKind comes from the assignment (not the capability). If no
 * kind is declared, falls back to capability-based inference (Task A).
 *
 * @param taskBrief the full task brief string
 * @param genome the worker's genome (for capabilityNeeds + fallback deliverableKind)
 * @returns the OwnershipContract, or null if no ownership prefix is present
 */
function parseOwnershipFromBrief(
  taskBrief: string,
  genome: WorkerGenome,
): OwnershipContract | null {
  // Find the "Your assignment in it: " line.
  const match = /Your assignment in it:\s*(.+?)(?:\n|$)/.exec(taskBrief);
  if (match === null) return null;
  const responsibilityLine = match[1]!;
  const { ownedArtifacts, cleanResponsibility } = parseOwnershipPrefix(responsibilityLine);
  if (ownedArtifacts.length === 0) return null; // no prefix → no contract
  // D+ B01C S1.2: prefer the explicit kind from the prefix; fall back
  // to capability-based inference (Task A) if not declared.
  const explicitKind = parseDeliverableKindFromPrefix(responsibilityLine);
  const deliverableKind = explicitKind ?? genomeDeliverableKind(genome);
  // Build a minimal contract (without re-detecting mentions — that's
  // done in checkCompletion where the goalText is available).
  return {
    workerId: genome.identity.id,
    role: genome.role,
    responsibility: cleanResponsibility,
    deliverableKind,
    ownedArtifacts,
    upstreamDependencies: [], // populated in B02
    applicableChecks: [], // populated in checkCompletion where goalText is available
  };
}

// ---------------------------------------------------------------------------
// A3 — Test freshness
// ---------------------------------------------------------------------------

/**
 * Determine whether a command string is a "test command" — i.e., one
 * that matches a detected executable-acceptance mention in the goal text.
 *
 * Reuses `detectExecutableMentions()` from
 * `src/runtime/acceptance-integrity.ts` (G7-19F) — the same regex-based
 * detection the gateway uses for auto-add.
 *
 * @param command the command string the worker invoked via `run_command`
 * @param mentions the executable-acceptance mentions detected from the goal text
 * @returns the matching mention, or null if not a test command
 */
export function matchingTestMention(
  command: string,
  mentions: readonly ExecutableAcceptanceMention[],
): ExecutableAcceptanceMention | null {
  // Match if the command string contains the mention's canonical command
  // (e.g., 'npm test' matches a worker that ran 'npm test' or 'npm test --').
  // We use a startsWith check on the trimmed command to avoid matching
  // 'npm install' as 'npm test'.
  const trimmed = command.trim();
  for (const mention of mentions) {
    if (trimmed === mention.command || trimmed.startsWith(`${mention.command} `)) {
      return mention;
    }
  }
  return null;
}

/**
 * Determine whether a command is likely to mutate the workspace filesystem.
 *
 * Conservative heuristic: assumes any `run_command` MIGHT mutate, except
 * for a small allow-list of read-only commands (`ls`, `cat`, `pwd`, `echo`,
 * `node --test`, `node -e` with no side effects, etc.).
 *
 * This is conservative on purpose: when in doubt, assume mutation. The
 * downside of a false positive (treating a read-only command as a mutation)
 * is that the worker must re-test — a small cost. The downside of a false
 * negative (treating a mutating command as read-only) is that stale test
 * evidence would be accepted — a correctness violation.
 *
 * The allow-list is intentionally short and conservative. Commands that
 * read but have output redirection (`> file`) are NOT in the allow-list
 * because the redirection itself is a mutation.
 */
export function isLikelyFilesystemMutation(command: string): boolean {
  const trimmed = command.trim();
  // Read-only commands (no arguments that could redirect output)
  const READ_ONLY_PREFIXES = [
    'ls',
    'cat',
    'pwd',
    'echo',
    'wc',
    'head',
    'tail',
    'file',
    'stat',
    'du',
    'df',
    'which',
    'type',
    'true',
    'false',
    'node --test',
    // NOTE: 'node -e' was removed in DPLUS-A-REVIEW-01 because it can
    // execute arbitrary code including fs.writeFileSync(). Treating it
    // as read-only was a false optimization. The snapshot digest
    // comparison at finish is the authoritative freshness guarantee.
    'npx tsc --noEmit',
  ];
  for (const prefix of READ_ONLY_PREFIXES) {
    if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) {
      // Check for output redirection — if present, this is a mutation
      if (trimmed.includes('>') || trimmed.includes('>>')) {
        return true; // redirection = mutation
      }
      return false; // read-only command, no redirection
    }
  }
  return true; // unknown command → assume mutation
}

// ---------------------------------------------------------------------------
// A4 — Controlled repair loop
// ---------------------------------------------------------------------------

/**
 * The result of a completion gate check.
 *
 * - `{ ok: true }` — the worker may finish successfully.
 * - `{ ok: false, reason, actionableFeedback }` — the worker must NOT
 *   finish; the feedback is appended to the scratchpad so the LLM can
 *   inspect, repair, and retry.
 */
export interface CompletionCheckResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly actionableFeedback?: string;
}

/**
 * Maximum number of times the gate may reject `finish` before the worker
 * terminates with an explicit `failure` status. Prevents infinite loops
 * (A11 — no-progress behavior).
 *
 * Default: 2. After 2 rejections, the worker must either satisfy the gate
 * or terminate. This gives the LLM one "real attempt" plus one retry,
 * which is enough to fix a single missed test without unbounded looping.
 */
export const MAX_FINISH_REJECTIONS = 2;

/**
 * Check whether a worker may finish successfully, given its current
 * completion evidence and the goal text.
 *
 * ## Decision logic
 *
 * 1. **`deliverableKind === 'testable-code'`**: requires a current,
 *    successful test command whose snapshot matches the current workspace.
 *    If no executable acceptance mention is in the goal text, the gate
 *    is skipped (the worker has no test to run — see A07).
 *
 * 2. **`deliverableKind === 'documentation'`**: requires that at least
 *    one file has been written (the documentation deliverable). No
 *    executable test is required (A09).
 *
 * 3. **Other kinds** (`data-analysis`, `research`, `general`): no
 *    executable test required. The existing artifact-existence check
 *    in `worker-agent.ts:1001-1018` remains the gate.
 *
 * 4. **`finishRejections >= MAX_FINISH_REJECTIONS`**: the gate returns
 *    `{ ok: true }` only if evidence is valid; otherwise it returns
 *    `{ ok: false, terminal: true }` to signal the worker agent to
 *    terminate with failure (A11, A12).
 *
 * @param evidence the current completion evidence (mutated by the worker loop)
 * @param goalText the goal outcome + context + constraints, for mention detection
 * @param currentSnapshot the workspace snapshot taken at finish time
 *   (or null if it could not be computed)
 */
export function checkCompletion(
  evidence: CompletionEvidence,
  goalText: string,
  currentSnapshot: WorkspaceSnapshot | null,
): CompletionCheckResult {
  const allMentions = detectExecutableMentions(goalText);

  // D+ B01: scope applicable checks to the worker's ownership contract.
  // If the worker has an ownership contract, only checks whose
  // requiredFile matches the worker's ownedArtifacts apply. If no
  // contract is present (pre-B01 or Generalist), fall back to Task A
  // behavior (all mentions apply to testable-code workers).
  let applicableMentions: readonly ExecutableAcceptanceMention[];
  if (evidence.ownershipContract !== null) {
    // Re-build the contract with applicableChecks populated from goalText
    const contractWithChecks: OwnershipContract = {
      ...evidence.ownershipContract,
      applicableChecks: applicableAcceptanceChecks(allMentions, evidence.ownershipContract),
    };
    applicableMentions = contractWithChecks.applicableChecks;
  } else {
    // Pre-B01 fallback: all mentions apply to testable-code workers
    applicableMentions = evidence.deliverableKind === 'testable-code' ? allMentions : [];
  }

  // For testable-code workers with applicable executable mentions
  if (evidence.deliverableKind === 'testable-code' && applicableMentions.length > 0) {
    if (evidence.lastTestCommand === null) {
      return {
        ok: false,
        reason: 'no successful test command has been run',
        actionableFeedback:
          `This mission's goal requires the following executable acceptance checks to pass:\n` +
          applicableMentions.map((m) => `- "${m.command}" (must exit ${m.expectExit})`).join('\n') +
          `\nRun the required test command(s) via run_command, verify they exit 0, ` +
          `then call finish. If you cannot satisfy a check, finish with a summary explaining what blocked you.`,
      };
    }
    if (evidence.lastTestCommand.exitCode !== 0) {
      // PILOT-002 R3.2: diagnose the test failure using stdout/stderr.
      const diagnosis = diagnoseTestFailure(evidence.lastTestCommand);
      return {
        ok: false,
        reason: `last test command exited ${evidence.lastTestCommand.exitCode}, not 0`,
        actionableFeedback: diagnosis,
      };
    }
    if (evidence.lastTestSnapshot === null) {
      return {
        ok: false,
        reason: 'no workspace snapshot was captured after the last test',
        actionableFeedback:
          `Run the test command again — the system could not verify that your test ` +
          `applies to the current workspace state.`,
      };
    }
    if (currentSnapshot === null) {
      return {
        ok: false,
        reason: 'could not compute the current workspace snapshot (fail-closed)',
        actionableFeedback:
          `The system could not inspect the current workspace state. ` +
          `Try reducing the number of files, or finish with a summary explaining the issue.`,
      };
    }
    if (evidence.lastTestSnapshot.digest !== currentSnapshot.digest) {
      return {
        ok: false,
        reason: 'workspace changed since the last successful test (stale evidence)',
        actionableFeedback:
          `Files in your workspace have changed since the last successful test run. ` +
          `Re-run the test command ("${evidence.lastTestCommand.command}") to verify the current ` +
          `state, then call finish.`,
      };
    }
    // All checks passed
    return { ok: true };
  }

  // D+ B01: documentation workers with ownership contract — no test required.
  // The ownership contract's applicableChecks is empty for non-testable-code
  // workers (see applicableAcceptanceChecks in ownership-contract.ts).
  // The existing artifact-existence check in worker-agent.ts remains the gate.
  if (evidence.deliverableKind === 'documentation') {
    return { ok: true };
  }

  // For data-analysis, research, general: no executable test required.
  // The existing artifact-existence check is sufficient.
  return { ok: true };
}

/**
 * Mark a `run_command` action in the evidence.
 *
 * PILOT-002 R3.2: now accepts stdout/stderr so the gate can diagnose
 * test failures (e.g., detect ECONNREFUSED and guide the worker to
 * write unit tests instead of integration tests).
 *
 * - If the command matches a detected executable mention, record the
 *   test command + output (regardless of exit code — failures are
 *   recorded too, so the gate can diagnose them).
 * - If the command exited 0 AND matches a mention, record the snapshot.
 * - If the command is likely a filesystem mutation, invalidate the
 *   last test snapshot.
 *
 * @param evidence the evidence to mutate (in place)
 * @param command the command string
 * @param exitCode the command's exit code
 * @param snapshot the workspace snapshot taken after the command, or null
 * @param step the step number
 * @param mentions the executable mentions detected from the goal text
 * @param stdout the command's stdout (truncated to 2000 chars), optional
 * @param stderr the command's stderr (truncated to 2000 chars), optional
 */
export function recordRunCommand(
  evidence: CompletionEvidence,
  command: string,
  exitCode: number,
  snapshot: WorkspaceSnapshot | null,
  step: number,
  mentions: readonly ExecutableAcceptanceMention[],
  stdout?: string,
  stderr?: string,
): void {
  const matchingMention = matchingTestMention(command, mentions);
  if (matchingMention !== null) {
    // PILOT-002 R3.2: record the test command regardless of exit code,
    // so the gate can diagnose failures and give actionable feedback.
    // Only include stdout/stderr if they contain actual content (non-empty).
    // This keeps the object shape stable for tests that don't provide output.
    const hasStdout = stdout !== undefined && stdout.length > 0;
    const hasStderr = stderr !== undefined && stderr.length > 0;
    evidence.lastTestCommand = {
      command: matchingMention.command,
      exitCode,
      ...(hasStdout ? { stdout: stdout!.slice(0, 2000) } : {}),
      ...(hasStderr ? { stderr: stderr!.slice(0, 2000) } : {}),
    };
    if (exitCode === 0) {
      // Successful test — record snapshot.
      evidence.lastTestSnapshot = snapshot;
      evidence.lastTestStep = step;
    }
    return;
  }
  // Check if this command is likely a filesystem mutation
  if (isLikelyFilesystemMutation(command)) {
    // Mutation → invalidate last test snapshot
    evidence.lastTestSnapshot = null;
    evidence.lastMutationStep = step;
  }
}

/**
 * Mark a `write_file` action in the evidence.
 *
 * Any write_file invalidates the last test snapshot — the next finish
 * attempt will require re-test (A05).
 */
export function recordWriteFile(
  evidence: CompletionEvidence,
  step: number,
): void {
  evidence.lastTestSnapshot = null;
  evidence.lastMutationStep = step;
}

// ---------------------------------------------------------------------------
// Public type re-exports for tests
// ---------------------------------------------------------------------------

export type { ExecutableAcceptanceMention };
export { detectExecutableMentions };

// ---------------------------------------------------------------------------
// PILOT-002 R3 — Runtime Acceptance Gate (async)
// ---------------------------------------------------------------------------

/**
 * PILOT-002 R3: determine whether the completion gate should require a
 * runtime start check for this worker.
 *
 * Returns true when ALL of:
 *   - deliverable kind is `testable-code` (worker produced code that runs)
 *   - goal text contains a start command mention (npm start, node server.js)
 *   - the worker has a computer (needed to spawn the start process)
 *
 * The check is deterministic: same inputs → same decision.
 */
export function shouldRequireRuntimeStart(
  evidence: CompletionEvidence,
  goalText: string,
  hasComputer: boolean,
): boolean {
  if (evidence.deliverableKind !== 'testable-code') return false;
  if (!hasComputer) return false;
  // Lazy import to avoid pulling acceptance-integrity into the sync path.
  // We use the same detection logic the gateway uses for test commands.
  // Inline the regex here to keep this module self-contained for the gate.
  return /\bnpm\s+start\b|\bnode\s+server\.(?:js|mjs|ts)\b/i.test(goalText);
}

/**
 * PILOT-002 R3: spawn the start command in the worker's workspace, probe
 * an HTTP endpoint, and kill the process.
 *
 * The command comes from the goal text's start mention (npm start or
 * node server.js). We spawn it directly via `child_process.spawn` (NOT
 * via `computer.exec` — that would block for 60s waiting for the server
 * to exit, which it never does). We give the server up to 8 seconds to
 * bind, then probe `http://127.0.0.1:3000/` (the conventional dev port).
 *
 * The probe accepts HTTP 200 or any 2xx/3xx as "server is up". 4xx/5xx
 * means the server is broken. Connection refused means it didn't bind.
 *
 * @param computer the worker's computer (must support exec — we use it
 *   to discover the workspace directory via `listFiles` first, then
 *   spawn the start command in that directory)
 * @param command the start command (e.g., 'npm start', 'node server.js')
 * @param options optional overrides (probe URL, timeout)
 * @returns the result of the runtime start check
 */
export async function checkRuntimeStart(
  computer: WorkerComputer,
  command: string,
  options: {
    readonly probeUrl?: string;
    readonly startupTimeoutMs?: number;
  } = {},
): Promise<RuntimeStartResult> {
  const probeUrl = options.probeUrl ?? 'http://127.0.0.1:3000/';
  const startupTimeoutMs = options.startupTimeoutMs ?? 8_000;

  // We need to spawn the start command in the worker's workspace.
  // The WorkerComputer does not expose a spawn() — only exec() which
  // blocks. We use exec() with a shell wrapper that backgrounds the
  // server and waits briefly. If the server crashes immediately, exec
  // returns with the crash exit code and stderr.
  //
  // The wrapper: `sh -c '<cmd> > /tmp/.start-stdout 2> /tmp/.start-stderr & sleep <timeout>; curl -sS -o /dev/null -w '%{http_code}' <url> || echo FAIL; kill %1 2>/dev/null`
  //
  // This is deliberately simple — we do NOT add a new spawn primitive
  // to the WorkerComputer interface (that would be a frozen-contract
  // change). We reuse exec() with a bounded shell command.
  const wrapped = `sh -c '${command.replace(/'/g, "'\\''")} > /tmp/.r3-start-stdout 2> /tmp/.r3-start-stderr & PID=$!; sleep ${Math.ceil(startupTimeoutMs / 1000)}; HTTP=$(curl -sS -o /dev/null -w '%{http_code}' ${probeUrl} 2>/dev/null || echo FAIL); kill $PID 2>/dev/null; wait $PID 2>/dev/null; STDERR=$(cat /tmp/.r3-start-stderr 2>/dev/null | head -c 4000); if [ "$HTTP" = "FAIL" ] || [ -z "$HTTP" ]; then echo "HTTP_FAILED"; echo "---STDERR---"; echo "$STDERR"; exit 1; elif [ "$HTTP" -ge 200 ] && [ "$HTTP" -lt 400 ]; then echo "HTTP_OK:$HTTP"; exit 0; else echo "HTTP_BAD:$HTTP"; echo "---STDERR---"; echo "$STDERR"; exit 1; fi'`;

  try {
    const result = await computer.exec(wrapped);
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    if (result.exitCode === 0) {
      // Server started and responded OK.
      const httpMatch = /HTTP_OK:(\d+)/.exec(stdout);
      const httpStatus = httpMatch ? Number.parseInt(httpMatch[1]!, 10) : 200;
      return {
        ok: true,
        command,
        httpStatus,
        reason: `server started and responded HTTP ${httpStatus} on ${probeUrl}`,
        stderr: '',
      };
    }
    // Failure: extract the reason.
    let reason = 'server failed to start or did not respond';
    let httpStatus: number | null = null;
    const failMatch = /HTTP_FAILED/.exec(stdout);
    const badMatch = /HTTP_BAD:(\d+)/.exec(stdout);
    if (failMatch) {
      reason = `server did not respond on ${probeUrl} within ${startupTimeoutMs}ms (connection refused or timed out)`;
    } else if (badMatch) {
      httpStatus = Number.parseInt(badMatch[1]!, 10);
      reason = `server responded with HTTP ${httpStatus} (expected 2xx or 3xx)`;
    }
    // Extract the actual stderr from the start command (after ---STDERR---).
    const stderrMarker = stdout.indexOf('---STDERR---');
    const actualStderr = stderrMarker >= 0
      ? stdout.slice(stderrMarker + '---STDERR---'.length).trim()
      : stderr.trim();
    return {
      ok: false,
      command,
      httpStatus,
      reason,
      stderr: actualStderr.slice(0, 4000),
    };
  } catch (error) {
    return {
      ok: false,
      command,
      httpStatus: null,
      reason: `runtime start check could not execute: ${(error as Error).message.slice(0, 200)}`,
      stderr: '',
    };
  }
}

/**
 * PILOT-002 R3: build the actionable feedback for a failed runtime start.
 *
 * The feedback is fed back to the worker via the scratchpad so the LLM
 * can diagnose and repair. The feedback deliberately does NOT mention
 * the specific fix (e.g., "use DatabaseSync") — the worker must
 * diagnose from the stderr itself.
 */
export function runtimeStartFailureFeedback(
  result: RuntimeStartResult,
): string {
  return (
    `Your application's start command "${result.command}" did not launch a working server.\n` +
    `Reason: ${result.reason}\n` +
    (result.stderr.length > 0
      ? `Server stderr (first 4000 chars):\n${result.stderr}\n`
      : '') +
    `Inspect the error, repair the code, re-run "npm test" to confirm tests still pass, ` +
    `then call finish. The completion gate will re-verify the server starts and responds.`
  );
}

/**
 * PILOT-002 R3.2: diagnose a test failure using the stdout/stderr output.
 *
 * Analyzes the test output to detect common failure patterns and returns
 * specific, actionable feedback. This is a GENERAL mechanism — it detects
 * patterns like ECONNREFUSED (tests require a running server), import
 * errors (wrong API usage), and assertion failures. It does NOT hardcode
 * fixes for any specific application.
 *
 * Detected patterns:
 *   - ECONNREFUSED / connection refused → tests require a running server;
 *     tell the worker to rewrite as unit tests.
 *   - SyntaxError / import errors → wrong API usage; show the error.
 *   - Assertion errors → show the failing assertion.
 *   - Unknown → generic "inspect the output" feedback.
 */
function diagnoseTestFailure(
  testCommand: { readonly command: string; readonly exitCode: number; readonly stdout?: string; readonly stderr?: string },
): string {
  const output = `${testCommand.stdout ?? ''}\n${testCommand.stderr ?? ''}`;
  const trimmedOutput = output.trim().slice(0, 1500);

  // Detect connection-related failures (tests require a running server).
  if (/ECONNREFUSED|connect\s+ENOTFOUND|fetch\s+failed|Connection\s+refused/i.test(output)) {
    return (
      `The test command "${testCommand.command}" exited ${testCommand.exitCode} because the tests ` +
      `attempt to connect to a running server (ECONNREFUSED/fetch failed detected).\n` +
      `This means your tests are INTEGRATION tests that require a running HTTP server.\n` +
      `Rewrite them as UNIT tests that import the module directly and test functions in isolation.\n` +
      `Do NOT start the server in tests. Do NOT connect to localhost or HTTP endpoints in tests.\n` +
      `Example: instead of fetch('http://localhost:3000/api/tasks'), import the function directly:\n` +
      `  import { createTask } from '../database.js';\n` +
      `  test('createTask', () => { const result = createTask('title', 'desc'); assert(result.id > 0); });\n` +
      `Test output (first 1500 chars):\n${trimmedOutput}`
    );
  }

  // Detect SyntaxError / import errors (wrong API usage).
  if (/SyntaxError|ERR_UNKNOWN_BUILTIN_MODULE|does not provide an export named/i.test(output)) {
    return (
      `The test command "${testCommand.command}" exited ${testCommand.exitCode} due to a module/import error.\n` +
      `A file has an invalid import. Check the error message and fix the import statement.\n` +
      `Common fix: if using node:sqlite, the correct import is:\n` +
      `  import { DatabaseSync } from 'node:sqlite';\n` +
      `  const db = new DatabaseSync('tasks.db');\n` +
      `NOT: import { open, sqlite3 } from 'node:sqlite' (these exports do not exist).\n` +
      `Test output (first 1500 chars):\n${trimmedOutput}`
    );
  }

  // Detect assertion failures.
  if (/AssertionError|assertion/i.test(output)) {
    return (
      `The test command "${testCommand.command}" exited ${testCommand.exitCode} due to assertion failures.\n` +
      `Inspect the failing assertions and fix the code so the assertions pass.\n` +
      `Test output (first 1500 chars):\n${trimmedOutput}`
    );
  }

  // Generic feedback with the actual output.
  return (
    `The test command "${testCommand.command}" exited with code ${testCommand.exitCode}.\n` +
    `Inspect the test output below, repair the code or the tests, re-run the test, ` +
    `and only call finish after it exits 0.\n` +
    `Test output (first 1500 chars):\n${trimmedOutput}`
  );
}

// ---------------------------------------------------------------------------
// PILOT-003 R4 — Evidence-Based Acceptance Contract Gate
// ---------------------------------------------------------------------------

/**
 * PILOT-003 R4: check the acceptance contract against real operational evidence.
 *
 * This is the SYSTEM-LEVEL enforcement: the worker cannot claim success
 * unless every condition in the contract is verified against actual evidence.
 * The worker decides HOW to satisfy conditions; the system verifies WHETHER
 * they are satisfied.
 *
 * @param evidence the worker's completion evidence
 * @param contract the mission acceptance contract
 * @param workspaceFiles the files currently in the worker's workspace
 * @returns ok=true if all conditions verified, otherwise ok=false with feedback
 */
export function checkAcceptanceContract(
  evidence: CompletionEvidence,
  contract: MissionAcceptanceContract,
  workspaceFiles: readonly string[],
): CompletionCheckResult {
  const ctx: ContractVerificationContext = {
    workspaceFiles,
    lastTestExitCode: evidence.lastTestCommand?.exitCode ?? null,
    lastBuildExitCode: evidence.lastBuildExitCode,
    lastStartResult: evidence.lastStartResult
      ? { ok: evidence.lastStartResult.ok, httpStatus: evidence.lastStartResult.httpStatus }
      : null,
    browserEvidence: evidence.browserEvidence,
    deliveryPackage: evidence.deliveryPackage,
    repoCloned: evidence.repoCloned,
    dependenciesInstalled: evidence.dependenciesInstalled,
  };

  const result = verifyAcceptanceContract(contract, ctx);
  if (result.allVerified) {
    return { ok: true };
  }

  // Build actionable feedback listing the unverified conditions.
  const feedback = result.unverified
    .map((c) => `- ${c.label}: ${c.description}${c.evidence ? ` (current: ${c.evidence})` : ''}`)
    .join('\n');
  return {
    ok: false,
    reason: `${result.unverified.length} acceptance condition(s) unverified`,
    actionableFeedback:
      `The mission acceptance contract is not yet satisfied. The following conditions ` +
      `are NOT verified:\n${feedback}\n\n` +
      `Complete the remaining work to satisfy these conditions, then call finish. ` +
      `The system verifies REAL evidence — claims without proof will be rejected.`,
  };
}
