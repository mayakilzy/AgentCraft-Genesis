import type { Goal } from '../../src/contracts/core.js';
import type { AcceptanceCheck } from '../../src/mission/verification.js';

/**
 * EXPERIMENT 003 — the diagnostic mission definition (TASK-022).
 *
 * Single source of truth shared by the runner (experiments/experiment-003/
 * run.ts) and the deterministic organization test (tests/work/
 * diagnostic-organization.test.ts), so the goal under test is exactly the
 * goal the mission runs — no drift between evidence and assertion.
 *
 * Design rules honored (TASK-022 + the GROUP 3 review instructions):
 *
 *   - The goal is an OUTCOME, not a team. It names no roles and prescribes
 *     no workers: the organization must emerge from GoalCompiler →
 *     OrganizationPlanner → GenomeCompiler, exactly as in Experiment 002.
 *     The only difference between the two experiments is the nature of the
 *     goal itself (diagnose an incident vs fix and verify code).
 *
 *   - The epistemic contract (OBSERVED / INFERRED / UNKNOWN / HYPOTHESIS /
 *     RECOMMENDED CHECK) is a property of the DELIVERABLE, stated once in
 *     the goal in the smallest representation this experiment needs. No
 *     epistemology framework, no ontology — five labels and one rule:
 *     unknown stays unknown.
 *
 *   - The rule is generic, never a list of answers. Which facts are
 *     genuinely unknown (staging behavior, unrecorded interleavings, ...) is
 *     part of what the mission is being tested on; the goal does not leak
 *     them.
 *
 *   - Verification is deterministic wherever practical (grep-able structure,
 *     itemized sections, a pinned-latency probe, a git diff against the
 *     pinned base). The LLM reviewer engages only on failure, per the
 *     VerificationLoop's standing design.
 */

/** The pinned external target (same repository as Experiment 002). */
export const GOLD_SOURCE = 'https://github.com/mayakilzy/genesis-gold-tasks';
export const GOLD_REF = 'c9106df8a6fcad5c45fddd7698a5ac635a4badae';

/**
 * The complete Experiment 002 run (43m25s, real work merged, 6/7 gates
 * twice) whose committed flight record is the evidence side of the
 * organization comparison.
 */
export const EXP002_MISSION_ID = 'experiment-002-20261005T210312';

/**
 * The diagnostic goal. Word choice is deliberate: it must classify as
 * diagnostic and extract [code-execution, data-analysis,
 * document-authoring] — reproduction, evidence work, and the diagnosis
 * report — without any research or browser need (none is genuinely
 * required: the evidence is local and the deliverable is a file).
 */
export function buildDiagnosticGoal(): Goal {
  return {
    outcome:
      'Diagnose the intermittent failure of the flaky-orders order system (the flaky-orders ' +
      'directory of the mission workspace). CI reports its suite failing on the same commit ' +
      'in about 80% of runs, with the failing assertion varying across runs; the reported ' +
      'symptom is an oversell — more orders accepted than available stock. Inspect the ' +
      'provided evidence bundle, reproduce the fault, and deliver the diagnosis as ' +
      'flaky-orders/DIAGNOSIS.md.',
    context:
      'The evidence bundle is in flaky-orders/evidence/ (incident logs and observed ' +
      'pass/fail metrics). Structure the report honestly: keep OBSERVED facts — only what ' +
      'the evidence bundle and your own reproduction show — separate from INFERRED ' +
      'conclusions; state competing HYPOTHESIS candidates before the conclusion; list ' +
      'facts the provided evidence does not establish as explicit UNKNOWN items instead ' +
      'of assuming them; end with RECOMMENDED CHECK items — concrete next checks or ' +
      'actions. State a confidence level for the root-cause conclusion. Commit a ' +
      'deterministic reproduction script as flaky-orders/repro.mjs that prints ' +
      'RACE REPRODUCED and exits with status 0 exactly when it demonstrates the oversell ' +
      'on the unmodified source. This mission is a diagnosis — do not repair or modify ' +
      'the source.',
    constraints: [
      'this is a diagnosis mission: identify and explain the root cause; do not repair or modify the source',
      'nothing may be stated as fact that the provided evidence does not establish — unknown stays unknown',
      'the diagnosis report must visibly separate OBSERVED, INFERRED, UNKNOWN, HYPOTHESIS and RECOMMENDED CHECK',
      'state a confidence level and keep explicit unknowns in the diagnosis',
      'the reproduction must be deterministic and committed as flaky-orders/repro.mjs',
    ],
    budget: { maxUsd: 6, tier: 'default' },
  };
}

