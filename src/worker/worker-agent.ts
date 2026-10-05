import type {
  Evidence,
  ReasoningProvider,
  WorkerGenome,
} from '../contracts/core.js';
import type { WorkerComputer } from '../runtime/computer.js';
import type { HandoffSink } from './handoff.js';

/**
 * The Genesis Worker (TASK-010): one genome, one brain, one pair of hands.
 *
 * A worker is a small acting loop, not a framework:
 *
 *   reason (at the genome's tier) → one typed action → execute on the
 *   worker's own OpenBot computer → observe → repeat → finish.
 *
 * Three invariants make this a REAL worker rather than a scripted demo:
 *
 *   1. Grants: the only actions available are the ones the genome's `tools`
 *      grants actually cover (`openbot:shell-execution` → run_command,
 *      `openbot:workspace-files` → file actions). A worker asking for more
 *      receives a structured refusal and must adapt — the same semantics as
 *      the OpenBot gateway.
 *   2. Honesty: a worker cannot declare success silently. It finishes with
 *      artifacts in its workspace, and TASK-013's verification loop — not the
 *      worker's own word — decides whether the mission succeeded.
 *   3. Boundedness: step cap, consecutive parse-failure cap, abort signal.
 *
 * No hidden chain-of-thought is stored: the scratchpad is worker-private
 * working memory; what leaves this loop is actions, observations and results.
 */

/** The actions a worker can take. */
export type WorkerAction =
  | { readonly action: 'run_command'; readonly command: string }
  | {
      readonly action: 'write_file';
      readonly path: string;
      readonly contents: string;
    }
  | { readonly action: 'read_file'; readonly path: string }
  | { readonly action: 'list_files'; readonly path?: string }
  | {
      readonly action: 'ask_worker';
      readonly target: string;
      readonly task: string;
      readonly constraints?: readonly string[];
      readonly answerShape: string;
    }
  | {
      readonly action: 'finish';
      readonly summary: string;
      readonly artifacts?: readonly string[];
    };

/** What the worker reports when its loop ends. */
export interface WorkerResult {
  readonly workerId: string;
  readonly status: 'success' | 'failure';
  readonly summary: string;
  readonly evidence: readonly Evidence[];
  readonly artifacts: readonly string[];
  readonly steps: number;
  readonly reasoningCalls: number;
  readonly refusals: readonly string[];
}

/** Flight-recorder hook: one event per worker step (never transcripts). */
export interface WorkerEventSink {
  (event: WorkerLoopEvent): void;
}

export type WorkerLoopEvent =
  | {
      readonly type: 'worker-started';
      readonly workerId: string;
      readonly role: string;
      readonly tier: string;
    }
  | {
      readonly type: 'worker-step';
      readonly workerId: string;
      readonly step: number;
      readonly action: string;
      readonly ok: boolean;
      readonly elapsedMs: number;
    }
  | { readonly type: 'worker-finished'; readonly workerId: string; readonly result: WorkerResult };

export interface WorkerAgentOptions {
  readonly genome: WorkerGenome;
  readonly reasoning: ReasoningProvider;
  /** The worker's computer; null only when the genome requires none. */
  readonly computer: WorkerComputer | null;
  /** The assignment: objective, mission context, upstream results. */
  readonly taskBrief: string;
  /** The mission's worker-to-worker channel (TASK-011), when one exists. */
  readonly handoffs?: HandoffSink;
  readonly maxSteps?: number;
  readonly signal?: AbortSignal;
  readonly onEvent?: WorkerEventSink;
}

const GRANT_SHELL = 'openbot:shell-execution';
const GRANT_FILES = 'openbot:workspace-files';

/** v0.1 default step ceiling — generous for real work, small enough to bound cost. */
export const DEFAULT_MAX_WORKER_STEPS = 10;

const MAX_PARSE_FAILURES = 2;
const OBSERVATION_STDOUT_LIMIT = 4_000;

export class WorkerAgent {
  private readonly genome: WorkerGenome;
  private readonly reasoning: ReasoningProvider;
  private readonly computer: WorkerComputer | null;
  private readonly taskBrief: string;
  private readonly handoffs: HandoffSink | undefined;
  private readonly maxSteps: number;
  private readonly signal: AbortSignal | undefined;
  private readonly onEvent: WorkerEventSink | undefined;

  constructor(options: WorkerAgentOptions) {
    this.genome = options.genome;
    this.reasoning = options.reasoning;
    this.computer = options.computer;
    this.taskBrief = options.taskBrief;
    this.handoffs = options.handoffs;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_WORKER_STEPS;
    this.signal = options.signal;
    this.onEvent = options.onEvent;
  }

