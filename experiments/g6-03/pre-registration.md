# G6-03 Pre-registration — Jev Decision Benchmark

**Frozen at:** 2026-10-07T16:48:00Z
**Corpus version:** 1.0.0
**Mission:** G6-03 (Jev Decision Benchmark, evidence-based evaluation)
**Branch:** build/group-06-productionization
**Authoritative start HEAD:** f91442b5cf66356e0e7f011d13638cd0d7451fe7

> This pre-registration is **immutable** after benchmark execution begins.
> Corrections are recorded as `observation` or `corrigendum` fields, never
> by rewriting the original pre-registration.

---

## 1. Central Question

For which Genesis decision classes, if any, does Jev provide a better decision mechanism than existing rule / statistical-heuristic / LLM-reasoning approaches?

This benchmark is capable of returning any of:
- ADOPT_TARGETED (Jev preferred for ≥1 decision class)
- ADOPT_OPTIONAL (Jev works, useful, not preferred)
- DEFER_MORE_EVIDENCE (inconclusive)
- REJECT_FOR_V1 (insufficient value vs complexity/cost)

"Do not adopt Jev" is a successful scientific outcome if the evidence supports it.

---

## 2. Decision Census Summary

Full census: `experiments/g6-03/corpus/decision-census.json` (frozen alongside this pre-registration).

Total bounded decision points inventoried in current Genesis: **33**
- DETERMINISTIC: 17
- BOUNDED_PROBABILISTIC: 13
- OPEN_SEMANTIC (above bounded decisions, excluded from corpus): 2 (worker action selection, coordinator integration summary)
- UNSUITABLE_FOR_BENCHMARK: 0

**Statistical-arm finding:** STATISTICAL_ARM = NOT_MATERIAL
- The `DecisionProvider` contract accommodates a statistical arm (`src/contracts/core.ts:403-404`), but no implementation exists.
- The closest analog, `StatisticalCandidateGenerator`, is a deterministic set-intersection computation over Experience aggregation — NOT a probabilistic estimator over bounded option sets at request-time.
- Per Section 20 of the G6-03 mission brief: report `STATISTICAL_ARM = NOT_MATERIAL` and **do not fabricate one** for the benchmark.

---

## 3. Decision Corpus

File: `experiments/g6-03/corpus/decision-corpus.json` (frozen v1.0.0, 29 cases).

| Family | Decision Kind | Cases | Source Decision |
|--------|---------------|-------|-----------------|
| A | worker-role selection (coordinator-decision) | 4 | D09 |
| B | capability/provider selection (reasoning-tier) | 5 | D01 |
| C | retry / fail / escalate (worker-retry-vs-fail) | 5 | D13 + D25 |
| D | candidate pattern selection (pattern-apply-vs-ignore) | 5 | D10 + D30 |
| E | accept / review / reject (verification-diagnosis) | 4 | D24 + D25 |
| F | organization strategy selection (domain-classification + scope-classification) | 6 | D04 + D06 |
| **Total** | 6 decision kinds | **29** | |

**Why 29 cases (within the 20-40 target):** 6 decision families are represented (not many trivial variants of one question). Each family has 4-6 cases. Cases include both deterministic (rule-correct) and bounded-probabilistic (rule possibly wrong) items, so Jev's added value can be measured both where rule should win and where rule might lose.

---

## 4. Ground Truth Methods

Three ground truth sources are used (per Section 17):
1. **deterministic_known_answer** — when the rule is exhaustive and the answer is a definitional fact.
2. **genesis_rule_baseline** — when the existing Genesis rule is the baseline; ground truth is "what the rule produces for these inputs". This is fair because the rule IS the production mechanism; an alternative arm that disagrees with the rule on deterministic cases is wrong *by definition* of the current contract.
3. **semantic_consensus** — when no deterministic ground truth exists; the case author (G6-03 session) records the consensus answer and rationale. Marked in `notes` field. Bounded in count (4 cases: A3, F1-F4).

**Self-grading prohibition (Section 17):** No Jev-graded-Jev. The ground truth for each case is fixed at pre-registration time, before any Jev call is made.

**Leakage prevention (Section 18):** `expected_choice` is NEVER included in the provider-visible input. The `Decision<T>` object passed to providers contains only `kind`, `question`, `options`, `facts`. Ground truth lives in a separate file (`decision-corpus.json`) and is read by the harness after the provider returns its choice.

---

## 5. Provider Arms

Three arms evaluated:

