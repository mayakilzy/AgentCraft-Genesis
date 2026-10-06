/**
 * Organizational Learning — public entrypoint (GROUP 4).
 *
 * The closed learning loop:
 *
 *   deriveExperience → ExperienceStore → StatisticalCandidateGenerator →
 *   RuleCandidateEvaluator → promoteCandidate → RulePatternRetriever →
 *   OrganizationPlanner (advisory patterns)
 *
 * Large in capability, small in code. Each module is one file; the entire
 * learning subsystem reuses existing Genesis contracts.
 */

export * from './experience.js';
export * from './experience-store.js';
export * from './candidate.js';
export * from './candidate-generator.js';
export * from './evaluation.js';
export * from './pattern.js';