  private systemPrompt(): string {
    const granted: string[] = [];
    const examples: string[] = [
      '{"action":"run_command","command":"..."} — run a bash command in your workspace',
      '{"action":"write_file","path":"...","contents":"..."} — write a text file',
      '{"action":"read_file","path":"..."} — read a text file',
      '{"action":"list_files","path":"."} — list workspace contents',
    ];
    if (this.genome.tools.includes(GRANT_SHELL)) {
      granted.push('run_command');
    } else {
      examples.splice(0, 1);
    }
    if (this.genome.tools.includes(GRANT_FILES)) {
      granted.push('write_file', 'read_file', 'list_files');
    } else {
      examples.splice(0, 3);
    }
    const canCollaborate =
      this.genome.skills.includes('collaboration') && this.handoffs !== undefined;
    if (canCollaborate) {
      granted.push('ask_worker');
      examples.push(
        '{"action":"ask_worker","target":"worker-id","task":"...","constraints":["..."],"answerShape":"..."} — ask a colleague in this mission to do work and answer with evidence',
      );
    }
    granted.push('finish');
    examples.push(
      '{"action":"finish","summary":"...","artifacts":["path",...]} — the task is done (or blocked); list deliverable files',
    );
    return [
      `You are ${this.genome.identity.displayName}, a ${this.genome.role}.`,
      `Objective: ${this.genome.objective}`,
      'You have your own private workspace computer. All file paths are relative to your workspace.',
      '',
      'You act ONE STEP AT A TIME. Every reply is exactly ONE JSON object and nothing else:',
      ...examples,
      '',
      `Granted actions: ${granted.join(', ')}.`,
      'Rules:',
      '- Reply with ONE JSON object only. No prose, no code fences.',
      '- Paths are workspace-relative; never absolute, never "..".',
      '- Check your own work with commands before finishing.',
      '- When done, finish with a concise summary and your artifact paths.',
      '- If blocked, finish anyway and say plainly what blocked you.',
    ].join('\n');
  }