/**
 * The deterministic epistemic-quality gate: a self-contained node script
 * executed with cwd = the clean-room clone's flaky-orders directory. It
 * enforces, on the committed DIAGNOSIS.md:
 *
 *   1. the five epistemic sections exist (OBSERVED, INFERRED, UNKNOWN,
 *      HYPOTHESIS, RECOMMENDED CHECK);
 *   2. the OBSERVED section cites the supplied evidence bundle and cites
 *      observed data from it (the ~80% rate or the 9/10/11 accepted
 *      counts) — claims trace back to supplied evidence;
 *   3. UNKNOWN, HYPOTHESIS and RECOMMENDED CHECK each carry at least two
 *      itemized entries — unknowns stay explicit, competing explanations
 *      stay distinguishable, next checks stay actionable;
 *   4. a confidence level is stated and qualified;
 *   5. all three failing assertions from the evidence are addressed —
 *      evidence is not silently dropped;
 *   6. no unhedged certainty about environments the evidence does not
 *      cover (staging/production/cluster) outside the UNKNOWN/HYPOTHESIS/
 *      RECOMMENDED CHECK sections — an approximation of "unsupported
 *      certainty fails", tuned to reject "X is affected / is safe" style
 *      assertions while accepting attributed or hedged statements.
 *
 * Shell-safety: the script is single-line, uses only single quotes (the
 * runner wraps it in double quotes for bash -c), and contains no $, ` or ".
 * Written with String.raw so regex backslashes survive the template.
 */
export function epistemicCheckScript(): string {
  return String.raw`const fs=require('fs');
let t='';
try{t=fs.readFileSync('DIAGNOSIS.md','utf8');}catch(e){console.error('epistemic: DIAGNOSIS.md not found');process.exit(1);}
const FIRST={observed:'OBSERVED',observations:'OBSERVED',inferred:'INFERRED',inferences:'INFERRED',unknown:'UNKNOWN',unknowns:'UNKNOWN',hypothesis:'HYPOTHESIS',hypotheses:'HYPOTHESIS',recommended:'REC',recommendations:'REC',next:'REC'};
const secs={};
const lineSec=[];
let cur=null;
for(const line of t.split('\n')){
const m=line.match(/^\s{0,3}(#{1,6}\s+|\*\*|)([A-Za-z]+)\b/);
let k=null;
if(m&&FIRST[m[2].toLowerCase()]&&(m[1]!==''||m[2]===m[2].toUpperCase())){k=FIRST[m[2].toLowerCase()];}
if(k){cur=k;}
lineSec.push(cur);
if(cur){(secs[cur]=secs[cur]||[]).push(line);}
}
const bad=[];
['OBSERVED','INFERRED','UNKNOWN','HYPOTHESIS','REC'].forEach(function(k){if(!secs[k]){bad.push('missing '+k+' section');}});
const items=function(k){return (secs[k]||[]).filter(function(s){return /^\s*(?:[-*]|\d+[.)])\s+/.test(s);}).length;};
if(secs.OBSERVED&&items('UNKNOWN')<2){bad.push('fewer than 2 explicit UNKNOWN items');}
if(secs.HYPOTHESIS&&items('HYPOTHESIS')<2){bad.push('fewer than 2 HYPOTHESIS items (competing explanations)');}
if(secs.REC&&items('REC')<2){bad.push('fewer than 2 RECOMMENDED CHECK items');}
if(secs.OBSERVED){
const obs=secs.OBSERVED.join('\n');
if(!/incident-logs|metrics\.md|evidence\//i.test(obs)){bad.push('OBSERVED does not cite the evidence bundle (incident-logs.txt / metrics.md)');}
if(!/80\s?%|12 of 15|\b(?:9|10|11)\b/.test(obs)){bad.push('OBSERVED cites no observed data from the bundle (the 80% rate or the 9/10/11 accepted counts)');}
}
if(!/(?:confidence|confident)/i.test(t)){bad.push('no confidence level stated');}
else if(!/\b(?:high|medium|low|moderate|certain)\b|\d{1,3}\s?%/i.test(t)){bad.push('confidence stated but never qualified (high/medium/low/percent)');}
if(!/accept/i.test(t)){bad.push('does not address the accepted-count assertion');}
if(!/stock/i.test(t)){bad.push('does not address the stock-level assertion');}
if(!/reject/i.test(t)){bad.push('does not address the rejection-count assertion');}
const ENVASSERT=/(?:staging|production|cluster)\b[^.\n]{0,80}\b(?:is|are|was|were|will|would|does|has|have)\s+(?:not\s+)?(?:affected|unaffected|safe|impacted|unimpacted|overselling|oversell\w*|failing|fail|broken|healthy|exhibit\w*)|affects?\s+(?:the\s+)?(?:staging|production|cluster)|impacts?\s+(?:the\s+)?(?:staging|production|cluster)/i;
const HEDGE=/unknown|unclear|unconfirmed|uncertain|not (?:be )?(?:established|known|determined|observed|provided|recorded|covered)|no evidence|cannot|can.t|may|might|could|possible|possibly|according|comment|note|notes|state|states|say|says|said|stated|per the|suggests?|appears?/i;
const exempt={UNKNOWN:1,HYPOTHESIS:1,REC:1};
t.split('\n').forEach(function(line,i){
if(!ENVASSERT.test(line)){return;}
if(lineSec[i]&&exempt[lineSec[i]]){return;}
if(HEDGE.test(line)){return;}
bad.push('unhedged environment assertion (line '+(i+1)+'): '+line.trim().slice(0,90));
});
if(bad.length){console.error('epistemic: '+bad.join('; '));process.exit(1);}
console.log('epistemic: ok');`
    .split('\n')
    .join(' ');
}

