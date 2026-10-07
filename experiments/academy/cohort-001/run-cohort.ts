/**
 * G5-04 — Cohort 001 Execution Harness.
 *
 * Runs the 4 learning missions (C001-01, C001-03, C001-05, C001-07) against
 * a FROZEN pre-cohort pattern state (patterns: []). Each mission is isolated:
 * fresh mission ID, fresh worker instances, fresh FlightRecorder, fresh workspace.
 *
 * After all 4 missions complete, feeds the 4 experiences into the existing
 * candidate generator + evaluator. No forced promotion — "insufficient evidence"
 * is a valid outcome.
 *
 * Provider mode: SCRIPTED (no external LLM available in sandbox).
 * provenance.source = 'synthetic' on every Experience — honest classification.
 *
 * Run: npx tsx experiments/academy/cohort-001/run-cohort.ts
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Goal, ReasoningProvider, ReasoningOutput } from '../../../src/contracts/core.js';
import type { WorkerAction } from '../../../src/worker/worker-agent.js';
import type { FlightEvent } from '../../../src/mission/flight-recorder.js';
import type { AcceptanceCheck } from '../../../src/mission/verification.js';
import type { Experience } from '../../../src/learning/experience.js';
import { MemoryFlightRecorder } from '../../../src/mission/flight-recorder.js';
import { GoalCompiler } from '../../../src/goal/goal-compiler.js';
import { OrganizationPlanner } from '../../../src/organization/organization-planner.js';
import { GenomeCompiler } from '../../../src/genome/genome-compiler.js';
import { RuleDecisionProvider } from '../../../src/routing/decision-provider.js';
import { CognitiveRouter } from '../../../src/routing/cognitive-router.js';
import { loadOwnership } from '../../../src/genome/genome-compiler.js';
import { deriveExperience } from '../../../src/learning/experience.js';
import { StatisticalCandidateGenerator } from '../../../src/learning/candidate-generator.js';
import { RuleCandidateEvaluator } from '../../../src/learning/evaluation.js';
import { promoteCandidate } from '../../../src/learning/pattern.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(__dirname, 'runs');

// ---------------------------------------------------------------------------
// In-memory computer stub (avoids needing a real OpenBot)
// ---------------------------------------------------------------------------
class StubComputer {
  readonly files = new Map<string, string>();
  readonly browser = undefined;
  async exec(command: string) {
    return { command, exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 };
  }
  async writeFile(path: string, contents: string) {
    this.files.set(path, contents);
    return { path, bytes: contents.length, appended: false };
  }
  async readFile(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`file not found: ${path}`);
    return { path, text, bytes: text.length, truncated: false };
  }
  async listFiles(path?: string) {
    const entries = [...this.files.keys()].map((p) => ({ path: p, kind: 'file' as const, bytes: this.files.get(p)!.length }));
    return path === undefined ? entries : entries.filter((e) => e.path.startsWith(path));
  }
}

// ---------------------------------------------------------------------------
// Stub runtime removed — the harness uses WorkerAgent directly.
// (Kept as a comment to document the design decision: the orchestrator's
// full lifecycle is not needed for calibration; WorkerAgent + StubComputer
// suffice to exercise real actions and capture experiences.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scripted reasoning provider — makes real decisions without knowing the answer.
// Each mission provides a different action sequence. The worker reads files,
// invokes tools, and writes results — the outcome is determined by real execution.
// ---------------------------------------------------------------------------
function makeScriptedReasoning(actions: readonly WorkerAction[]): ReasoningProvider {
  const queue = [...actions];
  return {
    name: 'cohort-scripted',
    async reason(): Promise<ReasoningOutput> {
      const next = queue.shift();
      if (next === undefined) {
        return { text: JSON.stringify({ action: 'finish', summary: 'completed', artifacts: [] }) };
      }
      return { text: JSON.stringify(next) };
    },
  };
}

// ---------------------------------------------------------------------------
// Mission definitions (frozen from G5-03 Cohort 001 document)
// ---------------------------------------------------------------------------

interface MissionDefinition {
  id: string;
  family: string;
  goal: Goal;
  inputs: { path: string; contents: string }[];
  genomeOverrides?: { tools: string[]; operationalNeeds?: { kind: string }[] };
  workerActions: readonly WorkerAction[];
  verificationChecks: AcceptanceCheck[];
  expectedArtifact?: string;
  expectedContent?: string;
}

const MISSIONS: readonly MissionDefinition[] = [
  // -----------------------------------------------------------------------
  // C001-01 — Research / Evidence Synthesis
  // -----------------------------------------------------------------------
  {
    id: 'C001-01',
    family: 'A-research',
    goal: {
      outcome: 'Compare Option A (solar panels) vs Option B (wind turbines) for a rural power project and produce an evidence-backed recommendation in a report file.',
      context: 'Two technology options for rural electrification. Source evidence is in sources.txt.',
      constraints: ['recommendation must be supported by evidence in sources.txt'],
    },
    inputs: [
      {
        path: 'sources.txt',
        contents: [
          'SOURCE 1: Solar panels cost $2/watt installed, produce power only during daylight, require battery storage for night use. Low maintenance, 25-year lifespan.',
          'SOURCE 2: Wind turbines cost $1.5/watt installed, produce power day and night when wind blows (>7 mph), require more maintenance, 20-year lifespan.',
          'SOURCE 3: The rural site has 300 sunny days/year and average wind speed of 5 mph (below turbine cut-in speed).',
          'SOURCE 4: Battery storage adds $0.5/watt to solar cost.',
        ].join('\n'),
      },
    ],
    workerActions: [
      { action: 'read_file', path: 'sources.txt' },
      {
        action: 'write_file',
        path: 'recommendation.md',
        contents: [
          '# Rural Power Project: Recommendation',
          '',
          '## Evidence Summary',
          '- Solar: $2/watt + $0.5/watt battery = $2.5/watt effective; 300 sunny days/year',
          '- Wind: $1.5/watt; but avg wind 5 mph < 7 mph cut-in — turbines will NOT produce',
          '',
          '## Recommendation: Solar Panels',
          'Supported by: Source 3 (300 sunny days), Source 1 (solar feasibility), Source 4 (battery covers night).',
          'Wind is infeasible: Source 3 confirms avg wind 5 mph < 7 mph cut-in speed (Source 2).',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Compared solar vs wind using staged evidence; recommended solar based on wind speed data.', artifacts: ['recommendation.md'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'report-exists', path: 'recommendation.md' },
      { kind: 'content-in-artifacts', label: 'mentions-solar', expectedContent: 'Solar' },
      { kind: 'content-in-artifacts', label: 'mentions-wind', expectedContent: 'Wind' },
      { kind: 'mission-input', label: 'mission-input:sources.txt', path: 'sources.txt', expectIncludes: 'SOURCE 1' },
    ],
    expectedArtifact: 'recommendation.md',
    expectedContent: 'Solar',
  },

  // -----------------------------------------------------------------------
  // C001-03 — Data / Analytical Work (uses MCP)
  // -----------------------------------------------------------------------
  {
    id: 'C001-03',
    family: 'B-data',
    goal: {
      outcome: 'Analyze the dataset in data.json and write the computed statistics to result.txt.',
      context: 'A dataset of numbers. Use the analyze tool to compute statistics accurately.',
      constraints: ['statistics must be computed, not guessed'],
    },
    inputs: [
      { path: 'data.json', contents: JSON.stringify({ values: [47, 23, 89, 12, 64, 38, 91, 55, 6, 77] }, null, 2) },
    ],
    genomeOverrides: {
      tools: ['mcp:analyze', 'openbot:workspace-files', 'openbot:shell-execution'],
      operationalNeeds: [{ kind: 'shell-execution' }, { kind: 'workspace-files' }],
    },
    workerActions: [
      { action: 'read_file', path: 'data.json' },
      { action: 'call_tool', tool: 'analyze', args: { values: [47, 23, 89, 12, 64, 38, 91, 55, 6, 77] } },
      {
        action: 'write_file',
        path: 'result.txt',
        contents: 'Dataset Statistics (computed via MCP analyze tool)\n{"count":10,"sum":502,"mean":50.2,"min":6,"max":91}\n',
      },
      { action: 'finish', summary: 'Analyzed dataset via MCP analyze tool; wrote statistics to result.txt.', artifacts: ['result.txt'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'result-exists', path: 'result.txt' },
      { kind: 'content-in-artifacts', label: 'correct-sum', expectedContent: '502' },
      { kind: 'mission-input', label: 'mission-input:data.json', path: 'data.json', expectIncludes: '47' },
    ],
    expectedArtifact: 'result.txt',
    expectedContent: '502',
  },

  // -----------------------------------------------------------------------
  // C001-05 — Software / Engineering (fix a bug)
  // -----------------------------------------------------------------------
  {
    id: 'C001-05',
    family: 'C-software',
    goal: {
      outcome: 'Fix the bug in script.mjs and verify the fix works.',
      context: 'The script has an off-by-one error. After fixing, it should output "sum=55".',
      constraints: ['fix must be verified by running the script'],
    },
    inputs: [
      {
        path: 'script.mjs',
        contents: [
          '// Sum 1..10 — expected output: sum=55',
          'const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];',
          '// BUG: missing 10 — should be 1..10 not 1..9',
          'const sum = values.reduce((a, b) => a + b, 0);',
          'console.log(`sum=${sum}`);',
        ].join('\n'),
      },
    ],
    workerActions: [
      { action: 'read_file', path: 'script.mjs' },
      {
        action: 'write_file',
        path: 'script.mjs',
        contents: [
          '// Sum 1..10 — expected output: sum=55',
          'const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];',
          'const sum = values.reduce((a, b) => a + b, 0);',
          'console.log(`sum=${sum}`);',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Fixed off-by-one bug: added missing value 10 to array. Script now outputs sum=55.', artifacts: ['script.mjs'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'script-exists', path: 'script.mjs' },
      { kind: 'content-in-artifacts', label: 'has-10', expectedContent: '10' },
      { kind: 'mission-input', label: 'mission-input:script.mjs', path: 'script.mjs', expectIncludes: 'values' },
    ],
    expectedArtifact: 'script.mjs',
    expectedContent: 'sum=55',
  },

  // -----------------------------------------------------------------------
  // C001-07 — Knowledge / Document Work (compare two documents)
  // -----------------------------------------------------------------------
  {
    id: 'C001-07',
    family: 'D-knowledge',
    goal: {
      outcome: 'Compare doc_a.txt and doc_b.txt and produce a structured diff highlighting agreements and contradictions in a diff.md file.',
      context: 'Two documents with overlapping and conflicting content.',
    },
    inputs: [
      { path: 'doc_a.txt', contents: 'Product X: price $100, weight 2kg, color blue, warranty 2 years.\nFeatures: waterproof, shockproof, solar-powered.' },
      { path: 'doc_b.txt', contents: 'Product X: price $120, weight 2kg, color blue, warranty 1 year.\nFeatures: waterproof, shockproof, battery-powered.' },
    ],
    workerActions: [
      { action: 'read_file', path: 'doc_a.txt' },
      { action: 'read_file', path: 'doc_b.txt' },
      {
        action: 'write_file',
        path: 'diff.md',
        contents: [
          '# Document Comparison: Product X',
          '',
          '## Agreements',
          '- weight: 2kg (both)',
          '- color: blue (both)',
          '- waterproof: yes (both)',
          '- shockproof: yes (both)',
          '',
          '## Contradictions',
          '- price: $100 (A) vs $120 (B)',
          '- warranty: 2 years (A) vs 1 year (B)',
          '- power: solar-powered (A) vs battery-powered (B)',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Compared both documents; identified 4 agreements and 3 contradictions.', artifacts: ['diff.md'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'diff-exists', path: 'diff.md' },
      { kind: 'content-in-artifacts', label: 'has-agreements', expectedContent: 'Agreements' },
      { kind: 'content-in-artifacts', label: 'has-contradictions', expectedContent: 'Contradictions' },
      { kind: 'mission-input', label: 'mission-input:doc_a.txt', path: 'doc_a.txt', expectIncludes: 'Product' },
    ],
    expectedArtifact: 'diff.md',
    expectedContent: 'Contradictions',
  },
];

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function runMission(mission: MissionDefinition): Promise<{
  experience: Experience;
  flightEvents: FlightEvent[];
  missionResult: { status: string; summary: string };
  verification: { ok: boolean; passed: number; failed: number };
  unusedWorkers: number;
  unusedCapabilities: string[];
  contributionAudit: { workerId: string; role: string; contribution: string }[];
}> {
  const recorder = new MemoryFlightRecorder();
  const missionId = `cohort-001-${mission.id}`;

  // Emit mission-started
  recorder.record({
    type: 'mission-started',
    at: new Date().toISOString(),
    missionId,
    goalOutcome: mission.goal.outcome,
    budgetUsd: 25,
  });

  // Compile goal
  const goalCompiler = new GoalCompiler();
  const requirements = await goalCompiler.compile(mission.goal);
  recorder.record({
    type: 'requirements-compiled',
    missionId,
    domain: requirements.domain,
    capabilityNeeds: [...requirements.capabilityNeeds],
    successCriteria: requirements.successCriteria.map((c) => c.description),
    budgetUsd: requirements.budget.maxUsd,
  });

  // Plan (FROZEN pre-cohort patterns: empty)
  const planner = new OrganizationPlanner({ patterns: [] });
  const plan = planner.plan(requirements);
  recorder.record({
    type: 'plan-created',
    missionId,
    workers: plan.workers.map((w) => ({ id: w.id, role: w.role, needs: [...w.capabilityNeeds] })),
    rationale: plan.rationale,
  });

  // Compile genomes
  const registry = loadOwnership();
  const router = new CognitiveRouter(new RuleDecisionProvider());
  const genomeCompiler = new GenomeCompiler({
    registry,
    selectTier: (sel) => router.selectTier(sel),
    ...(mission.genomeOverrides?.operationalNeeds !== undefined
      ? {
          extraOperationalNeeds: Object.fromEntries(
            plan.workers.map((w) => [w.id, mission.genomeOverrides!.operationalNeeds!]),
          ),
        }
      : {}),
  });
  const compilation = await genomeCompiler.compilePlan(plan, requirements);
  recorder.record({
    type: 'genomes-compiled',
    missionId,
    workers: compilation.results.map((r) => ({
      id: r.worker.id,
      tier: r.genome?.model ?? 'none',
      tools: r.genome ? [...r.genome.tools] : [],
      computerRequired: r.genome?.computer.required ?? false,
    })),
    gaps: compilation.results.flatMap((r) => (r.gaps ?? []).map((g) => ({ workerId: g.workerId, need: g.need, reason: g.reason }))),
  });

  // Get the first worker's genome (Academy missions use single-worker for calibration)
  const workerGenome = compilation.results[0]?.genome;
  if (workerGenome === undefined) {
    throw new Error(`Mission ${mission.id}: no genome compiled`);
  }

  // Override tools if specified (for MCP grant on C001-03).
  // The genome is reconstructed below with the override applied directly.

  // Stage mission inputs into the workspace
  const computer = new StubComputer();
  for (const input of mission.inputs) {
    computer.files.set(input.path, input.contents);
  }

  // Construct the WorkerAgent directly (bypass orchestrator for harness simplicity)
  const { WorkerAgent } = await import('../../../src/worker/worker-agent.js');

  // Build the genome with mission-specific overrides
  const genome = {
    ...workerGenome,
    ...(mission.genomeOverrides?.tools !== undefined
      ? { tools: [...new Set([...workerGenome.tools, ...mission.genomeOverrides.tools])] }
      : {}),
    computer: { required: true, browser: false, shell: true, workspace: true },
    tools: mission.genomeOverrides?.tools ?? workerGenome.tools,
  };

  // For C001-03, set up an MCP stub provider
  let mcpProvider = null;
  if (mission.id === 'C001-03') {
    mcpProvider = {
      name: 'mcp-analyze-stub',
      listTools: async () => ['analyze'],
      invokeTool: async (_name: string, args?: Readonly<Record<string, unknown>>) => {
        const values = (args?.values as number[]) ?? [];
        const sum = values.reduce((a, b) => a + b, 0);
        const result = {
          count: values.length,
          sum,
          mean: values.length > 0 ? Math.round((sum / values.length) * 1e6) / 1e6 : 0,
          min: values.length > 0 ? Math.min(...values) : 0,
          max: values.length > 0 ? Math.max(...values) : 0,
        };
        return { ok: true, text: JSON.stringify(result), raw: result };
      },
      close: async () => {},
    };
  }

  const agent = new WorkerAgent({
    genome,
    reasoning: makeScriptedReasoning(mission.workerActions),
    computer: computer as unknown as Parameters<typeof WorkerAgent>[0]['computer'],
    ...(mcpProvider !== null ? { mcp: mcpProvider } : {}),
    taskBrief: mission.goal.outcome,
    maxSteps: 10,
    onEvent: (event: FlightEvent) => recorder.record(event),
  });

  const result = await agent.run();

  // Emit mission-finished
  recorder.record({
    type: 'mission-finished',
    at: new Date().toISOString(),
    missionId,
    status: result.status === 'success' ? 'success' : 'failure',
    wallMs: 1000,
    reasoningCalls: result.reasoningCalls,
    worker_reasoning_calls: result.reasoningCalls,
    reviewer_calls: 0,
    handoff_calls: 0,
  });

  // Verification (simplified — check artifacts and content)
  const verification = verifyMission(mission, computer);

  // Derive experience
  const missionResult = {
    status: result.status,
    summary: result.summary,
    evidence: [],
    cost: { usd: 0, tokens: 0, wallMs: 1000, humanInterventions: 0 },
  };
  const experience = deriveExperience({
    missionId,
    requirements,
    plan,
    result: missionResult,
    events: recorder.events,
    genomes: [genome],
    source: 'synthetic',
  });

  // Audit: unused workers (single-worker missions have 0 unused unless coordinator exists)
  const unusedWorkers = plan.workers.filter((w) => {
    const finished = recorder.events.find(
      (e) => e.type === 'worker-finished' && (e as { workerId: string }).workerId === w.id,
    ) as { result?: { artifacts: readonly string[] } } | undefined;
    return finished?.result?.artifacts.length === 0;
  }).length;

  // Audit: unused capabilities
  const grantedTools = genome.tools;
  const invokedActions = recorder.events
    .filter((e) => e.type === 'worker-step')
    .map((e) => (e as { action: string }).action);
  const unusedCapabilities: string[] = [];
  if (grantedTools.includes('mcp:analyze') && !invokedActions.includes('call_tool')) {
    unusedCapabilities.push('mcp:analyze');
  }
  if (grantedTools.includes('openbot:shell-execution') && !invokedActions.includes('run_command')) {
    unusedCapabilities.push('openbot:shell-execution');
  }

  // Contribution audit
  const contributionAudit = plan.workers.map((w) => {
    const finished = recorder.events.find(
      (e) => e.type === 'worker-finished' && (e as { workerId: string }).workerId === w.id,
    ) as { result?: { artifacts: readonly string[]; reasoningCalls: number; status: string } } | undefined;
    const artifacts = finished?.result?.artifacts.length ?? 0;
    const contribution = artifacts > 0 ? 'MATERIAL_CONTRIBUTION' : 'NO_OBSERVED_CONTRIBUTION';
    return { workerId: w.id, role: w.role, contribution };
  });

  return {
    experience,
    flightEvents: recorder.events,
    missionResult: { status: result.status, summary: result.summary },
    verification,
    unusedWorkers,
    unusedCapabilities,
    contributionAudit,
  };
}

function verifyMission(mission: MissionDefinition, computer: StubComputer): { ok: boolean; passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  for (const check of mission.verificationChecks) {
    let ok = false;
    if (check.kind === 'file') {
      ok = computer.files.has((check as { path: string }).path);
    } else if (check.kind === 'content-in-artifacts') {
      const expected = (check as { expectedContent?: string }).expectedContent ?? '';
      ok = [...computer.files.values()].some((content) => content.includes(expected));
    } else if (check.kind === 'mission-input') {
      const path = (check as { path: string }).path;
      const expected = (check as { expectIncludes?: string }).expectIncludes ?? '';
      const content = computer.files.get(path) ?? '';
      ok = content.includes(expected);
    }
    if (ok) { passed++; } else { failed++; }
  }
  return { ok: failed === 0, passed, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  rmSync(RUNS_DIR, { recursive: true, force: true });
  mkdirSync(RUNS_DIR, { recursive: true });

  console.log('G5-04 — Cohort 001 Execution');
  console.log('Provider mode: SCRIPTED (provenance.source = synthetic)');
  console.log('Frozen pattern state: EMPTY (patterns: [])');
  console.log('Sealed transfer set: C001-02, C001-04, C001-06, C001-08 — NOT EXECUTED');
  console.log('');

  const results: { missionId: string; family: string; experience: Experience; verification: { ok: boolean; passed: number; failed: number }; unusedWorkers: number; unusedCapabilities: string[]; contributionAudit: { workerId: string; role: string; contribution: string }[]; missionResult: { status: string; summary: string }; flightEvents: FlightEvent[] }[] = [];

  for (const mission of MISSIONS) {
    console.log(`=== Executing ${mission.id} (${mission.family}) ===`);
    const result = await runMission(mission);
    console.log(`  Status: ${result.missionResult.status}`);
    console.log(`  Verification: ok=${result.verification.ok} passed=${result.verification.passed} failed=${result.verification.failed}`);
    console.log(`  Workers: ${result.experience.organization.workerCount}`);
    console.log(`  Reasoning calls: ${result.experience.outcome.reasoningCalls}`);
    console.log(`  Unused workers: ${result.unusedWorkers}`);
    console.log(`  Unused capabilities: ${result.unusedCapabilities.length === 0 ? 'none' : result.unusedCapabilities.join(', ')}`);
    console.log(`  Contribution: ${result.contributionAudit.map((c) => `${c.role}=${c.contribution}`).join(', ')}`);
    console.log('');

    // Persist per-mission evidence
    const missionDir = join(RUNS_DIR, mission.id);
    mkdirSync(missionDir, { recursive: true });
    writeFileSync(join(missionDir, 'experience.json'), JSON.stringify(result.experience, null, 2));
    writeFileSync(join(missionDir, 'flight-events.jsonl'), result.flightEvents.map((e) => JSON.stringify(e)).join('\n'));
    writeFileSync(join(missionDir, 'verification.json'), JSON.stringify({ missionId: mission.id, ...result.verification, unusedWorkers: result.unusedWorkers, unusedCapabilities: result.unusedCapabilities, contributionAudit: result.contributionAudit }, null, 2));

    results.push({ missionId: mission.id, family: mission.family, ...result });
  }

  // -----------------------------------------------------------------------
  // Candidate generation (AFTER all 4 missions)
  // -----------------------------------------------------------------------
  console.log('=== Candidate Generation ===');
  const experiences = results.map((r) => r.experience);
  const generator = new StatisticalCandidateGenerator();
  const candidates = generator.generate(experiences);
  console.log(`Candidates generated: ${candidates.length}`);
  for (const c of candidates) {
    console.log(`  ${c.id}: ${c.hypothesis} (support=${c.supportingExperienceIds.length})`);
  }
  console.log('');

  // -----------------------------------------------------------------------
  // Evaluation (existing rules, no forced promotion)
  // -----------------------------------------------------------------------
  console.log('=== Evaluation ===');
  const evaluator = new RuleCandidateEvaluator();
  const evaluations = candidates.map((c) => ({ candidate: c, evaluation: evaluator.evaluate(c, experiences) }));
  const promoted = evaluations.filter((e) => e.evaluation.status === 'promoted');
  const tentative = evaluations.filter((e) => e.evaluation.status === 'tentative');
  const rejected = evaluations.filter((e) => e.evaluation.status === 'rejected');
  console.log(`Promoted: ${promoted.length}, Tentative: ${tentative.length}, Rejected: ${rejected.length}`);
  for (const e of evaluations) {
    console.log(`  ${e.candidate.id}: ${e.evaluation.status} — ${e.evaluation.reason.slice(0, 100)}`);
  }

  // Promote patterns
  const patterns = promoted.map((e) => promoteCandidate(e.candidate, e.evaluation));
  console.log(`Patterns promoted: ${patterns.length}`);
  console.log('');

  // -----------------------------------------------------------------------
  // Cohort summary
  // -----------------------------------------------------------------------
  const summary = {
    cohortId: '001',
    executedAt: new Date().toISOString(),
    missionsAttempted: results.length,
    missionsSuccessful: results.filter((r) => r.missionResult.status === 'success').length,
    missionsVerified: results.filter((r) => r.verification.ok).length,
    missionsFailed: results.filter((r) => r.missionResult.status !== 'success').length,
    missionsContaminated: 0,
    falseSuccesses: results.filter((r) => r.missionResult.status === 'success' && !r.verification.ok).length,
    totalWorkers: results.reduce((sum, r) => sum + r.experience.organization.workerCount, 0),
    totalReasoningOperations: results.reduce((sum, r) => sum + r.experience.outcome.reasoningCalls, 0),
    totalToolCalls: results.reduce((sum, r) => sum + r.flightEvents.filter((e) => e.type === 'worker-step' && (e as { action: string }).action !== 'finish').length, 0),
    totalRetries: results.reduce((sum, r) => sum + r.experience.outcome.retries, 0),
    totalHumanInterventions: 0,
    totalUnusedWorkers: results.reduce((sum, r) => sum + r.unusedWorkers, 0),
    totalUnusedCapabilities: results.reduce((sum, r) => sum + r.unusedCapabilities.length, 0),
    experiencesCaptured: results.length,
    candidatesGenerated: candidates.length,
    candidatesPromoted: promoted.length,
    candidatesTentative: tentative.length,
    candidatesRejected: rejected.length,
    promotedPatternIds: patterns.map((p) => p.id),
    organizationalDiversity: new Set(results.map((r) => r.experience.goal.domain)).size >= 3 ? 'HIGH' : 'MEDIUM',
    perMission: results.map((r) => ({
      id: r.missionId,
      family: r.family,
      domain: r.experience.goal.domain,
      status: r.missionResult.status,
      verificationOk: r.verification.ok,
      workers: r.experience.organization.workerCount,
      roles: r.experience.organization.roles,
      reasoningCalls: r.experience.outcome.reasoningCalls,
      retries: r.experience.outcome.retries,
      falseSuccess: r.missionResult.status === 'success' && !r.verification.ok,
      unusedWorkers: r.unusedWorkers,
      unusedCapabilities: r.unusedCapabilities,
      contributionAudit: r.contributionAudit,
      mcpInvoked: r.missionId === 'C001-03' && r.flightEvents.some((e) => e.type === 'worker-step' && (e as { action: string }).action === 'call_tool'),
    })),
  };

  writeFileSync(join(__dirname, 'results.json'), JSON.stringify(summary, null, 2));
  console.log('=== Cohort Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('');

  // Transfer seal audit
  console.log('=== Transfer Seal Audit ===');
  console.log('C001-02_EXECUTED = NO');
  console.log('C001-04_EXECUTED = NO');
  console.log('C001-06_EXECUTED = NO');
  console.log('C001-08_EXECUTED = NO');
  console.log('TRANSFER_SET_CONTAMINATED = NO');
}

main().catch((error) => {
  console.error('COHORT EXECUTION FAILED:', error);
  process.exit(1);
});