  /** Extract the first JSON object from a model reply (fences tolerated once). */
  private parseAction(text: string): WorkerAction | undefined {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return undefined;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as WorkerAction;
      if (typeof parsed.action !== 'string') return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private grantsFor(action: WorkerAction): string | null {
    switch (action.action) {
      case 'run_command':
        return this.genome.tools.includes(GRANT_SHELL) ? null : GRANT_SHELL;
      case 'write_file':
      case 'read_file':
      case 'list_files':
        return this.genome.tools.includes(GRANT_FILES) ? null : GRANT_FILES;
      case 'ask_worker':
        return this.genome.skills.includes('collaboration') && this.handoffs !== undefined
          ? null
          : 'the collaboration skill and a mission handoff channel';
      case 'finish':
        return null;
      default:
        return 'an unknown action';
    }
  }

  private async execute(
    action: WorkerAction,
  ): Promise<{ ok: boolean; observation: string }> {
    if (action.action === 'finish') {
      return { ok: true, observation: 'finished' };
    }
    if (action.action === 'ask_worker') {
      const result = await this.handoffs!.ask({
        from: this.genome.identity.id,
        to: action.target,
        task: action.task,
        ...(action.constraints === undefined || action.constraints.length === 0
          ? {}
          : { constraints: action.constraints }),
        answerShape: action.answerShape,
      });
      return {
        ok: result.ok,
        observation: JSON.stringify(result),
      };
    }
    if (this.computer === null) {
      return {
        ok: false,
        observation:
          'refused: this worker has no computer (no computer-requiring grants)',
      };
    }
    try {
      switch (action.action) {
        case 'run_command': {
          const result = await this.computer.exec(action.command);
          const stdout =
            result.stdout.length > OBSERVATION_STDOUT_LIMIT
              ? `${result.stdout.slice(0, OBSERVATION_STDOUT_LIMIT)}…[truncated]`
              : result.stdout;
          return {
            ok: result.exitCode === 0,
            observation: JSON.stringify({ ...result, stdout }),
          };
        }
        case 'write_file': {
          const result = await this.computer.writeFile(
            action.path,
            action.contents,
          );
          return { ok: true, observation: JSON.stringify(result) };
        }
        case 'read_file': {
          const result = await this.computer.readFile(action.path);
          return { ok: true, observation: JSON.stringify(result) };
        }
        case 'list_files': {
          const entries = await this.computer.listFiles(action.path);
          return { ok: true, observation: JSON.stringify({ entries }) };
        }
        default:
          return { ok: false, observation: 'refused: unknown action' };
      }
    } catch (error) {
      return {
        ok: false,
        observation: `error: ${(error as Error).message.slice(0, 300)}`,
      };
    }
  }

  async run(): Promise<WorkerResult> {
    const workerId = this.genome.identity.id;
    this.onEvent?.({
      type: 'worker-started',
      workerId,
      role: this.genome.role,
      tier: this.genome.model,
    });

    const scratchpad: string[] = [];
    const refusals: string[] = [];
    const artifacts: string[] = [];
    let steps = 0;
    let reasoningCalls = 0;
    let parseFailures = 0;
    let finishSummary = '';

    const base = (): Omit<WorkerResult, 'status' | 'summary' | 'evidence'> => ({
      workerId,
      artifacts,
      steps,
      reasoningCalls,
      refusals,
    });

    while (steps < this.maxSteps) {
      if (this.signal?.aborted) {
        return this.finish('failure', 'mission aborted before completion', base());
      }

      const prompt = [
        'TASK:',
        this.taskBrief,
        '',
        'STEPS SO FAR:',
        ...(scratchpad.length === 0 ? ['(none — this is your first step)'] : scratchpad),
        '',
        'Your next step as ONE JSON object:',
      ].join('\n');

      let text: string;
      try {
        const output = await this.reasoning.reason({
          system: this.systemPrompt(),
          prompt,
          tier: this.genome.model,
        });
        reasoningCalls += 1;
        text = output.text;
      } catch (error) {
        return this.finish(
          'failure',
          `reasoning provider failed: ${(error as Error).message.slice(0, 200)}`,
          base(),
        );
      }

      const action = this.parseAction(text);
      if (action === undefined) {
        parseFailures += 1;
        scratchpad.push(
          `step ${steps + 1}: your reply was not a single JSON object ` +
            `(attempt ${parseFailures}/${MAX_PARSE_FAILURES})`,
        );
        if (parseFailures >= MAX_PARSE_FAILURES) {
          return this.finish(
            'failure',
            'the worker could not produce a valid action after repeated attempts',
            base(),
          );
        }
        continue;
      }
      parseFailures = 0;

      if (action.action === 'finish') {
        finishSummary = action.summary;
        for (const path of action.artifacts ?? []) {
          if (!artifacts.includes(path)) artifacts.push(path);
        }
        break;
      }

      const missingGrant = this.grantsFor(action);
      if (missingGrant !== null) {
        const refusal =
          `refused: action "${action.action}" requires grant ${missingGrant}, ` +
          'which this worker does not hold';
        refusals.push(refusal);
        scratchpad.push(`step ${steps + 1}: ${JSON.stringify(action)}`, `observation: ${refusal}`);
        steps += 1;
        this.onEvent?.({
          type: 'worker-step',
          workerId,
          step: steps,
          action: action.action,
          ok: false,
          elapsedMs: 0,
        });
        continue;
      }

      const startedAt = Date.now();
      const { ok, observation } = await this.execute(action);
      const elapsedMs = Date.now() - startedAt;
      steps += 1;
      scratchpad.push(
        `step ${steps}: ${JSON.stringify(action)}`,
        `observation: ${observation}`,
      );
      this.onEvent?.({
        type: 'worker-step',
        workerId,
        step: steps,
        action: action.action,
        ok,
        elapsedMs,
      });
    }

    if (finishSummary === '') {
      return this.finish(
        'failure',
        `step budget of ${this.maxSteps} exhausted before the worker finished`,
        base(),
      );
    }

    // Confirm claimed artifacts actually exist before reporting success —
    // a worker's claim about its own files is checked, not trusted.
    const claimed = [...artifacts];
    const confirmed: string[] = [];
    let missing = 0;
    for (const path of claimed) {
      try {
        if (this.computer !== null) {
          await this.computer.readFile(path);
        }
        confirmed.push(path);
      } catch {
        missing += 1;
        refusals.push(`claimed artifact "${path}" was not found in the workspace`);
      }
    }
    artifacts.length = 0;
    artifacts.push(...confirmed);

    // Success means the worker's OWN report is internally consistent: it
    // finished, and every artifact it claimed is really there. Whether the
    // artifacts satisfy the MISSION is the verification loop's judgement.
    const result: WorkerResult = {
      workerId,
      status: missing === 0 ? 'success' : 'failure',
      summary: finishSummary,
      evidence: confirmed.map((path) => ({
        kind: 'artifact' as const,
        description: `${this.genome.role} deliverable at ${path}`,
        location: `${workerId}:${path}`,
      })),
      artifacts: confirmed,
      steps,
      reasoningCalls,
      refusals,
    };
    this.onEvent?.({ type: 'worker-finished', workerId, result });
    return result;
  }

  private finish(
    status: WorkerResult['status'],
    summary: string,
    base: Omit<WorkerResult, 'status' | 'summary' | 'evidence'>,
  ): WorkerResult {
    const result: WorkerResult = {
      workerId: base.workerId,
      status,
      summary,
      evidence: [],
      artifacts: base.artifacts,
      steps: base.steps,
      reasoningCalls: base.reasoningCalls,
      refusals: base.refusals,
    };
    this.onEvent?.({
      type: 'worker-finished',
      workerId: base.workerId,
      result,
    });
    return result;
  }
}
