/**
 * G7-19F — Acceptance Integrity Gate.
 *
 * Scans goal text (outcome + context + constraints) for explicit
 * executable-acceptance phrases (e.g., "npm test MUST exit 0"). For
 * each detected phrase with no corresponding caller-supplied
 * `command`-type criterion, the gate emits per-worker auto-added
 * command checks at verification time.
 *
 * ## Why this exists
 *
 * G7-19E found that a user-stated requirement like
 * "npm test MUST exit 0 within 60s" became a `hardConstraint` STRING
 * inside `GoalRequirements` (via the FROZEN goal compiler), but was
 * NEVER translated into a `command`-type `AcceptanceCheck`. The
 * structural floor (file existence + content-in-artifacts) passed
 * (22/22 checks), verification reported `ok=true`, and the mission
 * was reported as SELECTED — even though the produced application's
 * `npm test` actually failed (broken `node --test test/` script +
 * naive CLI arg-splitting helper).
 *
 * This module is the smallest correction that ensures an explicit
 * executable acceptance requirement cannot silently disappear during
 * goal compilation or mission submission.
 *
 * ## How it works
 *
 * 1. `detectExecutableMentions(goalText)` — scans goal text for
 *    known executable-acceptance phrases. Returns a list of
 *    `{ phrase, command, expectExit, requiredFile, label }`.
 * 2. `isMentionCovered(mention, callerCriteria)` — checks whether
 *    the caller already provided a `command`-type check with the
 *    same command string.
 * 3. `buildAutoAddedCommandChecks(mention, artifacts)` — for each
 *    artifact source (worker) that produced the mention's required
 *    file (e.g., `package.json`), emits a per-worker `command` check
 *    that runs the detected command in the worker's clean-room
 *    subdirectory (`sh -c "cd artifacts/<workerId> && <command>"`).
 *    If NO worker produced the required file, emits a sentinel
 *    `command` check that always fails — so the omission is
 *    visible (verification fails honestly).
 *
 * ## Verifier compatibility
 *
 * The verifier's `checkCommand` (in `src/mission/verification.ts`,
 * FROZEN) runs `this.verifier.exec(check.command)` in the verifier's
 * workspace. The verifier's clean-room layout puts each worker's
 * files under `artifacts/<workerId>/<path>`. The auto-added command
 * uses `sh -c "cd artifacts/<workerId> && <command>"` so the command
 * runs in the correct subdirectory.
 *
 * The OpenBot adapter's `exec` delegates to a real shell, so
 * `sh -c "..."` works. The `MemoryComputer.exec` (dev mode) is a
 * stub that returns canned results; tests that exercise the
 * auto-added checks must use a real `WorkerComputer` or supply
 * canned exec results via `MemoryComputer.execResults`.
 *
 * ## What this does NOT do
 *
 * - It does NOT modify the FROZEN goal compiler, verifier, or
 *   orchestrator. The fix lives entirely in the non-frozen
 *   runtime/gateway layer.
 * - It does NOT auto-translate vague phrases like "tests must pass"
 *   or "the application must work". Only phrases that name a specific
 *   known command (e.g., "npm test") are auto-translated. Vague
 *   phrases remain the caller's responsibility.
 * - It does NOT introduce new LLM calls. Detection is deterministic
 *   (regex).
 * - It does NOT auto-add checks for commands the user explicitly
 *   provided. If the caller supplied a `command`-type check with the
 *   same command string, the mention is considered covered.
 */

/**
 * One detected executable-acceptance mention in goal text.
 */
export interface ExecutableAcceptanceMention {
  /**
   * The matched phrase (e.g., "npm test"). This is the canonical
   * command string used for both coverage detection and auto-add.
   */
  readonly phrase: string;
  /**
   * The auto-generated command (e.g., "npm test"). The verifier
   * runs this in each worker's clean-room subdirectory.
   */
  readonly command: string;
  /**
   * The expected exit code (default 0).
   */
  readonly expectExit: number;
  /**
   * The file that must be present in a worker's clean-room subdir
   * for the command to make sense (e.g., "package.json" for
   * `npm test`). Only workers that produced this file get the
   * auto-added check.
   */
  readonly requiredFile: string;
  /**
   * The label for auto-added checks (used in the verification
   * outcome's `label` field).
   */
  readonly label: string;
}

/**
 * Conservative pattern set: only auto-translate when the phrase
 * names a specific, known command. Vague phrases ("tests must pass")
 * are not auto-translated — the caller must provide an explicit
 * `command`-type check for those.
 *
 * Each pattern maps to a single canonical command. If multiple
 * variants match (e.g., "npm test" and "yarn test" both appear),
 * each gets its own mention — the caller can choose to cover one
 * and let the other auto-add.
 */
const EXECUTABLE_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly command: string;
  readonly expectExit: number;
  readonly requiredFile: string;
  readonly label: string;
}> = [
  {
    pattern: /\bnpm\s+test\b/i,
    command: 'npm test',
    expectExit: 0,
    requiredFile: 'package.json',
    label: 'npm test exits 0 (G7-19F auto-detected from goal text)',
  },
  {
    pattern: /\byarn\s+test\b/i,
    command: 'yarn test',
    expectExit: 0,
    requiredFile: 'package.json',
    label: 'yarn test exits 0 (G7-19F auto-detected from goal text)',
  },
  {
    pattern: /\bpnpm\s+test\b/i,
    command: 'pnpm test',
    expectExit: 0,
    requiredFile: 'package.json',
    label: 'pnpm test exits 0 (G7-19F auto-detected from goal text)',
  },
];

