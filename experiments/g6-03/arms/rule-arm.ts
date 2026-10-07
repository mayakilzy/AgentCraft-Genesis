/**
 * G6-03 — Rule arm for the Jev Decision Benchmark.
 *
 * This is the BENCHMARK-ONLY Rule arm. It implements DecisionProvider and
 * dispatches per `request.kind` to family-specific rule functions that
 * re-implement the actual Genesis rules. Where Genesis has a real
 * DecisionProvider for the kind (e.g., 'reasoning-tier'), the Rule arm
 * calls into it. Where the rule is embedded in another module
 * (e.g., `classifyDomain` in goal-compiler.ts), the Rule arm re-implements
 * the same logic to keep the experiment self-contained.
 *
 * This file is NOT production code. It lives under experiments/ and does
 * NOT count against the Anti-Bloat gate.
 *
 * The Rule arm is FAIR: it receives the SAME Decision<T> input the Jev
 * arm receives — kind, question, options, facts. Ground truth lives in
 * a separate file and is NOT visible to either arm.
 */

import type {
  Decision,
  DecisionOutcome,
  DecisionProvider,
} from '../../../src/contracts/core.js';
import { RuleDecisionProvider } from '../../../src/routing/decision-provider.js';

// Family A — coordinator-decision: coordinator iff specialists.length >= 3
function ruleCoordinatorDecision<T extends string>(
  request: Decision<T>,
): DecisionOutcome<T> {
  const count = Number(request.facts['specialist_count']);
  const expected = count >= 3 ? 'yes' : 'no';
  const matched = request.options.find((o) => o === (expected as T));
  if (matched === undefined) {
    return {
      choice: request.options[0],
      reason: `rule computed "${expected}" but it was not in options; defaulted to first option (rule-arm fallback)`,
      provider: 'rule-benchmark',
    };
  }
  return {
    choice: matched,
    reason: `Genesis rule (organization-planner.ts:386): coordinator iff specialists >= 3; here ${count} ${count >= 3 ? '>=' : '<'} 3`,
    provider: 'rule-benchmark',
  };
}

// Family B — reasoning-tier: delegate to existing RuleDecisionProvider
const tierProvider = new RuleDecisionProvider();
async function ruleReasoningTier<T extends string>(
  request: Decision<T>,
): Promise<DecisionOutcome<T>> {
  return tierProvider.decide(request);
}

// Family C — worker-retry-vs-fail
function ruleWorkerRetryVsFail<T extends string>(
  request: Decision<T>,
): DecisionOutcome<T> {
  const aborted = request.facts['mission_aborted'] === true;
  const ok = request.facts['verification_ok'] === true;
  const retryable = request.facts['diagnosis_retryable'];
  const attempt = Number(request.facts['attempt'] ?? 1);
  const maxAttempts = Number(request.facts['max_attempts'] ?? 2);

  if (aborted) {
    return {
      choice: 'fail' as T,
      reason: 'Genesis rule: mission aborted -> fail (orchestrator.ts:684)',
      provider: 'rule-benchmark',
    };
  }
  if (ok) {
    return {
      choice: 'fail' as T,
      reason: 'verification ok=true -> no retry (defensive; corpus has no such case)',
      provider: 'rule-benchmark',
    };
  }
  if (attempt >= maxAttempts) {
    return {
      choice: 'fail' as T,
      reason: `Genesis rule (worker-agent.ts:925): attempt ${attempt} >= maxAttempts ${maxAttempts} -> fail`,
      provider: 'rule-benchmark',
    };
  }
  if (retryable === false) {
    return {
      choice: 'fail' as T,
      reason: 'Genesis rule (orchestrator.ts:684): diagnosis.retryable=false -> fail',
      provider: 'rule-benchmark',
    };
  }
  return {
    choice: 'retry' as T,
    reason: `Genesis rule (orchestrator.ts:684): !ok && !aborted && retryable!==false (got ${String(retryable)}) -> retry`,
    provider: 'rule-benchmark',
  };
}

