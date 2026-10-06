/**
 * TASK-023 mission definition — ONE goal, THREE organizational
 * strategies, everything else identical by construction.
 *
 * The goal is a plain, natural, human-level mission statement. It names
 * no roles, no team, no benchmark, no measurements, and no defect
 * locations. It was written once and frozen; the deterministic
 * compilation result was verified in preflight, not iterated on.
 *
 * Arm A (strong single agent) and Arm B (static multi-agent team) inject
 * harness-fixed organizations through the SAME planner seam the real
 * chain uses (runRepoMission's injectable planner) — no other code path
 * differs. Arm C passes no planner: GoalCompiler → OrganizationPlanner
 * → GenomeCompiler → Runtime decide the organization from the goal
 * alone.
 *
 * The static team (Arm B) was frozen in BENCHMARK-DESIGN.md before the
 * benchmark base repository was generated: a reasonable generic team
 * for the "repair + document + verify a repository" mission class, not
 * tailored to the seeded defects, and not deliberately weakened.
 */

import type {
  Goal,
  GoalRequirements,
  OrganizationPlan,
} from '../../src/contracts/core.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import type { AcceptanceCheck } from '../../src/mission/verification.js';

export const BENCHMARK_GOAL: Goal = {
  outcome:
    'The worklog time-tracking repository shipped from a rushed release branch ' +
    'with several incorrect behaviors, stale documentation examples, and no test ' +
    'suite. Restore it to a trustworthy state: fix the behavioral bugs so the ' +
    'implementation matches its specification (SPEC.md and the function ' +
    'contracts), correct the documentation so its examples show the real ' +
    'behavior of the repaired code, and deliver a test suite that protects the ' +
    'repaired behaviors. The repository must install, run and pass its own tests.',
  context:
    'The mission repository is a worklog project pinned at a fixed release ' +
    'snapshot. The behavioral contract is SPEC.md plus the documented function ' +
    'contracts; examples in README.md and docs/ must reflect what the code ' +
    'actually does. Work in your own git worktree and commit your work; the ' +
    'orchestrator owns final integration.',
  constraints: [
    'keep the public library API of src/lib.mjs unchanged',
    'the specification (SPEC.md) is the contract for correct behavior',
    'leave the repository clean and buildable',
  ],
  budget: { maxUsd: 6, tier: 'default' },
};

/**
 * ARM A — Strong Single Agent: one Sole Operator holding EVERY capability
 * need the goal compiles to (the union of what the mission implies — the
 * same tool universe a specialist team would hold), the same tier policy,
 * the same step ceiling. A genuinely strong baseline: not crippled, no
 * artificial step poverty (30 steps like every other worker instance).
 */
export class StrongSingleAgentPlanner extends OrganizationPlanner {
  override plan(requirements: GoalRequirements): OrganizationPlan {
    const needs = [...requirements.capabilityNeeds];
    return {
      rationale:
        'BENCHMARK ARM A (strong single agent): one Sole Operator covering every ' +
        `capability need the goal compiled to (${needs.join(', ')}) — no division ` +
        'of labor, no coordinator, no adaptation; the complete mission in one ' +
        'worker with the full tool universe the mission implies.',
      workers: [
        {
          id: 'principal-engineer-1',
          role: 'Sole Operator',
          responsibility:
            'Executes the entire mission end-to-end across all required capabilities',
          capabilityNeeds: needs,
        },
      ],
      collaboration: [],
      capabilityNeeds: needs,
    };
  }
}

/**
 * ARM B — Static Multi-Agent Team, frozen before workload generation:
 * the reasonable generic four-role team a framework would configure by
 * hand for a "repair + document + verify a repository" mission.
 * Identical for any goal shape; never adapted; not deliberately poor.
 */
export class StaticTeamPlanner extends OrganizationPlanner {
  override plan(requirements: GoalRequirements): OrganizationPlan {
    return {
      rationale:
        'BENCHMARK ARM B (static multi-agent team): a fixed Software Engineer / ' +
        'Verification Engineer / Documentation Writer / Mission Coordinator ' +
        'team — the organization a typical framework is configured with by hand ' +
        'for repository repair missions. Frozen before the benchmark workload ' +
        'was generated; identical for any goal; never adapted. The goal ' +
        `compiled to ${requirements.capabilityNeeds.join(', ')}.`,
      workers: [
        {
          id: 'mission-coordinator-1',
          role: 'Mission Coordinator',
          responsibility:
            'Decomposes the mission, assigns work, integrates results and controls quality',
          capabilityNeeds: [],
        },
        {
          id: 'software-engineer-1',
          role: 'Software Engineer',
          responsibility: 'Implements, runs and fixes the code changes',
          capabilityNeeds: ['code-execution'],
        },
        {
          id: 'verification-engineer-2',
          role: 'Verification Engineer',
          responsibility: 'Tests and verifies the implementation end-to-end',
          capabilityNeeds: ['code-execution'],
        },
        {
          id: 'documentation-writer-3',
          role: 'Documentation Writer',
          responsibility: 'Documents the change and its usage',
          capabilityNeeds: ['document-authoring'],
        },
      ],
      collaboration: [
        { from: 'software-engineer-1', to: 'verification-engineer-2', kind: 'report' },
        { from: 'verification-engineer-2', to: 'documentation-writer-3', kind: 'handoff' },
      ],
      capabilityNeeds: ['code-execution', 'document-authoring'],
    };
  }
}

/**
 * In-mission acceptance checks (identical for all arms; what the
 * mission's own verification loop shows the workers). Deliberately
 * shallow and gold-free: repository-derived self-consistency only.
 * The deep truth gates (gold suite, doc harness, test quality) are the
 * evaluator's, applied after the mission ends.
 */
export function benchmarkExtraChecks(): AcceptanceCheck[] {
  return [
    {
      kind: 'command',
      label: 'every source module parses',
      command: 'cd repo && for f in src/*.mjs; do node --check "$f" || exit 1; done',
    },
    {
      kind: 'command',
      label: 'the CLI runs and shows usage',
      command: 'cd repo && node src/cli.mjs --help > /dev/null',
    },
    {
      kind: 'command',
      label: 'a test suite exists under tests/',
      command: 'test -n "$(ls repo/tests/*.test.mjs 2>/dev/null)"',
    },
  ];
}
