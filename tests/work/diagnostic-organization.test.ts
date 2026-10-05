import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import {
  buildDiagnosticGoal,
  epistemicCheckScript,
  EXP002_MISSION_ID,
  extraChecks,
  GOLD_REF,
} from '../../experiments/experiment-003/mission.js';

/**
 * TASK-022 acceptance, pinned deterministically — the property the
 * experiment observes live is first asserted here, with no LLM anywhere:
 *
 *   - the DIAGNOSTIC goal compiles to the diagnostic domain and extracts
 *     evidence-oriented capability needs (reproduction, evidence analysis,
 *     the report) — not the software-engineering set, and nothing the case
 *     does not genuinely need (no web-research, no browser-verification);
 *
 *   - the planner, fed only those requirements, staffs a diagnostic
 *     organization (Reproduction Engineer, Diagnostic Analyst, Report
 *     Writer under a Mission Coordinator) — NOT a recycled software
 *     engineering team, and no role was prescribed by the goal;
 *
 *   - that organization is structurally different from the one recorded in
 *     Experiment 002's committed flight record (evidence, not narrative);
 *
 *   - the deterministic epistemic gate accepts an honest diagnosis and
 *     rejects unhedged environment certainty and missing unknowns.
 *
 * If a future change makes diagnostic goals produce the software-engineering
 * organization (or vice versa), this suite fails before any experiment
 * burns a provider window on it.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..');

const CONFORMING_DIAGNOSIS = `# Diagnosis — flaky-orders intermittent oversell

## Root cause

The oversell is caused by concurrent reservations interleaving inside
InventoryService.reserve.

## OBSERVED

- incident-logs.txt: 12 of 15 runs of the suite failed on the same commit (~80%)
- incident-logs.txt: failing runs report 9, 10 or 11 accepted orders against stock 8
- metrics.md: three different assertions fail across runs (accepted count, stock level, rejections)

## INFERRED

- the accepted-count, stock-level and rejection-count assertion failures are three
  views of one oversell, because accepted, remaining stock and rejected orders
  must account for all 12 dispatched orders

## HYPOTHESIS

- the read-check-write sequence in reserve is not atomic, so concurrent calls that
  read the same stock level all accept
- a test-only timing artifact (competing candidate, to be distinguished by the
  reproduction on the unmodified source)

## UNKNOWN

- whether the staging cluster described in the code comments exhibits the same
  behavior — no telemetry for it exists in the evidence bundle
- the exact interleavings of each failing run were not recorded

## RECOMMENDED CHECK

- run the committed repro.mjs to confirm the oversell on the unmodified source
- capture staging telemetry for the reserve path before any fix is rolled out

## Confidence

High — the deterministic reproduction demonstrates the oversell; the staging
question above stays open.
`;

const UNHEDGED_ENV_CERTAINTY = `# Diagnosis

## OBSERVED

- incident-logs.txt: 12 of 15 runs failed (~80%)

## INFERRED

- the reserve path oversells under concurrency
- the staging cluster is affected by the same oversell

## HYPOTHESIS

- the read-check-write sequence in reserve is not atomic
- a test-only timing artifact

## RECOMMENDED CHECK

- run repro.mjs

## Confidence

High
`;

const NO_UNKNOWNS = `# Diagnosis

## OBSERVED

- metrics.md: 80% failure rate

## INFERRED

- the reserve path oversells under concurrency

## HYPOTHESIS

- non-atomic read-check-write
- timing artifact

## RECOMMENDED CHECK

- run repro.mjs
- capture telemetry

## Confidence

High
`;

function runEpistemicScript(diagnosis: string): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'exp003-epistemic-'));
  writeFileSync(join(dir, 'DIAGNOSIS.md'), diagnosis, 'utf8');
  try {
    execFileSync('node', ['-e', epistemicCheckScript()], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? 1, stderr: failure.stderr ?? '' };
  }
}

describe('experiment 003 — the diagnostic mission definition', () => {
  it('compiles to the diagnostic domain with evidence-oriented needs', async () => {
    const requirements = await new GoalCompiler().compile(buildDiagnosticGoal());
    expect(requirements.domain).toBe('diagnostic');
    expect([...requirements.capabilityNeeds].sort()).toEqual([
      'code-execution',
      'data-analysis',
      'document-authoring',
    ]);
    // Nothing the case does not genuinely need:
    expect(requirements.capabilityNeeds).not.toContain('web-research');
    expect(requirements.capabilityNeeds).not.toContain('browser-verification');
  });

  it('plans a diagnostic organization — not a recycled software-engineering team', async () => {
    const requirements = await new GoalCompiler().compile(buildDiagnosticGoal());
    const plan = new OrganizationPlanner().plan(requirements);
    const roles = plan.workers.map((worker) => worker.role);
    const specialists = roles.filter((role) => role !== 'Mission Coordinator').sort();

    expect(specialists).toEqual([
      'Diagnostic Analyst',
      'Report Writer',
      'Reproduction Engineer',
    ]);
    expect(roles).toContain('Mission Coordinator');
    // No force-fit coding workers (the TASK-022 prohibition):
    expect(roles).not.toContain('Software Engineer');
    expect(roles).not.toContain('Verification Engineer');
    expect(roles).not.toContain('Documentation Writer');
    // And the goal itself never prescribes a team:
    const goalText = [
      buildDiagnosticGoal().outcome,
      buildDiagnosticGoal().context ?? '',
      ...(buildDiagnosticGoal().constraints ?? []),
    ].join('\n');
    for (const role of specialists) {
      expect(goalText).not.toContain(role);
    }
  });

  it('is structurally different from the recorded Experiment 002 organization', async () => {
    const flight2 = readFileSync(
      join(REPO_ROOT, 'data', 'flight-records', `${EXP002_MISSION_ID}.jsonl`),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const plan2 = flight2.find((event) => event.type === 'plan-created') as {
      workers: { role: string; needs: string[] }[];
    };
    const requirements2 = flight2.find(
      (event) => event.type === 'requirements-compiled',
    ) as { capabilityNeeds: string[] };

    const requirements3 = await new GoalCompiler().compile(buildDiagnosticGoal());
    const plan3 = new OrganizationPlanner().plan(requirements3);

    const roles2 = plan2.workers
      .map((worker) => worker.role)
      .filter((role) => role !== 'Mission Coordinator');
    const roles3 = plan3.workers
      .map((worker) => worker.role)
      .filter((role) => role !== 'Mission Coordinator');
    const needs2 = [...requirements2.capabilityNeeds].sort();
    const needs3 = [...requirements3.capabilityNeeds].sort();

    // Computed exactly as the experiment report computes it:
    expect(roles2.every((role) => !roles3.includes(role))).toBe(true);
    expect(needs2.join(',')).not.toBe(needs3.join(','));
  });
});

describe('experiment 003 — the deterministic epistemic gate', () => {
  it('accepts an honest, structured diagnosis', () => {
    const outcome = runEpistemicScript(CONFORMING_DIAGNOSIS);
    expect(outcome.status).toBe(0);
  });

  it('rejects unhedged certainty about environments the evidence does not cover', () => {
    const outcome = runEpistemicScript(UNHEDGED_ENV_CERTAINTY);
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain('unhedged environment assertion');
  });

  it('rejects a diagnosis with no explicit unknowns', () => {
    const outcome = runEpistemicScript(NO_UNKNOWNS);
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain('UNKNOWN');
  });
});

describe('experiment 003 — the acceptance checks', () => {
  it('guards the unmodified source and the epistemic gate in one command set', () => {
    const checks = extraChecks({ repoDir: 'repo' });
    const labels = checks.map((check) => check.label).join('\n');
    // The diagnosis-must-not-repair gate exists and pins the base commit:
    const untouched = checks.find((check) =>
      check.label.includes('untouched'),
    ) as { command: string };
    expect(untouched.command).toContain(GOLD_REF);
    expect(untouched.command).toContain('flaky-orders/src');
    // The epistemic gate is wired as a command check:
    const epistemic = checks.find((check) =>
      check.label.includes('epistemic quality'),
    ) as { command: string };
    expect(epistemic.command).toContain('node -e');
    // Labels stay honest about what each gate decides:
    expect(labels).toContain('epistemic quality');
    expect(checks.length).toBe(7);
  });
});
