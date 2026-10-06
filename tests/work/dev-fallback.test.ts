import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DevelopmentFallbackProvider,
  type FallbackUsage,
} from '../../experiments/experiment-003/dev-fallback.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';

/**
 * TASK-022 — the DEVELOPMENT REASONING FALLBACK contract, pinned:
 *
 *   - a reasoning call is journaled as a request file containing EXACTLY
 *     the provider input (system, prompt, tier) plus its fallback labels —
 *     the audit trail of exactly what the fallback actor was shown for
 *     that call (per-instance isolation is pinned separately, in
 *     fallback-isolation.test.ts, by TASK-022A);
 *   - a plain-text response file is consumed as the ReasoningOutput and
 *     both journal files are archived (done-*) so the pending queue holds
 *     only unanswered requests;
 *   - every call is announced in the flight record as
 *     reasoning_source = DEVELOPMENT_REASONING_FALLBACK with
 *     external_provider = unavailable and fallback_actor =
 *     GLM_PRIMARY_BUILDER — impossible to confuse with a provider call;
 *   - usage counts fallback calls only;
 *   - a call nobody answers times out loudly (an honest failure, never a
 *     fabricated response).
 */

describe('development reasoning fallback (TASK-022 rule)', () => {
  it('journals the exact provider input and consumes the actor response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-fallback-'));
    const recorder = new MemoryFlightRecorder();
    const provider = new DevelopmentFallbackProvider({
      queueDir: dir,
      missionId: 'test-mission',
      recorder,
      waitTimeoutMs: 5_000,
      pollIntervalMs: 20,
    });

    const pending = provider.reason({
      system: 'You are a worker.',
      prompt: 'TASK:\ndo the thing\n\nYour next step as ONE JSON object:',
      tier: 'default',
    });

    // The request lands before any answer exists.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const requestFile = join(dir, 'req-0001.json');
    expect(existsSync(requestFile)).toBe(true);
    const request = JSON.parse(readFileSync(requestFile, 'utf8')) as Record<string, unknown>;
    expect(request.reasoning_source).toBe('DEVELOPMENT_REASONING_FALLBACK');
    expect(request.external_provider).toBe('unavailable');
    expect(request.fallback_actor).toBe('GLM_PRIMARY_BUILDER');
    expect(request.system).toBe('You are a worker.');
    expect(request.prompt).toContain('do the thing');
    expect(request.tier).toBe('default');

    writeFileSync(join(dir, 'resp-0001.txt'), '{"action":"finish","summary":"done"}', 'utf8');
    const output = await pending;
    expect(output.text).toBe('{"action":"finish","summary":"done"}');

    // Journal archived; nothing left pending.
    expect(existsSync(join(dir, 'done-req-0001.json'))).toBe(true);
    expect(existsSync(join(dir, 'done-resp-0001.txt'))).toBe(true);
    expect(existsSync(requestFile)).toBe(false);

    const usage: FallbackUsage = provider.currentUsage();
    expect(usage.calls).toBe(1);
    expect(usage.completionChars).toBeGreaterThan(0);
    expect(usage.timeouts).toBe(0);

    // Flight-record visibility: requested + answered, labeled per call.
    const events = recorder.events.filter((event) => event.type === 'reasoning-fallback');
    expect(events).toHaveLength(2);
    const answered = events[1] as unknown as Record<string, unknown>;
    expect(answered.phase).toBe('answered');
    expect(answered.reasoning_source).toBe('DEVELOPMENT_REASONING_FALLBACK');
    expect(answered.external_provider).toBe('unavailable');
    expect(answered.fallback_actor).toBe('GLM_PRIMARY_BUILDER');
  });

  it('fails loudly when no fallback actor answers within the timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-fallback-'));
    const recorder = new MemoryFlightRecorder();
    const provider = new DevelopmentFallbackProvider({
      queueDir: dir,
      missionId: 'test-mission',
      recorder,
      waitTimeoutMs: 150,
      pollIntervalMs: 20,
    });

    await expect(
      provider.reason({ prompt: 'unanswered', tier: 'cheap' }),
    ).rejects.toThrow('development fallback timeout');

    const usage = provider.currentUsage();
    expect(usage.calls).toBe(0);
    expect(usage.timeouts).toBe(1);

    const events = recorder.events.filter((event) => event.type === 'reasoning-fallback');
    expect(events).toHaveLength(2);
    const timeout = events[1] as unknown as Record<string, unknown>;
    expect(timeout.phase).toBe('timeout');
  });

  it('labels the real actor when TASK-023 fresh-session serving is declared', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-fallback-'));
    const recorder = new MemoryFlightRecorder();
    const provider = new DevelopmentFallbackProvider({
      queueDir: dir,
      missionId: 'test-mission',
      recorder,
      waitTimeoutMs: 5_000,
      pollIntervalMs: 20,
      fallbackActor: 'GLM_FRESH_ISOLATED_SESSION',
    });
    const view = provider.forInstance('worker-1#1') as DevelopmentFallbackProvider;

    const pending = view.reason({
      system: 'You are a worker.',
      prompt: 'TASK:\nstep\n\nYour next step as ONE JSON object:',
      tier: 'default',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const requestFile = join(dir, 'instance-worker-1-1', 'req-0001.json');
    const request = JSON.parse(readFileSync(requestFile, 'utf8')) as Record<string, unknown>;
    expect(request.fallback_actor).toBe('GLM_FRESH_ISOLATED_SESSION');
    expect(request.instance).toBe('worker-1#1');
    writeFileSync(join(dir, 'instance-worker-1-1', 'resp-0001.txt'), '{"action":"finish","summary":"done"}', 'utf8');
    await pending;

    for (const event of recorder.events) {
      if (event.type === 'reasoning-fallback') {
        expect((event as unknown as Record<string, unknown>).fallback_actor).toBe(
          'GLM_FRESH_ISOLATED_SESSION',
        );
      }
    }
  });
});