| Arm | Implementation | Notes |
|-----|----------------|-------|
| **Rule** | Family-specific rule functions in `experiments/g6-03/arms/rule-arm.ts` | Re-implementations of the actual Genesis rules (coordinator iff ≥3, criticality→tier, retry iff retryable && !aborted, etc.). Where the rule already exists in production code (e.g., `RuleDecisionProvider`), the arm calls into it. Where the rule is embedded (e.g., `classifyDomain`), the arm re-implements the same logic to keep the experiment self-contained. |
| **Statistical** | NOT_MATERIAL | Not built. Per Section 20. |
| **Jev** | `src/providers/jev-decision-provider.ts` (new, thin adapter) | Implements `DecisionProvider`. Pin model `typesafe/jev-router` on OpenRouter. Uses `response_format: json_schema` for strict structured output. No generic OpenRouter client — the adapter is structurally incapable of selecting another model. |
| **LLM/GLM** | NOT INCLUDED | Per Section 21: GLM may serve as LLM decision baseline IF scientifically justified. We exclude it because (a) no GLM API is available in this environment without using OpenRouter (forbidden for non-Jev), (b) the comparison of interest is Jev vs the production rule baseline, (c) adding an LLM arm without LLM access would require using OpenRouter for non-Jev models — explicitly forbidden. |

**Arms evaluated: 2 (Rule, Jev).** Statistical and LLM arms are explicitly NOT_MATERIAL/NOT_INCLUDED.

---

## 6. Jev Integration — Frozen Specifications

**JEV_ENDPOINT_USED** = `https://openrouter.ai/api/v1/chat/completions`
**JEV_MODEL_USED** = `typesafe/jev-router`
**JEV_API_INTERFACE** = OpenRouter Chat Completions API (OpenAI-compatible), with `response_format: { type: 'json_schema', strict: true, schema: {...} }`
**Authentication** = Bearer token from `OPENROUTER_API_KEY` env var (read at provider construction; never serialized; never logged)
**Request shape**:
- `messages`: [system: "You are a bounded decision provider..."; user: rendered decision prompt with kind/question/options/facts]
- `response_format`: json_schema requiring `{ choice: enum[...options], reason: string }`
- `max_tokens`: 256 (allows reasoning + final answer)
- `temperature`: 0 (deterministic-ish)

**Response mapping**:
- `choices[0].message.content` → parse JSON → extract `choice` and `reason`
- `choices[0].message.reasoning` → PRESERVED as `providerMetadata.reasoning` (NOT chain-of-thought persistence — this is structured metadata: tokens count + text, capped at 500 chars)
- `usage.cost` (when present, in USD) → PRESERVED as `providerMetadata.costUsd`
- `usage.completion_tokens_details.reasoning_tokens` → PRESERVED as `providerMetadata.reasoningTokens`
- `usage.prompt_tokens` → PRESERVED as `providerMetadata.promptTokens`
- `usage.completion_tokens` → PRESERVED as `providerMetadata.completionTokens`

**Provider identity**: `provider: 'jev'` (NOT 'openrouter' — provider identity is the Jev boundary, not the wire protocol)

**Failure behavior**:
- missing `OPENROUTER_API_KEY` env → throws `JevCredentialMissingError` (synchronous, no HTTP call)
- HTTP non-200 → throws `JevProviderUnavailableError` (with non-secret status code)
- HTTP timeout (no response in 30s) → throws `JevProviderTimeoutError`
- malformed JSON in `choices[0].message.content` → throws `JevMalformedResponseError`
- parsed `choice` not in `request.options` → throws `JevInvalidChoiceError`
- HTTP 401/403 → throws `JevCredentialInvalidError` (no secret echo)

**Fallback policy (Section 27)**: NONE. JevDecisionProvider does NOT silently fall back to Rule or any other provider. If Jev fails, the failure propagates as a thrown error. The benchmark harness catches the error and records `outcome: 'failure'` with the error class. Production callers may catch and choose to fall back, but the JevDecisionProvider itself never hides a failure.

---

## 7. Metrics

Per-decision-class metrics recorded for each arm:

