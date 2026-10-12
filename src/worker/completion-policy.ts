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
   * The last successful test command (exit 0), or null if no test has
   * run yet. "Test command" means a `run_command` whose command string
   * matches a detected executable-acceptance mention (e.g., "npm test").
   */
  lastTestCommand: { readonly command: string; readonly exitCode: number } | null;
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
}

/**
 * Create fresh completion evidence for a worker.
 */
export function freshEvidence(genome: WorkerGenome): CompletionEvidence {
  return {
    deliverableKind: genomeDeliverableKind(genome),
    lastTestCommand: null,
    lastTestSnapshot: null,
    lastTestStep: null,
    lastMutationStep: null,
    finishRejections: 0,
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
    'node -e',
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
  const mentions = detectExecutableMentions(goalText);

  // For testable-code workers with executable mentions in the goal text
  if (evidence.deliverableKind === 'testable-code' && mentions.length > 0) {
    if (evidence.lastTestCommand === null) {
      return {
        ok: false,
        reason: 'no successful test command has been run',
        actionableFeedback:
          `This mission's goal requires the following executable acceptance checks to pass:\n` +
          mentions.map((m) => `- "${m.command}" (must exit ${m.expectExit})`).join('\n') +
          `\nRun the required test command(s) via run_command, verify they exit 0, ` +
          `then call finish. If you cannot satisfy a check, finish with a summary explaining what blocked you.`,
      };
    }
    if (evidence.lastTestCommand.exitCode !== 0) {
      return {
        ok: false,
        reason: `last test command exited ${evidence.lastTestCommand.exitCode}, not 0`,
        actionableFeedback:
          `The test command "${evidence.lastTestCommand.command}" exited with code ` +
          `${evidence.lastTestCommand.exitCode}. Inspect the failing tests, repair the code, ` +
          `re-run the test, and only call finish after it exits 0.`,
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

  // For documentation workers: require at least one file written.
  // The worker-agent's existing artifact-existence check (line 1001-1018)
  // already confirms the file exists; here we just confirm that the worker
  // produced SOMETHING. If the worker called finish with zero artifacts,
  // the existing check fails. If the goal text mentions executable acceptance
  // but the worker is a documentation writer, we DON'T require the test
  // (the code worker runs the test, not the doc worker — A09).
  if (evidence.deliverableKind === 'documentation') {
    // Documentation workers are not required to run tests (A09).
    // The existing artifact-existence check is sufficient.
    return { ok: true };
  }

  // For data-analysis, research, general: no executable test required.
  // The existing artifact-existence check is sufficient.
  return { ok: true };
}

/**
 * Mark a `run_command` action in the evidence.
 *
 * - If the command matches a detected executable mention AND exited 0,
 *   record the test command + snapshot.
 * - If the command is likely a filesystem mutation, invalidate the
 *   last test snapshot (the next finish attempt will require re-test).
 *
 * @param evidence the evidence to mutate (in place)
 * @param command the command string
 * @param exitCode the command's exit code
 * @param snapshot the workspace snapshot taken after the command, or null
 * @param step the step number
 * @param mentions the executable mentions detected from the goal text
 */
export function recordRunCommand(
  evidence: CompletionEvidence,
  command: string,
  exitCode: number,
  snapshot: WorkspaceSnapshot | null,
  step: number,
  mentions: readonly ExecutableAcceptanceMention[],
): void {
  const matchingMention = matchingTestMention(command, mentions);
  if (matchingMention !== null && exitCode === 0) {
    // Successful test command — record evidence
    evidence.lastTestCommand = { command: matchingMention.command, exitCode };
    evidence.lastTestSnapshot = snapshot;
    evidence.lastTestStep = step;
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
