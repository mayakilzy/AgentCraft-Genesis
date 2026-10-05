import type {
  DecisionProvider,
  ReasoningTier,
  TierSelection,
} from '../contracts/core.js';

/**
 * Cognitive Router v0.1 (TASK-009).
 *
 * The single place where cognitive resources are chosen. It turns a
 * TierSelection into a bounded decision and delegates to whichever
 * DecisionProvider it was constructed with (rules, LLM, future Jev).
 *
 * `selectTier` satisfies the TierSelector structural port consumed by the
 * Genome Compiler, and returns a ReasoningTier — never a provider or model
 * name — so routing decisions cannot leak vendor choices into plans or
 * genomes. Budget awareness comes from the provider's rules (ceiling clamp),
 * not from a complex optimizer.
 */
export class CognitiveRouter {
  constructor(private readonly provider: DecisionProvider) {}

  async selectTier(selection: TierSelection): Promise<ReasoningTier> {
    const outcome = await this.provider.decide({
      kind: 'reasoning-tier',
      question:
        `Select the reasoning tier for role "${selection.role}" ` +
        `(${selection.roleId}) in a ${selection.missionDomain} mission.`,
      options: ['cheap', 'default', 'frontier'],
      facts: {
        criticality: selection.criticality,
        missionDomain: selection.missionDomain,
        budgetCeiling: selection.budgetCeiling ?? 'none',
      },
    });
    return outcome.choice as ReasoningTier;
  }
}
