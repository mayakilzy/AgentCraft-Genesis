import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
  ScopeableReasoningProvider,
} from '../../src/contracts/core.js';
import type { FlightRecorder } from '../../src/mission/flight-recorder.js';

/**
 * DEVELOPMENT REASONING FALLBACK (TASK-022 rule, review-authorized).
 *
 * A development-only harness — NOT a production provider — that substitutes
 * the unavailable external LLM by relaying each reasoning call to the GLM
 * Primary Builder through a file journal:
 *
 *   reason(input) → writes req-<seq>.json → waits for resp-<seq>.txt
 *                 → returns its text as the ReasoningOutput.
 *
 * TASK-022A (fallback instance isolation): the journal is PARTITIONED per
 * logical worker instance. Every WorkerAgent construction — a specialist's
 * main run, its bounded retry, the coordinator, or a handoff-served
 * invocation — scopes this provider through forInstance() and receives its
 * own journal directory under the mission root, so the actor serving an
 * instance can see only that instance's requests (same-instance continuity
 * preserved; cross-instance hidden memory impossible). The pre-TASK-022A
 * single shared journal is exactly what the Experiment 003 independent
 * review classified as process contamination: one persistent actor reused
 * across logically isolated worker instances. Mission-scope calls that do
 * not pass through a WorkerAgent (the failure-reviewer) journal at the root.
 *
 * What makes this honest:
 *
 *   - REPLACE REASONING, NEVER EXECUTION: the adapter only answers the
 *     ReasoningProvider boundary. Tools, computers, git, integration and
 *     verification keep running exactly as with a real provider.
 *   - Each request file preserves EXACTLY what the fallback actor was shown
 *     for that call (system + prompt + tier, nothing else) and declares the
 *     instance it belongs to — the audit trail of the per-instance
 *     epistemic boundary: a compliant actor answers from the request and its
 *     instance directory, and nothing else is reachable.
 *   - Every call is announced in the flight record as
 *     reasoning_source = DEVELOPMENT_REASONING_FALLBACK, so a
 *     fallback-served mission can never be confused with a real-provider
 *     run; usage is reported as fallback calls, never external calls.
 *   - No retry, no queue, no proxy, no provider infrastructure: one class,
 *     two files per call, a poll loop.
 */

export interface DevelopmentFallbackOptions {
  /** Directory for the request/response journal (created if absent). */
  readonly queueDir: string;
  readonly missionId: string;
  /** Flight recorder for per-call visibility events (optional). */
  readonly recorder?: FlightRecorder;
  /** How long one call waits for the fallback actor (default 15 min). */
  readonly waitTimeoutMs?: number;
  /** Journal poll interval (default 2 s). */
  readonly pollIntervalMs?: number;
}

/** What the journal records about one substituted call. */
export interface FallbackUsage {
  readonly calls: number;
  readonly promptChars: number;
  readonly completionChars: number;
  readonly timeouts: number;
}

/**
 * State shared by the mission-root provider and every instance view it hands
 * out: the mission-total usage (reported by currentUsage() wherever read) and
 * the guard that keeps one journal directory per logical worker instance.
 */
interface FallbackInternals {
  /** Mutable mission-total accumulator (root + all instance views). */
  readonly usage: {
    calls: number;
    promptChars: number;
    completionChars: number;
    timeouts: number;
  };
  /** Journal directory names already issued — uniqueness is the boundary. */
  readonly issuedDirs: Set<string>;
  /** The mission-root queue directory; every instance dir is its child. */
  readonly rootDir: string;
  /** Instance key of this view ('' for the mission root). */
  readonly instance: string;
}

function pad(seq: number): string {
  return String(seq).padStart(4, '0');
}

/**
 * Journal directory name for one instance key: traversal-safe, collision-
 * guarded by the issuedDirs set. Instance dirs are prefixed so they can
 * never be confused with the root's own request files.
 */
function instanceDirName(instanceKey: string): string {
  const cleaned = instanceKey
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error(
      `invalid fallback instance key: ${JSON.stringify(instanceKey)}`,
    );
  }
  return `instance-${cleaned}`;
}

export class DevelopmentFallbackProvider implements ScopeableReasoningProvider {
  readonly name = 'development-reasoning-fallback';

  private readonly queueDir: string;
  private readonly missionId: string;
  private readonly recorder: FlightRecorder | undefined;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly internals: FallbackInternals;
  private seq = 0;

  constructor(options: DevelopmentFallbackOptions, internals?: FallbackInternals) {
    this.queueDir = options.queueDir;
    mkdirSync(options.queueDir, { recursive: true });
    this.missionId = options.missionId;
    this.recorder = options.recorder;
    this.waitTimeoutMs = options.waitTimeoutMs ?? 15 * 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.internals =
      internals ?? {
        usage: { calls: 0, promptChars: 0, completionChars: 0, timeouts: 0 },
        issuedDirs: new Set<string>(),
        rootDir: options.queueDir,
        instance: '',
      };
  }