// Family D — pattern-apply-vs-ignore
function rulePatternApplyVsIgnore<T extends string>(
  request: Decision<T>,
): DecisionOutcome<T> {
  const kind = String(request.facts['pattern_kind'] ?? '');
  const targetRole = request.facts['pattern_target_role'] ?? undefined;
  const specialistsRaw = request.facts['current_specialist_roles'];
  // The corpus stores specialist_roles as a JSON-stringified array string
  // (facts values can be string | number | boolean).
  let specialists: string[] = [];
  if (typeof specialistsRaw === 'string') {
    try {
      const parsed = JSON.parse(specialistsRaw);
      if (Array.isArray(parsed)) {
        specialists = parsed.map((s) => String(s));
      } else {
        specialists = String(specialistsRaw).split(',').filter(Boolean);
      }
    } catch {
      specialists = String(specialistsRaw).split(',').filter(Boolean);
    }
  }
  const count = Number(request.facts['current_specialist_count'] ?? 0);
  const coverage = request.facts['redistribution_preserves_coverage'] === true;

  if (kind === 'avoid-role') {
    const target = String(targetRole ?? '');
    const present = specialists.some((s) => s.trim() === target);
    if (!present) {
      return {
        choice: 'ignore' as T,
        reason: `Genesis rule: avoid-role but target "${target}" not present -> ignore`,
        provider: 'rule-benchmark',
      };
    }
    if (!coverage) {
      return {
        choice: 'ignore' as T,
        reason: 'Genesis rule: avoid-role but redistribution breaks coverage -> ignore',
        provider: 'rule-benchmark',
      };
    }
    return {
      choice: 'apply' as T,
      reason: `Genesis rule: avoid-role, target "${target}" present, coverage preserved -> apply`,
      provider: 'rule-benchmark',
    };
  }
  if (kind === 'prefer-role') {
    const target = String(targetRole ?? '');
    if (target !== 'Sole Operator') {
      return {
        choice: 'ignore' as T,
        reason: `Genesis rule: prefer-role for "${target}" not implemented -> ignore`,
        provider: 'rule-benchmark',
      };
    }
    if (count <= 1) {
      return {
        choice: 'ignore' as T,
        reason: 'Genesis rule: already a single-worker build -> ignore',
        provider: 'rule-benchmark',
      };
    }
    return {
      choice: 'apply' as T,
      reason: `Genesis rule: prefer-role Sole Operator, ${count} > 1 -> collapse`,
      provider: 'rule-benchmark',
    };
  }
  return {
    choice: 'ignore' as T,
    reason: `Genesis rule: pattern kind "${kind}" not implemented -> ignore`,
    provider: 'rule-benchmark',
  };
}

// Family E — verification-diagnosis
function ruleVerificationDiagnosis<T extends string>(
  request: Decision<T>,
): DecisionOutcome<T> {
  const failedCount = Number(request.facts['failed_check_count'] ?? 0);
  const reviewerAvailable = request.facts['reviewer_available'] === true;
  if (failedCount === 0) {
    return {
      choice: 'accept' as T,
      reason: 'Genesis rule: 0 failed checks -> ok=true -> accept',
      provider: 'rule-benchmark',
    };
  }
  if (!reviewerAvailable) {
    return {
      choice: 'accept' as T,
      reason: 'Genesis rule: !ok but no reviewer -> accept the verification result (!ok)',
      provider: 'rule-benchmark',
    };
  }
  return {
    choice: 'review' as T,
    reason: `Genesis rule: ${failedCount} failed checks && reviewer available -> review`,
    provider: 'rule-benchmark',
  };
}

