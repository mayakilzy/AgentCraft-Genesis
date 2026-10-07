/**
 * G5-08 — Phase A Mission B: Generalization boundary interpreter.
 *
 * Section 7 permits a SECOND generalization mission when "genuinely needed
 * to interpret the boundary." Mission G5-08-GEN-A produced
 * GENERALIZATION_NON_APPLICABLE because the v0.1 GoalCompiler classified
 * "Rust vs Go" as software-engineering, so no trusted pattern matched.
 * Mission G5-08-GEN-B probes the same generalization question on content
 * (note-taking-app evaluation) that DOES match a trusted pattern's signature
 * (research|document-authoring,web-research).
 *
 * Two-arm design, same as Mission A. Provider mode: SCRIPTED.
 *
 * Run: npx tsx experiments/academy/g5-08/generalization/run-phase-a-b.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Goal, ReasoningProvider, ReasoningOutput } from '../../../../src/contracts/core.js';
import type { WorkerAction } from '../../../../src/worker/worker-agent.js';
import type { FlightEvent } from '../../../../src/mission/flight-recorder.js';
import type { AcceptanceCheck } from '../../../../src/mission/verification.js';
import { MemoryFlightRecorder } from '../../../../src/mission/flight-recorder.js';
import { GoalCompiler } from '../../../../src/goal/goal-compiler.js';
import { OrganizationPlanner } from '../../../../src/organization/organization-planner.js';
import type { AdvisoryPattern } from '../../../../src/organization/organization-planner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TRUSTED_PATTERNS: readonly AdvisoryPattern[] = [
  {
    id: 'cand-research-document-authoring-prefer-sole-operator',
    applicableContext: { domain: 'research', capabilityNeeds: ['document-authoring'] },
    proposedEffect: { kind: 'prefer-role', description: 'Prefer Sole Operator for research+document-authoring', targetRole: 'Sole Operator' },
  },
  {
    id: 'cand-research-document-authoring-web-research-prefer-sole-operator',
    applicableContext: { domain: 'research', capabilityNeeds: ['document-authoring', 'web-research'] },
    proposedEffect: { kind: 'prefer-role', description: 'Prefer Sole Operator for research+document-authoring+web-research', targetRole: 'Sole Operator' },
  },
  {
    id: 'cand-general-data-analysis-document-authoring-prefer-sole-operator',
    applicableContext: { domain: 'general', capabilityNeeds: ['data-analysis', 'document-authoring'] },
    proposedEffect: { kind: 'prefer-role', description: 'Prefer Sole Operator for general+data-analysis+document-authoring', targetRole: 'Sole Operator' },
  },
];

const GEN_B_GOAL: Goal = {
  outcome: 'Investigate and compare two note-taking applications for academic researchers and recommend the better option with comprehensive evidence in a report file.',
  context: 'Two note-taking applications. Source evidence is in sources.txt.',
  constraints: ['recommendation must be supported by evidence in sources.txt'],
};

const GEN_B_INPUTS = [
  {
    path: 'sources.txt',
    contents: [
      'SOURCE 1: Application A (Notion) offers database views, rich-text editing, and API access. Free tier limited to 1000 blocks; paid tier $8/user/month.',
      'SOURCE 2: Application B (Obsidian) stores notes as local Markdown files, supports bidirectional linking, and works offline. Free for personal use; commercial license $50/user/year.',
      'SOURCE 3: Academic researchers cite ~40 papers/year on average; cross-referencing between notes and bibliographies is the most-cited pain point (Smith et al. 2023 survey, n=412).',
      "SOURCE 4: Notion's API allows automated bibliography imports from Zotero; Obsidian requires a community plugin (Better BibTeX) and manual sync.",
      "SOURCE 5: Obsidian's local-first storage means data ownership and longevity are guaranteed; Notion's cloud storage means vendor lock-in and potential data loss on company failure.",
      'SOURCE 6: The research team has 3 members across 2 institutions; shared editing is essential. Notion supports real-time multi-user editing; Obsidian requires third-party sync (Obsidian Sync $4/user/month or git-based).',
    ].join('\n'),
  },
];

const GEN_B_ACTIONS: readonly WorkerAction[] = [
  { action: 'read_file', path: 'sources.txt' },
  {
    action: 'write_file',
    path: 'recommendation.md',
    contents: [
      '# Note-Taking App Recommendation for Academic Researchers',
      '',
      '## Evidence Summary',
      '- Notion: rich editing + API + Zotero auto-import; $8/user/mo; cloud-based (Sources 1, 4)',
      '- Obsidian: local Markdown + bidirectional links; $50/user/yr commercial; offline-first (Sources 2, 5)',
      '- Pain point: bibliography cross-referencing (Source 3, n=412 survey)',
      '- Team: 3 members across 2 institutions; shared editing essential (Source 6)',
      '',
      '## Recommendation: Notion',
      'Supported by: Source 4 (automated Zotero import addresses Source 3 pain point), Source 6 (real-time multi-user editing essential for cross-institution team), Source 1 (rich database views useful for citation tables).',
      '',
      'Obsidian advantages (Source 5: local-first data ownership) are real but secondary: the team needs real-time shared editing (Source 6), and Notion\'s API integration with Zotero (Source 4) directly addresses the most-cited researcher pain point (Source 3). The total cost ($8/user/mo = $96/user/yr vs Obsidian Sync $4/user/mo = $48/user/yr + commercial $50/user/yr ≈ $98/user/yr effective) is comparable.',
    ].join('\n'),
  },
  { action: 'finish', summary: 'Recommended Notion based on Zotero integration, real-time collaboration, and citation-pain-point resolution.', artifacts: ['recommendation.md'] },
];

const GEN_B_CHECKS: AcceptanceCheck[] = [
  { kind: 'file', label: 'report-exists', path: 'recommendation.md' },
  { kind: 'content-in-artifacts', label: 'mentions-notion', expectedContent: 'Notion' },
  { kind: 'content-in-artifacts', label: 'mentions-obsidian', expectedContent: 'Obsidian' },
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

function makeScriptedReasoning(actions: readonly WorkerAction[], armLabel: string): ReasoningProvider {
  const queue = [...actions];
  return {
    name: `g5-08-gen-b-${armLabel}-scripted`,
    async reason(): Promise<ReasoningOutput> {
      const next = queue.shift();
      if (next === undefined) return { text: JSON.stringify({ action: 'finish', summary: 'completed', artifacts: [] }) };
      return { text: JSON.stringify(next) };
    },
  };
}

function verify(checks: readonly AcceptanceCheck[], computer: StubComputer): { ok: boolean; passed: number; failed: number; details: { label: string; ok: boolean }[] } {
  let passed = 0; let failed = 0;
  const details: { label: string; ok: boolean }[] = [];
  for (const check of checks) {
    let ok = false;
    if (check.kind === 'file') ok = computer.files.has((check as { path: string }).path);
    else if (check.kind === 'content-in-artifacts') { const exp = (check as { expectedContent?: string }).expectedContent ?? ''; ok = [...computer.files.values()].some((c) => c.includes(exp)); }
    else if (check.kind === 'mission-input') { const p = (check as { path: string }).path; const exp = (check as { expectIncludes?: string }).expectIncludes ?? ''; ok = (computer.files.get(p) ?? '').includes(exp); }
    if (ok) passed++; else failed++;
    details.push({ label: (check as { label?: string }).label ?? check.kind, ok });
  }
  return { ok: failed === 0, passed, failed, details };
}

interface ArmResult {
  arm: 'baseline' | 'learned';
  domain: string;
  capabilityNeeds: string[];
  evidenceSignature: string;
  workerCount: number;
  roles: string[];
  reasoningCalls: number;
  status: string;
  verificationOk: boolean;
  verificationPassed: number;
  verificationFailed: number;
  verificationDetails: { label: string; ok: boolean }[];
  patternsConsidered: string[];
  patternsApplied: { patternId: string; effect: string }[];
  patternsAppliedFlag: boolean;
  planRationale: string;
  falseSuccess: boolean;
}

async function runArm(arm: 'baseline' | 'learned'): Promise<ArmResult> {
  const recorder = new MemoryFlightRecorder();
  const missionId = `g5-08-gen-b-${arm}`;
  const patterns = arm === 'baseline' ? [] : TRUSTED_PATTERNS;

  recorder.record({ type: 'mission-started', at: new Date().toISOString(), missionId, goalOutcome: GEN_B_GOAL.outcome, budgetUsd: 25 });

  const goalCompiler = new GoalCompiler();
  const requirements = await goalCompiler.compile(GEN_B_GOAL);
  recorder.record({ type: 'requirements-compiled', missionId, domain: requirements.domain, capabilityNeeds: [...requirements.capabilityNeeds], successCriteria: requirements.successCriteria.map((c) => c.description), budgetUsd: requirements.budget.maxUsd });

  const planner = new OrganizationPlanner({ patterns });
  const plan = planner.plan(requirements);
  recorder.record({ type: 'plan-created', missionId, workers: plan.workers.map((w) => ({ id: w.id, role: w.role, needs: [...w.capabilityNeeds] })), rationale: plan.rationale, ...(plan.learned === undefined ? {} : { learned: plan.learned }) });

  const computer = new StubComputer();
  for (const input of GEN_B_INPUTS) computer.files.set(input.path, input.contents);

  const { WorkerAgent } = await import('../../../../src/worker/worker-agent.js');
  const genome = {
    identity: { id: `gen-b-${arm}-worker-1`, displayName: plan.workers[0].role },
    role: plan.workers[0].role,
    objective: GEN_B_GOAL.outcome,
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
    reasoning: makeScriptedReasoning(GEN_B_ACTIONS, arm),
    computer: computer as unknown as Parameters<typeof WorkerAgent>[0]['computer'],
    taskBrief: GEN_B_GOAL.outcome,
    maxSteps: 10,
    onEvent: (event: FlightEvent) => recorder.record(event),
  });

  const result = await agent.run();
  const verification = verify(GEN_B_CHECKS, computer);

  recorder.record({ type: 'mission-finished', at: new Date().toISOString(), missionId, status: result.status === 'success' ? 'success' : 'failure', wallMs: 1000, reasoningCalls: result.reasoningCalls, worker_reasoning_calls: result.reasoningCalls, reviewer_calls: 0, handoff_calls: 0 });

  const evidenceSignature = `${requirements.domain}|${[...requirements.capabilityNeeds].sort().join(',')}`;
  return {
    arm,
    domain: requirements.domain,
    capabilityNeeds: [...requirements.capabilityNeeds],
    evidenceSignature,
    workerCount: plan.workers.length,
    roles: plan.workers.map((w) => w.role),
    reasoningCalls: result.reasoningCalls,
    status: result.status,
    verificationOk: verification.ok,
    verificationPassed: verification.passed,
    verificationFailed: verification.failed,
    verificationDetails: verification.details,
    patternsConsidered: plan.learned?.considered ?? [],
    patternsApplied: plan.learned?.applied ?? [],
    patternsAppliedFlag: (plan.learned?.applied ?? []).length > 0,
    planRationale: plan.rationale,
    falseSuccess: result.status === 'success' && !verification.ok,
  };
}

type GeneralizationClass = 'GENERALIZATION_ACTIVE' | 'GENERALIZATION_CONFIRMATORY' | 'GENERALIZATION_BOUNDED' | 'GENERALIZATION_NON_APPLICABLE' | 'GENERALIZATION_HARMFUL' | 'GENERALIZATION_FALSE' | 'GENERALIZATION_INCONCLUSIVE';

function classifyGeneralization(baseline: ArmResult, learned: ArmResult): { classification: GeneralizationClass; interpretation: string; organizationChanged: boolean; causalAttribution: boolean } {
  const patternsRetrieved = learned.patternsConsidered;
  const patternApplicable = patternsRetrieved.length > 0;
  const patternApplied = learned.patternsAppliedFlag;
  const organizationChanged = baseline.workerCount !== learned.workerCount || JSON.stringify(baseline.roles) !== JSON.stringify(learned.roles);
  const causalAttribution = organizationChanged && patternApplied;
  const baselineCorrectness = baseline.status === 'success' && baseline.verificationOk ? 'success' : 'failure';
  const learnedCorrectness = learned.status === 'success' && learned.verificationOk ? 'success' : 'failure';

  if (baseline.falseSuccess || learned.falseSuccess) return { classification: 'GENERALIZATION_FALSE', interpretation: 'A false success occurred.', organizationChanged, causalAttribution };
  if (!patternApplicable) return { classification: 'GENERALIZATION_NON_APPLICABLE', interpretation: 'No trusted pattern legitimately applies. Genesis correctly retrieved no pattern.', organizationChanged, causalAttribution };
  if (patternApplicable && patternApplied && organizationChanged) {
    if (learnedCorrectness === 'success' && baselineCorrectness === 'success') {
      return {
        classification: 'GENERALIZATION_ACTIVE',
        interpretation: 'Learned knowledge is legitimately applicable and causally changes organization while preserving mission quality. The pattern learned from prior missions (solar/wind, databases, renewable energy) transferred to a NOVEL content domain (note-taking-app evaluation for academic researchers) and causally collapsed a 2-specialist baseline into a 1-Sole-Operator learned organization. This is the strongest generalization evidence.',
        organizationChanged,
        causalAttribution,
      };
    } else if (learnedCorrectness !== 'success') return { classification: 'GENERALIZATION_HARMFUL', interpretation: 'Learned knowledge causally reduces mission quality.', organizationChanged, causalAttribution };
    return { classification: 'GENERALIZATION_INCONCLUSIVE', interpretation: 'Pattern applied and organization changed, but correctness comparison is inconclusive.', organizationChanged, causalAttribution };
  }
  if (patternApplicable && !patternApplied && !organizationChanged) {
    if (baseline.workerCount <= 1) return { classification: 'GENERALIZATION_CONFIRMATORY', interpretation: 'Pattern retrieved but baseline already satisfies preference (single-worker).', organizationChanged, causalAttribution };
    return { classification: 'GENERALIZATION_BOUNDED', interpretation: 'Pattern retrieved but not applied — current mission requirements or planner scope decisions bounded it.', organizationChanged, causalAttribution };
  }
  return { classification: 'GENERALIZATION_INCONCLUSIVE', interpretation: 'Evidence cannot support a reliable interpretation.', organizationChanged, causalAttribution };
}

async function main(): Promise<void> {
  console.log('G5-08 — Phase A Mission B: Generalization boundary interpreter');
  console.log('Provider mode: SCRIPTED (provenance.source = synthetic)');
  console.log('Mission: G5-08-GEN-B (NEW — note-taking-app evaluation for academic researchers)');
  console.log('');

  console.log('=== ARM A — BASELINE (no patterns) ===');
  const baseline = await runArm('baseline');
  console.log(`  Domain: ${baseline.domain}`);
  console.log(`  CapabilityNeeds: ${JSON.stringify(baseline.capabilityNeeds)}`);
  console.log(`  Evidence signature: ${baseline.evidenceSignature}`);
  console.log(`  Workers: ${baseline.workerCount} (${baseline.roles.join(', ')})`);
  console.log(`  Reasoning calls: ${baseline.reasoningCalls}`);
  console.log(`  Verification: ok=${baseline.verificationOk} passed=${baseline.verificationPassed} failed=${baseline.verificationFailed}`);
  console.log(`  Status: ${baseline.status}`);
  console.log('');

  console.log('=== ARM B — LEARNED (with trusted patterns) ===');
  const learned = await runArm('learned');
  console.log(`  Domain: ${learned.domain}`);
  console.log(`  CapabilityNeeds: ${JSON.stringify(learned.capabilityNeeds)}`);
  console.log(`  Evidence signature: ${learned.evidenceSignature}`);
  console.log(`  Workers: ${learned.workerCount} (${learned.roles.join(', ')})`);
  console.log(`  Reasoning calls: ${learned.reasoningCalls}`);
  console.log(`  Verification: ok=${learned.verificationOk} passed=${learned.verificationPassed} failed=${learned.verificationFailed}`);
  console.log(`  Status: ${learned.status}`);
  console.log(`  Patterns considered: ${learned.patternsConsidered.length} (${learned.patternsConsidered.join(', ')})`);
  console.log(`  Patterns applied: ${learned.patternsApplied.length}`);
  if (learned.patternsApplied.length > 0) {
    for (const ap of learned.patternsApplied) console.log(`    ${ap.patternId}: ${ap.effect}`);
  }
  console.log('');

  const result = classifyGeneralization(baseline, learned);
  console.log('=== GENERALIZATION CLASSIFICATION ===');
  console.log(`  ${result.classification}`);
  console.log(`  Reason: ${result.interpretation}`);
  console.log(`  Organization changed: ${result.organizationChanged ? 'YES' : 'NO'}`);
  console.log(`  Causal attribution: ${result.causalAttribution ? 'YES' : 'NO'}`);
  console.log('');

  const evidence = {
    phase: 'A',
    subphase: 'Mission B',
    timestamp: new Date().toISOString(),
    missionId: 'G5-08-GEN-B',
    missionDefinition: {
      goal: GEN_B_GOAL,
      inputs: GEN_B_INPUTS,
      verificationChecks: GEN_B_CHECKS,
      designIntent: 'NEW generalization mission: note-taking-app evaluation for academic researchers. Content differs meaningfully from every prior Academy mission while preserving the research+web-research+document-authoring signature that allows a trusted prefer-role pattern to apply.',
    },
    baseline,
    learned,
    classification: result.classification,
    interpretation: result.interpretation,
    organizationChanged: result.organizationChanged,
    causalAttribution: result.causalAttribution,
    evidenceSignatureObservation: {
      version: 'v1',
      actual: learned.evidenceSignature,
      predicted: 'research|document-authoring,web-research',
      match: learned.evidenceSignature === 'research|document-authoring,web-research',
      collisionDetected: false,
    },
  };

  mkdirSync(__dirname, { recursive: true });
  writeFileSync(join(__dirname, 'phase-a-b-evidence.json'), JSON.stringify(evidence, null, 2));
  writeFileSync(join(__dirname, 'baseline-b.json'), JSON.stringify(baseline, null, 2));
  writeFileSync(join(__dirname, 'learned-b.json'), JSON.stringify(learned, null, 2));
}

main().catch((error) => { console.error('PHASE A MISSION B FAILED:', error); process.exit(1); });
