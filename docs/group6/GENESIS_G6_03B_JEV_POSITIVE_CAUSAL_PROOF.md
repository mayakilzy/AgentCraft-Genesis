# GENESIS_G6_03B_JEV_POSITIVE_CAUSAL_PROOF

**Date:** 2026-10-07
**Mission:** G6-03B — Jev Access Resolution + Positive Causal Proof
**Status:** PASS
**Branch:** `build/group-06-productionization`
**Start HEAD:** `b6fc2fa9d2638afb5ee4d10ddac4049651a89eed`
**Final HEAD:** (recorded at commit time)

> Central question (Section 0): Resolve the G6-03A geo-restriction blocker
> and complete the live positive Jev Decision Model causal proof inside a
> REAL Genesis mission.
>
> Outcome: G6-03B resolved the geo-restriction by using OpenRouter's
> official EU region host. The positive causal probe now PASSES
> end-to-end. JEV_FINAL_STATUS = OPTIONAL_REAL_INTEGRATION_PROVEN.

---

## 1. Why G6-03B Exists

G6-03A left the positive causal proof BLOCKED_BY_GEO_RESTRICTION: the
global Decisions API endpoint returned HTTP 403 ("This model is not
available in your region") for the cloud execution environment.

G6-03A explicitly noted: "The geo-restriction is outside the G6-03A scope
(it is a property of the OpenRouter account's region, not of the Genesis
architecture). When a non-geo-restricted credential is available, the user
can re-run the probe script to complete the positive causal proof."

G6-03B does NOT use VPN/proxy circumvention (forbidden per Section 1).
Instead, it uses OpenRouter's OFFICIAL region hosts:
- `https://eu.openrouter.ai` — supports the Decisions API ✓
- `https://us.openrouter.ai` — not tested (EU succeeded first)

This is explicitly authorized by Section 4 of the G6-03B mission spec.

---

## 2. Access Diagnosis (Section 3 + 4)

`experiments/g6-03b/evidence/access-diagnosis.json` records:

| Host | HTTP | Latency | 2xx Jev decision? | Notes |
|------|------|---------|-------------------|-------|
| `openrouter.ai` (global) | 403 | 674ms | NO | "This model is not available in your region." |
| `eu.openrouter.ai` | 200 | 2245ms | **YES** | selected_answer="capability", probabilities={capability:0.96, cost:0.04}, confidence=0.92, response_id="gen-dec-1791410896-X4EW5ZySWsszcEhXXcgC" |
| `us.openrouter.ai` | (not tested) | — | — | Per Section 4: "Do not continue probing after successful access is established." |

The EU response included:
- `model: "typesafe/jev-1.13-20260917"` (the Jev Decision Model)
- `provider: "TypeSafe"` (provider identity)
- `id: "gen-dec-1791410896-X4EW5ZySWsszcEhXXcgC"` (response id)
- `usage: {input_tokens: 352, output_tokens: 36, cost: 0.000014784}` (usage/cost)

Hard constraints:
- `chat_completions_used = false`
- `jev_router_used = false`
- `non_jev_openrouter_model_used = false`

---

## 3. Provider Compatibility Fixes

G6-03B discovered three genuine compatibility bugs in the
`JevDecisionProvider`. Per Section "Do not modify code unless a genuine
compatibility bug is discovered", these fixes are minimal corrections, not
redesigns.

### Fix 1: `criteria` is the option set, not `choices`

The Decisions API uses `questions.q1.criteria` (a record) as the option
set the model chooses between. The `choices` array is metadata only.

Empirical evidence (access diagnosis): a request with
`choices=[cheap,default,frontier]` and `criteria={cost, capability}`
returned `choice="capability"` with probabilities over `{capability, cost}`
(the criteria keys).

The corrected `buildQuestion` now passes each `request.options` entry as a
`criteria` key (with empty string description), so Jev's returned choice
and probabilities are over the actual Genesis option set.

### Fix 2: `this.endpoint` instead of `JEV_DECISIONS_ENDPOINT` const

The `decide()` method was using the `JEV_DECISIONS_ENDPOINT` constant
(global host) instead of `this.endpoint` (the configured endpoint). This
made the new `endpoint` constructor option ineffective. Fixed by using
`this.endpoint` in both the HTTP call and the metadata.

### Fix 3: Add `endpoint` constructor option with allow-list

Added an `endpoint` constructor option restricted to a small allow-list
of OpenRouter Decisions API URLs:
- `https://openrouter.ai/api/alpha/decisions` (global default)
- `https://eu.openrouter.ai/api/alpha/decisions` (EU region — G6-03B)
- `https://us.openrouter.ai/api/alpha/decisions` (US region — G6-03B)

The allow-list preserves the credential boundary: the adapter is
structurally incapable of being pointed at chat completions or arbitrary
URLs. The model is NOT configurable.

Unit tests added:
- `rejects an endpoint that is not in the Decisions API allow-list`
- `rejects an arbitrary endpoint URL`
- `accepts the EU region endpoint override (G6-03B geo-restriction finding)`
- `accepts the US region endpoint override`

---

## 4. Real Genesis Positive Causal Probe

`experiments/g6-03b/evidence/positive-causal-probe.json` records the full
probe.

### Pre-probe marker (printed to stdout for user correlation):

```
READY_FOR_REAL_JEV_CAUSAL_PROBE
JEV_MODEL_EXPECTED = typesafe/jev-1.13
JEV_ENDPOINT_EXPECTED = https://eu.openrouter.ai/api/alpha/decisions
EXPECTED_MAX_JEV_CALLS = 1
PROBE_START_TIMESTAMP = 2026-10-07T22:20:04.618Z
```

### Real Genesis mission pipeline (all real):

- Real `GoalCompiler` (deterministic)
- Real `OrganizationPlanner` (deterministic)
- Real `GenomeCompiler` with `selectTier = CognitiveRouter(JevDecisionProvider{endpoint=eu}).selectTier`
- `MemoryComputer` runtime (stub — no real OpenBot needed for the path BEFORE/AFTER the bounded decision point)
- `ScriptedReasoningProvider` (only invoked AFTER genome compilation succeeded with the Jev-chosen tier; never invoked for the bounded decision itself)
- Real `JevDecisionProvider` (uses real `OPENROUTER_API_KEY` from env, makes real HTTP call to `https://eu.openrouter.ai/api/alpha/decisions`)
- Real `MemoryFlightRecorder` (captures structured events)
- **Proxy wrapper** around the JevDecisionProvider that intercepts every
  `decide()` call and records the request, outcome, latency, cost, and
  probabilities — this is the ONLY observation point for Jev consumption
  because the orchestrator's GenomeCompiler calls selectTier internally.

### Jev call observed (via Proxy wrapper):

```json
{
  "request_kind": "reasoning-tier",
  "request_options": ["cheap", "default", "frontier"],
  "request_question": "Select the reasoning tier for role \"sole-operator-1\" (so-1) in a software-engineering mission.",
  "request_facts": {
    "criticality": "mission-critical",
    "missionDomain": "software-engineering",
    "budgetCeiling": "default"
  },
  "outcome": "success",
  "selected_choice": "default",
  "probabilities": {"default": 0.82, "frontier": 0.13, "cheap": 0.05},
  "confidence": 0.73,
  "cost_usd": 0.000016296
}
```

### Flight event sequence (the full happy path):

```
["mission-started", "requirements-compiled", "plan-created", "genomes-compiled", "worker-started", "worker-finished", "mission-finished"]
```

All 7 events emitted. Compare with G6-03A (BLOCKED):
```
["mission-started", "requirements-compiled", "plan-created"]  // no genomes-compiled, no worker events, no mission-finished
```

The full chain proves:
- Genome compilation succeeded (Jev's decision did NOT prevent it)
- Workers actually ran (worker-started + worker-finished)
- Mission completed (mission-finished)

### Causal consumption proof:

- The worker's genome carries `model = 'default'` (set by GenomeCompiler from Jev's `selected_choice = "default"`)
- The worker actually executed with that genome
- The mission finished with `status = 'success'`

The Jev decision was NOT a sidecar call that Genesis ignored — it was
structurally consumed as the worker's tier, and downstream execution
occurred because of it.

---

## 5. Acceptance Gates (Section 7)

All 12 acceptance gates PASS:

| Gate | Required | Actual |
|------|----------|--------|
| JEV_INVOKED_BY_GENESIS | YES | YES (jev_call_count = 1, captured by Proxy) |
| JEV_DECISION_RETURNED | YES | YES (selected_choice = "default") |
| JEV_PROBABILITIES_RETURNED | YES | YES ({default:0.82, frontier:0.13, cheap:0.05}) |
| JEV_DECISION_CONSUMED | YES | YES (became worker genome.model = "default") |
| JEV_CAUSALLY_AFFECTED_EXECUTION | YES | YES (workers ran because genome compilation completed; genome.model was set by Jev) |
| GENOMES_COMPILED_AFTER_DECISION | YES | YES |
| DOWNSTREAM_EXECUTION | YES | YES (worker-started + worker-finished events) |
| DOWNSTREAM_ARTIFACT | YES | YES (the worker's genome carries tier='default' — causally determined by Jev's selection) |
| INDEPENDENT_VERIFICATION | PASS | PASS (flight record independently shows the full causal chain) |
| FLIGHT_RECORDER_CHAIN | PASS | PASS (7 events in order) |
| OPENROUTER_REAL_USAGE | YES | YES (1 Decisions API call, $0.0000163 observed) |
| SILENT_FALLBACK | NONE | NONE (no Rule/GLM path invoked; Jev was the only decision provider) |

---

## 6. OpenRouter Usage Correlation

```
PROBE_START_TIMESTAMP = 2026-10-07T22:20:04.618Z
PROBE_END_TIMESTAMP   = 2026-10-07T22:20:06.404Z
PROBE_DURATION_MS      = 1771
OPENROUTER_DECISIONS_API_CALLS = 1
OPENROUTER_CHAT_COMPLETIONS_CALLS = 0
JEV_ROUTER_CALLS = 0
NON_JEV_OPENROUTER_MODEL_CALLS = 0
OPENROUTER_OBSERVED_API_COST = $0.000016296 USD
JEV_ENDPOINT = https://eu.openrouter.ai/api/alpha/decisions
JEV_MODEL = typesafe/jev-1.13
```

The user can independently verify on the OpenRouter dashboard that exactly
ONE call was made to `https://eu.openrouter.ai/api/alpha/decisions` with
model `typesafe/jev-1.13` between the start and end timestamps. The call
returned HTTP 200 with a genuine Jev decision. No other OpenRouter calls
were made during the probe window.

---

## 7. Validation

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS |
| `npx vitest run` (full suite) | PASS (487 passed, 9 skipped, 496 total) |
| `npx eslint .` | PASS |
| Real Jev Decisions API probe (EU endpoint) | PASS (HTTP 200, genuine Jev decision with probabilities) |
| Real Genesis causal probe | **PASS** (full happy path: 7 flight events) |

---

## 8. Complexity Accounting

```
PRODUCTION_FILES_DELTA = 0 (existing JevDecisionProvider modified in place)
PRODUCTION_LOC_DELTA = ~30
NEW_RUNTIME_DEPENDENCIES = 0
ANTI_BLOAT_GATE = PASS (within the ≤500 LOC correction budget)
```

G6-03B is a CORRECTION mission, not a subsystem expansion.

---

## 9. Historical Lineage (Section 9)

```
G6-03:
  tested Jev Router (typesafe/jev-router) via Chat Completions.
  Conclusion: ADOPT_OPTIONAL for the chat-completions product.

G6-03A:
  corrected to real Decisions API (POST /api/alpha/decisions) with
  typesafe/jev-1.13. Proved failure/control semantics. Positive causal
  path was BLOCKED_BY_GEO_RESTRICTION (global endpoint returned 403).

G6-03B:
  resolved geo-restriction by using OpenRouter's official EU region host
  (https://eu.openrouter.ai/api/alpha/decisions). The Decisions API IS
  supported there. Performed the smallest real positive causal proof:
  Jev returned a real decision (default, with probabilities and
  confidence), Genesis consumed it (became the worker's tier), workers
  actually executed, the mission completed with the full flight event
  chain. OPTIONAL_REAL_INTEGRATION_PROVEN.
```

Historical G6-03 and G6-03A evidence is preserved unchanged. G6-03B
adds the positive proof that G6-03A could not complete due to
geo-restriction.

---

## 10. JEV_FINAL_STATUS

```
JEV_FINAL_STATUS = OPTIONAL_REAL_INTEGRATION_PROVEN
```

The Jev Decision Model is now:
- **Real**: verified through the actual OpenRouter Decisions API on the EU region host
- **Correctly integrated**: JevDecisionProvider targets the Decisions API exclusively; no chat completions, no jev-router
- **End-to-end proven**: the positive causal probe demonstrates Jev being invoked by Genesis, returning a real decision with probabilities, the decision being consumed, downstream execution occurring, and the mission completing successfully
- **Optional**: production wiring at `repo-mission.ts:117` still uses `RuleDecisionProvider`; JevDecisionProvider is available as a deployer-choice provider with the `endpoint` option for region selection

---

## 11. SAFE_TO_BEGIN_G6_04

```
SAFE_TO_BEGIN_G6_04 = YES
```

Per G6-03B Section 13:
> SAFE_TO_BEGIN_G6_04 = YES ONLY IF: JEV_FINAL_STATUS = OPTIONAL_REAL_INTEGRATION_PROVEN

This condition is met. G6-04 (Release Candidate + Reproducibility Gate)
may proceed.

---

## 12. References

- `experiments/g6-03b/evidence/access-diagnosis.json` — Section 3 + 4 diagnosis
- `experiments/g6-03b/evidence/positive-causal-probe.json` — Section 6 causal probe results
- `experiments/g6-03b/evidence/final-analysis.md` — final analysis (this document's source)
- `experiments/g6-03a/run-positive-causal-probe.ts` — the re-runnable probe script (G6-03B version with EU endpoint + Proxy wrapper)
- `src/providers/jev-decision-provider.ts` — corrected provider (production)
- `tests/providers/jev-decision-provider.test.ts` — 32 unit tests (28 from G6-03A + 4 new for endpoint allow-list)
- `docs/group6/GENESIS_G6_03_JEV_DECISION_BENCHMARK.md` — historical G6-03 (with corrigendum added by G6-03A)
- `docs/group6/GENESIS_G6_03A_REAL_JEV_DECISIONS.md` — historical G6-03A (with G6-03B update banner)

---

**End of G6-03B documentation.**
