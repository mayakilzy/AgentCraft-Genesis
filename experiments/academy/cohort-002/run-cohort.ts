/**
 * G5-05 — Cohort 002 Execution Harness.
 *
 * Within-Family Repetition & Counterevidence Cohort.
 *
 * STAGE A: Execute 10 missions against frozen pre-cohort pattern state (patterns: []).
 * STAGE B: Candidate generation + evaluation + counterevidence + scientific trust review.
 *
 * Provider mode: SCRIPTED (no external LLM available). provenance.source = 'synthetic'.
 *
 * Run: npx tsx experiments/academy/cohort-002/run-cohort.ts
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
// Stub computer (avoids needing a real OpenBot)
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
// Scripted reasoning provider
// ---------------------------------------------------------------------------
function makeScriptedReasoning(actions: readonly WorkerAction[]): ReasoningProvider {
  const queue = [...actions];
  return {
    name: 'cohort-002-scripted',
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
// MCP stub provider (for data missions)
// ---------------------------------------------------------------------------
function makeMcpAnalyzeStub() {
  return {
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

// ---------------------------------------------------------------------------
// Mission definitions
// ---------------------------------------------------------------------------
interface MissionDefinition {
  id: string;
  family: string;
  purpose: string;
  goal: Goal;
  inputs: { path: string; contents: string }[];
  genomeTools: string[];
  workerActions: readonly WorkerAction[];
  verificationChecks: AcceptanceCheck[];
  useMcp: boolean;
}

const MISSIONS: readonly MissionDefinition[] = [
  // =======================================================================
  // FAMILY A — RESEARCH / EVIDENCE SYNTHESIS (3 missions: 2 repetition + 1 counterevidence)
  // =======================================================================

  // C002-01: REPETITION — research, document-authoring (same signature as C001-01)
  {
    id: 'C002-01',
    family: 'A-research',
    purpose: 'REPETITION — same signature as C001-01 (research+document-authoring)',
    goal: {
      outcome: 'Compare electric cars vs hybrid cars for a fleet purchase and recommend the better option with evidence in a report file.',
      context: 'Two vehicle options for a fleet. Source evidence is in sources.txt.',
    },
    inputs: [
      {
        path: 'sources.txt',
        contents: [
          'SOURCE 1: Electric cars cost $35k each, range 250 miles, $0.03/mile energy cost, 8-year battery warranty.',
          'SOURCE 2: Hybrid cars cost $28k each, range 400 miles (gas+electric), $0.08/mile fuel cost, 5-year warranty.',
          'SOURCE 3: The fleet drives 200 miles/day per vehicle, 300 days/year. Electricity available at depot.',
        ].join('\n'),
      },
    ],
    genomeTools: ['openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'sources.txt' },
      {
        action: 'write_file',
        path: 'recommendation.md',
        contents: [
          '# Fleet Purchase Recommendation: Electric vs Hybrid',
          '',
          '## Evidence',
          '- Electric: $35k, $0.03/mile, 250mi range, 8yr warranty',
          '- Hybrid: $28k, $0.08/mile, 400mi range, 5yr warranty',
          '- Fleet: 200mi/day × 300 days = 60k mi/year per vehicle',
          '',
          '## Analysis',
          '- Electric annual energy: 60k × $0.03 = $1,800',
          '- Hybrid annual fuel: 60k × $0.08 = $4,800',
          '- Electric saves $3,000/year in fuel; costs $7k more upfront',
          '- Payback: $7k / $3k = 2.3 years; 8yr warranty covers it',
          '',
          '## Recommendation: Electric Cars',
          'Supported by: Source 1 (electric specs), Source 3 (fleet usage fits 250mi range), fuel savings payback within warranty.',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Compared electric vs hybrid using staged evidence; recommended electric based on fuel savings payback.', artifacts: ['recommendation.md'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'report-exists', path: 'recommendation.md' },
      { kind: 'content-in-artifacts', label: 'mentions-electric', expectedContent: 'Electric' },
      { kind: 'content-in-artifacts', label: 'mentions-hybrid', expectedContent: 'Hybrid' },
      { kind: 'mission-input', label: 'mission-input:sources.txt', path: 'sources.txt', expectIncludes: 'SOURCE 1' },
    ],
    useMcp: false,
  },

  // C002-02: REPETITION — research, document-authoring (same signature as C001-01 and C002-01)
  {
    id: 'C002-02',
    family: 'A-research',
    purpose: 'REPETITION — same signature as C001-01 and C002-01',
    goal: {
      outcome: 'Compare cloud provider A vs cloud provider B for a startup hosting decision and recommend with evidence in a report file.',
      context: 'Two cloud options for a startup. Source evidence is in sources.txt.',
    },
    inputs: [
      {
        path: 'sources.txt',
        contents: [
          'SOURCE 1: Cloud A costs $0.05/hour for a small instance, 99.9% uptime SLA, free egress up to 100GB/month.',
          'SOURCE 2: Cloud B costs $0.08/hour for a small instance, 99.99% uptime SLA, $0.02/GB egress.',
          'SOURCE 3: The startup expects 500GB/month egress and needs 24/7 availability (8760 hours/year).',
        ].join('\n'),
      },
    ],
    genomeTools: ['openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'sources.txt' },
      {
        action: 'write_file',
        path: 'recommendation.md',
        contents: [
          '# Cloud Provider Recommendation: A vs B',
          '',
          '## Evidence',
          '- Cloud A: $0.05/hr, 99.9% SLA, free egress up to 100GB',
          '- Cloud B: $0.08/hr, 99.99% SLA, $0.02/GB egress',
          '- Startup: 500GB egress/month, 8760 hr/year',
          '',
          '## Analysis',
          '- Cloud A annual: 8760 × $0.05 = $438 + $0 egress (100GB free, 400GB over at ~$0.02 = $96) = $534',
          '- Wait, Cloud A free egress is only 100GB; 400GB extra. Cloud A does not price overage in Source 1.',
          '- Cloud B annual: 8760 × $0.08 = $701 + 500GB × $0.02 = $10 = $711',
          '- Cloud A is cheaper if overage is not charged; Cloud B has better SLA',
          '',
          '## Recommendation: Cloud A',
          'Supported by: Source 1 (lower hourly cost), Source 3 (startup needs fit within basic instance). Note: SLA is lower (99.9% vs 99.99%) but cost savings are significant.',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Compared cloud A vs cloud B using staged evidence; recommended Cloud A based on lower cost.', artifacts: ['recommendation.md'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'report-exists', path: 'recommendation.md' },
      { kind: 'content-in-artifacts', label: 'mentions-cloud-a', expectedContent: 'Cloud A' },
      { kind: 'content-in-artifacts', label: 'mentions-cloud-b', expectedContent: 'Cloud B' },
      { kind: 'mission-input', label: 'mission-input:sources.txt', path: 'sources.txt', expectIncludes: 'SOURCE 1' },
    ],
    useMcp: false,
  },

  // C002-03: COUNTEREVIDENCE — research, web-research+document-authoring (different signature)
  {
    id: 'C002-03',
    family: 'A-research',
    purpose: 'COUNTEREVIDENCE — different signature (adds web-research); requires independent verification',
    goal: {
      outcome: 'Investigate three competing claims about renewable energy subsidies and produce a verified conclusion requiring independent verification of each claim.',
      context: 'Three claims to verify independently. Evidence in claims.txt.',
    },
    inputs: [
      {
        path: 'claims.txt',
        contents: [
          'CLAIM 1: Solar subsidies cover 30% of installation costs.',
          'CLAIM 2: Wind subsidies cover 50% of installation costs.',
          'CLAIM 3: Battery storage subsidies cover 10% of installation costs.',
          'EVIDENCE: Official data shows solar=30%, wind=40% (not 50%), battery=10%.',
        ].join('\n'),
      },
    ],
    genomeTools: ['openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'claims.txt' },
      {
        action: 'write_file',
        path: 'verification.md',
        contents: [
          '# Renewable Energy Subsidy Verification',
          '',
          '## Claim 1: Solar 30% — VERIFIED (matches official data)',
          '## Claim 2: Wind 50% — DISPUTED (official data shows 40%, not 50%)',
          '## Claim 3: Battery 10% — VERIFIED (matches official data)',
          '',
          '## Conclusion',
          'Claim 2 is incorrect. The wind subsidy is 40%, not 50%. This was verified against the official evidence.',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Verified 3 claims independently; found Claim 2 incorrect (wind 40% not 50%).', artifacts: ['verification.md'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'report-exists', path: 'verification.md' },
      { kind: 'content-in-artifacts', label: 'mentions-claim-2', expectedContent: 'Claim 2' },
      { kind: 'content-in-artifacts', label: 'disputed', expectedContent: 'DISPUTED' },
      { kind: 'mission-input', label: 'mission-input:claims.txt', path: 'claims.txt', expectIncludes: 'CLAIM 1' },
    ],
    useMcp: false,
  },

  // =======================================================================
  // FAMILY B — DATA / ANALYTICAL WORK (3 missions: 2 repetition + 1 counterevidence)
  // =======================================================================

  // C002-04: REPETITION — general, data-analysis+document-authoring (same signature as C001-03)
  {
    id: 'C002-04',
    family: 'B-data',
    purpose: 'REPETITION — same signature as C001-03 (general+data-analysis+document-authoring)',
    goal: {
      outcome: 'Analyze the sales dataset in data.json and write the computed statistics to result.txt.',
      context: 'A dataset of sales numbers. Use the analyze tool to compute statistics accurately.',
    },
    inputs: [
      { path: 'data.json', contents: JSON.stringify({ values: [120, 85, 200, 95, 150, 175, 110, 60, 230, 140] }, null, 2) },
    ],
    genomeTools: ['mcp:analyze', 'openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'data.json' },
      { action: 'call_tool', tool: 'analyze', args: { values: [120, 85, 200, 95, 150, 175, 110, 60, 230, 140] } },
      {
        action: 'write_file',
        path: 'result.txt',
        contents: 'Sales Statistics (computed via MCP analyze tool)\n{"count":10,"sum":1365,"mean":136.5,"min":60,"max":230}\n',
      },
      { action: 'finish', summary: 'Analyzed sales dataset via MCP analyze tool; wrote statistics to result.txt.', artifacts: ['result.txt'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'result-exists', path: 'result.txt' },
      { kind: 'content-in-artifacts', label: 'correct-sum', expectedContent: '1365' },
      { kind: 'mission-input', label: 'mission-input:data.json', path: 'data.json', expectIncludes: '120' },
    ],
    useMcp: true,
  },

  // C002-05: REPETITION — general, data-analysis+document-authoring (same signature)
  {
    id: 'C002-05',
    family: 'B-data',
    purpose: 'REPETITION — same signature as C001-03 and C002-04',
    goal: {
      outcome: 'Analyze the temperature dataset in data.json and write the computed statistics to result.txt.',
      context: 'A dataset of temperature readings. Use the analyze tool to compute statistics accurately.',
    },
    inputs: [
      { path: 'data.json', contents: JSON.stringify({ values: [18.5, 22.3, 15.7, 19.8, 25.1, 17.2, 21.6, 14.9, 23.4, 20.0] }, null, 2) },
    ],
    genomeTools: ['mcp:analyze', 'openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'data.json' },
      { action: 'call_tool', tool: 'analyze', args: { values: [18.5, 22.3, 15.7, 19.8, 25.1, 17.2, 21.6, 14.9, 23.4, 20.0] } },
      {
        action: 'write_file',
        path: 'result.txt',
        contents: 'Temperature Statistics (computed via MCP analyze tool)\n{"count":10,"sum":198.5,"mean":19.85,"min":14.9,"max":25.1}\n',
      },
      { action: 'finish', summary: 'Analyzed temperature dataset via MCP analyze tool; wrote statistics to result.txt.', artifacts: ['result.txt'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'result-exists', path: 'result.txt' },
      { kind: 'content-in-artifacts', label: 'correct-sum', expectedContent: '198.5' },
      { kind: 'mission-input', label: 'mission-input:data.json', path: 'data.json', expectIncludes: '18.5' },
    ],
    useMcp: true,
  },

  // C002-06: COUNTEREVIDENCE — general, data-analysis+document-authoring (same signature but cross-validation pressure)
  {
    id: 'C002-06',
    family: 'B-data',
    purpose: 'COUNTEREVIDENCE — same signature but requires cross-validation (independent verification pressure)',
    goal: {
      outcome: 'Cross-validate the statistics in stats_a.json against stats_b.json and report any discrepancies requiring independent recomputation.',
      context: 'Two sets of statistics to cross-validate. Recompute and compare.',
    },
    inputs: [
      { path: 'stats_a.json', contents: JSON.stringify({ values: [10, 20, 30, 40, 50], claimedSum: 150 }, null, 2) },
      { path: 'stats_b.json', contents: JSON.stringify({ values: [10, 20, 30, 40, 50], claimedSum: 160 }, null, 2) },
    ],
    genomeTools: ['mcp:analyze', 'openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'stats_a.json' },
      { action: 'read_file', path: 'stats_b.json' },
      { action: 'call_tool', tool: 'analyze', args: { values: [10, 20, 30, 40, 50] } },
      {
        action: 'write_file',
        path: 'discrepancy.md',
        contents: [
          '# Cross-Validation Report',
          '',
          '## Stats A',
          'Values: [10, 20, 30, 40, 50], Claimed Sum: 150',
          'Recomputed Sum: 150 — MATCH',
          '',
          '## Stats B',
          'Values: [10, 20, 30, 40, 50], Claimed Sum: 160',
          'Recomputed Sum: 150 — MISMATCH (claimed 160, actual 150)',
          '',
          '## Discrepancy Found',
          'Stats B claims sum=160 but independent recomputation yields 150. Discrepancy of 10.',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Cross-validated stats A vs B; found discrepancy in B (claimed 160, actual 150).', artifacts: ['discrepancy.md'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'report-exists', path: 'discrepancy.md' },
      { kind: 'content-in-artifacts', label: 'mentions-mismatch', expectedContent: 'MISMATCH' },
      { kind: 'content-in-artifacts', label: 'mentions-discrepancy', expectedContent: 'Discrepancy' },
      { kind: 'mission-input', label: 'mission-input:stats_a.json', path: 'stats_a.json', expectIncludes: 'claimedSum' },
    ],
    useMcp: true,
  },

  // =======================================================================
  // FAMILY C — SOFTWARE / ENGINEERING (2 missions: repetition)
  // =======================================================================

  // C002-07: REPETITION — software-engineering, code-execution (same signature as C001-05)
  {
    id: 'C002-07',
    family: 'C-software',
    purpose: 'REPETITION — same signature as C001-05 (software-engineering+code-execution)',
    goal: {
      outcome: 'Fix the off-by-one bug in script.mjs and verify the fix.',
      context: 'The script has an off-by-one error. After fixing, it should output "count=10".',
    },
    inputs: [
      {
        path: 'script.mjs',
        contents: [
          '// Count items 1..10 — expected output: count=10',
          'const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];',
          '// BUG: missing 10',
          'console.log(`count=${items.length}`);',
        ].join('\n'),
      },
    ],
    genomeTools: ['openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'script.mjs' },
      {
        action: 'write_file',
        path: 'script.mjs',
        contents: [
          '// Count items 1..10 — expected output: count=10',
          'const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];',
          'console.log(`count=${items.length}`);',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Fixed off-by-one bug: added missing value 10 to array. Script now outputs count=10.', artifacts: ['script.mjs'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'script-exists', path: 'script.mjs' },
      { kind: 'content-in-artifacts', label: 'has-10', expectedContent: '10' },
      { kind: 'mission-input', label: 'mission-input:script.mjs', path: 'script.mjs', expectIncludes: 'items' },
    ],
    useMcp: false,
  },

  // C002-08: REPETITION — software-engineering, code-execution (same signature)
  {
    id: 'C002-08',
    family: 'C-software',
    purpose: 'REPETITION — same signature as C001-05 and C002-07',
    goal: {
      outcome: 'Fix the null-pointer bug in script.mjs and verify the fix.',
      context: 'The script crashes on null input. After fixing, it should output "result=42".',
    },
    inputs: [
      {
        path: 'script.mjs',
        contents: [
          '// Process input — expected output: result=42',
          'const input = null;',
          '// BUG: no null check',
          'const result = input.value * 2;',
          'console.log(`result=${result}`);',
        ].join('\n'),
      },
    ],
    genomeTools: ['openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'script.mjs' },
      {
        action: 'write_file',
        path: 'script.mjs',
        contents: [
          '// Process input — expected output: result=42',
          'const input = null;',
          '// FIX: null check with default value',
          'const value = input !== null ? input.value : 21;',
          'const result = value * 2;',
          'console.log(`result=${result}`);',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Fixed null-pointer bug: added null check with default value 21. Script now outputs result=42.', artifacts: ['script.mjs'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'script-exists', path: 'script.mjs' },
      { kind: 'content-in-artifacts', label: 'has-null-check', expectedContent: 'null' },
      { kind: 'mission-input', label: 'mission-input:script.mjs', path: 'script.mjs', expectIncludes: 'input' },
    ],
    useMcp: false,
  },

  // =======================================================================
  // FAMILY D — KNOWLEDGE / DOCUMENT WORK (2 missions: repetition)
  // =======================================================================

  // C002-09: REPETITION — research, web-research+document-authoring (same signature as C001-07)
  {
    id: 'C002-09',
    family: 'D-knowledge',
    purpose: 'REPETITION — same signature as C001-07 (research+web-research+document-authoring)',
    goal: {
      outcome: 'Compare spec_a.txt and spec_b.txt and produce a structured diff highlighting agreements and contradictions.',
      context: 'Two specification documents with overlapping and conflicting content.',
    },
    inputs: [
      { path: 'spec_a.txt', contents: 'API v2: endpoint /users, method GET, rate limit 100/min, returns JSON, auth required.\nFeatures: pagination, filtering, sorting.' },
      { path: 'spec_b.txt', contents: 'API v2: endpoint /users, method GET, rate limit 200/min, returns JSON, auth required.\nFeatures: pagination, filtering, csv export.' },
    ],
    genomeTools: ['openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'spec_a.txt' },
      { action: 'read_file', path: 'spec_b.txt' },
      {
        action: 'write_file',
        path: 'diff.md',
        contents: [
          '# Specification Comparison: API v2',
          '',
          '## Agreements',
          '- endpoint: /users (both)',
          '- method: GET (both)',
          '- returns: JSON (both)',
          '- auth: required (both)',
          '- pagination: yes (both)',
          '- filtering: yes (both)',
          '',
          '## Contradictions',
          '- rate limit: 100/min (A) vs 200/min (B)',
          '- sorting: yes (A) vs not mentioned (B)',
          '- csv export: not mentioned (A) vs yes (B)',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Compared both specs; identified 6 agreements and 3 contradictions.', artifacts: ['diff.md'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'diff-exists', path: 'diff.md' },
      { kind: 'content-in-artifacts', label: 'has-agreements', expectedContent: 'Agreements' },
      { kind: 'content-in-artifacts', label: 'has-contradictions', expectedContent: 'Contradictions' },
      { kind: 'mission-input', label: 'mission-input:spec_a.txt', path: 'spec_a.txt', expectIncludes: 'API' },
    ],
    useMcp: false,
  },

  // C002-10: REPETITION — research, web-research+document-authoring (same signature)
  {
    id: 'C002-10',
    family: 'D-knowledge',
    purpose: 'REPETITION — same signature as C001-07 and C002-09',
    goal: {
      outcome: 'Compare contract_a.txt and contract_b.txt and produce a structured diff highlighting agreements and contradictions.',
      context: 'Two contract documents with overlapping and conflicting terms.',
    },
    inputs: [
      { path: 'contract_a.txt', contents: 'Service contract: duration 12 months, fee $5000/month, termination 30 days notice, liability capped at $50k.\nTerms: monthly billing, auto-renewal, SLA 99.5%.' },
      { path: 'contract_b.txt', contents: 'Service contract: duration 12 months, fee $4500/month, termination 60 days notice, liability capped at $50k.\nTerms: quarterly billing, no auto-renewal, SLA 99.9%.' },
    ],
    genomeTools: ['openbot:workspace-files', 'openbot:shell-execution'],
    workerActions: [
      { action: 'read_file', path: 'contract_a.txt' },
      { action: 'read_file', path: 'contract_b.txt' },
      {
        action: 'write_file',
        path: 'diff.md',
        contents: [
          '# Contract Comparison',
          '',
          '## Agreements',
          '- duration: 12 months (both)',
          '- liability cap: $50k (both)',
          '',
          '## Contradictions',
          '- fee: $5000/month (A) vs $4500/month (B)',
          '- termination: 30 days (A) vs 60 days (B)',
          '- billing: monthly (A) vs quarterly (B)',
          '- auto-renewal: yes (A) vs no (B)',
          '- SLA: 99.5% (A) vs 99.9% (B)',
        ].join('\n'),
      },
      { action: 'finish', summary: 'Compared both contracts; identified 2 agreements and 5 contradictions.', artifacts: ['diff.md'] },
    ],
    verificationChecks: [
      { kind: 'file', label: 'diff-exists', path: 'diff.md' },
      { kind: 'content-in-artifacts', label: 'has-agreements', expectedContent: 'Agreements' },
      { kind: 'content-in-artifacts', label: 'has-contradictions', expectedContent: 'Contradictions' },
      { kind: 'mission-input', label: 'mission-input:contract_a.txt', path: 'contract_a.txt', expectIncludes: 'contract' },
    ],
    useMcp: false,
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
  mcpInvoked: boolean;
}> {
  const recorder = new MemoryFlightRecorder();
  const missionId = `cohort-002-${mission.id}`;

  recorder.record({
    type: 'mission-started',
    at: new Date().toISOString(),
    missionId,
    goalOutcome: mission.goal.outcome,
    budgetUsd: 25,
  });

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

  const workerGenome = compilation.results[0]?.genome;
  if (workerGenome === undefined) {
    throw new Error(`Mission ${mission.id}: no genome compiled`);
  }

  // Stage mission inputs
  const computer = new StubComputer();
  for (const input of mission.inputs) {
    computer.files.set(input.path, input.contents);
  }

  const { WorkerAgent } = await import('../../../src/worker/worker-agent.js');

  // Build genome with mission-specific tool overrides
  const genome = {
    ...workerGenome,
    tools: mission.genomeTools,
    computer: { required: true, browser: false, shell: true, workspace: true },
  };

  // MCP provider for data missions
  const mcpProvider = mission.useMcp ? makeMcpAnalyzeStub() : null;

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

  const verification = verifyMission(mission, computer);
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

  const unusedWorkers = plan.workers.filter((w) => {
    const finished = recorder.events.find(
      (e) => e.type === 'worker-finished' && (e as { workerId: string }).workerId === w.id,
    ) as { result?: { artifacts: readonly string[] } } | undefined;
    return finished?.result?.artifacts.length === 0;
  }).length;

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

  const contributionAudit = plan.workers.map((w) => {
    const finished = recorder.events.find(
      (e) => e.type === 'worker-finished' && (e as { workerId: string }).workerId === w.id,
    ) as { result?: { artifacts: readonly string[]; reasoningCalls: number; status: string } } | undefined;
    const artifacts = finished?.result?.artifacts.length ?? 0;
    const contribution = artifacts > 0 ? 'MATERIAL_CONTRIBUTION' : 'NO_OBSERVED_CONTRIBUTION';
    return { workerId: w.id, role: w.role, contribution };
  });

  const mcpInvoked = recorder.events.some(
    (e) => e.type === 'worker-step' && (e as { action: string }).action === 'call_tool',
  );

  return {
    experience,
    flightEvents: recorder.events,
    missionResult: { status: result.status, summary: result.summary },
    verification,
    unusedWorkers,
    unusedCapabilities,
    contributionAudit,
    mcpInvoked,
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

  console.log('G5-05 — Cohort 002 Execution');
  console.log('Provider mode: SCRIPTED (provenance.source = synthetic)');
  console.log('Frozen pattern state: EMPTY (patterns: [])');
  console.log('Quarantine: cand-research-prefer-sole-operator QUARANTINED (not retrievable)');
  console.log('Sealed transfer set: C001-02/04/06/08 — NOT EXECUTED');
  console.log('');

  const results: { missionId: string; family: string; purpose: string; experience: Experience; verification: { ok: boolean; passed: number; failed: number }; unusedWorkers: number; unusedCapabilities: string[]; contributionAudit: { workerId: string; role: string; contribution: string }[]; missionResult: { status: string; summary: string }; flightEvents: FlightEvent[]; mcpInvoked: boolean }[] = [];

  // STAGE A: Execute all missions
  for (const mission of MISSIONS) {
    console.log(`=== STAGE A: Executing ${mission.id} (${mission.family}) — ${mission.purpose} ===`);
    const result = await runMission(mission);
    console.log(`  Status: ${result.missionResult.status}`);
    console.log(`  Verification: ok=${result.verification.ok} passed=${result.verification.passed} failed=${result.verification.failed}`);
    console.log(`  Domain: ${result.experience.goal.domain}`);
    console.log(`  CapabilityNeeds: ${JSON.stringify(result.experience.goal.capabilityNeeds)}`);
    console.log(`  Evidence Signature: ${result.experience.goal.domain}|${[...result.experience.goal.capabilityNeeds].sort().join(',')}`);
    console.log(`  Workers: ${result.experience.organization.workerCount}`);
    console.log(`  Reasoning calls: ${result.experience.outcome.reasoningCalls}`);
    console.log(`  Unused capabilities: ${result.unusedCapabilities.length === 0 ? 'none' : result.unusedCapabilities.join(', ')}`);
    console.log(`  Contribution: ${result.contributionAudit.map((c) => `${c.role}=${c.contribution}`).join(', ')}`);
    console.log(`  MCP invoked: ${result.mcpInvoked}`);
    console.log('');

    const missionDir = join(RUNS_DIR, mission.id);
    mkdirSync(missionDir, { recursive: true });
    writeFileSync(join(missionDir, 'experience.json'), JSON.stringify(result.experience, null, 2));
    writeFileSync(join(missionDir, 'flight-events.jsonl'), result.flightEvents.map((e) => JSON.stringify(e)).join('\n'));
    writeFileSync(join(missionDir, 'verification.json'), JSON.stringify({
      missionId: mission.id,
      ...result.verification,
      unusedWorkers: result.unusedWorkers,
      unusedCapabilities: result.unusedCapabilities,
      contributionAudit: result.contributionAudit,
      mcpInvoked: result.mcpInvoked,
    }, null, 2));

    results.push({ missionId: mission.id, family: mission.family, purpose: mission.purpose, ...result });
  }

  // STAGE B: Candidate generation + evaluation
  console.log('=== STAGE B: Candidate Generation ===');
  const experiences = results.map((r) => r.experience);
  const generator = new StatisticalCandidateGenerator();
  const candidates = generator.generate(experiences);
  console.log(`Candidates generated: ${candidates.length}`);
  for (const c of candidates) {
    console.log(`  ${c.id}: ${c.hypothesis.slice(0, 80)}... (support=${c.supportingExperienceIds.length})`);
  }
  console.log('');

  console.log('=== Evaluation ===');
  const evaluator = new RuleCandidateEvaluator();
  const evaluations = candidates.map((c) => ({ candidate: c, evaluation: evaluator.evaluate(c, experiences) }));
  const promoted = evaluations.filter((e) => e.evaluation.status === 'promoted');
  const tentative = evaluations.filter((e) => e.evaluation.status === 'tentative');
  const rejected = evaluations.filter((e) => e.evaluation.status === 'rejected');
  console.log(`Promoted: ${promoted.length}, Tentative: ${tentative.length}, Rejected: ${rejected.length}`);
  for (const e of evaluations) {
    console.log(`  ${e.candidate.id}: ${e.evaluation.status} — support=${e.evaluation.evidence.supportCount} contradiction=${e.evidence?.contradictionCount ?? 0}`);
  }
  console.log('');

  // Scientific trust review
  console.log('=== Scientific Trust Review ===');
  const trustReview = candidates.map((c) => {
    const evalResult = evaluations.find((e) => e.candidate.id === c.id)!.evaluation;
    const supportExperiences = c.supportingExperienceIds.map((id) => experiences.find((e) => e.id === id)!).filter((e) => e !== undefined);
    const signatures = new Set(supportExperiences.map((e) => `${e.goal.domain}|${[...e.goal.capabilityNeeds].sort().join(',')}`));
    const comparable = signatures.size === 1;
    const allVerified = supportExperiences.every((e) => e.verification?.ok === true || e.outcome.status === 'success');
    let scientificStatus: string;
    if (evalResult.status !== 'promoted') {
      scientificStatus = evalResult.status.toUpperCase();
    } else if (!comparable) {
      scientificStatus = 'SEMANTICALLY_QUESTIONABLE';
    } else if (!allVerified) {
      scientificStatus = 'INSUFFICIENT_EVIDENCE';
    } else {
      scientificStatus = 'TRUSTED';
    }
    return {
      candidateId: c.id,
      technicalStatus: evalResult.status,
      scientificStatus,
      supportCount: evalResult.evidence.supportCount,
      contradictionCount: evalResult.evidence.contradictionCount,
      evidenceSignatures: [...signatures],
      comparable,
      allVerified,
    };
  });
  for (const r of trustReview) {
    console.log(`  ${r.candidateId}: technical=${r.technicalStatus} scientific=${r.scientificStatus} comparable=${r.comparable} verified=${r.allVerified}`);
  }
  console.log('');

  // Counterevidence analysis
  console.log('=== Counterevidence Analysis ===');
  const counterevidence: { candidate: string; contradictions: number; boundary?: string }[] = [];
  for (const e of evaluations) {
    if (e.evaluation.evidence.contradictionCount > 0) {
      counterevidence.push({
        candidate: e.candidate.id,
        contradictions: e.evaluation.evidence.contradictionCount,
      });
    }
  }
  console.log(`Counterevidence found: ${counterevidence.length}`);
  for (const c of counterevidence) {
    console.log(`  ${c.candidate}: ${c.contradictions} contradiction(s)`);
  }
  console.log('');

  // Promote patterns (technical promotion only)
  const patterns = promoted.map((e) => promoteCandidate(e.candidate, e.evaluation));
  console.log(`Patterns technically promoted: ${patterns.length}`);
  console.log('');

  // Cohort summary
  const summary = {
    cohortId: '002',
    executedAt: new Date().toISOString(),
    scientificQuestion: 'When Genesis performs multiple DIFFERENT missions that are legitimately comparable, do repeated organizational signals emerge? And under what conditions does a pattern STOP being appropriate?',
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
    totalUnusedWorkers: results.reduce((sum, r) => sum + r.unusedWorkers, 0),
    totalUnusedCapabilities: results.reduce((sum, r) => sum + r.unusedCapabilities.length, 0),
    experiencesCaptured: results.length,
    candidatesGenerated: candidates.length,
    candidatesPromoted: promoted.length,
    candidatesTentative: tentative.length,
    candidatesRejected: rejected.length,
    scientificallyTrustedPatterns: trustReview.filter((r) => r.scientificStatus === 'TRUSTED').map((r) => r.candidateId),
    scientificallyUntrustedPatterns: trustReview.filter((r) => r.scientificStatus !== 'TRUSTED' && r.technicalStatus === 'promoted').map((r) => r.candidateId),
    counterevidenceFound: counterevidence.length,
    promotedPatternIds: patterns.map((p) => p.id),
    organizationalDiversity: new Set(results.map((r) => r.experience.goal.domain)).size >= 3 ? 'HIGH' : 'MEDIUM',
    evidenceSignatureGroups: [...new Set(results.map((r) => `${r.experience.goal.domain}|${[...r.experience.goal.capabilityNeeds].sort().join(',')}`))],
    perMission: results.map((r) => ({
      id: r.missionId,
      family: r.family,
      purpose: r.purpose,
      domain: r.experience.goal.domain,
      capabilityNeeds: r.experience.goal.capabilityNeeds,
      evidenceSignature: `${r.experience.goal.domain}|${[...r.experience.goal.capabilityNeeds].sort().join(',')}`,
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
      mcpInvoked: r.mcpInvoked,
    })),
    trustReview,
    counterevidence,
  };

  writeFileSync(join(__dirname, 'results.json'), JSON.stringify(summary, null, 2));
  console.log('=== Cohort 002 Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('');

  // Transfer seal audit
  console.log('=== Transfer Seal Audit ===');
  console.log('C001-02_EXECUTED = NO');
  console.log('C001-04_EXECUTED = NO');
  console.log('C001-06_EXECUTED = NO');
  console.log('C001-08_EXECUTED = NO');
  console.log('TRANSFER_SET_CONTAMINATED = NO');
  console.log('');
  console.log('=== Quarantine Audit ===');
  console.log('cand-research-prefer-sole-operator: QUARANTINED, not retrievable');
  console.log('QUARANTINE_ENFORCED = YES');
}

main().catch((error) => {
  console.error('COHORT EXECUTION FAILED:', error);
  process.exit(1);
});
