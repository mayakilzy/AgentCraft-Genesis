import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Goal, GoalRequirements, MissionResult, OrganizationPlan, ReasoningInput, ReasoningOutput, ReasoningProvider, RuntimeHandle, WorkerGenome } from '../../src/contracts/core.js';
import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import { MemoryFlightRecorder, type FlightEvent } from '../../src/mission/flight-recorder.js';
import { MissionOrchestrator } from '../../src/mission/orchestrator.js';
import { GenomeCompiler, loadOwnership } from '../../src/genome/genome-compiler.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import type { WorkerComputer, WorkerRuntime } from '../../src/runtime/computer.js';
import {
  FileExperienceStore,
  MemoryExperienceStore,
  deriveExperience,
  type Experience,
} from '../../src/learning/index.js';

/**
 * TASK-024 — Experience Store.
 *
 * The smallest durable representation of "what happened when this organization
 * attempted this kind of goal": derive, persist, retrieve, preserve
 * evidence/provenance, distinguish successful and unsuccessful outcomes.
 */

const DIAGNOSTIC_GOAL: Goal = {
  outcome:
    'Diagnose why CNC machine 7 halts with spindle fault E-04 after twenty ' +
    'minutes; reproduce it from the telemetry logs and identify the root cause.',
};

class MemoryComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
  async exec() {
    return { command: '', exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, elapsedMs: 1 };
  }
  async writeFile(path: string, contents: string) {
    this.files.set(path, contents);
    return { path, bytes: contents.length, appended: false };
  }
  async readFile(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`no file at ${path}`);
    return { path, text, bytes: text.length, truncated: false };
  }
  async listFiles() {
    return [...this.files.keys()].map((path) => ({ path, kind: 'file' as const }));
  }
}

class MemoryRuntime implements WorkerRuntime {
  readonly name = 'memory-runtime';
  readonly stopped: string[] = [];
  readonly computers = new Map<string, MemoryComputer>();
  async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
    if (!genome.computer.required) return { workerId: genome.identity.id, ref: 'memory:none' };
    this.computers.set(genome.identity.id, new MemoryComputer());
    return { workerId: genome.identity.id, ref: `memory:${genome.identity.id}` };
  }
  computer(handle: RuntimeHandle): WorkerComputer {
    const computer = this.computers.get(handle.workerId);
    if (!computer) throw new Error(`no computer for ${handle.workerId}`);
    return computer;
  }
  async stopWorker(handle: RuntimeHandle): Promise<void> {
    this.stopped.push(handle.workerId);
  }
}

class ScriptedReasoning implements ReasoningProvider {
  readonly name = 'scripted';
  readonly calls: ReasoningInput[] = [];
  constructor(private readonly scripts: Record<string, readonly string[]>) {}
  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    this.calls.push(input);
    const system = input.system ?? '';
    for (const [marker, queue] of Object.entries(this.scripts)) {
      if (system.includes(`You are ${marker}`)) {
        const [next, ...rest] = queue;
        this.scripts[marker] = rest;
        return { text: next };
      }
    }
    throw new Error(`no script for system: ${system.slice(0, 80)}`);
  }
}

async function runDiagnosticMission(
  goal: Goal,
  reasoning: ReasoningProvider,
): Promise<{
  result: MissionResult;
  events: readonly FlightEvent[];
  requirements: GoalRequirements;
  plan: OrganizationPlan;
  missionId: string;
}> {
  const runtime = new MemoryRuntime();
  const recorder = new MemoryFlightRecorder();
  const router = new CognitiveRouter(new RuleDecisionProvider());
  const compiler = new GoalCompiler();
  const planner = new OrganizationPlanner();
  const missionId = `test-${Math.random().toString(36).slice(2, 8)}`;
  const orchestrator = new MissionOrchestrator({
    goalCompiler: compiler,
    planner,
    genomeCompiler: new GenomeCompiler({
      registry: loadOwnership('data/ownership.yaml'),
      selectTier: (selection) => router.selectTier(selection),
    }),
    runtime,
    reasoning,
    recorder,
    missionId,
  });
  const result = await orchestrator.run(goal);
  const requirements = await compiler.compile(goal);
  const plan = planner.plan(requirements);
  return { result, events: recorder.events, requirements, plan, missionId };
}

