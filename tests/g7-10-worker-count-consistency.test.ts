/**
 * G7-10 — Workstream A: Worker-count consistency tests.
 *
 * Covers A4 (worker-count consistency) and A5 (repeated-event resilience).
 *
 * The G7-09 audit found that InsightsSection used `deriveWorkerCount` (reads
 * only the `plan-created` event) while MissionControlDetail and Agent used
 * `extractWorkers` (reads 6 event types). This produced inconsistent counts.
 *
 * G7-10 unifies on `extractWorkers`. These tests verify the canonical
 * extraction strategy:
 *   - Each worker is counted once (by stable workerId).
 *   - Repeated events (worker-step, worker-retry) do NOT inflate the count.
 *   - Verifier/coordinator roles are treated consistently.
 *   - Workers appearing in worker-started but not plan-created are still counted.
 *   - Workers appearing only in plan-created (planned but not yet started) are counted.
 */
import { describe, it, expect } from 'vitest';
import { extractWorkers } from '../web/src/lib/genesis/events.js';
import type { MissionEventRecord } from '../web/src/lib/genesis/types.js';

function makeEvent(
  type: string,
  payload: Record<string, unknown>,
  seq: number,
  timestamp = `2026-10-08T10:00:${String(seq).padStart(2, '0')}Z`,
): MissionEventRecord {
  return { seq, timestamp, type, payload };
}

