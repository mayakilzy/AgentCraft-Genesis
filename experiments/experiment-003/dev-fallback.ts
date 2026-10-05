import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
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
 * What makes this honest:
 *
 *   - REPLACE REASONING, NEVER EXECUTION: the adapter only answers the
 *     ReasoningProvider boundary. Tools, computers, git, integration and
 *     verification keep running exactly as with a real provider.
 *   - The request journal preserves EXACTLY what the fallback actor was
 *     shown (system + prompt + tier, nothing else) — the audit trail for
 *     "the fallback reasoned only from worker-visible context".
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

function pad(seq: number): string {
  return String(seq).padStart(4, '0');
}

export class DevelopmentFallbackProvider implements ReasoningProvider {
  readonly name = 'development-reasoning-fallback';

  private readonly queueDir: string;
  private readonly missionId: string;
  private readonly recorder: FlightRecorder | undefined;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private seq = 0;
  private usage: FallbackUsage = {
    calls: 0,
    promptChars: 0,
    completionChars: 0,
    timeouts: 0,
  };

  constructor(options: DevelopmentFallbackOptions) {
    this.queueDir = options.queueDir;
    mkdirSync(options.queueDir, { recursive: true });
    this.missionId = options.missionId;
    this.recorder = options.recorder;
    this.waitTimeoutMs = options.waitTimeoutMs ?? 15 * 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
  }

  /** Fallback-served calls only — never counted as external provider calls. */
  currentUsage(): FallbackUsage {
    return { ...this.usage };
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    const seq = (this.seq += 1);
    const requestPath = join(this.queueDir, `req-${pad(seq)}.json`);
    const responsePath = join(this.queueDir, `resp-${pad(seq)}.txt`);

    // The exact input the external provider would have received — and the
    // exact input the fallback actor is allowed to see. Nothing else is
    // communicated in either direction.
    writeFileSync(
      requestPath,
      JSON.stringify(
        {
          seq,
          at: new Date().toISOString(),
          reasoning_source: 'DEVELOPMENT_REASONING_FALLBACK',
          external_provider: 'unavailable',
          fallback_actor: 'GLM_PRIMARY_BUILDER',
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
        this.usage = {
          calls: this.usage.calls + 1,
          promptChars: this.usage.promptChars + input.prompt.length,
          completionChars: this.usage.completionChars + text.length,
          timeouts: this.usage.timeouts,
        };
        this.recorder?.record({
          type: 'reasoning-fallback',
          missionId: this.missionId,
          seq,
          phase: 'answered',
          reasoning_source: 'DEVELOPMENT_REASONING_FALLBACK',
          external_provider: 'unavailable',
          fallback_actor: 'GLM_PRIMARY_BUILDER',
          tier: input.tier,
          waitMs,
          completionChars: text.length,
        });
        return { text };
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    this.usage = { ...this.usage, timeouts: this.usage.timeouts + 1 };
    this.recorder?.record({
      type: 'reasoning-fallback',
      missionId: this.missionId,
      seq,
      phase: 'timeout',
      reasoning_source: 'DEVELOPMENT_REASONING_FALLBACK',
      external_provider: 'unavailable',
      fallback_actor: 'GLM_PRIMARY_BUILDER',
      tier: input.tier,
      waitMs: this.waitTimeoutMs,
    });
    throw new Error(
      `development fallback timeout: no response for request ${seq} within ` +
        `${Math.round(this.waitTimeoutMs / 1000)}s (queue: ${this.queueDir})`,
    );
  }
}
