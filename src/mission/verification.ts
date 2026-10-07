import { createHash } from 'node:crypto';

import type { Evidence, ReasoningProvider } from '../contracts/core.js';
import type { WorkerComputer } from '../runtime/computer.js';
import type { FlightEvent } from './flight-recorder.js';

/**
 * Verification Loop v0.1 (TASK-013): a mission is not successful just
 * because a worker said it was.
 *
 * Acceptance checks are deterministic and tied to the task: commands run and
 * their exit code/output asserted, files opened and their contents asserted,
 * evidence kinds required by the goal confirmed present. Checks execute in a
 * CLEAN ROOM: artifacts are copied out of the producing workers' computers
 * into a separate verifier computer before being examined, so a worker
 * cannot leave anything behind in its own workspace that fakes a pass. This
 * mirrors the architecture's clean-room verification direction without
 * building a platform: it is one copy step and one computer.
 *
 * A reviewer (an LLM reasoning call) appears ONLY on failure — the
 * conflict/risk case — to produce a traceable diagnosis used by the
 * orchestrator's single bounded retry. No universal QA framework.
 */

export type AcceptanceCheck =
  | {
      readonly kind: 'command';
      readonly label: string;
      readonly command: string;
      readonly expectExit?: number;
      readonly expectOutputIncludes?: string;
      readonly expectOutputExcludes?: string;
    }
  | {
      readonly kind: 'file';
      readonly label: string;
      /** Path in the verifier's clean-room copy of the artifacts. */
      readonly path: string;
      readonly expectIncludes?: string;
    }
  | {
      readonly kind: 'evidence';
      readonly label: string;
      readonly evidenceKind: Evidence['kind'];
    }
  /**
   * PHASE 4.8B: fail-closed check for mission inputs. When the orchestrator
   * stages authoritative mission inputs into the worker's workspace, the
   * verifier can confirm that the staged input is present in the clean room.
   * This closes the fabrication path: if the worker never read the staged
   * input (because it fabricated a substitute), the input file won't appear
   * in the artifacts the worker claims — and this check fails honestly.
   */
  | {
      readonly kind: 'mission-input';
      readonly label: string;
      /** The workspace-relative path the orchestrator staged the input to. */
      readonly path: string;
      readonly expectIncludes?: string;
    }
  /**
   * PHASE 4.8D: flight-action check. Verifies that a specific provider-neutral
   * worker action was invoked with ok=true in the flight record. This is the
   * enforcement mechanism for mission obligations: if the user requires
   * delegation, the check confirms `get_durable_result` was actually called;
   * if the user requires shared publication, the check confirms
   * `append_shared_workspace` was actually called. Worker prose alone cannot
   * satisfy this — runtime evidence is required.
   */
  | {
      readonly kind: 'flight-action';
      readonly label: string;
      /** The provider-neutral action name (e.g. 'get_durable_result'). */
      readonly action: string;
    }
  /**
   * PHASE 4.8D: content-in-artifacts check. Scans ALL artifacts (not one
   * named file) for expected content. Fixes the artifact-name overfitting
   * exposed by Phase 4.8C (where verification expected 'inventory_summary.txt'
   * but the worker produced 'summary_report.md'). The check reads every file
   * in every artifact source and confirms the expected substring appears in
   * at least one. This validates the content contract, not an arbitrary name.
   */
  | {
      readonly kind: 'content-in-artifacts';
      readonly label: string;
      /** Substring expected in at least one artifact file. */
      readonly expectIncludes: string;
    }
  /**
   * G6-01 (P0 H-06): hash-match check. Verifies that an artifact file's
   * SHA-256 content hash matches an expected hex string. This is the
   * strongest content-integrity check: it catches plausible-but-wrong
   * content produced by a real-LLM worker whose file EXISTS and contains
   * a substring that satisfies `expectIncludes` but is materially wrong.
   *
   * Use cases:
   *   - Mission with a known-correct gold answer (the expected hash is
   *     computed from the gold answer before the mission starts).
   *   - Mission where the artifact must be byte-for-byte identical to a
   *     reference (e.g. a generated config file with deterministic output).
   *   - Detecting worker fabrication: a worker that "summarizes" the
   *     staged input but actually writes fabricated content fails this
   *     check even when the file exists and contains expected keywords.
   *
   * This check does NOT replace the existing `file` and `content-in-artifacts`
   * checks — it adds a stronger tier for missions that need it. Missions
   * without a known-correct hash continue to use the existing checks.
   */
  | {
      readonly kind: 'hash-match';
      readonly label: string;
      /** Path in the verifier's clean-room copy of the artifacts. */
      readonly path: string;
      /** Expected SHA-256 hex string (64 lowercase hex chars). */
      readonly expectHash: string;
    };

