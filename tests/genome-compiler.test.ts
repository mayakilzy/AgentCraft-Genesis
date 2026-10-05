import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type {
  Goal,
  GoalRequirements,
  OrganizationPlan,
  TierSelection,
} from '../src/contracts/core.js';
import { GoalCompiler } from '../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
  parseOwnershipRegistry,
} from '../src/genome/genome-compiler.js';
import { OrganizationPlanner } from '../src/organization/organization-planner.js';
import {
  CONSTRAINED_GOAL,
  DIAGNOSTIC_GOAL,
  RESEARCH_GOAL,
  SIMPLE_GOAL,
  SOFTWARE_ENGINEERING_GOAL,
} from './fixtures/goals.js';

/**
 * TASK-008 — genomes are compiled from the LIVE ownership registry, not from
 * hardcoded vendor decisions; unsatisfiable needs become structured gaps.
 */

const GENOME_FIELDS = [
  'identity',
  'role',
  'objective',
  'model',
  'skills',
  'tools',
  'computer',
  'memory',
  'budget',
  'autonomy',
] as const;

let compiler: GoalCompiler;
let planner: OrganizationPlanner;
const tierCalls: TierSelection[] = [];
let genomeCompiler: GenomeCompiler;
let requirements: Map<Goal, GoalRequirements>;
let plans: Map<Goal, OrganizationPlan>;

const recordingSelector = async (selection: TierSelection) => {
  tierCalls.push(selection);
  return selection.criticality === 'mission-critical' ? 'default' : 'cheap';
};

beforeAll(async () => {
  compiler = new GoalCompiler();
  planner = new OrganizationPlanner();
  genomeCompiler = new GenomeCompiler({
    registry: loadOwnership('data/ownership.yaml'),
    selectTier: recordingSelector,
  });

  const goals = [
    RESEARCH_GOAL,
    SOFTWARE_ENGINEERING_GOAL,
    DIAGNOSTIC_GOAL,
    SIMPLE_GOAL,
    CONSTRAINED_GOAL,
  ];
  const compiled = await Promise.all(goals.map((goal) => compiler.compile(goal)));
  requirements = new Map(goals.map((goal, i) => [goal, compiled[i]]));
  plans = new Map(
    goals.map((goal, i) => [goal, planner.plan(compiled[i] as GoalRequirements)]),
  );
});