describe('TASK-024 — Experience Store', () => {
  it('derives a compact experience from a completed mission with provenance', async () => {
    const reasoning = new ScriptedReasoning({
      'Diagnostic Analyst': [
        JSON.stringify({ action: 'write_file', path: 'analysis.md', contents: '# Analysis\nOversell under concurrency.' }),
        JSON.stringify({ action: 'finish', summary: 'Analyzed.', artifacts: ['analysis.md'] }),
      ],
      'Reproduction Engineer': [
        // The Reproduction Engineer finishes without producing any artifact —
        // a real signal the candidate generator will detect in TASK-025.
        JSON.stringify({ action: 'finish', summary: 'Nothing to reproduce; telemetry was self-evident.' }),
      ],
      'Report Writer': [
        JSON.stringify({ action: 'write_file', path: 'DIAGNOSIS.md', contents: '# Diagnosis\nRoot cause.' }),
        JSON.stringify({ action: 'finish', summary: 'Wrote diagnosis.', artifacts: ['DIAGNOSIS.md'] }),
      ],
      'Mission Coordinator': [
        JSON.stringify({ action: 'finish', summary: 'Integrated.' }),
      ],
    });

    const { result, events, requirements, plan, missionId } = await runDiagnosticMission(DIAGNOSTIC_GOAL, reasoning);
    const experience = deriveExperience({
      missionId,
      requirements,
      plan,
      result,
      events,
      flightRecordPath: '/tmp/flight.jsonl',
      repositorySha: 'abc123',
    });

    // Compact: schemaVersion, goal, organization, contributions, outcome.
    expect(experience.schemaVersion).toBe(1);
    expect(experience.id).toBe(`exp-${missionId}`);
    expect(experience.goal.domain).toBe('diagnostic');
    expect(experience.organization.workerCount).toBeGreaterThan(0);
    expect(experience.organization.roles).toContain('Reproduction Engineer');

    // Per-worker contributions captured.
    const reproduction = experience.contributions.find((c) => c.role === 'Reproduction Engineer');
    expect(reproduction).toBeDefined();
    expect(reproduction!.artifactsCount).toBe(0);

    // Provenance preserved (references, NOT payloads).
    expect(experience.provenance.missionId).toBe(missionId);
    expect(experience.provenance.flightRecordPath).toBe('/tmp/flight.jsonl');
    expect(experience.provenance.repositorySha).toBe('abc123');
    expect(experience.provenance.source).toBe('real-mission');
  });

  it('distinguishes successful and unsuccessful organizational outcomes', async () => {
    // A failing mission: every worker spins until step budget is hit.
    const spin = JSON.stringify({ action: 'list_files', path: '.' });
    const reasoning = new ScriptedReasoning({
      'Diagnostic Analyst': Array(12).fill(spin),
      'Reproduction Engineer': Array(12).fill(spin),
      'Report Writer': Array(12).fill(spin),
      'Mission Coordinator': Array(12).fill(spin),
    });

    const { result, events, requirements, plan } = await runDiagnosticMission(DIAGNOSTIC_GOAL, reasoning);
    const experience = deriveExperience({
      missionId: 'failing-mission',
      requirements,
      plan,
      result,
      events,
    });

    expect(experience.outcome.status).not.toBe('success');
    expect(['failure', 'partial']).toContain(experience.outcome.status);
  });

  it('persists and retrieves experiences through the memory store', () => {
    const store = new MemoryExperienceStore();
    const experience: Experience = {
      id: 'exp-test-1',
      recordedAt: '2026-10-07T00:00:00Z',
      schemaVersion: 1,
      goal: { outcome: 'Test goal', domain: 'diagnostic', capabilityNeeds: ['data-analysis'] },
      organization: { workerCount: 1, roles: ['Sole Operator'], collaborationEdges: 0, rationale: 'test' },
      contributions: [{ workerId: 'sole-operator-1', role: 'Sole Operator', reasoningCalls: 1, artifactsCount: 1, status: 'success' }],
      outcome: { status: 'success', summary: 'ok', reasoningCalls: 1, wallMs: 10, retries: 0, humanInterventions: 0 },
      evidence: [],
      provenance: { missionId: 'test-1', source: 'synthetic' },
    };

    store.record(experience);
    expect(store.retrieve('exp-test-1')).toEqual(experience);
    expect(store.all()).toHaveLength(1);
    expect(store.filter((e) => e.goal.domain === 'diagnostic')).toHaveLength(1);
    expect(store.filter((e) => e.goal.domain === 'research')).toHaveLength(0);
  });

  it('persists durably to a JSONL file and survives a fresh store instance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'genesis-exp-'));
    try {
      const store1 = new FileExperienceStore({ dir });
      const experience: Experience = {
        id: 'exp-durable-1',
        recordedAt: '2026-10-07T00:00:00Z',
        schemaVersion: 1,
        goal: { outcome: 'Durable test', domain: 'research', capabilityNeeds: ['web-research'] },
        organization: { workerCount: 2, roles: ['Web Researcher', 'Report Writer'], collaborationEdges: 1, rationale: 'test' },
        contributions: [],
        outcome: { status: 'success', summary: 'ok', reasoningCalls: 2, wallMs: 50, retries: 0, humanInterventions: 0 },
        evidence: [],
        provenance: { missionId: 'durable-1', source: 'real-mission' },
      };
      store1.record(experience);

      // A fresh store instance reads the same file.
      const store2 = new FileExperienceStore({ dir });
      expect(store2.retrieve('exp-durable-1')).toEqual(experience);
      expect(store2.all()).toHaveLength(1);

      // The file is human-readable JSONL.
      const raw = readFileSync(join(dir, 'experiences.jsonl'), 'utf8');
      expect(raw).toContain('"id":"exp-durable-1"');
      expect(raw).toContain('"schemaVersion":1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replaces an experience with the same id (re-derivation supersedes)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'genesis-exp-'));
    try {
      const store = new FileExperienceStore({ dir });
      const base: Experience = {
        id: 'exp-replace-1',
        recordedAt: '2026-10-07T00:00:00Z',
        schemaVersion: 1,
        goal: { outcome: 'v1', domain: 'diagnostic', capabilityNeeds: [] },
        organization: { workerCount: 1, roles: ['Sole Operator'], collaborationEdges: 0, rationale: 'v1' },
        contributions: [],
        outcome: { status: 'partial', summary: 'v1', reasoningCalls: 0, wallMs: 0, retries: 0, humanInterventions: 0 },
        evidence: [],
        provenance: { missionId: 'replace-1', source: 'real-mission' },
      };
      store.record(base);
      const updated: Experience = { ...base, outcome: { ...base.outcome, status: 'success', summary: 'v2' } };
      store.record(updated);

      expect(store.all()).toHaveLength(1);
      expect(store.retrieve('exp-replace-1')!.outcome.status).toBe('success');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not copy flight-record payloads — only references', async () => {
    const reasoning = new ScriptedReasoning({
      'Diagnostic Analyst': [
        JSON.stringify({ action: 'write_file', path: 'a.md', contents: 'x'.repeat(10_000) }),
        JSON.stringify({ action: 'finish', summary: 'done.', artifacts: ['a.md'] }),
      ],
      'Reproduction Engineer': [JSON.stringify({ action: 'finish', summary: 'nothing' })],
      'Report Writer': [
        JSON.stringify({ action: 'write_file', path: 'r.md', contents: 'report' }),
        JSON.stringify({ action: 'finish', summary: 'wrote.', artifacts: ['r.md'] }),
      ],
      'Mission Coordinator': [JSON.stringify({ action: 'finish', summary: 'integrated.' })],
    });
    const { result, events, requirements, plan } = await runDiagnosticMission(DIAGNOSTIC_GOAL, reasoning);
    const experience = deriveExperience({
      missionId: 'no-payload-mission',
      requirements,
      plan,
      result,
      events,
    });

    // The 10_000-char file body MUST NOT appear in the experience.
    const serialized = JSON.stringify(experience);
    expect(serialized.length).toBeLessThan(5_000);
    expect(serialized).not.toContain('x'.repeat(100));
  });
});