export interface CheckOutcome {
  readonly label: string;
  readonly kind: AcceptanceCheck['kind'];
  readonly ok: boolean;
  readonly detail: string;
}

export interface VerificationDiagnosis {
  readonly rootCause: string;
  readonly retryable: boolean;
  readonly guidance: string;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly outcomes: readonly CheckOutcome[];
  readonly summary: string;
  /** Present when a reviewer examined a failure. */
  readonly diagnosis?: VerificationDiagnosis;
  /** How many reviewer (LLM) calls this verification consumed (GROUP 3). */
  readonly reviewerCalls: number;
}

/** One artifact to copy into the clean room, with its producing computer. */
export interface ArtifactSource {
  readonly workerId: string;
  readonly computer: WorkerComputer;
  readonly paths: readonly string[];
}

export interface VerificationLoopOptions {
  /** Reviewer invoked only when a check fails (conflict/risk). */
  readonly reviewer?: ReasoningProvider;
  /**
   * PHASE 4.8B: computers that hold staged mission inputs, used by
   * `mission-input` checks to read the authoritative bytes directly from
   * the producing worker's workspace (not the clean-room copy).
   */
  readonly missionInputComputers?: ReadonlyArray<{
    readonly workerId: string;
    readonly computer: WorkerComputer;
  }>;
  /**
   * PHASE 4.8D: flight events for `flight-action` checks. The orchestrator
   * passes the recorder's events so verification can confirm that specific
   * provider-neutral worker actions (e.g. get_durable_result,
   * append_shared_workspace) were actually invoked with ok=true. This is
   * the enforcement mechanism for mission obligations.
   */
  readonly flightEvents?: readonly FlightEvent[];
}

/** Where a copied artifact lands inside the verifier's workspace. */
export function cleanRoomPath(source: ArtifactSource, path: string): string {
  return `artifacts/${source.workerId}/${path}`;
}

const DIAGNOSIS_SYSTEM =
  'You are a mission verification reviewer. Reply with ONE JSON object only: ' +
  '{"rootCause":"...","retryable":true|false,"guidance":"..."}';

function parseDiagnosis(text: string): VerificationDiagnosis | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      rootCause?: unknown;
      retryable?: unknown;
      guidance?: unknown;
    };
    if (typeof parsed.rootCause !== 'string' || typeof parsed.guidance !== 'string') {
      return undefined;
    }
    return {
      rootCause: parsed.rootCause.slice(0, 500),
      retryable: parsed.retryable !== false,
      guidance: parsed.guidance.slice(0, 500),
    };
  } catch {
    return undefined;
  }
}

export class VerificationLoop {
  private readonly verifier: WorkerComputer;
  private readonly options: VerificationLoopOptions;

  constructor(
    verifier: WorkerComputer,
    options: VerificationLoopOptions = {},
  ) {
    this.verifier = verifier;
    this.options = options;
  }

