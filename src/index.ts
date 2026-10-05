/**
 * AgentCraft Genesis — public entrypoint.
 *
 * Genesis is a Goal-to-Organization runtime:
 * Goal → Requirements → Organization Plan → Worker Genomes → Provider Decisions.
 *
 * Philosophy: large in capability, small in code.
 */

export const GENESIS_VERSION = '0.1.0';

export const GENESIS_MOTTO = 'Large in capability, small in code.';

export const GENESIS_ENGINEERING_RULE =
  'CONFIGURE → REUSE → WRAP → ADAPT → EXTEND → BUILD';

export * from './contracts/core.js';
export * from './goal/goal-compiler.js';
export * from './organization/organization-planner.js';
