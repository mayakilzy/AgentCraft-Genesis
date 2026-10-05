import type { Goal } from '../../src/contracts/core.js';

/**
 * TASK-006 fixtures — five deliberately different goals used across the
 * GROUP 1 test suite (compiler, planner, genome, router, integration).
 *
 * The three "experiment-shaped" goals mirror the falsifiability requirement
 * of the founding architecture (§21): research, software engineering and
 * diagnostic missions must yield genuinely different organizations.
 */

/** Experiment-001-shaped: business investigation. */
export const RESEARCH_GOAL: Goal = {
  outcome:
    'Research whether a self-hosted AI maintenance specialist for industrial machines is commercially viable for small factories.',
};

/** Experiment-002-shaped: software engineering. */
export const SOFTWARE_ENGINEERING_GOAL: Goal = {
  outcome:
    'Implement a dark-mode toggle in the web app dashboard and verify it end-to-end in the browser.',
};

/** Experiment-003-shaped: industrial machine incident. */
export const DIAGNOSTIC_GOAL: Goal = {
  outcome:
    'Diagnose why CNC machine 7 halts with spindle fault E-04 after twenty minutes; reproduce it from the telemetry logs and identify the root cause.',
};

/** Trivial goal — must yield a single-worker plan. */
export const SIMPLE_GOAL: Goal = {
  outcome: 'Summarize the attached meeting notes into a one-page memo.',
};

/** Goal with explicit constraints, budget hint and required approvals. */
export const CONSTRAINED_GOAL: Goal = {
  outcome: 'Evaluate three SaaS vendors and recommend one in a short report.',
  constraints: ['The recommendation must include a pricing comparison'],
  budget: { maxUsd: 15 },
  approvals: ['Sending emails to vendors'],
};

export const ALL_FIXTURE_GOALS: readonly Goal[] = [
  RESEARCH_GOAL,
  SOFTWARE_ENGINEERING_GOAL,
  DIAGNOSTIC_GOAL,
  SIMPLE_GOAL,
  CONSTRAINED_GOAL,
];