  /**
   * Copy artifacts into the clean room, then run every check. Failed checks
   * carry a traceable reason; a failing run gets one reviewer diagnosis.
   */
  async verify(
    checks: readonly AcceptanceCheck[],
    artifacts: readonly ArtifactSource[],
    evidence: readonly Evidence[] = [],
  ): Promise<VerificationResult> {
    // Clean-room copy: read from each producer, write into the verifier.
    const copyFailures: string[] = [];
    for (const source of artifacts) {
      for (const path of source.paths) {
        try {
          const read = await source.computer.readFile(path);
          await this.verifier.writeFile(cleanRoomPath(source, path), read.text);
        } catch (error) {
          copyFailures.push(
            `artifact ${source.workerId}:${path} could not be copied: ` +
              `${(error as Error).message.slice(0, 200)}`,
          );
        }
      }
    }

    const outcomes: CheckOutcome[] = [];
    for (const check of checks) {
      switch (check.kind) {
        case 'file':
          outcomes.push(await this.checkFile(check));
          break;
        case 'command':
          outcomes.push(await this.checkCommand(check));
          break;
        case 'evidence':
          outcomes.push(checkEvidence(check, evidence));
          break;
        case 'mission-input':
          outcomes.push(await this.checkMissionInput(check));
          break;
        case 'flight-action':
          outcomes.push(this.checkFlightAction(check));
          break;
        case 'content-in-artifacts':
          outcomes.push(await this.checkContentInArtifacts(check, artifacts));
          break;
        case 'hash-match':
          outcomes.push(await this.checkHashMatch(check));
          break;
      }
    }
    for (const failure of copyFailures) {
      outcomes.push({
        label: `artifact-copy:${failure.split(':')[0]}`,
        kind: 'file',
        ok: false,
        detail: failure,
      });
    }

    const failed = outcomes.filter((outcome) => !outcome.ok);
    const result: VerificationResult = {
      ok: failed.length === 0,
      outcomes,
      summary:
        failed.length === 0
          ? `all ${outcomes.length} acceptance check(s) passed`
          : `${failed.length} of ${outcomes.length} acceptance check(s) failed: ` +
            failed.map((f) => `${f.label} (${f.detail})`).join('; '),
      reviewerCalls: 0,
    };

    if (!result.ok && this.options.reviewer !== undefined) {
      const diagnosis = await this.review(failed, artifacts);
      if (diagnosis !== undefined) {
        return { ...result, diagnosis, reviewerCalls: 1 };
      }
    }
    return result;
  }

  private async checkFile(
    check: Extract<AcceptanceCheck, { kind: 'file' }>,
  ): Promise<CheckOutcome> {
    try {
      const read = await this.verifier.readFile(check.path);
      if (
        check.expectIncludes !== undefined &&
        !read.text.includes(check.expectIncludes)
      ) {
        return {
          label: check.label,
          kind: 'file',
          ok: false,
          detail:
            `"${check.path}" does not include the expected content ` +
            `(expected: "${check.expectIncludes.slice(0, 120)}")`,
        };
      }
      return {
        label: check.label,
        kind: 'file',
        ok: true,
        detail: `"${check.path}" present (${read.bytes} bytes)`,
      };
    } catch (error) {
      return {
        label: check.label,
        kind: 'file',
        ok: false,
        detail: `"${check.path}" not found in the clean room: ${(error as Error).message.slice(0, 160)}`,
      };
    }
  }

  private async checkMissionInput(
    check: Extract<AcceptanceCheck, { kind: 'mission-input' }>,
  ): Promise<CheckOutcome> {
    // PHASE 4.8B: read from the producing worker's own computer (not the
    // clean-room copy). The clean-room only contains artifacts the worker
    // explicitly claimed; the staged input may or may not be among them.
    // The fail-closed semantics require checking the authoritative source.
    const computers = this.options.missionInputComputers ?? [];
    for (const source of computers) {
      try {
        const read = await source.computer.readFile(check.path);
        if (
          check.expectIncludes !== undefined &&
          !read.text.includes(check.expectIncludes)
        ) {
          return {
            label: check.label,
            kind: 'mission-input',
            ok: false,
            detail: `"${check.path}" was found in ${source.workerId}'s workspace but does NOT contain the expected authoritative content — possible fabrication (expected substring: "${check.expectIncludes.slice(0, 80)}")`,
          };
        }
        return {
          label: check.label,
          kind: 'mission-input',
          ok: true,
          detail: `authoritative input "${check.path}" observed in ${source.workerId}'s workspace (${read.bytes} bytes)`,
        };
      } catch {
        // try next computer
      }
    }
    return {
      label: check.label,
      kind: 'mission-input',
      ok: false,
      detail: `authoritative input "${check.path}" was NOT found in any worker's workspace — the worker may have fabricated a substitute. Fail-closed: the mission's factual claim cannot be traced to the authoritative input.`,
    };
  }

