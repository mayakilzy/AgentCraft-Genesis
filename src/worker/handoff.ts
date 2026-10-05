import type {
  Evidence,
  ReasoningProvider,
  WorkerGenome,
} from '../contracts/core.js';
import type { WorkerComputer } from '../runtime/computer.js';
import { WorkerAgent } from './worker-agent.js';

/**
 * Minimal Worker Coordination (TASK-011): one worker asking another for real
 * work, over a typed handoff — the semantics of OpenBot's documented
 * bot-to-bot handoff, implemented at the layer Genesis actually owns.
 *
 * Why not OpenBot's `message_bot` directly: that primitive lives inside the
 * OpenBot server (grant tables, the work-items queue, Intelligence threads),
 * which is a full server deployment Genesis v0.1 workers do not run inside.
 * What Genesis preserves from it — because it is what makes a handoff safe —
 * is the SHAPE:
 *
 *   - typed envelope: the task, its bounds, and what a good answer looks
 *     like — never a paragraph the receiver must interpret;
 *   - references only: task/result/evidence cross the boundary; private
 *     working memory (scratchpads, chain-of-thought) never does;
 *   - depth is capped and REFUSED, not truncated — no A→B→C→… chains;
 *   - a handoff that fails for good is said out loud, never silently
 *     swallowed;
 *   - the answer comes back with evidence from the answering worker's own
 *     verified work.
 *
 * A2A stays out (per the ownership registry): workers in one mission are not
 * independent agents across deployments; when they are, A2A is the protocol.
 */

/** The typed envelope one worker sends another (mirrors message_bot's shape). */
export interface HandoffRequest {
  readonly from: string;
  readonly to: string;
  readonly task: string;
  readonly constraints?: readonly string[];
  /** What a good answer looks like — bounds the receiver's interpretation. */
  readonly answerShape: string;
}

/** The typed answer that comes back. */
export interface HandoffResult {
  readonly to: string;
  readonly ok: boolean;
  readonly answer: string;
  readonly evidence: readonly Evidence[];
  /** Present when refused or failed — the reason is said out loud. */
  readonly reason?: string;
}

/** The port a worker uses to ask a colleague. */
export interface HandoffSink {
  ask(request: HandoffRequest): Promise<HandoffResult>;
}

/** Everything needed to run a worker that can serve handoffs. */
export interface HandoffParticipant {
  readonly genome: WorkerGenome;
  readonly reasoning: ReasoningProvider;
  readonly computer: WorkerComputer | null;
}

/** Flight-recorder hook for handoffs. */
export interface HandoffEvent {
  readonly type: 'handoff';
  readonly from: string;
  readonly to: string;
  readonly ok: boolean;
  readonly reason?: string;
}

export interface MissionHandoffsOptions {
  /** v0.1 cap: no chains — a handoff may not be served inside a handoff. */
  readonly maxDepth?: number;
  /** Step ceiling for serving a handoff (default 5). */
  readonly serveMaxSteps?: number;
  readonly onEvent?: (event: HandoffEvent) => void;
  readonly signal?: AbortSignal;
}

function refuse(
  request: HandoffRequest,
  reason: string,
  onEvent?: (event: HandoffEvent) => void,
): HandoffResult {
  onEvent?.({ type: 'handoff', from: request.from, to: request.to, ok: false, reason });
  return { to: request.to, ok: false, answer: '', evidence: [], reason };
}

/**
 * The mission's handoff channel. One instance per mission; workers obtain it
 * through their options and the orchestrator wires the same roster to every
 * participant.
 */
export class MissionHandoffs implements HandoffSink {
  private readonly participants: ReadonlyMap<string, HandoffParticipant>;
  private readonly options: Required<
    Omit<MissionHandoffsOptions, 'onEvent' | 'signal'>
  > & {
    onEvent?: (event: HandoffEvent) => void;
    signal?: AbortSignal;
  };
  private depth = 0;

  constructor(
    participants: ReadonlyMap<string, HandoffParticipant>,
    options: MissionHandoffsOptions = {},
  ) {
    this.participants = participants;
    this.options = {
      maxDepth: options.maxDepth ?? 1,
      serveMaxSteps: options.serveMaxSteps ?? 5,
      onEvent: options.onEvent,
      signal: options.signal,
    };
  }

  async ask(request: HandoffRequest): Promise<HandoffResult> {
    const { onEvent } = this.options;

    const target = this.participants.get(request.to);
    if (target === undefined) {
      return refuse(
        request,
        `no worker "${request.to}" in this mission's roster`,
        onEvent,
      );
    }
    if (request.to === request.from) {
      return refuse(request, 'a worker cannot hand work to itself', onEvent);
    }
    if (this.depth >= this.options.maxDepth) {
      return refuse(
        request,
        `handoff depth cap of ${this.options.maxDepth} reached — chains are refused, not truncated`,
        onEvent,
      );
    }
    if (!request.task.trim() || !request.answerShape.trim()) {
      return refuse(
        request,
        'a handoff needs a non-empty task and answerShape',
        onEvent,
      );
    }

    this.depth += 1;
    try {
      const agent = new WorkerAgent({
        genome: target.genome,
        reasoning: target.reasoning,
        computer: target.computer,
        taskBrief: renderHandoffBrief(request),
        maxSteps: this.options.serveMaxSteps,
        signal: this.options.signal,
      });
      const served = await agent.run();
      const result: HandoffResult = {
        to: request.to,
        ok: served.status === 'success',
        answer: served.summary,
        evidence: served.evidence,
        ...(served.status === 'success'
          ? {}
          : {
              reason:
                `worker "${request.to}" failed to serve the handoff: ${served.summary}`,
            }),
      };
      onEvent?.({
        type: 'handoff',
        from: request.from,
        to: request.to,
        ok: result.ok,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      });
      return result;
    } finally {
      this.depth -= 1;
    }
  }
}

/** The brief the answering worker receives: the envelope, nothing else. */
export function renderHandoffBrief(request: HandoffRequest): string {
  return [
    'A colleague worker has asked you for help. Their typed request:',
    '',
    `TASK: ${request.task}`,
    ...(request.constraints === undefined || request.constraints.length === 0
      ? []
      : [`CONSTRAINTS: ${request.constraints.join('; ')}`]),
    `WHAT A GOOD ANSWER LOOKS LIKE: ${request.answerShape}`,
    '',
    'Do the work with your own tools and workspace, verify it, then finish.',
    'Your finish summary is the answer delivered back to the colleague, and',
    'any artifacts you list are attached to the answer as evidence.',
  ].join('\n');
}