// Family F1 — domain-classification
function ruleDomainClassification<T extends string>(
  request: Decision<T>,
): DecisionOutcome<T> {
  const outcome = String(request.facts['goal_outcome'] ?? '');
  const context = String(request.facts['goal_context'] ?? '');
  const constraints = String(request.facts['goal_constraints'] ?? '');
  const text = `${outcome} ${context} ${constraints}`.toLowerCase();
  const SIGNALS: Record<string, string[]> = {
    'software-engineering': ['service', 'api', 'rest', 'code', 'build', 'deploy', 'persistence', 'rust', 'go', 'typescript', 'javascript', 'npm', 'package', 'dependency', 'dependencies', 'bug', 'fix', 'test', 'refactor'],
    'research': ['survey', 'literature', 'bibliography', 'paper', 'papers', 'study', 'studies', 'research', 'analyze', 'analyse', 'cite', 'sources', 'review'],
    'diagnostic': ['diagnose', 'diagnostic', 'slow', 'slowness', 'troubleshoot', 'investigate', 'root cause', 'remediation', 'fix production', 'incident'],
  };
  const scores: Record<string, number> = { 'software-engineering': 0, 'research': 0, 'diagnostic': 0 };
  for (const [dom, sigs] of Object.entries(SIGNALS)) {
    for (const s of sigs) {
      const re = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) scores[dom] += 1;
    }
  }
  let best: string = 'general';
  let bestScore = 0;
  for (const [dom, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      best = dom;
    }
  }
  const matched = request.options.find((o) => o === (best as T));
  if (matched === undefined) {
    return {
      choice: request.options[0],
      reason: `rule computed "${best}" but it was not in options; defaulted to first option`,
      provider: 'rule-benchmark',
    };
  }
  return {
    choice: matched,
    reason: `Genesis rule (goal-compiler.ts:206): word-signal scores ${JSON.stringify(scores)} -> ${best}`,
    provider: 'rule-benchmark',
  };
}

// Family F2 — scope-classification
function ruleScopeClassification<T extends string>(
  request: Decision<T>,
): DecisionOutcome<T> {
  const needCount = Number(request.facts['capability_need_count'] ?? 0);
  const criterionCount = Number(request.facts['success_criterion_count'] ?? 0);
  const wordCount = Number(request.facts['outcome_word_count'] ?? 0);
  const complexityHits = Number(request.facts['complexity_signals_hit'] ?? 0);
  const score = Math.max(0, needCount - 1) +
    (criterionCount > 2 ? 1 : 0) +
    (wordCount > 25 ? 1 : 0) +
    Math.min(2, complexityHits);
  let scope: string;
  if (score <= 1) scope = 'minimal';
  else if (score <= 3) scope = 'standard';
  else scope = 'complex';
  const matched = request.options.find((o) => o === (scope as T));
  if (matched === undefined) {
    return {
      choice: request.options[0],
      reason: `rule computed "${scope}" but it was not in options`,
      provider: 'rule-benchmark',
    };
  }
  return {
    choice: matched,
    reason: `Genesis rule (organization-planner.ts:157): score=${score} -> ${scope}`,
    provider: 'rule-benchmark',
  };
}

export class RuleBenchmarkProvider implements DecisionProvider {
  readonly name = 'rule-benchmark';

  async decide<T extends string>(
    request: Decision<T>,
  ): Promise<DecisionOutcome<T>> {
    switch (request.kind) {
      case 'coordinator-decision':
        return Promise.resolve(ruleCoordinatorDecision(request));
      case 'reasoning-tier':
        return ruleReasoningTier(request);
      case 'worker-retry-vs-fail':
        return Promise.resolve(ruleWorkerRetryVsFail(request));
      case 'pattern-apply-vs-ignore':
        return Promise.resolve(rulePatternApplyVsIgnore(request));
      case 'verification-diagnosis':
        return Promise.resolve(ruleVerificationDiagnosis(request));
      case 'domain-classification':
        return Promise.resolve(ruleDomainClassification(request));
      case 'scope-classification':
        return Promise.resolve(ruleScopeClassification(request));
      default:
        return {
          choice: request.options[0],
          reason: `Rule arm has no rule for decision kind "${request.kind}"`,
          provider: this.name,
        };
    }
  }
}