describe('ownership registry loading (TASK-008 support)', () => {
  it('loads the live registry from data/ownership.yaml', () => {
    const registry = loadOwnership('data/ownership.yaml');
    expect(registry.ownership.length).toBeGreaterThanOrEqual(18);
    expect(
      registry.ownership.filter((e) => e.decision === 'GENESIS-BUILD').length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('rejects registries with duplicate canonical domains', () => {
    const doc = parse(readFileSync('data/ownership.yaml', 'utf8'));
    doc.ownership.push(structuredClone(doc.ownership[0]));
    expect(() => parseOwnershipRegistry(doc)).toThrow(/duplicate canonical domain/);
  });
});

describe('GenomeCompiler v0.1 (TASK-008)', () => {
  it('compiles every planned worker of the research plan into a valid genome', async () => {
    const compilation = await genomeCompiler.compilePlan(
      plans.get(RESEARCH_GOAL)!,
      requirements.get(RESEARCH_GOAL)!,
    );

    expect(compilation.ok).toBe(true);
    expect(compilation.results).toHaveLength(4);

    const byRole = new Map(
      compilation.results.map((r) => [r.genome!.role, r.genome!]),
    );

    const researcher = byRole.get('Web Researcher')!;
    expect(researcher.tools).toContain('openbot:browser-chromium');
    expect(researcher.computer).toEqual({
      required: true,
      browser: true,
      shell: false,
      workspace: false,
    });

    const analyst = byRole.get('Data Analyst')!;
    expect(analyst.tools).toContain('openbot:shell-execution');
    expect(analyst.computer.shell).toBe(true);

    const writer = byRole.get('Report Writer')!;
    expect(writer.tools).toContain('openbot:workspace-files');
    expect(writer.computer.workspace).toBe(true);
    expect(writer.memory).toBe('shared-thread');
  });

  it('maps the engineering plan onto shell/workspace and browser computers', async () => {
    const compilation = await genomeCompiler.compilePlan(
      plans.get(SOFTWARE_ENGINEERING_GOAL)!,
      requirements.get(SOFTWARE_ENGINEERING_GOAL)!,
    );

    expect(compilation.ok).toBe(true);
    const engineer = compilation.results.find(
      (r) => r.genome?.role === 'Software Engineer',
    )!.genome!;
    expect(engineer.computer.shell).toBe(true);
    expect(engineer.computer.workspace).toBe(true);
    expect(engineer.computer.browser).toBe(false);

    const verifier = compilation.results.find(
      (r) => r.genome?.role === 'Verification Engineer',
    )!.genome!;
    expect(verifier.computer.browser).toBe(true);
  });

  it('splits the mission budget across workers without ever exceeding it', async () => {
    for (const goal of [RESEARCH_GOAL, CONSTRAINED_GOAL, SIMPLE_GOAL]) {
      const compilation = await genomeCompiler.compilePlan(
        plans.get(goal)!,
        requirements.get(goal)!,
      );
      const total = compilation.results.reduce(
        (sum, r) => sum + (r.genome?.budget.maxUsd ?? 0),
        0,
      );
      expect(total).toBeLessThanOrEqual(
        requirements.get(goal)!.budget.maxUsd,
      );
    }
  });

  it('consults the tier selector with explainable criticality per role', async () => {
    tierCalls.length = 0;
    await genomeCompiler.compilePlan(
      plans.get(RESEARCH_GOAL)!,
      requirements.get(RESEARCH_GOAL)!,
    );

    const byRole = new Map(tierCalls.map((call) => [call.role, call]));
    expect(byRole.get('Mission Coordinator')!.criticality).toBe(
      'mission-critical',
    );
    expect(byRole.get('Report Writer')!.criticality).toBe('important');
    expect(byRole.get('Web Researcher')!.criticality).toBe('routine');
    for (const call of tierCalls) {
      expect(call.missionDomain).toBe('research');
      expect(call.budgetCeiling).toBe('default');
    }
  });

  it('returns structured capability gaps instead of guessing genomes', async () => {
    const plan: OrganizationPlan = {
      rationale: 'synthetic gap probe',
      workers: [
        {
          id: 'quantum-worker-1',
          role: 'Quantum Specialist',
          responsibility: 'Simulates quantum circuits',
          capabilityNeeds: ['quantum-simulation'],
        },
      ],
      collaboration: [],
      capabilityNeeds: ['quantum-simulation'],
    };

    const compilation = await genomeCompiler.compilePlan(
      plan,
      requirements.get(SIMPLE_GOAL)!,
    );

    expect(compilation.ok).toBe(false);
    const result = compilation.results[0];
    expect(result.genome).toBeUndefined();
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps![0].workerId).toBe('quantum-worker-1');
    expect(result.gaps![0].need).toBe('quantum-simulation');
    expect(result.gaps![0].reason).toContain('no canonical owner');
  });

  it('sets supervised autonomy when approvals exist and shared-thread memory for teams', async () => {
    const supervised = await genomeCompiler.compilePlan(
      plans.get(CONSTRAINED_GOAL)!,
      requirements.get(CONSTRAINED_GOAL)!,
    );
    for (const result of supervised.results) {
      expect(result.genome!.autonomy).toBe('supervised');
      expect(result.genome!.memory).toBe('shared-thread');
    }

    const solo = await genomeCompiler.compilePlan(
      plans.get(SIMPLE_GOAL)!,
      requirements.get(SIMPLE_GOAL)!,
    );
    const soleGenome = solo.results[0].genome!;
    expect(soleGenome.autonomy).toBe('autonomous');
    expect(soleGenome.memory).toBe('none');
    expect(soleGenome.identity.id).toBe('sole-operator-1');
  });

  it('produces genomes with exactly the ten baseline fields — no subclasses, no extras', async () => {
    const compilation = await genomeCompiler.compilePlan(
      plans.get(DIAGNOSTIC_GOAL)!,
      requirements.get(DIAGNOSTIC_GOAL)!,
    );
    for (const result of compilation.results) {
      expect(Object.keys(result.genome!).sort()).toEqual([...GENOME_FIELDS].sort());
      // Plain objects only — MuseWorker/DotWorker/BotWorker classes do not exist.
      expect(result.genome!.constructor).toBe(Object);
      expect(result.genome!.model).toMatch(/^(cheap|default|frontier)$/);
    }
  });

  it('never binds a provider or vendor name into a genome', async () => {
    for (const goal of plans.keys()) {
      const compilation = await genomeCompiler.compilePlan(
        plans.get(goal)!,
        requirements.get(goal)!,
      );
      const serialized = JSON.stringify(compilation);
      expect(serialized).not.toMatch(
        /openai|anthropic|claude|gemini|gpt-|deepseek|llama/i,
      );
    }
  });
});