  /**
   * TASK-022A: a provider view scoped to ONE logical worker instance. The
   * view journals into its own directory under the mission root — never a
   * subdirectory of another view — so the actor serving it can reach only
   * this instance's requests. Two instances must never share a context: a
   * duplicate key fails loudly instead of silently merging journals.
   */
  forInstance(instanceKey: string): ReasoningProvider {
    const dirName = instanceDirName(instanceKey);
    if (this.internals.issuedDirs.has(dirName)) {
      throw new Error(
        `development fallback instance key already in use: ${JSON.stringify(
          instanceKey,
        )} — two logical worker instances must never share a fallback context`,
      );
    }
    this.internals.issuedDirs.add(dirName);
    const viewDir = join(this.internals.rootDir, dirName);
    mkdirSync(viewDir, { recursive: true });
    return new DevelopmentFallbackProvider(
      {
        queueDir: viewDir,
        missionId: this.missionId,
        ...(this.recorder === undefined ? {} : { recorder: this.recorder }),
        waitTimeoutMs: this.waitTimeoutMs,
        pollIntervalMs: this.pollIntervalMs,
      },
      {
        usage: this.internals.usage,
        issuedDirs: this.internals.issuedDirs,
        rootDir: this.internals.rootDir,
        instance: instanceKey,
      },
    );
  }

  /** Fallback-served calls only — never counted as external provider calls. */
  currentUsage(): FallbackUsage {
    return { ...this.internals.usage };
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    const seq = (this.seq += 1);
    const requestPath = join(this.queueDir, `req-${pad(seq)}.json`);
    const responsePath = join(this.queueDir, `resp-${pad(seq)}.txt`);
    const instance = this.internals.instance;

    // The exact input the external provider would have received — and the
    // exact input the fallback actor is allowed to see, in this instance's
    // own journal directory. Nothing else is communicated in either
    // direction.
    writeFileSync(
      requestPath,
      JSON.stringify(
        {
          seq,
          at: new Date().toISOString(),
          reasoning_source: 'DEVELOPMENT_REASONING_FALLBACK',
          external_provider: 'unavailable',
          fallback_actor: 'GLM_PRIMARY_BUILDER',
          ...(instance === '' ? {} : { instance }),
          system: input.system ?? '',
          prompt: input.prompt,
          tier: input.tier,
        },
        null,
        2,
      ),
      'utf8',
    );
    this.recorder?.record({
      type: 'reasoning-fallback',
      missionId: this.missionId,
      seq,
      phase: 'requested',
      reasoning_source: 'DEVELOPMENT_REASONING_FALLBACK',
      external_provider: 'unavailable',
      fallback_actor: 'GLM_PRIMARY_BUILDER',
      ...(instance === '' ? {} : { instance }),
      tier: input.tier,
      promptChars: input.prompt.length,
    });

    const deadline = Date.now() + this.waitTimeoutMs;
    const startedAt = Date.now();
    while (Date.now() < deadline) {
      if (existsSync(responsePath)) {
        // Give a partially-written file a moment to complete, then read.
        await new Promise((resolve) => setTimeout(resolve, 250));
        const text = readFileSync(responsePath, 'utf8');
        const waitMs = Date.now() - startedAt;
        renameSync(
          requestPath,
          join(this.queueDir, `done-req-${pad(seq)}.json`),
        );
        renameSync(
          responsePath,
          join(this.queueDir, `done-resp-${pad(seq)}.txt`),
        );
        this.internals.usage.calls += 1;
        this.internals.usage.promptChars += input.prompt.length;
        this.internals.usage.completionChars += text.length;
        this.recorder?.record({
          type: 'reasoning-fallback',
          missionId: this.missionId,
          seq,
          phase: 'answered',
          reasoning_source: 'DEVELOPMENT_REASONING_FALLBACK',
          external_provider: 'unavailable',
          fallback_actor: 'GLM_PRIMARY_BUILDER',
          ...(instance === '' ? {} : { instance }),
          tier: input.tier,
          waitMs,
          completionChars: text.length,
        });
        return { text };
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    this.internals.usage.timeouts += 1;
    this.recorder?.record({
      type: 'reasoning-fallback',
      missionId: this.missionId,
      seq,
      phase: 'timeout',
      reasoning_source: 'DEVELOPMENT_REASONING_FALLBACK',
      external_provider: 'unavailable',
      fallback_actor: 'GLM_PRIMARY_BUILDER',
      ...(instance === '' ? {} : { instance }),
      tier: input.tier,
      waitMs: this.waitTimeoutMs,
    });
    throw new Error(
      `development fallback timeout: no response for request ${seq} within ` +
        `${Math.round(this.waitTimeoutMs / 1000)}s (queue: ${this.queueDir})`,
    );
  }
}