| Metric | Source | Notes |
|--------|--------|-------|
| decision_correctness | expected_choice === arm.choice | boolean per case |
| constraint_satisfaction | (always true for these cases — no constraints outside `options`) | n/a |
| invalid_choice_rate | arm.choice not in request.options | recorded for Jev only (Rule never produces invalid choices by construction) |
| abstention_escalation | arm returned 'I don't know' equivalent | n/a — Jev must choose; failures recorded separately |
| confidence_behavior | Jev providerMetadata.reasoningTokens + observation of repeated cases | qualitative: "observed confidence behavior", NOT statistical calibration (sample too small) |
| latency_ms | t_request_sent to t_response_parsed | measured at provider boundary (not whole mission) |
| provider_failures | count of failed calls per arm | Jev only (Rule never fails) |
| retry_count | 0 for both arms (no retries at provider boundary) | n/a |
| cost_usd | Jev: usage.cost from OpenRouter response; Rule: 0 | labeled COST_SOURCE = OBSERVED for Jev, ESTIMATED=$0 for Rule |
| consistency | 5 cases repeated twice (B1, B2, C1, D1, F1) to observe stability | small sample — observation only, no statistical claim |

**Aggregate per arm:**
- total_calls
- successful_calls
- failed_calls
- total_cost_usd
- avg_latency_ms
- correctness_rate (correct / successful_calls, NOT correct / total — failures are not "incorrect", they are failures)

**Per-decision-class breakdown** (the scientifically meaningful unit, per Section 55):
- For each (family × arm): correct, failed, invalid, total, avg_latency, avg_cost

---

## 8. Jev Call Budget

**Maximum Jev calls in benchmark**: 29 (one per case) + 5 (consistency repeats for B1, B2, C1, D1, F1) + 6 (failure-behavior tests: missing credential, invalid credential, timeout simulation, malformed response, invalid choice, provider unavailable) = **40 Jev calls maximum**.

**Estimated cost**: Round-2 probe observed $0.00006-$0.0003 per call. Upper bound: 40 × $0.0003 = **$0.012 USD**. Well below any "modest development experiment budget" threshold.

**Cost ceiling**: $1.00 USD (500× safety margin over estimate). If actual cost approaches $0.50 USD, halt and report `BENCHMARK_COST_REVIEW_REQUIRED`.

**COST_SOURCE**:
- OBSERVED for Jev calls (OpenRouter returns `usage.cost` in response body)
- ESTIMATED ($0) for Rule calls (no API call)

---

## 9. Success Criteria (for Jev adoption decision)

Jev will be classified `ADOPT_TARGETED` for a decision class iff ALL hold:
1. correctness_rate on that class ≥ 0.80 (≥4/5 or ≥3/4 correct)
2. latency < 5000ms p50 on that class (rule latency is <1ms; Jev must not be unboundedly slow)
3. total Jev cost across all classes < $0.50 USD
4. invalid_choice_rate < 0.20 on that class
5. No critical failure behavior gap (credential missing, malformed response, etc.) — must be tested and shown to fail loudly, not silently

Jev will be classified `ADOPT_OPTIONAL` iff:
- 1-4 hold for at least one class, but no class shows Jev materially outperforming Rule (i.e., Jev does not correctly handle a case the Rule gets wrong, OR Rule is already 100% correct on the class so Jev adds no value)

Jev will be classified `DEFER_MORE_EVIDENCE` iff:
- correctness_rate is between 0.50 and 0.80 on a class, OR
- failure behavior is correct but sample is too small to claim adoption (e.g., only 4 cases per class)

Jev will be classified `REJECT_FOR_V1` iff:
- correctness_rate < 0.50 on all classes where Rule is correct, AND
- Jev provides no measurable improvement on the bounded-probabilistic cases (A3, F1-F4) where Rule might be wrong

---

## 10. Tie-breaking Rules

- If Jev and Rule both produce the correct choice, the winner per case is **Rule** (lower cost, lower latency, deterministic).
- If Jev produces the correct choice and Rule produces the wrong choice (only possible on bounded-probabilistic cases where Rule is wrong), the winner per case is **Jev**.
- If both produce wrong choices, neither wins; case is `tie-wrong`.
- If Jev fails (throws), the case is `jev-failure` (not a Jev win, not a Jev loss for correctness — recorded separately as a failure metric).

---

## 11. Known Limitations

