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
export * from './genome/genome-compiler.js';
export * from './routing/decision-provider.js';
export * from './routing/cognitive-router.js';
export * from './runtime/computer.js';
export * from './runtime/openbot/computer-api.js';
export * from './runtime/openbot/computer-process.js';
export * from './runtime/openbot/adapter.js';
export * from './worker/worker-agent.js';
export * from './worker/handoff.js';
export * from './mission/flight-recorder.js';
export * from './mission/orchestrator.js';
export * from './mission/verification.js';
export * from './goal/llm-understanding.js';
export * from './providers/zai-reasoning.js';
export * from './learning/index.js';