/**
 * Detect executable-acceptance mentions in goal text.
 *
 * Returns a list of detected mentions, de-duplicated by command
 * string (so "npm test" mentioned twice in the goal text produces
 * one mention, not two).
 *
 * @param goalText the goal's outcome + context + constraints
 *   concatenated (any order; the regex is line-blind).
 * @returns the detected mentions, in the order they appear in
 *   {@link EXECUTABLE_PATTERNS}.
 */
export function detectExecutableMentions(
  goalText: string,
): readonly ExecutableAcceptanceMention[] {
  const mentions: ExecutableAcceptanceMention[] = [];
  const seen = new Set<string>();
  for (const p of EXECUTABLE_PATTERNS) {
    if (p.pattern.test(goalText)) {
      if (seen.has(p.command)) continue;
      seen.add(p.command);
      mentions.push({
        phrase: p.command,
        command: p.command,
        expectExit: p.expectExit,
        requiredFile: p.requiredFile,
        label: p.label,
      });
    }
  }
  return mentions;
}

/**
 * Check whether the caller-supplied acceptance criteria already
 * covers a detected mention. A mention is "covered" when a
 * `command`-type check exists with the same command string.
 *
 * This is the "did the user already handle it?" check. If yes,
 * the mention is recorded but no auto-added check is emitted.
 * If no, the auto-add fires.
 *
 * @param mention the detected mention
 * @param callerCriteria the caller-supplied acceptance criteria
 *   (parsed into AcceptanceCheckInput form)
 */
export function isMentionCovered(
  mention: ExecutableAcceptanceMention,
  callerCriteria: readonly { kind: string; command?: string }[],
): boolean {
  return callerCriteria.some(
    (c) => c.kind === 'command' && c.command === mention.command,
  );
}

/**
 * A minimal artifact-source shape used by {@link buildAutoAddedCommandChecks}.
 * Matches the relevant slice of the orchestrator's `ArtifactSource`.
 */
export interface AutoAddArtifactSource {
  readonly workerId: string;
  readonly paths: readonly string[];
}

/**
 * A `command`-type acceptance check, in the shape the verifier
 * expects. Mirrors `Extract<AcceptanceCheck, { kind: 'command' }>`
 * from `src/mission/verification.ts` — repeated here to avoid
 * importing the FROZEN verifier module.
 */
export interface CommandAcceptanceCheck {
  readonly kind: 'command';
  readonly label: string;
  readonly command: string;
  readonly expectExit?: number;
  readonly expectOutputIncludes?: string;
  readonly expectOutputExcludes?: string;
}

/**
 * Build per-worker auto-added command checks for an uncovered
 * executable-acceptance mention.
 *
 * For each artifact source (worker) that produced the mention's
 * required file (e.g., `package.json`), emit a `command` check that
 * runs the detected command in the worker's clean-room subdirectory.
 *
 * The command uses `sh -c "cd artifacts/<workerId> && <command>"` so
 * that the verifier's clean-room layout (which puts files under
 * `artifacts/<workerId>/<path>`) supports the command.
 *
 * If NO worker produced the required file, emit a single sentinel
 * `command` check that always fails honestly:
 * `sh -c "echo blocker: ... 1>&2; exit 1"` with `expectExit: 0`.
 * This forces verification to fail — the omission is not silent.
 *
 * @param mention the uncovered mention
 * @param artifacts the per-worker artifact sources (from
 *   `context.artifacts` in `buildChecks`)
 * @returns the per-worker auto-added command checks (possibly empty
 *   if no worker produced the required file — but then a sentinel
 *   check is emitted)
 */
export function buildAutoAddedCommandChecks(
  mention: ExecutableAcceptanceMention,
  artifacts: readonly AutoAddArtifactSource[],
): readonly CommandAcceptanceCheck[] {
  const checks: CommandAcceptanceCheck[] = [];
  for (const source of artifacts) {
    if (!source.paths.includes(mention.requiredFile)) continue;
    checks.push({
      kind: 'command',
      label: `${mention.label} — ${source.workerId}`,
      command: `sh -c "cd artifacts/${source.workerId} && ${mention.command}"`,
      expectExit: mention.expectExit,
    });
  }
  // If no worker produced the required file, emit a sentinel check
  // that always fails — so the omission is visible (verification
  // fails honestly, not silently passes).
  if (checks.length === 0) {
    checks.push({
      kind: 'command',
      label: `${mention.label} — BLOCKER: no worker produced ${mention.requiredFile}`,
      command:
        `sh -c "echo G7-19F blocker: ${mention.command} ` +
        `requires ${mention.requiredFile} but no worker produced it ` +
        `1>&2; exit 1"`,
      expectExit: mention.expectExit,
    });
  }
  return checks;
}

/**
 * Convenience: detect mentions, filter to uncovered ones, and
 * build all auto-added command checks in one call.
 *
 * This is the main entry point for the gateway's `buildChecks`
 * method. It returns the full list of auto-added checks (across
 * all uncovered mentions × all matching artifact sources).
 *
 * @param goalText the goal's outcome + context + constraints
 *   concatenated
 * @param callerCriteria the caller-supplied acceptance criteria
 * @param artifacts the per-worker artifact sources (from
 *   `context.artifacts` in `buildChecks`)
 * @returns the auto-added command checks (possibly empty if all
 *   mentions are covered or no mentions were detected)
 */
export function buildAutoAddedChecksForGoal(
  goalText: string,
  callerCriteria: readonly { kind: string; command?: string }[],
  artifacts: readonly AutoAddArtifactSource[],
): readonly CommandAcceptanceCheck[] {
  const mentions = detectExecutableMentions(goalText);
  const out: CommandAcceptanceCheck[] = [];
  for (const m of mentions) {
    if (isMentionCovered(m, callerCriteria)) continue;
    out.push(...buildAutoAddedCommandChecks(m, artifacts));
  }
  return out;
}
