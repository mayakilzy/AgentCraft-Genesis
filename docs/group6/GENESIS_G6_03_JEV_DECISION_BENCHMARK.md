# GENESIS_G6_03_JEV_DECISION_BENCHMARK

**Date:** 2026-10-07
**Mission:** G6-03 — Jev Decision Benchmark (Evidence-Based Decision Provider Evaluation)
**Status:** PASS_WITH_LIMITATION
**Branch:** `build/group-06-productionization` (continued from G6-02)
**Start HEAD:** `f91442b5cf66356e0e7f011d13638cd0d7451fe7`
**Final HEAD:** (recorded at commit time)

> Central question (Section 0): Determine whether Jev provides measurable,
> defensible value inside AgentCraft Genesis DecisionProvider.
>
> Answer after G6-03: **ADOPT_OPTIONAL** — Jev works correctly on most
> decision classes but provides **no measurable improvement** over the
> existing Rule baseline. Jev remains available as a deployer-choice
> provider; production wiring continues to use `RuleDecisionProvider`.

---

## 1. Mission Summary

G6-03 evaluated whether Jev (accessible via OpenRouter as
`typesafe/jev-router`) provides measurable, defensible value inside the
Genesis DecisionProvider surface. The evaluation was a benchmark, not an
integration: the goal was to determine IF, WHERE, and UNDER WHAT CONDITIONS
Jev should be used — not to integrate it because it exists.

The benchmark followed a strict scientific protocol (pre-registration,
decision census, decision corpus, provider arms, ground truth, metrics,
failure probes, analysis). All evidence is recorded under
`experiments/g6-03/`.

**Outcome:** Jev works correctly on 23/29 cases (79%) but never
outperforms the Rule arm on any decision class. The Rule arm is 100%
correct on 5 of 6 families; Jev matches it only on 2 families (where
Rule is also imperfect, and on the one case where Rule is wrong, Jev was
also wrong). Jev is operationally worse: 3-4 orders of magnitude higher
latency, non-zero cost, and 7% failure rate (null-content responses from
the reasoning model).

---

## 2. Decision Census

The Decision Census (`experiments/g6-03/corpus/decision-census.json`)
inventoried every bounded decision point in Genesis. Total: 33 decisions.

| Classification | Count |
|----------------|-------|
| DETERMINISTIC | 17 |
| BOUNDED_PROBABILISTIC | 13 |
| OPEN_SEMANTIC (above bounded decisions, excluded from corpus) | 2 |
| UNSUITABLE_FOR_BENCHMARK | 0 |

**Statistical-arm finding: STATISTICAL_ARM = NOT_MATERIAL**

The `DecisionProvider` contract (`src/contracts/core.ts:403-404`) accommodates
a statistical arm, but no implementation exists in Genesis. The closest
analog, `StatisticalCandidateGenerator`, is a deterministic set-intersection
computation over Experience aggregation — NOT a probabilistic estimator over
bounded option sets at request-time. Per G6-03 mission Section 20, no
statistical arm was fabricated for the benchmark.

The four highest-value probabilistic targets (per census) are:
- D04 domain classification
- D05 capability need extraction
- D21 failure classification
- D25 verification diagnosis

The benchmark corpus includes cases from D04 (Family F1-F4), D25 (Family
E1-E4), and adjacent decisions (D09, D01, D13, D10, D06).

---

## 3. Benchmark Methodology

### 3.1 Pre-registration

`experiments/g6-03/pre-registration.md` — frozen before benchmark
execution began. The pre-registration defines:

- Central question (Jev's defensible value)
- Decision Census summary (33 decisions, NOT_MATERIAL statistical arm)
- Decision Corpus (29 cases across 6 families)
- Ground truth methods (3: deterministic, genesis_rule_baseline,
  semantic_consensus)
- Leakage prevention (`expected_choice` is never in provider-visible input)
- Provider arms (Rule, Jev; Statistical=NOT_MATERIAL, LLM=NOT_INCLUDED)
- Jev integration specs (endpoint, model, auth, request/response mapping)
- Failure behavior (typed errors, no silent fallback)
- Metrics (per-decision-class: correctness, latency, cost, failures,
  confidence observation; aggregate per arm)
- Jev call budget (40 calls max, $0.012 estimated, $1.00 hard ceiling)
- Success criteria for ADOPT_TARGETED / ADOPT_OPTIONAL / DEFER_MORE_EVIDENCE
  / REJECT_FOR_V1
- Tie-breaking rules
- Known limitations
- Anti-bloat gate plan
- Validation plan
- Push plan

The pre-registration is **immutable**. Corrections are recorded as
`observation` or `corrigendum` fields. The corpus was bumped from
v1.0.0 to v1.0.1 with a documented corrigendum fixing 21 contract
violations in facts values (arrays were stored as JSON arrays; the
`Decision<T>.facts` contract requires string|number|boolean).

### 3.2 Decision Corpus

`experiments/g6-03/corpus/decision-corpus.json` — 29 cases across 6
families:

| Family | Decision Kind | Cases | Source Decision |
|--------|---------------|-------|-----------------|
| A | coordinator-decision | 4 | D09 |
| B | reasoning-tier | 5 | D01 |
| C | worker-retry-vs-fail | 5 | D13 + D25 |
| D | pattern-apply-vs-ignore | 5 | D10 + D30 |
| E | verification-diagnosis | 4 | D24 + D25 |
| F | domain/scope-classification | 6 | D04 + D06 |
| **Total** | 6 decision kinds | **29** | |

### 3.3 Ground Truth

Three methods (per pre-reg Section 4):

1. `deterministic_known_answer` — when the rule is exhaustive and the answer
   is a definitional fact
2. `genesis_rule_baseline` — when the existing Genesis rule is the baseline;
   ground truth is what the rule produces for these inputs
3. `semantic_consensus` — when no deterministic ground truth exists; the
   case author records the consensus answer with rationale (used on 4
   cases: A3, F1, F2, F3, F4 — all bounded-probabilistic)

**Self-grading prohibition** (Section 17): No Jev-graded-Jev. Ground truth
is fixed at pre-registration time.

**Leakage prevention** (Section 18): `expected_choice` is NEVER in the
provider-visible `Decision<T>` object. The harness reads ground truth
from the corpus file after the provider returns its choice.

### 3.4 Provider Arms

Two arms evaluated:

- **Rule** (`experiments/g6-03/arms/rule-arm.ts`) — re-implementations of
  the actual Genesis rules, dispatched per `request.kind`. Where Genesis
  has a real `DecisionProvider` for the kind (e.g., `reasoning-tier`), the
  Rule arm calls into it. Where the rule is embedded in another module
  (e.g., `classifyDomain` in `goal-compiler.ts`), the Rule arm
  re-implements the same logic to keep the experiment self-contained.
- **Jev** (`src/providers/jev-decision-provider.ts`) — the new thin
  adapter, pinned to `typesafe/jev-router` on OpenRouter.

The Statistical arm is `NOT_MATERIAL` (per census). The LLM/GLM arm is
excluded (per pre-reg Section 5: no GLM API available without using
OpenRouter for non-Jev, which is forbidden).

### 3.5 Metrics

Per-decision-class (the scientifically meaningful unit, per G6-03 mission
Section 55):

- decision correctness
- constraint satisfaction (always true for these cases — no constraints
  outside `options`)
- invalid-choice rate (Jev only — Rule never produces invalid choices by
  construction)
- abstention/escalation (n/a — Jev must choose; failures recorded
  separately)
- confidence behavior (observed, NOT statistically calibrated — sample too
  small per pre-reg Section 25)
- latency (measured at provider boundary, not whole mission)
- provider failures
- retry count (0 for both arms — no retries at provider boundary)
- cost (Jev: observed from `usage.cost`; Rule: $0)

Aggregate per arm: total calls, successful calls, failed calls, total
cost, average latency, correctness rate.

---

## 4. Jev Integration

### 4.1 Jev Access Verification

- `REAL_JEV_ACCESS = YES`
- `JEV_ENDPOINT_USED = https://openrouter.ai/api/v1/chat/completions`
- `JEV_MODEL_USED = typesafe/jev-router` (a router that delegates to
  sub-models; the round-2 probe observed `deepseek/deepseek-v4.1-flash`
  via Together as the underlying model)
- `JEV_API_INTERFACE = OpenRouter Chat Completions API (OpenAI-compatible)`
  with `response_format: { type: 'json_schema', strict: true }` enforcing
  `{ choice: enum[...options], reason: string }`

The connectivity probe (`scripts/jev_probe.ts` and
`scripts/jev_probe_round2.ts`) verified:
- The model is reachable via the supplied credential
- The model supports `response_format: json_schema` and returns valid JSON
- The model is a "reasoning" model (returns `message.reasoning` and
  `reasoning_details` fields alongside `message.content`)
- Pricing is provided by OpenRouter in `usage.cost` (USD, observed)
- Latency is 900ms - 7000ms per call (with reasoning tokens)

### 4.2 JevDecisionProvider Implementation

`src/providers/jev-decision-provider.ts` — a single thin adapter, 376 LOC
including rich JSDoc.

**Credential boundary (structural, not instructional):**

1. **Model pinning**: `JEV_MODEL = 'typesafe/jev-router'` is a `const`
   with no setter, no constructor parameter to override. The
   `JevDecisionProviderOptions` interface exposes only `envVarName`,
   `fetchImpl`, `testCredential` — no `model` field.
2. **Endpoint pinning**: `JEV_ENDPOINT` is also a `const`.
3. **No generic chat surface**: the adapter exposes only
   `DecisionProvider.decide(request: Decision<T>): Promise<DecisionOutcome<T>>`.
   No `chat()`, no `complete()`, no `messages` parameter.
4. **Per-call response schema**: `response_format: json_schema` is
   constructed dynamically per call from the request's `options` array,
   structurally preventing the model from returning a choice outside the
   requested set. If it does, `JevInvalidChoiceError` is thrown.
5. **Failure is loud**: any failure (missing/invalid credential, HTTP
   non-200, timeout, malformed response, invalid choice) throws a typed
   error. NO hidden fallback to Rule.

### 4.3 Request Mapping

The adapter maps the Genesis `Decision<T>` to the Jev request:

- `system`: a pinned prompt instructing the model to choose exactly one
  option from the provided set
- `user`: rendered decision prompt (`kind`, `question`, `options`,
  `facts`)
- `response_format`: `{ choice: enum[...options], reason: string }`
- `max_tokens`: 256 (allows reasoning + final answer)
- `temperature`: 0

### 4.4 Response Mapping

The adapter maps the Jev response into existing Genesis `DecisionOutcome`
semantics (no contract redesign):

- `choices[0].message.content` → JSON-parsed → `choice` (verified in
  `request.options`) and `reason` (capped at 500 chars)
- `choices[0].message.reasoning` → `providerMetadata.reasoningExcerpt`
  (capped at 500 chars — structured metadata, NOT chain-of-thought
  persistence)
- `usage.cost` → `providerMetadata.costUsd`
- `usage.prompt_tokens` → `providerMetadata.promptTokens`
- `usage.completion_tokens` → `providerMetadata.completionTokens`
- `usage.completion_tokens_details.reasoning_tokens` →
  `providerMetadata.reasoningTokens`
- measured latency → `providerMetadata.latencyMs`

`provider: 'jev'` (not `'openrouter'` — provider identity is the Jev
boundary, not the wire protocol).

### 4.5 Failure Behavior

Per G6-03 mission Section 26, the following failure modes are tested:

| Failure Mode | Error Class | Behavior |
|--------------|-------------|----------|
| Missing credential | `JevCredentialMissingError` | Synchronous, no HTTP call |
| HTTP 401/403 | `JevCredentialInvalidError` | No secret echo |
| HTTP non-200 (other) | `JevProviderUnavailableError` | Body excerpt (no secrets) |
| Timeout (no response in 30s) | `JevProviderUnavailableError` | Network-error path |
| Malformed JSON content | `JevMalformedResponseError` | Content excerpt (no secrets) |
| Choice not in options | `JevInvalidChoiceError` | Rejects the choice; no fallback |

**Decision fallback policy (Section 27):** NONE. Jev failure propagates
as a thrown error. No hidden fallback to Rule. Production callers may
catch and explicitly fall back, recording provider identity and fallback
reason in FlightRecorder.

---

## 5. Benchmark Results

### 5.1 Per-Family Results

| Family | Rule Correctness | Jev Correctness | Jev Failures | Jev Avg Latency | Jev Avg Cost/call | Best Provider |
|--------|------------------|-----------------|--------------|-----------------|-------------------|---------------|
| A (coordinator-decision) | 3/4 (75%) | 3/4 (75%) | 0 | 3560ms | $0.0003 | TIE (Rule preferred by cost/latency) |
| B (reasoning-tier) | 5/5 (100%) | 4/5 (80%) | 0 | 2525ms | $0.0002 | Rule |
| C (worker-retry-vs-fail) | 5/5 (100%) | 5/5 (100%) | 0 | 2958ms | $0.0003 | Rule |
| D (pattern-apply-vs-ignore) | 5/5 (100%) | 3/5 (60%) | 1 | 3868ms | $0.0002 | Rule |
| E (verification-diagnosis) | 4/4 (100%) | 3/4 (75%) | 1 | 4510ms | $0.0001 | Rule |
| F (domain/scope-classification) | 6/6 (100%) | 5/6 (83%) | 0 | 3493ms | $0.0002 | Rule |

**Aggregate:** Rule 28/29 (97%); Jev 23/29 (79%). Rule was wrong only on
A3 (a deliberately bounded-probabilistic case). Jev was also wrong on A3.

### 5.2 Cost & Latency

| Metric | Rule | Jev |
|--------|------|-----|
| Total calls | 29 | 34 (29 + 5 consistency repeats) |
| Successful calls | 29 | 27 (2 failures: null content responses) |
| Total cost (USD) | $0.0000 | $0.0074 (COST_SOURCE = OBSERVED) |
| Avg cost / call | $0 | $0.00022 |
| Avg latency | 0.07ms | 3448ms (~50,000× slower) |
| Min latency | 0ms | 1327ms |
| Max latency | 1ms | 6793ms |

Cost ceiling of $1.00 was not approached (used 0.74% of budget).

### 5.3 Failure Behavior Probes

All 7 failure-behavior probes PASSED:

| Probe | Description | Outcome |
|-------|-------------|---------|
| F1 | Missing credential → `JevCredentialMissingError` | PASS |
| F2 | HTTP 401 → `JevCredentialInvalidError` | PASS |
| F3 | HTTP 500 → `JevProviderUnavailableError` | PASS |
| F4 | Timeout / network → `JevProviderUnavailableError` | PASS |
| F5 | Malformed response → `JevMalformedResponseError` | PASS |
| F6 | Invalid returned choice → `JevInvalidChoiceError` | PASS |
| F7 | No silent fallback — failure surfaces as thrown error | PASS |

**No false-success path observed.**

### 5.4 Confidence Observations (no calibration claim)

- Jev correctness on `correct` outcomes: 23/29 (79%)
- Jev correctness on `incorrect` outcomes: 4/29 (14%)
- Jev failure (null content): 2/29 (7%)

Consistency (5 cases repeated twice):
- B1: incorrect → incorrect (consistently wrong)
- B2: correct → correct (consistent)
- C1: correct → correct (consistent in this run; was inconsistent in
  the prior run — see corrigendum in `final-analysis.md`)
- D1: correct → correct (consistent)
- F1: correct → correct (consistent)

**No statistical calibration claim.** Sample is too small (5 repeats,
29 cases) per pre-reg Section 25.

---

## 6. Adoption Decision

**JEV_ADOPTION_DECISION = `ADOPT_OPTIONAL`**

Per pre-reg Section 9, Jev is `ADOPT_OPTIONAL` because:
1. Jev meets correctness ≥ 0.80 on 3 classes (B, C, F)
2. Jev meets latency < 5000ms p50 on 3 classes (B, C, F)
3. Jev total cost < $0.50 ($0.0074 used)
4. Jev invalid_choice_rate = 0 (no invalid choices returned)
5. No critical failure behavior gap (all 7 probes pass)
6. But Jev provides NO measurable improvement over Rule on any class

Per pre-reg Section 9: "Jev will be classified `ADOPT_OPTIONAL` iff: 1-4
hold for at least one class, but no class shows Jev materially
outperforming Rule (i.e., Jev does not correctly handle a case the Rule
gets wrong, OR Rule is already 100% correct on the class so Jev adds no
value)."

This is the case: Rule is 100% correct on B, C, D, E, F. Jev is 80-100%
on those classes. On A (where Rule is 75%), Jev is also 75% (tied), and
on the one case (A3) where Rule is wrong, Jev was also wrong.

### 6.1 Routing Policy

`DECISION_ROUTING_POLICY_CREATED = NO`

Per pre-reg Section 12, ADOPT_OPTIONAL does NOT require a routing policy.
Production wiring continues to use `RuleDecisionProvider`
(`repo-mission.ts:117` — unchanged).

Deployers who want to experiment with Jev can construct
`new JevDecisionProvider()` explicitly. Missing credentials fail loudly
via `JevCredentialMissingError`.

### 6.2 Optional Provider Semantics

Per G6-03 mission Section 44: Genesis must still function without Jev
credentials unless Jev becomes an explicitly required deployment capability.

This is satisfied:
- `JevDecisionProvider` is constructed only when explicitly requested
- Production `repo-mission.ts:117` still wires `RuleDecisionProvider` (no change)
- Missing Jev credentials fail clearly when Jev is requested
- The Genesis engine does NOT fail to start when Jev credentials are absent

### 6.3 Real Genesis Integration Probe

`REAL_GENESIS_JEV_INTEGRATION = NOT_RUN`

Per pre-reg Section 13: "if Jev shows sufficient promise in isolated
benchmark cases (≥1 class ADOPT_TARGETED), execute one bounded real
Genesis decision path using JevDecisionProvider."

No class reached ADOPT_TARGETED (because Rule is 100% correct on all
classes where Jev meets the correctness threshold). The integration probe
is conditional on ADOPT_TARGETED; the condition is unmet.

- `JEV_CAUSALLY_CHANGED_GENESIS_DECISION = NOT_TESTED`
- `DOWNSTREAM_VERIFICATION = NOT_RUN`
- `FALSE_SUCCESS_PATH = NONE_OBSERVED`

---

## 7. Credential Boundary & Scope

```
OPENROUTER_USED_FOR_JEV = YES
OPENROUTER_USED_FOR_NON_JEV = NO
OPENROUTER_CHAT_COMPLETIONS_USED = YES (Jev-only, never for non-Jev models)
GLM_USED_FOR_DEVELOPMENT_REASONING = YES (not relevant to this benchmark)
JEV_ONLY_CREDENTIAL_BOUNDARY = PROVEN (structural — see Section 4.2)
SECRET_LEAKAGE = NONE_OBSERVED
```

The credential is:
- Read from `OPENROUTER_API_KEY` env var at provider construction
- NEVER serialized into the request body (used only in `Authorization`
  header, which is not logged or echoed)
- NEVER logged
- NEVER echoed in errors (the error taxonomy strips all credential-shaped
  strings)
- NEVER returned in `providerMetadata`
- NEVER recorded by FlightRecorder (the existing `SECRET_PATTERNS` regex
  catches OpenRouter-shaped keys via `/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/gi`)

---

## 8. Observability for G7

The `JevDecisionOutcome` carries `providerMetadata` with structured fields
that improve G7 backend readiness:

- `endpoint`, `model` — Jev-specific identity
- `latencyMs` — measured at provider boundary
- `promptTokens`, `completionTokens`, `totalTokens` — token usage
- `reasoningTokens` — separate count for reasoning-only tokens
- `costUsd` — observed cost (OBSERVED source, not ESTIMATED)
- `reasoningExcerpt` — capped at 500 chars; structured decision metadata,
  NOT chain-of-thought persistence

G7 surfaces (Mission Control, Replay, Insights, Decision Explainability)
can answer the questions from pre-reg Section 36:
- "What decision was made?" — `choice`
- "Which provider made it?" — `provider: 'jev'` or `'rule-v0.1'`
- "What options existed?" — `request.options` (visible in caller's
  FlightRecorder event)
- "Why was this provider selected?" — caller records this; provider
  records its own reason
- "What confidence was reported?" — `providerMetadata.reasoningTokens`
  (observed, not statistically calibrated)
- "Did fallback occur?" — `providerMetadata` would record a
  `fallbackReason` field if explicit fallback occurred (production
  callers must populate this; the provider itself does not silently
  fall back)
- "What did it cost?" — `providerMetadata.costUsd`
- "How long did it take?" — `providerMetadata.latencyMs`

```
G7_DECISION_EXPLAINABILITY_READINESS_CHANGE = IMPROVED
G7_PERFORMANCE_INSIGHTS_READINESS_CHANGE = IMPROVED
G7_REPLAY_READINESS_CHANGE = NEUTRAL (Jev decision can be replayed
  structurally, but Jev is non-deterministic; replay reproduces the
  decision, not the model's response)
```

---

## 9. Complexity Accounting

```
START_PRODUCTION_FILES = 42
FINAL_PRODUCTION_FILES = 43
PRODUCTION_FILES_DELTA = +1

START_PRODUCTION_LOC = 12217
FINAL_PRODUCTION_LOC = 12593
PRODUCTION_LOC_DELTA = +376

NEW_MODULES = 1 (src/providers/)
NEW_CONTRACTS = 0 (JevDecisionProvider implements existing DecisionProvider)
NEW_RUNTIME_DEPENDENCIES = 0 (uses native fetch)
NEW_STORAGE_TECHNOLOGIES = 0

ANTI_BLOAT_GATE = PASS
```

The single new production module `src/providers/` is justified: it
isolates the Jev adapter from `src/routing/` to make the credential
boundary visually and structurally obvious. The pre-registration planned
this exact delta.

The +376 LOC includes ~210 LOC of implementation and ~166 LOC of JSDoc
documentation required by the credential-boundary discipline.

Non-production additions (NOT counted against the gate):
- `experiments/g6-03/**` — corpus, harness, evidence (~600 LOC across 4 files)
- `tests/providers/jev-decision-provider.test.ts` — 22 unit tests (~280 LOC)

---

## 10. Validation

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS |
| `npx vitest run` (full suite) | PASS (455 + 22 new tests = 477 passed, 9 skipped, 486 total) |
| `npx vitest run tests/providers/jev-decision-provider.test.ts` | PASS (22 new tests) |
| `npx eslint .` | PASS |
| Existing tests weakened for Jev | NONE |
| Real Jev benchmark | PASS (29 cases, 27 successful, 2 failed-loud) |

---

## 11. Documentation Updates

- **Architecture Map**: NO change. Jev is NOT adopted in production wiring;
  the architecture does not include Jev.
- **Interop map**: NO change. Jev is unrelated to A2A/MCP/AG-UI.
- **ownership.yaml**: NO change. Jev is a DecisionProvider (decision
  layer), not a capability provider.
- **dependency-baseline.json**: NO change. Jev is NOT added as a runtime
  dependency (the adapter uses native fetch; no OpenRouter SDK added).
  The Jev entry in `dependency-baseline.json` remains as documented
  (`status: experimental`, `decision: EXPERIMENTAL PROVIDER...`).

---

## 12. Limitations

1. **Small sample size** (29 cases, 6 families, 4-6 cases per family).
   No statistical significance claimed.
2. **Single session**. Longitudinal Jev router behavior not tested.
3. **No LLM/GLM arm** (per pre-reg Section 5).
4. **No statistical arm** (NOT_MATERIAL per census).
5. **Adversarial coverage**: the corpus is representative of real Genesis
   decisions but not adversarial. A future benchmark with edge cases
   designed to make Rule fail might reveal Jev value not measured here.
6. **Jev router opacity**: the underlying model is `deepseek/deepseek-v4.1-flash`
   via Together (observed in round-2 probe). Jev's routing decisions are
   opaque. The benchmark measures the router's behavior, not any specific
   sub-model's.
7. **Confidence calibration**: NOT established. `reasoningTokens` is
   observed but not statistically calibrated.
8. **Latency measurement**: includes network round-trip; Rule latency is
   process-local.
9. **2 null-content failures** (D3, E4) were treated as failures (loud
   throws). They could alternatively be treated as abstention. The
   pre-registration did not specify abstention semantics; the
   implementation chose the conservative path.

---

## 13. Deferred Work

```
DEFERRED_TO_G6_04 = adversarial Jev benchmark (cases designed to make Rule fail)
DEFERRED_TO_G6_05 = (none)
DEFERRED_TO_G6_06 = (none)
POST_V1 = Jev evaluation under real LLM worker conditions (when Academy
  missions run with non-scripted reasoning)
```

---

## 14. Final Principles (verified)

- **Jev is being evaluated, not crowned.** ✓ (ADOPT_OPTIONAL, not ADOPT_TARGETED)
- **Decision intelligence does not equal authority.** ✓ (Jev is advisory; production wiring unchanged)
- **Use deterministic rules when the answer is deterministic.** ✓ (Rule remains the production default)
- **Use probabilistic decision intelligence only where uncertainty is real.** ✓ (No class reached ADOPT_TARGETED)
- **Jev is a provider, not a dependency.** ✓ (No new runtime dependency)
- **The benchmark must be capable of proving that Jev is unnecessary.** ✓ (it did)
- **OpenRouter is authorized for Jev only.** ✓ (JEV_ONLY_CREDENTIAL_BOUNDARY = PROVEN, structural)
- **Development fallback is not production evidence.** ✓ (no fallback used in benchmark)
- **No observed evidence → no factual claim.** ✓
- **No benchmark leakage.** ✓ (expected_choice never in provider-visible input)
- **No self-grading.** ✓ (ground truth fixed at pre-reg time)
- **No hidden fallback.** ✓ (F7 probe PASS — failures surface as thrown errors)
- **No secret leakage.** ✓ (SECRET_LEAKAGE = NONE_OBSERVED)
- **No chain-of-thought persistence.** ✓ (reasoningExcerpt is structured metadata, capped at 500 chars)
- **Evidence before adoption.** ✓
- **Truth before elegance.** ✓

---

## 15. GO / NO-GO

```
SAFE_TO_BEGIN_G6_04 = YES

JEV_DECISION_LAYER_STATUS = ADOPT_OPTIONAL
  (JevDecisionProvider available as a thin adapter; NOT wired into
  production; missing credentials fail loudly; Rule remains production default)

MAJOR_REMAINING_DECISION_RISK = NONE
  (The Rule baseline is preserved; no production path uses Jev;
  credentials are deleted at session end per G6-03 Section 61)

MAJOR_REMAINING_G7_BACKEND_RISK = NONE
  (Decision telemetry is improved via providerMetadata; no new
  infrastructure required for G7)

NEXT_RECOMMENDED_ACTION = G6-04 (Release Candidate + Reproducibility Gate)
```

---

## 16. References

- `experiments/g6-03/pre-registration.md` — frozen pre-registration
- `experiments/g6-03/corpus/decision-census.json` — 33-decision census
- `experiments/g6-03/corpus/decision-corpus.json` — 29-case corpus (v1.0.1)
- `experiments/g6-03/arms/rule-arm.ts` — Rule benchmark arm
- `experiments/g6-03/run-benchmark.ts` — benchmark harness
- `experiments/g6-03/evidence/benchmark-results.json` — per-case results
- `experiments/g6-03/evidence/cost-summary.json` — cost summary
- `experiments/g6-03/evidence/latency-summary.json` — latency summary
- `experiments/g6-03/evidence/confidence-observations.json` — confidence data
- `experiments/g6-03/evidence/jev-provider-environment.json` — Jev environment
- `experiments/g6-03/evidence/integration-probe.json` — integration probe status
- `experiments/g6-03/evidence/final-analysis.md` — final analysis (this document's source)
- `src/providers/jev-decision-provider.ts` — the thin adapter (production)
- `tests/providers/jev-decision-provider.test.ts` — 22 unit tests
- `docs/group6/GENESIS_G6_03_JEV_DECISION_BENCHMARK.md` — this document

---

**End of G6-03 documentation.**