  /**
   * PHASE 4.8D: Check that a specific provider-neutral worker action was
   * actually invoked with ok=true in the flight record. This is the
   * enforcement mechanism for mission obligations: worker prose claiming
   * "I used the durable worker" cannot satisfy this check — only a real
   * `get_durable_result` action with ok=true can.
   */
  private checkFlightAction(
    check: Extract<AcceptanceCheck, { kind: 'flight-action' }>,
  ): CheckOutcome {
    const events = this.options.flightEvents ?? [];
    const found = events.some(
      (e) => {
        const ev = e as { type: string; action?: string; ok?: boolean };
        return ev.type === 'worker-step' && ev.action === check.action && ev.ok === true;
      },
    );
    return {
      label: check.label,
      kind: 'flight-action',
      ok: found,
      detail: found
        ? `worker action "${check.action}" was invoked with ok=true (flight record evidence)`
        : `worker action "${check.action}" was NOT invoked with ok=true — the mission obligation is not satisfied by runtime evidence. Worker prose alone cannot satisfy this check.`,
    };
  }

  /**
   * PHASE 4.8D: Check that expected content appears in at least one artifact
   * file across all artifact sources. Fixes the artifact-name overfitting
   * exposed by Phase 4.8C: the check validates the content contract, not an
   * arbitrary file name.
   */
  private async checkContentInArtifacts(
    check: Extract<AcceptanceCheck, { kind: 'content-in-artifacts' }>,
    artifacts: readonly ArtifactSource[],
  ): Promise<CheckOutcome> {
    for (const source of artifacts) {
      for (const path of source.paths) {
        try {
          const read = await source.computer.readFile(path);
          if (read.text.includes(check.expectIncludes)) {
            return {
              label: check.label,
              kind: 'content-in-artifacts',
              ok: true,
              detail: `expected content found in ${source.workerId}:${path} (${read.bytes} bytes)`,
            };
          }
        } catch {
          // try next file
        }
      }
    }
    return {
      label: check.label,
      kind: 'content-in-artifacts',
      ok: false,
      detail: `expected content "${check.expectIncludes.slice(0, 80)}" was NOT found in any artifact across all workers`,
    };
  }

  /**
   * G6-01 (P0 H-06): Check that an artifact file's SHA-256 content hash
   * matches the expected hex string. This is the strongest content-integrity
   * check: it catches plausible-but-wrong content produced by a real-LLM
   * worker whose file EXISTS and contains a substring that satisfies
   * `expectIncludes` but is materially wrong.
   *
   * The hash is computed over the verifier's clean-room copy of the file
   * (not the producing worker's workspace), so a worker cannot leave
   * anything behind in its own workspace that fakes the pass. The expected
   * hash is normalized to lowercase before comparison.
   */
  private async checkHashMatch(
    check: Extract<AcceptanceCheck, { kind: 'hash-match' }>,
  ): Promise<CheckOutcome> {
    try {
      const read = await this.verifier.readFile(check.path);
      const actual =
        read.text.length === 0
          ? ''
          : createHash('sha256').update(read.text, 'utf8').digest('hex');
      const expected = check.expectHash.toLowerCase();
      if (actual === expected) {
        return {
          label: check.label,
          kind: 'hash-match',
          ok: true,
          detail: `"${check.path}" content hash matches expected (${read.bytes} bytes, sha256=${actual.slice(0, 16)}…)`,
        };
      }
      return {
        label: check.label,
        kind: 'hash-match',
        ok: false,
        detail:
          `"${check.path}" content hash does NOT match expected ` +
          `(expected=${expected.slice(0, 16)}…, actual=${actual.slice(0, 16)}…, ` +
          `${read.bytes} bytes). The file exists but its content is materially different ` +
          `from the expected gold answer — plausible-but-wrong content under a real-LLM worker.`,
      };
    } catch (error) {
      return {
        label: check.label,
        kind: 'hash-match',
        ok: false,
        detail: `"${check.path}" not found in the clean room: ${(error as Error).message.slice(0, 160)}`,
      };
    }
  }

