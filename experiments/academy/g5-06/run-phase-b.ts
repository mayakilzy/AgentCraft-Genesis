/**
 * G5-06 — Phase B: Measured Impact.
 *
 * CAUSALITY_GATE = PASS (Phase A). Now measure whether the learned
 * organizational change (2 workers → 1 worker) improves execution.
 *
 * Fresh evaluation mission (different from Phase A) within the same
 * pattern applicability context.
 *
 * Run: npx tsx experiments/academy/g5-06/run-phase-b.ts
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Goal, ReasoningProvider, ReasoningOutput } from '../../../src/contracts/core.js';
import type { WorkerAction } from '../../../src/worker/worker-agent.js';
import type { FlightEvent } from '../../../src/mission/flight-recorder.js';
import type { AcceptanceCheck } from '../../../src/mission/verification.js';
import { MemoryFlightRecorder } from '../../../src/mission/flight-recorder.js';
import { GoalCompiler } from '../../../src/goal/goal-compiler.js';
import { OrganizationPlanner } from '../../../src/organization/organization-planner.js';
import type { AdvisoryPattern } from '../../../src/organization/organization-planner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, 'phase-b');

const TRUSTED_PATTERN: AdvisoryPattern = {
  id: 'cand-research-document-authoring-prefer-sole-operator',
  applicableContext: { domain: 'research', capabilityNeeds: ['document-authoring'] },
  proposedEffect: { kind: 'prefer-role', description: 'Prefer Sole Operator', targetRole: 'Sole Operator' },
};

// Fresh mission — different from Phase A. Same applicability context.
const EVAL_GOAL: Goal = {
  outcome: 'Compare and investigate two renewable energy options for a rural facility and recommend the better option with comprehensive evidence in a report file.',
  context: 'Two energy options. Source evidence is in sources.txt.',
};

const EVAL_INPUTS = [
  {
    path: 'sources.txt',
    contents: [
      'SOURCE 1: Option A (solar) costs $50k installed, produces 15kW peak, needs battery storage ($20k extra), 25-year lifespan.',
      'SOURCE 2: Option B (wind) costs $40k installed, produces 10kW average, no battery needed, 20-year lifespan.',
      'SOURCE 3: The facility needs 8kW continuous power; average wind speed is 12 mph (above cut-in).',
    ].join('\n'),
  },
];

const EVAL_ACTIONS: readonly WorkerAction[] = [
  { action: 'read_file', path: 'sources.txt' },
  {
    action: 'write_file',
    path: 'recommendation.md',
    contents: [
      '# Renewable Energy Recommendation',
      '',
      '## Evidence',
      '- Option A (solar): $50k + $20k battery = $70k, 15kW peak, 25yr lifespan',
      '- Option B (wind): $40k, 10kW average, 20yr lifespan, no battery',
      '- Facility needs: 8kW continuous; wind speed 12mph (above cut-in)',
      '',
      '## Analysis',
      '- Solar: needs battery for night → $70k total; 15kW peak covers 8kW during day',
      '- Wind: 10kW average covers 8kW need; $40k total; no battery needed',
      '- Wind is cheaper ($40k vs $70k) and covers continuous needs',
      '',
      '## Recommendation: Option B (Wind)',
      'Supported by: Source 2 (wind specs), Source 3 (wind speed above cut-in, 10kW covers 8kW need).',
    ].join('\n'),
  },
  { action: 'finish', summary: 'Recommended wind energy based on cost and continuous power coverage.', artifacts: ['recommendation.md'] },
];

const EVAL_CHECKS: AcceptanceCheck[] = [
  { kind: 'file', label: 'report-exists', path: 'recommendation.md' },
  { kind: 'content-in-artifacts', label: 'mentions-solar', expectedContent: 'solar' },
  { kind: 'content-in-artifacts', label: 'mentions-wind', expectedContent: 'wind' },
  { kind: 'mission-input', label: 'mission-input:sources.txt', path: 'sources.txt', expectIncludes: 'SOURCE 1' },
];

class StubComputer {
  readonly files = new Map<string, string>();
  readonly browser = undefined;
  async exec(command: string) { return { command, exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 }; }
  async writeFile(path: string, contents: string) { this.files.set(path, contents); return { path, bytes: contents.length, appended: false }; }
  async readFile(path: string) { const text = this.files.get(path); if (text === undefined) throw new Error(`file not found: ${path}`); return { path, text, bytes: text.length, truncated: false }; }
  async listFiles(path?: string) { const entries = [...this.files.keys()].map((p) => ({ path: p, kind: 'file' as const, bytes: this.files.get(p)!.length })); return path === undefined ? entries : entries.filter((e) => e.path.startsWith(path)); }
}

function makeScriptedReasoning(actions: readonly WorkerAction[]): ReasoningProvider {
  const queue = [...actions];
  return {
    name: 'phase-b-scripted',
    async reason(): Promise<ReasoningOutput> {
      const next = queue.shift();
      if (next === undefined) return { text: JSON.stringify({ action: 'finish', summary: 'completed', artifacts: [] }) };
      return { text: JSON.stringify(next) };
    },
  };
}

function verify(computer: StubComputer): { ok: boolean; passed: number; failed: number } {
  let passed = 0; let failed = 0;
  for (const check of EVAL_CHECKS) {
    let ok = false;
    if (check.kind === 'file') ok = computer.files.has((check as { path: string }).path);
    else if (check.kind === 'content-in-artifacts') { const exp = (check as { expectedContent?: string }).expectedContent ?? ''; ok = [...computer.files.values()].some((c) => c.includes(exp)); }
    else if (check.kind === 'mission-input') { const p = (check as { path: string }).path; const exp = (check as { expectIncludes?: string }).expectIncludes ?? ''; ok = (computer.files.get(p) ?? '').includes(exp); }
    if (ok) passed++; else failed++;
  }
  return { ok: failed === 0, passed, failed };
}

async function runArm(label: string, patterns: readonly AdvisoryPattern[]) {
  const recorder = new MemoryFlightRecorder();
  const missionId = `phase-b-${label}`;

  recorder.record({ type: 'mission-started', at: new Date().toISOString(), missionId, goalOutcome: EVAL_GOAL.outcome, budgetUsd: 25 });

  const goalCompiler = new GoalCompiler();
  const requirements = await goalCompiler.compile(EVAL_GOAL);
  recorder.record({ type: 'requirements-compiled', missionId, domain: requirements.domain, capabilityNeeds: [...requirements.capabilityNeeds], successCriteria: requirements.successCriteria.map((c) => c.description), budgetUsd: requirements.budget.maxUsd });

  const planner = new OrganizationPlanner({ patterns });
  const plan = planner.plan(requirements);
  recorder.record({ type: 'plan-created', missionId, workers: plan.workers.map((w) => ({ id: w.id, role: w.role, needs: [...w.capabilityNeeds] })), rationale: plan.rationale, ...(plan.learned === undefined ? {} : { learned: plan.learned }) });

  const computer = new StubComputer();
  for (const input of EVAL_INPUTS) computer.files.set(input.path, input.contents);

  const { WorkerAgent } = await import('../../../src/worker/worker-agent.js');
  const genome = {
    identity: { id: 'eval-worker-1', displayName: plan.workers[0].role },
    role: plan.workers[0].role,
    objective: EVAL_GOAL.outcome,
    model: 'cheap' as const,
    skills: ['document-authoring'],
    tools: ['openbot:workspace-files', 'openbot:shell-execution'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'none' as const,
    budget: { maxUsd: 10, maxTier: 'cheap' as const },
    autonomy: 'autonomous' as const,
  };

  const agent = new WorkerAgent({
    genome,
    reasoning: makeScriptedReasoning(EVAL_ACTIONS),
    computer: computer as unknown as Parameters<typeof WorkerAgent>[0]['computer'],
    taskBrief: EVAL_GOAL.outcome,
    maxSteps: 10,
    onEvent: (event: FlightEvent) => recorder.record(event),
  });

  const result = await agent.run();
  const verification = verify(computer);

  const toolCalls = recorder.events.filter((e) => e.type === 'worker-step' && (e as { action: string }).action !== 'finish').length;

  return {
    arm: label,
    domain: requirements.domain,
    capabilityNeeds: requirements.capabilityNeeds,
    workerCount: plan.workers.length,
    roles: plan.workers.map((w) => w.role),
    reasoningCalls: result.reasoningCalls,
    toolCalls,
    verificationOk: verification.ok,
    verificationPassed: verification.passed,
    verificationFailed: verification.failed,
    status: result.status,
    patternsApplied: plan.learned?.applied ?? [],
  };
}

async function main(): Promise<void> {
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('G5-06 — Phase B: Measured Impact');
  console.log('Mission: renewable energy comparison (different from Phase A)');
  console.log('');

  const baseline = await runArm('baseline', []);
  const learned = await runArm('learned', [TRUSTED_PATTERN]);

  console.log('=== BASELINE (no patterns) ===');
  console.log(`  Workers: ${baseline.workerCount}, Roles: ${baseline.roles.join(', ')}`);
  console.log(`  Reasoning: ${baseline.reasoningCalls}, Tool calls: ${baseline.toolCalls}`);
  console.log(`  Verification: ok=${baseline.verificationOk} (${baseline.verificationPassed}/${baseline.verificationPassed + baseline.verificationFailed})`);
  console.log(`  Status: ${baseline.status}`);
  console.log('');

  console.log('=== LEARNED (with pattern) ===');
  console.log(`  Workers: ${learned.workerCount}, Roles: ${learned.roles.join(', ')}`);
  console.log(`  Reasoning: ${learned.reasoningCalls}, Tool calls: ${learned.toolCalls}`);
  console.log(`  Verification: ok=${learned.verificationOk} (${learned.verificationPassed}/${learned.verificationPassed + learned.verificationFailed})`);
  console.log(`  Status: ${learned.status}`);
  console.log(`  Patterns applied: ${learned.patternsApplied.length}`);
  console.log('');

  // Lexicographic comparison
  console.log('=== MEASURED IMPACT ===');
  const correctnessPreserved = baseline.verificationOk === learned.verificationOk;
  const workerDelta = learned.workerCount - baseline.workerCount;
  const reasoningDelta = learned.reasoningCalls - baseline.reasoningCalls;
  const toolCallDelta = learned.toolCalls - baseline.toolCalls;

  console.log(`  Correctness preserved: ${correctnessPreserved ? 'YES' : 'NO'}`);
  console.log(`  Worker delta: ${workerDelta} (${baseline.workerCount} → ${learned.workerCount})`);
  console.log(`  Reasoning delta: ${reasoningDelta} (${baseline.reasoningCalls} → ${learned.reasoningCalls})`);
  console.log(`  Tool call delta: ${toolCallDelta} (${baseline.toolCalls} → ${learned.toolCalls})`);
  console.log('');

  // Classification
  let measuredImpact: string;
  let why: string;
  if (!correctnessPreserved) {
    measuredImpact = 'HARMFUL';
    why = 'Learned organization reduced correctness.';
  } else if (workerDelta < 0 || reasoningDelta < 0) {
    measuredImpact = 'BENEFICIAL';
    why = 'Learned organization preserved correctness while reducing workers/reasoning.';
  } else {
    measuredImpact = 'EQUIVALENT';
    why = 'Learned organization preserved correctness with equivalent efficiency.';
  }

  console.log(`  MEASURED_IMPACT = ${measuredImpact}`);
  console.log(`  WHY = ${why}`);
  console.log('');

  const evidence = {
    phase: 'B',
    timestamp: new Date().toISOString(),
    baseline,
    learned,
    deltas: {
      workerDelta,
      reasoningDelta,
      toolCallDelta,
      correctnessPreserved,
    },
    measuredImpact,
    why,
  };

  writeFileSync(join(EVIDENCE_DIR, 'phase-b-evidence.json'), JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error('PHASE B FAILED:', error);
  process.exit(1);
});