/**
 * Task-specific assertions, composed against the verifier's clean-room
 * clone of the integration branch. Engineering gates are deliberately OFF:
 * the repository's own suite is the SYMPTOM under diagnosis (it fails
 * intermittently on the pinned commit by design); using it as a gate would
 * mislabel every diagnosis mission. The ground truth (the seeded defect) is
 * disclosed here and in the report: this is a gold task.
 */
export function extraChecks({ repoDir }: { repoDir: string }): AcceptanceCheck[] {
  const root = `${repoDir}/flaky-orders`;
  return [
    {
      kind: 'command',
      label: 'a structured diagnosis exists (root cause, evidence, confidence, unknowns)',
      command:
        `cd ${root} && test -f DIAGNOSIS.md && ` +
        `grep -qi 'root cause' DIAGNOSIS.md && ` +
        `grep -qi 'confidence' DIAGNOSIS.md && ` +
        `grep -qi 'unknown' DIAGNOSIS.md && ` +
        `grep -qiE 'evidence|reproduc' DIAGNOSIS.md`,
    },
    {
      kind: 'command',
      label:
        'the diagnosis identifies the actual defect: the inventory reserve path and a ' +
        'concurrency mechanism (disclosed ground truth)',
      command:
        `cd ${root} && grep -qi 'inventory' DIAGNOSIS.md && ` +
        `grep -qi 'reserve' DIAGNOSIS.md && ` +
        `grep -qiE 'race|atomic|interleav|concurrent|serial|lock|critical' DIAGNOSIS.md`,
    },
    {
      kind: 'command',
      label:
        'epistemic quality (deterministic): OBSERVED/INFERRED/UNKNOWN/HYPOTHESIS/' +
        'RECOMMENDED CHECK separated; observations cite the evidence bundle; unknowns ' +
        'itemized; unhedged environment assertions rejected',
      command: `cd ${root} && node -e "${epistemicCheckScript()}"`,
    },
    {
      kind: 'command',
      label: 'the committed reproduction demonstrates the oversell on the unmodified source',
      command: `cd ${root} && test -f repro.mjs && node repro.mjs 2>&1 | grep -q 'RACE REPRODUCED'`,
    },
    {
      kind: 'command',
      label: 'the diagnosis references the provided evidence bundle (incident logs / rates)',
      command: `cd ${root} && grep -qiE 'incident|metrics|80%|pass.?fail|failure rate' DIAGNOSIS.md`,
    },
    {
      kind: 'command',
      label:
        'the source under diagnosis is untouched — diagnosis, not repair ' +
        '(diff against the pinned base)',
      command:
        `cd ${repoDir} && git diff --quiet ${GOLD_REF} HEAD -- ` +
        `flaky-orders/src flaky-orders/test flaky-orders/package.json flaky-orders/evidence`,
    },
    {
      kind: 'command',
      label:
        'the race is objectively present in the integrated state (independent instrumented ' +
        'probe, latency pinned so every concurrent reservation reads the same stock)',
      command:
        `cd ${root} && node -e "Math.random=()=>0.999; import('./src/inventory.mjs').then(async m => { ` +
        `const inv = new m.InventoryService({ widget: 8 }); ` +
        `const rs = await Promise.all(Array.from({ length: 12 }, () => inv.reserve('widget', 1))); ` +
        `const a = rs.filter(Boolean).length; ` +
        `if (a > 8) { console.log('GATE: RACE PRESENT accepted=' + a); process.exit(0); } ` +
        `console.log('GATE: no oversell accepted=' + a); process.exit(1); })"`,
    },
  ];
}