1. **Small sample size per class** (4-6 cases per family). Statistical significance is NOT claimed. The benchmark is observational.
2. **Single session**. No longitudinal evidence.
3. **Rule arm reimplements production rules** rather than calling production code in every case. Where reimplementation diverges from production, the divergence is documented. (Reimplementation is necessary because production rules are embedded in non-DecisionProvider modules like `goal-compiler.ts`.)
4. **No LLM/GLM arm** (excluded per Section 5 above).
5. **No statistical arm** (NOT_MATERIAL per census).
6. **Ground truth for F1-F4 (domain-classification) and A3 (coordinator-decision) is semantic_consensus**, recorded by the case author. These are the cases where Rule could plausibly be wrong, so they are the highest-value cases for Jev to demonstrate improvement.
7. **Jev is a router** (per round-2 probe, it routes to deepseek-v4.1-flash via Together). The benchmark measures the Jev router's behavior, not any specific sub-model's. Routing decisions are opaque to us.
8. **Confidence calibration** is NOT established. `providerMetadata.reasoningTokens` is observed but not statistically calibrated.
9. **Latency measurement** includes network round-trip; Rule latency is process-local.

---

## 12. Routing Recommendation (FROZEN AFTER BENCHMARK)

The benchmark's adoption decision will produce exactly one of:
- ADOPT_TARGETED with explicit routing rule (e.g., "DETERMINISTIC→Rule; BOUNDED_PROBABILISTIC→Jev IF evidence supports")
- ADOPT_OPTIONAL (Jev available as a deployer-choice provider, not preferred)
- DEFER_MORE_EVIDENCE
- REJECT_FOR_V1

The decision is **emergent from evidence**, not pre-registered as the conclusion.

---

## 13. Real Genesis Integration Probe (Conditional)

Per Section 35: if Jev shows sufficient promise in isolated benchmark cases (≥1 class ADOPT_TARGETED), execute one bounded real Genesis decision path using JevDecisionProvider.

Candidate path: `Goal → Requirements → bounded decision (reasoning-tier for sole operator) → JevDecisionProvider → selected tier → GenomeCompiler → MissionOrchestrator → Verification`.

If Jev is clearly REJECT_FOR_V1 based on benchmark evidence:
- Do NOT force integration
- Document `REAL_GENESIS_JEV_INTEGRATION = NOT_RUN_BECAUSE_REJECTED_BY_BENCHMARK`

---

## 14. Stop Conditions

This pre-registration freezes the design. After this point, execution begins.
Observations during execution that diverge from predictions are recorded in `final-analysis.md` as `observation` or `corrigendum` blocks — NOT by editing this pre-registration.

---

## 15. Anti-Bloat Gate (per Section 47)

Baseline (recorded before implementation):
- START_PRODUCTION_FILES = 42
- START_PRODUCTION_LOC = 12217

G6-03 triggers:
- > 5 new production files → REVIEW
- > 800 net new production LOC → REVIEW
- > 1 new production module → REVIEW
- > 1 new runtime dependency → REVIEW
- new storage technology → REVIEW
- new infrastructure service → REVIEW

**Planned production changes for G6-03:**
- 1 new production file: `src/providers/jev-decision-provider.ts` (thin adapter, ~150-200 LOC)
- 0 changes to existing production files (no edits to decision-provider.ts, cognitive-router.ts, contracts/core.ts)
- 0 new runtime dependencies (uses native fetch; no `openai`/`@openrouter/sdk`/etc.)
- 0 new storage technologies
- 0 new infrastructure services

**Planned non-production changes (do not count toward the gate):**
- `experiments/g6-03/**` — corpus, harness, evidence
- `tests/providers/jev-decision-provider.test.ts` — unit tests
- `docs/group6/GENESIS_G6_03_JEV_DECISION_BENCHMARK.md` — documentation

Expected: PRODUCTION_FILES_DELTA = +1, PRODUCTION_LOC_DELTA = ~150-200, ANTI_BLOAT_GATE = PASS.

If actual delta exceeds the gate, halt and return `DESIGN_REVIEW_REQUIRED`.

---

## 16. Validation Plan (post-implementation)

1. `npx tsc --noEmit` — typecheck PASS
2. `npx vitest run` — all existing tests still pass + new tests pass
3. `npx eslint .` — lint PASS
4. No existing test weakened to accommodate Jev

---

## 17. Push Plan

1. Coherent commits (3 conceptual groups):
   - Commit 1: minimal JevDecisionProvider + tests
   - Commit 2: benchmark/evidence (experiments/g6-03/**)
   - Commit 3: documentation (docs/group6/GENESIS_G6_03_JEV_DECISION_BENCHMARK.md + final analysis)
2. Push to `build/group-06-productionization`
3. Verify LOCAL_HEAD == REMOTE_HEAD
4. After verification, delete vault credentials

---

**End of pre-registration. Frozen at 2026-10-07T16:48:00Z.**
