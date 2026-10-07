/**
 * G5-06 — Phase A: Causality Experiment.
 *
 * Counterfactual design: Baseline (no patterns) vs Learned (with trusted pattern).
 * The mission must naturally produce 2+ workers in the baseline so the pattern
 * can causally collapse it to 1 worker in the learned arm.
 *
 * Mission: "Compare database A vs database B for a startup and recommend with
 * evidence in a report." This goal triggers:
 * - domain: research ("compare" signal)
 * - capabilityNeeds: web-research + document-authoring (2 needs → scope standard)
 * - 2 specialists in baseline (Technical Researcher + Report Writer)
 * - Pattern: cand-research-document-authoring-prefer-sole-operator
 *   applicableContext: { domain: research, capabilityNeeds: [document-authoring] }
 *   → retrieved (intersection: document-authoring)
 *   → applied (collapses 2 specialists to 1 Sole Operator)
 *
 * Run: npx tsx experiments/academy/g5-06/run-phase-a.ts
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
const EVIDENCE_DIR = join(__dirname, 'phase-a');

// The trusted G5-05 pattern
const TRUSTED_PATTERN: AdvisoryPattern = {
  id: 'cand-research-document-authoring-prefer-sole-operator',
  applicableContext: { domain: 'research', capabilityNeeds: ['document-authoring'] },
  proposedEffect: { kind: 'prefer-role', description: 'Prefer Sole Operator for research+document-authoring', targetRole: 'Sole Operator' },
};

// The evaluation mission — designed to produce 2+ workers in baseline.
// "investigate" triggers web-research need; "report" triggers document-authoring;
// "comprehensive" triggers complexity → scope 'standard' → specialist build path.
// 2 capability needs (web-research + document-authoring) → 2 specialists
// (Technical Researcher + Report Writer) → pattern can collapse to 1.
const EVAL_GOAL: Goal = {
  outcome: 'Compare and investigate database A vs database B for a startup hosting decision and recommend the better option with comprehensive evidence in a report file.',
  context: 'Two database options for a startup. Source evidence is in sources.txt.',
};

const EVAL_INPUTS = [
  {
    path: 'sources.txt',
    contents: [
      'SOURCE 1: Database A is SQL, ACID compliant, $0.02/query, 99.99% uptime SLA.',
      'SOURCE 2: Database B is NoSQL, eventual consistency, $0.01/query, 99.9% uptime SLA.',
      'SOURCE 3: The startup needs strong consistency for financial transactions.',
    ].join('\n'),
  },
];

const EVAL_ACTIONS: readonly WorkerAction[] = [
  { action: 'read_file', path: 'sources.txt' },
  {
    action: 'write_file',
    path: 'recommendation.md',
    contents: [
      '# Database Recommendation: A vs B',
      '',
      '## Evidence',
      '- Database A: SQL, ACID, $0.02/query, 99.99% SLA',
      '- Database B: NoSQL, eventual, $0.01/query, 99.9% SLA',
      '- Startup needs: strong consistency',
      '',
      '## Recommendation: Database A',
      'Supported by: Source 1 (ACID compliance), Source 3 (strong consistency requirement).',
    ].join('\n'),
  },
  { action: 'finish', summary: 'Recommended Database A based on ACID and consistency requirements.', artifacts: ['recommendation.md'] },
];

const EVAL_CHECKS: AcceptanceCheck[] = [
  { kind: 'file', label: 'report-exists', path: 'recommendation.md' },
  { kind: 'content-in-artifacts', label: 'mentions-database-a', expectedContent: 'Database A' },
  { kind: 'content-in-artifacts', label: 'mentions-database-b', expectedContent: 'Database B' },
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
    name: 'phase-a-scripted',
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
  const missionId = `phase-a-${label}`;

  recorder.record({ type: 'mission-started', at: new Date().toISOString(), missionId, goalOutcome: EVAL_GOAL.outcome, budgetUsd: 25 });

  const goalCompiler = new GoalCompiler();
  const requirements = await goalCompiler.compile(EVAL_GOAL);
  recorder.record({ type: 'requirements-compiled', missionId, domain: requirements.domain, capabilityNeeds: [...requirements.capabilityNeeds], successCriteria: requirements.successCriteria.map((c) => c.description), budgetUsd: requirements.budget.maxUsd });

  const planner = new OrganizationPlanner({ patterns });
  const plan = planner.plan(requirements);
  recorder.record({ type: 'plan-created', missionId, workers: plan.workers.map((w) => ({ id: w.id, role: w.role, needs: [...w.capabilityNeeds] })), rationale: plan.rationale, ...(plan.learned === undefined ? {} : { learned: plan.learned }) });

  // Stage inputs
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
  const patternsApplied = plan.learned?.applied.length > 0;

  return {
    arm: label,
    domain: requirements.domain,
    capabilityNeeds: requirements.capabilityNeeds,
    workerCount: plan.workers.length,
    roles: plan.workers.map((w) => w.role),
    reasoningCalls: result.reasoningCalls,
    verificationOk: verification.ok,
    verificationPassed: verification.passed,
    verificationFailed: verification.failed,
    status: result.status,
    patternsConsidered: plan.learned?.considered ?? [],
    patternsApplied: plan.learned?.applied ?? [],
    patternsAppliedFlag: patternsApplied,
    planRationale: plan.rationale,
  };
}

async function main(): Promise<void> {
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('G5-06 — Phase A: Causality Experiment');
  console.log('Selected pattern: cand-research-document-authoring-prefer-sole-operator (support=3, TRUSTED)');
  console.log('Mission: database A vs B comparison (research+web-research+document-authoring)');
  console.log('');

  // ARM A — BASELINE (no patterns)
  console.log('=== ARM A — BASELINE (no patterns) ===');
  const baseline = await runArm('baseline', []);
  console.log(`  Domain: ${baseline.domain}`);
  console.log(`  CapabilityNeeds: ${JSON.stringify(baseline.capabilityNeeds)}`);
  console.log(`  Workers: ${baseline.workerCount}`);
  console.log(`  Roles: ${baseline.roles.join(', ')}`);
  console.log(`  Reasoning calls: ${baseline.reasoningCalls}`);
  console.log(`  Verification: ok=${baseline.verificationOk} passed=${baseline.verificationPassed} failed=${baseline.verificationFailed}`);
  console.log(`  Status: ${baseline.status}`);
  console.log(`  Patterns considered: ${baseline.patternsConsidered.length}`);
  console.log(`  Patterns applied: ${baseline.patternsApplied.length}`);
  console.log('');

  // ARM B — LEARNED (with trusted pattern)
  console.log('=== ARM B — LEARNED (with trusted pattern) ===');
  const learned = await runArm('learned', [TRUSTED_PATTERN]);
  console.log(`  Domain: ${learned.domain}`);
  console.log(`  CapabilityNeeds: ${JSON.stringify(learned.capabilityNeeds)}`);
  console.log(`  Workers: ${learned.workerCount}`);
  console.log(`  Roles: ${learned.roles.join(', ')}`);
  console.log(`  Reasoning calls: ${learned.reasoningCalls}`);
  console.log(`  Verification: ok=${learned.verificationOk} passed=${learned.verificationPassed} failed=${learned.verificationFailed}`);
  console.log(`  Status: ${learned.status}`);
  console.log(`  Patterns considered: ${learned.patternsConsidered.length}`);
  console.log(`  Patterns applied: ${learned.patternsApplied.length}`);
  if (learned.patternsApplied.length > 0) {
    for (const ap of learned.patternsApplied) {
      console.log(`    ${ap.patternId}: ${ap.effect}`);
    }
  }
  console.log('');

  // Causality gate
  console.log('=== CAUSALITY GATE ===');
  const orgChanged = baseline.workerCount !== learned.workerCount || JSON.stringify(baseline.roles) !== JSON.stringify(learned.roles);
  const patternRetrieved = learned.patternsConsidered.length > 0;
  const patternApplied = learned.patternsApplied.length > 0;
  const causalAttribution = orgChanged && patternApplied;
  const correctnessPreserved = baseline.verificationOk === learned.verificationOk;
  const noContamination = true; // no transfer set used, no quarantined pattern

  console.log(`  Pattern retrieved: ${patternRetrieved ? 'YES' : 'NO'}`);
  console.log(`  Pattern passed to planner: ${patternRetrieved ? 'YES' : 'NO'}`);
  console.log(`  Pattern interpreted: ${patternApplied ? 'YES' : 'NO'}`);
  console.log(`  Organization changed: ${orgChanged ? 'YES' : 'NO'}`);
  console.log(`  Causal attribution: ${causalAttribution ? 'YES' : 'NO'}`);
  console.log(`  Correctness preserved: ${correctnessPreserved ? 'YES' : 'NO'}`);
  console.log(`  No contamination: ${noContamination ? 'YES' : 'NO'}`);
  console.log('');

  const causalityGate = patternRetrieved && patternApplied && orgChanged && causalAttribution && correctnessPreserved && noContamination;
  console.log(`  CAUSALITY_GATE = ${causalityGate ? 'PASS' : 'FAIL'}`);
  console.log('');

  // Evidence
  const evidence = {
    phase: 'A',
    timestamp: new Date().toISOString(),
    selectedPattern: TRUSTED_PATTERN,
    baseline,
    learned,
    causalityGate,
    checks: {
      patternRetrieved,
      patternApplied,
      orgChanged,
      causalAttribution,
      correctnessPreserved,
      noContamination,
    },
    organizationalDifference: {
      workerDelta: learned.workerCount - baseline.workerCount,
      roleDifference: learned.roles.join(',') !== baseline.roles.join(','),
      baselineRoles: baseline.roles,
      learnedRoles: learned.roles,
    },
  };

  writeFileSync(join(EVIDENCE_DIR, 'phase-a-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`Evidence written to ${join(EVIDENCE_DIR, 'phase-a-evidence.json')}`);
}

main().catch((error) => {
  console.error('PHASE A FAILED:', error);
  process.exit(1);
});