describe('G7-10 A4/A5 — Worker-count consistency (extractWorkers)', () => {
  it('A4: counts distinct workers from plan-created', () => {
    const events: MissionEventRecord[] = [
      makeEvent('plan-created', {
        workers: [
          { id: 'w1', role: 'planner', needs: [] },
          { id: 'w2', role: 'executor', needs: [] },
          { id: 'w3', role: 'verifier', needs: [] },
        ],
      }, 1),
    ];
    const workers = extractWorkers(events);
    expect(Object.keys(workers).length).toBe(3);
    expect(workers['w1']?.role).toBe('planner');
    expect(workers['w2']?.role).toBe('executor');
    expect(workers['w3']?.role).toBe('verifier');
  });

  it('A5: repeated worker-step events do NOT inflate the count', () => {
    const events: MissionEventRecord[] = [
      makeEvent('plan-created', {
        workers: [{ id: 'w1', role: 'executor', needs: [] }],
      }, 1),
      makeEvent('worker-started', { workerId: 'w1', role: 'executor', tier: 'default' }, 2),
      makeEvent('worker-step', { workerId: 'w1', action: 'write_file', ok: true, step: 1 }, 3),
      makeEvent('worker-step', { workerId: 'w1', action: 'write_file', ok: true, step: 2 }, 4),
      makeEvent('worker-step', { workerId: 'w1', action: 'write_file', ok: true, step: 3 }, 5),
      makeEvent('worker-step', { workerId: 'w1', action: 'finish', ok: true, step: 4 }, 6),
    ];
    const workers = extractWorkers(events);
    // Still just ONE worker — repeated steps don't create new worker records.
    expect(Object.keys(workers).length).toBe(1);
    expect(workers['w1']?.stepCount).toBe(4);
  });

  it('A5b: repeated worker-retry events do NOT inflate the count', () => {
    const events: MissionEventRecord[] = [
      makeEvent('plan-created', {
        workers: [{ id: 'w1', role: 'executor', needs: [] }],
      }, 1),
      makeEvent('worker-started', { workerId: 'w1', role: 'executor', tier: 'default' }, 2),
      makeEvent('worker-retry', { workerId: 'w1', reason: 'timeout' }, 3),
      makeEvent('worker-retry', { workerId: 'w1', reason: 'timeout' }, 4),
      makeEvent('worker-retry', { workerId: 'w1', reason: 'timeout' }, 5),
    ];
    const workers = extractWorkers(events);
    expect(Object.keys(workers).length).toBe(1);
    expect(workers['w1']?.retryCount).toBe(3);
  });

  it('A4b: workers appearing in worker-started but NOT plan-created are counted', () => {
    // This is the case where deriveWorkerCount (plan-created only) would
    // return 0, but extractWorkers correctly counts the worker.
    const events: MissionEventRecord[] = [
      // No plan-created event (e.g., truncated by 100-event cap).
      makeEvent('worker-started', { workerId: 'w1', role: 'executor', tier: 'default' }, 1),
      makeEvent('worker-step', { workerId: 'w1', action: 'write_file', ok: true, step: 1 }, 2),
    ];
    const workers = extractWorkers(events);
    expect(Object.keys(workers).length).toBe(1);
    expect(workers['w1']?.role).toBe('executor');
  });

  it('A4c: workers appearing only in genomes-compiled are counted', () => {
    const events: MissionEventRecord[] = [
      makeEvent('genomes-compiled', {
        workers: [
          { id: 'w1', tier: 'default', tools: ['mcp:foo'], computerRequired: false },
          { id: 'w2', tier: 'frontier', tools: [], computerRequired: true },
        ],
        gaps: [],
      }, 1),
    ];
    const workers = extractWorkers(events);
    expect(Object.keys(workers).length).toBe(2);
    expect(workers['w1']?.tier).toBe('default');
    expect(workers['w2']?.tier).toBe('frontier');
  });

  it('A4d: verifier workers are counted consistently', () => {
    // The verifier worker (mission-verifier-1) appears in worker-started
    // but NOT in plan-created (it's auto-added by the orchestrator).
    // extractWorkers counts it; deriveWorkerCount did not.
    const events: MissionEventRecord[] = [
      makeEvent('plan-created', {
        workers: [
          { id: 'w1', role: 'executor', needs: [] },
          { id: 'w2', role: 'reviewer', needs: [] },
        ],
      }, 1),
      makeEvent('worker-started', { workerId: 'w1', role: 'executor', tier: 'default' }, 2),
      makeEvent('worker-started', { workerId: 'w2', role: 'reviewer', tier: 'default' }, 3),
      // Verifier auto-added — NOT in plan-created.
      makeEvent('worker-started', { workerId: 'mission-verifier-1', role: 'verifier', tier: 'cheap' }, 4),
    ];
    const workers = extractWorkers(events);
    // 3 distinct workers: w1, w2, mission-verifier-1.
    expect(Object.keys(workers).length).toBe(3);
    expect(workers['mission-verifier-1']?.role).toBe('verifier');
  });

  it('A4e: handoff events do NOT create spurious worker records', () => {
    // Handoff events reference existing workers (from/to) but should not
    // create new records — they only reference existing ones.
    const events: MissionEventRecord[] = [
      makeEvent('plan-created', {
        workers: [
          { id: 'w1', role: 'executor', needs: [] },
          { id: 'w2', role: 'reviewer', needs: [] },
        ],
      }, 1),
      makeEvent('handoff', { from: 'w1', to: 'w2', ok: true, reason: 'delegate' }, 2),
    ];
    const workers = extractWorkers(events);
    expect(Object.keys(workers).length).toBe(2);
  });

  it('A4f: empty events returns empty map (count = 0)', () => {
    const workers = extractWorkers([]);
    expect(Object.keys(workers).length).toBe(0);
  });

  it('A4g: same mission produces consistent count regardless of event order', () => {
    // The count should be the same whether events arrive in seq order or
    // are shuffled (as can happen with polling-based dedup).
    const ordered: MissionEventRecord[] = [
      makeEvent('plan-created', {
        workers: [{ id: 'w1', role: 'executor', needs: [] }],
      }, 1),
      makeEvent('worker-started', { workerId: 'w1', role: 'executor', tier: 'default' }, 2),
      makeEvent('worker-step', { workerId: 'w1', action: 'finish', ok: true, step: 1 }, 3),
    ];
    const shuffled: MissionEventRecord[] = [
      makeEvent('worker-step', { workerId: 'w1', action: 'finish', ok: true, step: 1 }, 3),
      makeEvent('plan-created', {
        workers: [{ id: 'w1', role: 'executor', needs: [] }],
      }, 1),
      makeEvent('worker-started', { workerId: 'w1', role: 'executor', tier: 'default' }, 2),
    ];
    const countOrdered = Object.keys(extractWorkers(ordered)).length;
    const countShuffled = Object.keys(extractWorkers(shuffled)).length;
    expect(countOrdered).toBe(countShuffled);
    expect(countOrdered).toBe(1);
  });
});
