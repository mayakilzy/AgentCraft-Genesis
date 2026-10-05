import type { Evidence, ReasoningProvider } from '../contracts/core.js';
import type { WorkerComputer } from '../runtime/computer.js';

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
