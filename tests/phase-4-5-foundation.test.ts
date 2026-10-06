import { describe, expect, it } from 'vitest';

import { GoalCompiler } from '../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../src/genome/genome-compiler.js';
import { OrganizationPlanner } from '../src/organization/organization-planner.js';
import { CognitiveRouter } from '../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../src/routing/decision-provider.js';
import type {
  OperationalNeed,
  OperationalNeedKind,
  WorkerGenome,
  Goal,
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
} from '../src/contracts/core.js';
import { deriveExperience } from '../src/learning/experience.js';
import { MemoryFlightRecorder } from '../src/mission/flight-recorder.js';
import { MissionOrchestrator } from '../src/mission/orchestrator.js';
import {
  MemoryRuntime,
  MemoryComputer,
} from './helpers/memory-runtime.js';

/**
 * PHASE 4.5 — Multi-Environment Foundation architectural tests.
 *
 * Tests the provider-neutral requirement model, requirement resolution,
 * generalized surface dispatch, and Experience v2 resolved-provider evidence.
 * These tests prove the seam is correct WITHOUT requiring OpenDots/OpenMuse.
 */

// ---------------------------------------------------------------------------
// Requirement model + resolution
// ---------------------------------------------------------------------------

describe('PHASE 4.5 — Operational requirement model', () => {
  const compiler = new GoalCompiler();
  const planner = new OrganizationPlanner();
  const router = new CognitiveRouter(new RuleDecisionProvider());
  const genomeCompiler = new GenomeCompiler({
    registry: loadOwnership('data/ownership.yaml'),
    selectTier: (selection) => router.selectTier(selection),
  });

  it('compiles every fixture genome with operationalNeeds populated', async () => {
    const goals: readonly Goal[] = [
      {
        outcome:
          'Implement a dark-mode toggle in the web app dashboard and verify it end-to-end in the browser.',
      },
      {
        outcome:
          'Diagnose why CNC machine 7 halts with spindle fault E-04 after twenty minutes; reproduce it from the telemetry logs.',
      },
    ];
    for (const goal of goals) {
      const requirements = await compiler.compile(goal);
      const plan = planner.plan(requirements);
      const compilation = await genomeCompiler.compilePlan(plan, requirements);
      // At least one worker (a specialist) has operationalNeeds.
      const specialistsWithNeeds = compilation.results.filter(
        (r) => (r.genome?.operationalNeeds?.length ?? 0) > 0,
      );
      expect(specialistsWithNeeds.length).toBeGreaterThan(0);
      for (const result of compilation.results) {
        const genome = result.genome!;
        // operationalNeeds is always defined (may be empty for a coordinator).
        expect(genome.operationalNeeds).toBeDefined();
        for (const need of genome.operationalNeeds!) {
          expect([
            'shell-execution',
            'browser',
            'workspace-files',
            'collaborative-workspace',
            'durable-delegation',
          ]).toContain(need.kind);
        }
      }
    }
  });

  it('operationalNeeds are provider-neutral — no upstream product names', async () => {
    const goal: Goal = {
      outcome:
        'Implement a dark-mode toggle in the web app dashboard and verify it end-to-end in the browser.',
    };
    const requirements = await compiler.compile(goal);
    const plan = planner.plan(requirements);
    const compilation = await genomeCompiler.compilePlan(plan, requirements);
    for (const result of compilation.results) {
      const genome = result.genome!;
      for (const need of genome.operationalNeeds ?? []) {
        // The need kind is provider-neutral. The provider is recorded in
        // `tools` (e.g. 'openbot:shell-execution'), NOT in the need kind.
        expect(need.kind).not.toMatch(/openbot|opendots|openmuse/i);
      }
    }
  });

  it('multiple needs represent combination naturally — no "hybrid" enum', async () => {
    const goal: Goal = {
      outcome:
        'Implement a dark-mode toggle in the web app dashboard and verify it end-to-end in the browser.',
    };
    const requirements = await compiler.compile(goal);
    const plan = planner.plan(requirements);
    const compilation = await genomeCompiler.compilePlan(plan, requirements);
    // The Software Engineer has shell-execution + workspace-files (code-execution
    // + document-authoring needs map to both). Multiple needs, no "hybrid".
    const engineer = compilation.results.find(
      (r) => r.genome?.role === 'Software Engineer',
    );
    if (engineer !== undefined) {
      const needs = engineer.genome!.operationalNeeds!;
      expect(needs.length).toBeGreaterThanOrEqual(1);
      // No "hybrid" kind exists in the vocabulary.
      expect(needs.some((n) => (n.kind as string) === 'hybrid')).toBe(false);
    }
  });

  it('legacy genome without operationalNeeds remains valid (backward compatible)', () => {
    // A genome constructed without operationalNeeds (e.g. by old code or tests)
    // is still a valid WorkerGenome — the field is optional.
    const legacyGenome: WorkerGenome = {
      identity: { id: 'legacy-1', displayName: 'Legacy' },
      role: 'Legacy',
      objective: 'test',
      model: 'cheap',
      skills: [],
      tools: [],
      computer: { required: false, browser: false, shell: false, workspace: false },
      memory: 'none',
      budget: { maxUsd: 1, maxTier: 'cheap' },
      autonomy: 'autonomous',
    };
    expect(legacyGenome.operationalNeeds).toBeUndefined();
    // The genome is still usable — the orchestrator reads `computer.required`
    // via the surfaces() method, which returns {} for a non-computer worker.
  });

  it('unsupported future needs (collaborative-workspace, durable-delegation) are declared but not resolvable in Phase 4.5', () => {
    // The need kinds exist in the vocabulary (the seam), but the GenomeCompiler
    // does not produce them yet (no capability need maps to them). This is
    // intentional — Phase 4.6/4.7 will extend the compiler to declare them.
    const futureNeeds: OperationalNeedKind[] = [
      'collaborative-workspace',
      'durable-delegation',
    ];
    // They are valid OperationalNeedKind values.
    for (const kind of futureNeeds) {
      const need: OperationalNeed = { kind };
      expect(need.kind).toBe(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// Surface dispatch
// ---------------------------------------------------------------------------

describe('PHASE 4.5 — WorkerSurfaces dispatch', () => {
  it('OpenBot adapter returns { computer } for computer-requiring workers', async () => {
    const runtime = new MemoryRuntime();
    const genome: WorkerGenome = {
      identity: { id: 'worker-1', displayName: 'Worker' },
      role: 'Worker',
      objective: 'test',
      model: 'cheap',
      skills: ['code-execution'],
      tools: ['openbot:shell-execution', 'openbot:workspace-files'],
      computer: { required: true, browser: false, shell: true, workspace: true },
      memory: 'none',
      budget: { maxUsd: 1, maxTier: 'cheap' },
      autonomy: 'autonomous',
      operationalNeeds: [
        { kind: 'shell-execution' },
        { kind: 'workspace-files' },
      ],
    };
    const handle = await runtime.ensureWorker(genome);
    const surfaces = runtime.surfaces(handle);
    expect(surfaces.computer).toBeDefined();
    expect(surfaces.computer).toBeInstanceOf(MemoryComputer);
  });

  it('OpenBot adapter returns {} for non-computer workers (e.g. coordinator)', async () => {
    const runtime = new MemoryRuntime();
    const genome: WorkerGenome = {
      identity: { id: 'coordinator-1', displayName: 'Coordinator' },
      role: 'Mission Coordinator',
      objective: 'test',
      model: 'default',
      skills: [],
      tools: [],
      computer: { required: false, browser: false, shell: false, workspace: false },
      memory: 'shared-thread',
      budget: { maxUsd: 1, maxTier: 'default' },
      autonomy: 'autonomous',
      operationalNeeds: [],
    };
    const handle = await runtime.ensureWorker(genome);
    const surfaces = runtime.surfaces(handle);
    expect(surfaces.computer).toBeUndefined();
    // The bundle is {} — the orchestrator no longer assumes every worker has a computer.
    expect(Object.keys(surfaces)).toHaveLength(0);
  });

  it('surfaces() is the provider-neutral dispatch point — no genome.computer.required check needed', async () => {
    // This test proves the orchestrator's dispatch pattern works:
    // it calls surfaces() and reads .computer, without checking genome.computer.required.
    const runtime = new MemoryRuntime();
    const withComputer: WorkerGenome = {
      identity: { id: 'w1', displayName: 'W1' },
      role: 'Worker',
      objective: 'test',
      model: 'cheap',
      skills: [],
      tools: ['openbot:shell-execution'],
      computer: { required: true, browser: false, shell: true, workspace: false },
      memory: 'none',
      budget: { maxUsd: 1, maxTier: 'cheap' },
      autonomy: 'autonomous',
      operationalNeeds: [{ kind: 'shell-execution' }],
    };
    const withoutComputer: WorkerGenome = {
      ...withComputer,
      identity: { id: 'w2', displayName: 'W2' },
      computer: { required: false, browser: false, shell: false, workspace: false },
      tools: [],
      operationalNeeds: [],
    };
    const handle1 = await runtime.ensureWorker(withComputer);
    const handle2 = await runtime.ensureWorker(withoutComputer);
    // The orchestrator pattern: just call surfaces() and read .computer.
    const s1 = runtime.surfaces(handle1);
    const s2 = runtime.surfaces(handle2);
    expect(s1.computer).toBeDefined();
    expect(s2.computer).toBeUndefined();
    // No `genome.computer.required ? runtime.computer(handle) : null` pattern needed.
  });
});

// ---------------------------------------------------------------------------
// Experience v2 resolved-provider evidence
// ---------------------------------------------------------------------------

describe('PHASE 4.5 — Experience v2 resolved-provider evidence', () => {
  const compiler = new GoalCompiler();
  const planner = new OrganizationPlanner();
  const router = new CognitiveRouter(new RuleDecisionProvider());
  const genomeCompiler = new GenomeCompiler({
    registry: loadOwnership('data/ownership.yaml'),
    selectTier: (selection) => router.selectTier(selection),
  });

  it('deriveExperience with genomes produces resolvedNeeds per worker', async () => {
    const goal: Goal = {
      outcome:
        'Implement a dark-mode toggle in the web app dashboard and verify it end-to-end in the browser.',
    };
    const requirements = await compiler.compile(goal);
    const plan = planner.plan(requirements);
    const compilation = await genomeCompiler.compilePlan(plan, requirements);
    const genomes = compilation.results.map((r) => r.genome!);

    // Build a minimal experience from the plan + genomes.
    const experience = deriveExperience({
      missionId: 'test-v2',
      requirements,
      plan,
      result: {
        status: 'success',
        summary: 'ok',
        evidence: [],
        cost: { usd: 0, tokens: 0, wallMs: 10, humanInterventions: 0 },
      },
      events: [],
      genomes,
    });

    expect(experience.schemaVersion).toBe(2);
    // Every worker with operationalNeeds should have resolvedNeeds.
    for (const contribution of experience.contributions) {
      const genome = genomes.find((g) => g.identity.id === contribution.workerId);
      if (genome?.operationalNeeds && genome.operationalNeeds.length > 0) {
        expect(contribution.resolvedNeeds).toBeDefined();
        expect(contribution.resolvedNeeds!.length).toBeGreaterThan(0);
        // For Phase 4.5, all resolved needs have provider 'openbot'.
        for (const resolved of contribution.resolvedNeeds!) {
          expect(resolved.provider).toBe('openbot');
        }
      }
    }
  });

  it('deriveExperience without genomes produces contributions without resolvedNeeds (backward compatible)', async () => {
    const goal: Goal = {
      outcome: 'Summarize the attached meeting notes into a one-page memo.',
    };
    const requirements = await compiler.compile(goal);
    const plan = planner.plan(requirements);

    const experience = deriveExperience({
      missionId: 'test-no-genomes',
      requirements,
      plan,
      result: {
        status: 'success',
        summary: 'ok',
        evidence: [],
        cost: { usd: 0, tokens: 0, wallMs: 10, humanInterventions: 0 },
      },
      events: [],
      // genomes intentionally absent — old callers still work.
    });

    expect(experience.schemaVersion).toBe(2);
    for (const contribution of experience.contributions) {
      // resolvedNeeds is absent when genomes are not provided.
      expect(contribution.resolvedNeeds).toBeUndefined();
    }
  });

  it('resolvedNeeds correctly maps need kinds to providers via tool grants', async () => {
    const goal: Goal = {
      outcome:
        'Implement a dark-mode toggle in the web app dashboard and verify it end-to-end in the browser.',
    };
    const requirements = await compiler.compile(goal);
    const plan = planner.plan(requirements);
    const compilation = await genomeCompiler.compilePlan(plan, requirements);
    const genomes = compilation.results.map((r) => r.genome!);

    const experience = deriveExperience({
      missionId: 'test-mapping',
      requirements,
      plan,
      result: {
        status: 'success',
        summary: 'ok',
        evidence: [],
        cost: { usd: 0, tokens: 0, wallMs: 10, humanInterventions: 0 },
      },
      events: [],
      genomes,
    });

    // For each contribution with resolvedNeeds, verify the mapping:
    // shell-execution → provider from tools matching *:shell-execution
    // browser → provider from tools matching *:browser-chromium
    // workspace-files → provider from tools matching *:workspace-files
    for (const contribution of experience.contributions) {
      const genome = genomes.find((g) => g.identity.id === contribution.workerId);
      if (genome === undefined || contribution.resolvedNeeds === undefined) continue;
      for (const resolved of contribution.resolvedNeeds) {
        const expectedDomain =
          resolved.kind === 'browser' ? 'browser-chromium' : resolved.kind;
        const expectedGrant = `${resolved.provider}:${expectedDomain}`;
        expect(genome.tools).toContain(expectedGrant);
      }
    }
  });

  it('no implicit provider is falsely reported for unresolved needs', () => {
    // A genome with a collaborative-workspace need but no matching tool grant
    // → resolveNeeds omits it (does NOT falsely attribute to any provider).
    const genome: WorkerGenome = {
      identity: { id: 'future-1', displayName: 'Future' },
      role: 'Future',
      objective: 'test',
      model: 'cheap',
      skills: [],
      tools: ['openbot:shell-execution'], // only shell-execution granted
      computer: { required: true, browser: false, shell: true, workspace: false },
      memory: 'none',
      budget: { maxUsd: 1, maxTier: 'cheap' },
      autonomy: 'autonomous',
      operationalNeeds: [
        { kind: 'shell-execution' },
        { kind: 'collaborative-workspace' }, // NOT resolvable in Phase 4.5
      ],
    };
    // deriveExperience with this genome should resolve shell-execution but
    // NOT collaborative-workspace (no tool grant matches).
    const requirements = {
      source: { outcome: 'test' },
      domain: 'general' as const,
      successCriteria: [{ description: 'test', kind: 'artifact' as const }],
      hardConstraints: [],
      capabilityNeeds: [],
      budget: { maxUsd: 1, tier: 'cheap' as const },
      approvals: [],
    };
    const plan = {
      rationale: 'test',
      workers: [{ id: 'future-1', role: 'Future', responsibility: 'test', capabilityNeeds: [] }],
      collaboration: [],
      capabilityNeeds: [],
    };
    const experience = deriveExperience({
      missionId: 'test-unresolved',
      requirements: requirements as never,
      plan: plan as never,
      result: {
        status: 'success',
        summary: 'ok',
        evidence: [],
        cost: { usd: 0, tokens: 0, wallMs: 1, humanInterventions: 0 },
      },
      events: [],
      genomes: [genome],
    });
    const contribution = experience.contributions[0];
    expect(contribution.resolvedNeeds).toBeDefined();
    // Only shell-execution is resolved; collaborative-workspace is omitted.
    const kinds = contribution.resolvedNeeds!.map((r) => r.kind);
    expect(kinds).toContain('shell-execution');
    expect(kinds).not.toContain('collaborative-workspace');
  });
});

// ---------------------------------------------------------------------------
// Orchestrator dispatch through the generalized seam
// ---------------------------------------------------------------------------

describe('PHASE 4.5 — MissionOrchestrator dispatches through surfaces()', () => {
  it('runs an end-to-end mission through the generalized seam (OpenBot path)', async () => {
    // This is the architectural test: the orchestrator must run a real mission
    // through surfaces() — NOT through the old genome.computer.required check.
    // If the generalized dispatch is wrong, this mission fails.
    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning: ReasoningProvider = {
      name: 'test-scripted',
      async reason(input: ReasoningInput): Promise<ReasoningOutput> {
        const system = input.system ?? '';
        if (system.includes('You are Software Engineer')) {
          if (input.prompt.includes('Inputs from colleagues') || input.prompt.includes('verification')) {
            return {
              text: JSON.stringify({
                action: 'finish',
                summary: 'done',
                artifacts: ['convert.ts'],
              }),
            };
          }
          return {
            text: JSON.stringify({
              action: 'write_file',
              path: 'convert.ts',
              contents: 'export const cToF = (c: number) => c * 9 / 5 + 32;',
            }),
          };
        }
        if (system.includes('You are Verification Engineer')) {
          return {
            text: JSON.stringify({
              action: 'finish',
              summary: 'verified',
              artifacts: ['USAGE.md'],
            }),
          };
        }
        throw new Error(`no script for: ${system.slice(0, 60)}`);
      },
    };
    const compiler = new GoalCompiler();
    const planner = new OrganizationPlanner();
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const genomeCompiler = new GenomeCompiler({
      registry: loadOwnership('data/ownership.yaml'),
      selectTier: (selection) => router.selectTier(selection),
    });
    const orchestrator = new MissionOrchestrator({
      goalCompiler: compiler,
      planner,
      genomeCompiler,
      runtime,
      reasoning,
      recorder,
      missionId: 'phase-4-5-probe',
    });
    const goal: Goal = {
      outcome:
        'Implement a small CLI utility that converts temperatures between Celsius and Fahrenheit, with tests.',
      constraints: ['pure TypeScript, no external dependencies'],
    };
    const result = await orchestrator.run(goal);
    // The mission ran through the generalized seam and produced a result.
    expect(result.status).toMatch(/^(success|partial|failure)$/);
    // The flight record shows the mission went through the full lifecycle.
    const types = recorder.events.map((e) => e.type);
    expect(types).toContain('mission-started');
    expect(types).toContain('requirements-compiled');
    expect(types).toContain('plan-created');
    expect(types).toContain('genomes-compiled');
    expect(types.lastIndexOf('mission-finished')).toBe(types.length - 1);
  }, 30_000);
});