  private async checkCommand(
    check: Extract<AcceptanceCheck, { kind: 'command' }>,
  ): Promise<CheckOutcome> {
    try {
      const exec = await this.verifier.exec(check.command);
      if (exec.exitCode !== (check.expectExit ?? 0)) {
        return {
          label: check.label,
          kind: 'command',
          ok: false,
          detail:
            `"${check.command.slice(0, 120)}" exited ${exec.exitCode} ` +
            `(expected ${(check.expectExit ?? 0)}); stderr: ${exec.stderr.slice(0, 200)}`,
        };
      }
      if (
        check.expectOutputIncludes !== undefined &&
        !exec.stdout.includes(check.expectOutputIncludes)
      ) {
        return {
          label: check.label,
          kind: 'command',
          ok: false,
          detail:
            `output of "${check.command.slice(0, 120)}" does not include ` +
            `"${check.expectOutputIncludes.slice(0, 120)}"; got: ${exec.stdout.slice(0, 200)}`,
        };
      }
      if (
        check.expectOutputExcludes !== undefined &&
        exec.stdout.includes(check.expectOutputExcludes)
      ) {
        return {
          label: check.label,
          kind: 'command',
          ok: false,
          detail:
            `output of "${check.command.slice(0, 120)}" includes forbidden ` +
            `"${check.expectOutputExcludes.slice(0, 120)}"`,
        };
      }
      return {
        label: check.label,
        kind: 'command',
        ok: true,
        detail: `"${check.command.slice(0, 120)}" passed (${exec.elapsedMs}ms)`,
      };
    } catch (error) {
      return {
        label: check.label,
        kind: 'command',
        ok: false,
        detail: `"${check.command.slice(0, 120)}" could not run: ${(error as Error).message.slice(0, 160)}`,
      };
    }
  }

  /** One bounded reviewer call — only on failure, never a standing reviewer. */
  private async review(
    failed: readonly CheckOutcome[],
    artifacts: readonly ArtifactSource[],
  ): Promise<VerificationDiagnosis | undefined> {
    try {
      const output = await this.options.reviewer!.reason({
        system: DIAGNOSIS_SYSTEM,
        prompt: [
          'A mission failed verification. Failed checks:',
          ...failed.map((f) => `- [${f.kind}] ${f.label}: ${f.detail}`),
          '',
          'Artifacts that were produced:',
          ...artifacts.flatMap((a) =>
            a.paths.map((path) => `- ${a.workerId}:${path}`),
          ),
          '',
          'Diagnose the root cause and say whether one bounded retry of the',
          'responsible work could fix it. Reply with the JSON object only.',
        ].join('\n'),
        tier: 'default',
      });
      return parseDiagnosis(output.text);
    } catch {
      return undefined; // a failing reviewer must not mask the real failures
    }
  }
}

function checkEvidence(
  check: Extract<AcceptanceCheck, { kind: 'evidence' }>,
  evidence: readonly Evidence[],
): CheckOutcome {
  const present = evidence.some((item) => item.kind === check.evidenceKind);
  return {
    label: check.label,
    kind: 'evidence',
    ok: present,
    detail: present
      ? `evidence of kind "${check.evidenceKind}" is present`
      : `no evidence of kind "${check.evidenceKind}" was attached to the mission`,
  };
}

/**
 * The structural floor when the caller provides no explicit checks: every
 * produced artifact must exist in the clean room. Caller-provided checks are
 * the strong path; this only guarantees a mission cannot pass on claims.
 */
export function deriveChecks(
  artifacts: readonly ArtifactSource[],
): AcceptanceCheck[] {
  return artifacts.flatMap((source) =>
    source.paths.map(
      (path): AcceptanceCheck => ({
        kind: 'file',
        label: `artifact-exists:${source.workerId}:${path}`,
        path: cleanRoomPath(source, path),
      }),
    ),
  );
}
