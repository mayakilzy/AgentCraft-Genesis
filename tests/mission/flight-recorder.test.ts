import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { Goal } from '../../src/contracts/core.js';
import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../../src/genome/genome-compiler.js';
import { FileFlightRecorder } from '../../src/mission/flight-recorder.js';
import { MissionOrchestrator } from '../../src/mission/orchestrator.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import { memoryRuntimeForTest } from '../helpers/memory-runtime.js';

/**
 * TASK-014 acceptance: what happened in a mission can be REBUILT from the
 * record; raw logs stay separate from the structured record; no secrets in
 * telemetry; the record stays small.
 */

const GOAL: Goal = {
  outcome:
    'Implement and document a small CLI utility that converts temperatures ' +
    'between Celsius and Fahrenheit, with tests.',
  constraints: ['pure TypeScript, no external dependencies'],
};

// A reasoning provider that alternates write → finish.
function writeThenFinish() {
  let call = 0;
  return {
    name: 'write-then-finish',
    async reason() {
      call += 1;
      if (call % 2 === 1) {
        return {
          text: JSON.stringify({
            action: 'write_file',
            path: 'deliverable.md',
            contents: '# Deliverable\nDone.',
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: 'Deliverable written and verified.',
          artifacts: ['deliverable.md'],
        }),
      };
    },
  };
}

describe('FileFlightRecorder — the durable mission record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'genesis-flight-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a rebuildable, secret-free, compact history of a mission', async () => {
    const runtime = memoryRuntimeForTest();
    const missionId = 'mission-test-0001';
    const recorder = new FileFlightRecorder({ dir, missionId });

    const router = new CognitiveRouter(new RuleDecisionProvider());
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (selection) => router.selectTier(selection),
      }),
      runtime: runtime.runtime,
      reasoning: writeThenFinish(),
      recorder,
      missionId,
    });
    const result = await orchestrator.run(GOAL);
    expect(result.status).toBe('success');
    recorder.close();

    // The structured record exists and is JSONL.
    const recordPath = join(dir, `${missionId}.jsonl`);
    expect(existsSync(recordPath)).toBe(true);
    const lines = readFileSync(recordPath, 'utf8').trim().split('\n');
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    // REBUILDABILITY: the record alone tells the mission's story.
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('mission-started');
    expect(types).toContain('requirements-compiled');
    expect(types).toContain('plan-created');
    expect(types).toContain('genomes-compiled');
    expect(types).toContain('worker-started');
    expect(types).toContain('worker-step');
    expect(types).toContain('worker-finished');
    expect(types).toContain('verification');
    expect(types.at(-1)).toBe('mission-finished');

    const started = events[0] as { goalOutcome: string; budgetUsd: number };
    expect(started.goalOutcome).toContain('CLI utility');
    const plan = events.find((event) => event.type === 'plan-created') as {
      workers: { id: string; role: string }[];
    };
    expect(plan.workers.length).toBeGreaterThan(0);
    expect(plan.workers.map((w) => w.role)).toContain('Software Engineer');

    // Every event is timestamped.
    expect(events.every((event) => typeof event.at === 'string')).toBe(true);

    // COMPACTNESS: each record stays small (no transcripts, bounded fields).
    expect(
      lines.every((line) => line.length < 8_000),
      'records stay small',
    ).toBe(true);

    // The mission Id appears in mission-scope events for traceability.
    const missionScoped = events.filter((event) =>
      String(event.type).startsWith('mission-') || event.type === 'verification',
    );
    expect(
      missionScoped.every((event) => event.missionId === missionId),
    ).toBe(true);
  });

  it('scrubs secrets from structured records and raw logs', () => {
    const missionId = 'mission-test-0002';
    const recorder = new FileFlightRecorder({ dir, missionId });
    recorder.record({
      type: 'mission-started',
      at: new Date().toISOString(),
      missionId,
      goalOutcome: 'audit deps with Bearer super-secret-token-value-123',
      budgetUsd: 5,
    });
    recorder.raw(
      'worker-1',
      'starting with COMPUTER_TOKEN=hunter2hunter2hunter2 and Authorization: Bearer abc123def456',
    );
    recorder.close();

    const structured = readFileSync(join(dir, `${missionId}.jsonl`), 'utf8');
    const raw = readFileSync(join(dir, `${missionId}.raw.log`), 'utf8');
    for (const content of [structured, raw]) {
      expect(content).not.toContain('super-secret-token-value-123');
      expect(content).not.toContain('abc123def456');
      expect(content).not.toContain('hunter2hunter2hunter2');
      expect(content).toContain('[redacted]');
    }
  });

  it('keeps raw process output in a separate file from the structured record', () => {
    const missionId = 'mission-test-0003';
    const recorder = new FileFlightRecorder({ dir, missionId });
    recorder.raw('computer:sole-operator-1', 'agent-computer listening on http://127.0.0.1:41234');
    recorder.record({
      type: 'mission-started',
      at: new Date().toISOString(),
      missionId,
      goalOutcome: 'separate the streams',
      budgetUsd: 1,
    });
    recorder.close();

    const structured = readFileSync(join(dir, `${missionId}.jsonl`), 'utf8');
    const raw = readFileSync(join(dir, `${missionId}.raw.log`), 'utf8');
    expect(raw).toContain('agent-computer listening');
    expect(structured).not.toContain('agent-computer listening');
    expect(structured).toContain('separate the streams');
    expect(raw).not.toContain('separate the streams');
  });
});
