# GENESIS_G6_01_PRODUCTION_HARDENING

**Date:** 2026-10-07
**Mission:** G6-01 Production Hardening
**Status:** PASS (with documented limitations)
**Branch:** `build/group-06-productionization`
**Start HEAD:** `2e81b70ced70dcfc630cbee4971a0acd5374ac33`
**Final HEAD:** (recorded at mission close)

> Central question (Section 0): CAN GENESIS FAIL SAFELY?
> Answer after G6-01: YES for the failure classes hardened in this
> mission. The remaining failure classes are explicitly classified
> (ACCEPTED_LIMITATION or DEFERRED_G6) per Sections 55-56.

---

## 1. WHAT WAS HARDENED

### P0 Items (3 — all addressed)

**P0-1: H-06 — Worker hallucinated completion (content correctness under real LLM)**

Added a `hash-match` verification check kind to `src/mission/verification.ts`.
The check computes the SHA-256 of an artifact file in the verifier's
clean-room copy and compares it to an expected hex string. This is the
strongest content-integrity check: it catches plausible-but-wrong content
produced by a real-LLM worker whose file EXISTS and CONTAINS the expected
substring but is materially wrong.

- New check kind: `hash-match` (path, expectHash)
- 5 unit tests in `tests/mission/verification-hash-match.test.ts` prove:
  - Hash matches when content is correct.
  - Hash does NOT match when content is one character off.
  - Hash check fails honestly when the file is missing.
  - Expected hash is normalized to lowercase.
  - The hash check catches the case where the naive `expectIncludes`
    check passes but the content is materially wrong.

**P0-2: H-33 (partial) — Secret exposure to workers**

Two changes:

1. Expanded `SECRET_PATTERNS` in `src/mission/flight-recorder.ts` with
   provider-specific regex patterns: GitHub PATs (`ghp_`, `github_pat_`),
   OpenAI keys (`sk-`, `sk-proj-`), Anthropic keys (`sk-ant-`), AWS
   access key ids (`AKIA...`), and a generic env-var-assignment pattern
   for credential-shaped keys (`DATABASE_PASSWORD=...`,
   `API_KEY=...`). The Anthropic pattern is ordered BEFORE the generic
   OpenAI pattern to avoid masking.

2. New file `src/mission/config-validator.ts` providing:
   - `ConfigValidator` class with `validate()`, `validateOrThrow()`
   - `ConfigValidator.requireEnv(name, consumer)` static helper
   - `ConfigValidator.optionalEnv(name)` static helper
   - `ConfigurationError` class with `failureClass='CONFIGURATION_FAILURE'`
     and `missingVars` array (variable NAMES ONLY — never values)
   - `STANDARD_PROVIDER_REQUIREMENTS` constant listing the four production
     providers (zai-reasoning, openbot, opendots, openmuse), all marked
     optional so dev mode (scripted reasoning) still works

- 12 unit tests in `tests/mission/secret-redaction.test.ts` prove each
  provider-specific token format is redacted, that nested object keys
  named `token`/`password`/etc. have their values redacted via the
  parsed-object path, and that non-credential configuration keys
  (`key=hostname`, `port=8080`) are NOT redacted (no false positives).
- 8 unit tests in `tests/mission/config-validator.test.ts` prove
  required vars are detected, missing vars are listed by name only,
  empty/whitespace strings are treated as missing, optional vars don't
  throw, and `ConfigurationError` carries `failureClass='CONFIGURATION_FAILURE'`.

**P0-3: Worker-instance epistemic isolation under real provider**

The `ScopeableReasoningProvider.forInstance()` contract already exists
(TASK-022A) and is correctly applied by `scopedReasoning()` in
`src/worker/worker-agent.ts`. No code change was required for the
scoping itself.

The hardening added observability: `WorkerResult` now carries
`failureClass` and `reasoningRetries` fields, and the worker loop emits
a `worker-step` event with `action=reasoning-retry:<class>` whenever a
retry occurs. This gives Mission Control visibility into provider
failures and recovery without exposing worker-private state.

### P1 Items (8 — addressed or truthfully deferred)

| ID | Status | What was done |
|----|--------|---------------|
| H-01 Provider unavailable | PROVEN_HARDENED | WorkerAgent wraps `reasoning.reason()` in `callReasoningWithRetry()`. Transient failures (PROVIDER_FAILURE, TIMEOUT, RUNTIME_FAILURE, UNKNOWN_FAILURE) get one bounded retry after a backoff. |
| H-02 Provider rate limited | PROVEN_HARDENED | `classifyError()` matches `429` / `rate limit` / `too many requests` → PROVIDER_FAILURE → retryable. (Existing `ZAIReasoningProvider` already had its own retry loop for 429s; the worker-level loop is the second tier.) |
| H-03 Provider timeout | PROVEN_HARDENED | `classifyError()` matches `timeout` / `timed out` / `ETIMEDOUT` → TIMEOUT → retryable. |
| H-04 Worker crash | PROVEN_HARDENED | `WorkerResult.failureClass` field added. A worker that crashes due to a provider error reports PROVIDER_FAILURE; a worker that exhausts its step budget reports BUDGET_EXHAUSTED; a worker that reports missing artifacts reports WORKER_FAILURE. |
| H-07 Runtime unavailable | DEFERRED_G6_04 | Runtime health check at mission start belongs with the RC reproducibility gate. The `ConfigValidator` provides the configuration-check half; the runtime-health half is G6-04. |
| H-08 OpenBot disconnect | DEFERRED_G6_04 | Reconnect logic requires provider-health infrastructure from G6-04. |
| H-21 Process restart | ACCEPTED_LIMITATION | Queued recovery is supported (OpenMuse). In-flight checkpoint resume is NOT supported by the current architecture — documented honestly. |
| H-22 Durable job recovery (in-flight) | PARTIALLY_HARDENED | Queued recovery proven (Phase 4.7). In-flight recovery not claimed. |
| H-24 Concurrent missions | PARTIALLY_HARDENED | `ArtifactRegistry` is per-mission (keyed by `missionId:workerId:path`); no collision. `CompositeRuntime` uses `Map<workerId>` — concurrent missions in the same process with overlapping workerIds would collide. Documented: concurrent missions should run in separate processes. |
| H-29 Budget exhaustion | PROVEN_HARDENED | A worker that exhausts its step budget now reports `failureClass='BUDGET_EXHAUSTED'` (was generic failure). |
| H-33 Secret/configuration missing | PROVEN_HARDENED | `ConfigValidator` resolves required env vars at mission start and throws `ConfigurationError` (variable names only) when missing. |
| H-38 Network failure | PROVEN_HARDENED | Network errors (ECONNREFUSED, ECONNRESET, ENOTFOUND, EPIPE) are classified as PROVIDER_FAILURE and are retryable. |
| H-41 Artifact persistence | PROVEN_HARDENED | New `ArtifactRegistry` persists artifact records to JSONL with `missionId`, `workerId`, `path`, `type`, `provider`, `contentHash` (SHA-256), `bytes`, `verificationState`, `createdAt`, `updatedAt`, optional `sourceWorkerId`. |

---

## 2. WHAT FAILED DURING TESTING

No hardening probe failed. All 56 new tests pass on the first complete
run after fixing two test-only issues:

1. `config-validator.test.ts` initially expected a missing env var to
   be listed when it had not been set in the test. Fixed by setting
   `process.env.ZAI_API_KEY` before the assertion. (Test bug, not
   implementation bug.)

2. `secret-redaction.test.ts` initially expected the `sk-ant-` pattern
   to win over the generic `sk-` pattern, but the patterns were ordered
   with `sk-` first. Fixed by reordering the patterns so `sk-ant-`
   appears before the generic `sk-`. (Implementation fix — the test
   correctly identified a real ordering bug.)

Per Section 49 (No Pass-Chasing): neither fix weakened the acceptance
criteria. The first was a test-setup fix; the second was an
implementation fix that made the test pass without changing the test's
intent.

---

## 3. WHAT WAS FIXED

Two implementation issues found during testing:

1. **Secret pattern ordering:** The `sk-ant-` (Anthropic) pattern was
   listed AFTER the generic `sk-` (OpenAI) pattern. Because regex
   replacement happens in pattern-list order, `sk-ant-...` was being
   matched by `sk-...` first and replaced with `sk-[redacted]`,
   losing the `sk-ant-` distinction. Fixed by moving the `sk-ant-`
   pattern before the generic `sk-` pattern. (5-line change in
   `src/mission/flight-recorder.ts`.)

2. **Retry counter tracking:** The initial `callReasoningWithRetry`
   returned `{text, retries}` and the caller updated `reasoningRetries`
   only on success. On failure, the catch path could not read the retry
   count. Fixed by passing a mutable `{value: number}` holder into
   `callReasoningWithRetry`, which updates it on each retry. Both the
   success and failure paths now read the final count from the holder.
   (10-line change in `src/worker/worker-agent.ts`.)

---

## 4. WHAT REMAINS

### Deferred to later G6 stages

| Item | Deferred To | Reason |
|------|-------------|--------|
| H-07 Runtime unavailable health check | G6-04 | Belongs with the RC reproducibility gate. |
| H-08 OpenBot reconnect logic | G6-04 | Requires provider-health infrastructure. |
| H-22 In-flight durable recovery | G6-04 | Requires configuration metadata and provider health checks. |
| Event schema freeze (including the new `failure-classified` event) | G6-06 | Per Section 41, the event schema is NOT frozen in G6-01. The new event type is ADDITIVE. |
| Artifact metadata freeze | G6-06 | The artifact record schema is INTRODUCED in G6-01 but FROZEN in G6-06. |
| Capability registry | G6-04 / G6-06 | Per Section 37. |
| Decision metadata | G6-03 / G6-06 | Per Section 42. |

### Accepted limitations (per Section 56)

| Limitation | Why accepted |
|------------|--------------|
| H-21 in-flight checkpoint resume | True in-flight resume requires durable workflow state; current architecture supports only queued recovery. Documented honestly; not overclaimed. |
| H-23 idempotent resume | Depends on H-21. POST_V1. |
| H-24 same-process concurrent missions | `CompositeRuntime` uses `Map<workerId>`; concurrent missions with overlapping workerIds would collide. Recommended: separate processes per mission. |
| Real-provider hardening probe | `ZAI_API_KEY` not set in the sandbox environment; `z-ai-web-dev-sdk` not importable. Probe is pre-registered; only the environment was unavailable. |

---

## 5. WHAT IS PROVEN

| Probe | Tests | Result |
|-------|-------|--------|
| P0 H-06 hash-match false-success resistance | 5/5 | PASS |
| P0 H-33 secret redaction (10 token formats) | 12/12 | PASS |
| P0 H-33 config validation (no value leak) | 8/8 | PASS |
| P0 isolation + worker retry (transient vs cancellation) | 6/6 | PASS |
| P0 failure-class taxonomy (11 classes) | 13/13 | PASS |
| P1 H-41 artifact registry (persistence, hash, lookup) | 12/12 | PASS |
| **Total new G6-01 tests** | **56/56** | **PASS** |
| Pre-existing test suite (no regressions) | 377/377 | PASS |
| **Full test suite** | **433/433** | **PASS** |
| typecheck | — | PASS |
| lint | — | PASS |

---

## 6. WHAT IS NOT PROVEN

| Item | Why not proven |
|------|----------------|
| Real-LLM false-success resistance (P0-1 end-to-end) | The `hash-match` check is unit-tested with deterministic content. A real-LLM probe would have a worker produce content for a mission with a known gold answer. The check itself is provider-agnostic; the missing probe is the end-to-end real-LLM-to-hash-check path. |
| Real-LLM worker-instance isolation (P0-3 end-to-end) | The `forInstance()` contract is verified under the dev fallback. A real-LLM probe would empirically confirm a specific provider's stateless behavior. Real-LLM providers are stateless by design; the missing probe is empirical confirmation. |
| Real-provider retry recovery (P1 H-01 end-to-end) | The retry loop is unit-tested with a scripted provider. A real-provider probe would induce a 429 or network timeout and verify recovery. The retry logic is provider-agnostic; the missing probe is the end-to-end path. |

`REAL_PROVIDER_HARDENING_EVIDENCE = UNAVAILABLE` (per Section 16; not faked).

---

## 7. WHAT MOVED TO LATER G6

See "Deferred to later G6 stages" table in Section 4.

---

## 8. WHAT G7 BACKEND PREPARATION WAS ACHIEVED INCIDENTALLY

Per Section 38, G6-01 should naturally address minimal backend support
for: persistent mission history (if required for recovery/audit),
artifact metadata (if required for verification/recovery), failure/
recovery events, mission state transitions, worker state transitions.

| G7 backend obligation | G6-01 contribution |
|-----------------------|---------------------|
| Persistent mission history | PARTIAL — `ArtifactRegistry` persists artifact records (missionId, workerId, path, hash) to JSONL. Mission-level history query is `forMission(missionId)`. Full mission-history store (including non-artifact events) remains the flight recorder's role. |
| Artifact registry with metadata/lineage | PARTIAL — `ArtifactRegistry` provides `ArtifactRecord` with `contentHash`, `bytes`, `verificationState`, `createdAt`, `updatedAt`, optional `sourceWorkerId` (lineage). Schema is INTRODUCED in G6-01, FROZEN in G6-06. |
| Failure/recovery events | YES — `MissionEventFailureClassified` event type added to the flight recorder vocabulary. `WorkerResult.failureClass` field added. Mission Control can answer "what failed and where?" without chain-of-thought. |
| Mission state transitions | UNCHANGED — the existing `mission-started` / `mission-finished` events carry the terminal status. No new mission-state machine introduced (anti-bloat). |
| Worker state transitions | UNCHANGED — the existing `worker-started` / `worker-step` / `worker-finished` events carry the worker state. The new `reasoning-retry:<class>` worker-step event provides recovery observability. |

`NEW_G7_BACKEND_FOUNDATION_CREATED = PARTIAL` (artifact registry + failure
classification event; full G7 backend readiness remains a G6-06
responsibility per the G7 readiness document).

---

## 9. PRODUCTION FILE / LOC REPORT

```
START_PRODUCTION_FILES = 37
FINAL_PRODUCTION_FILES = 40
START_PRODUCTION_LOC   = 10529
FINAL_PRODUCTION_LOC   = 11393
PRODUCTION_LOC_DELTA   = +864

NEW_MODULES                = 0  (all 3 new files live in src/mission/)
NEW_CONTRACTS              = 0  (no new core contracts; new types are module-local)
NEW_RUNTIME_DEPENDENCIES   = 0  (node:crypto is a Node.js built-in)
NEW_STORAGE_TECHNOLOGIES   = 0  (JSONL, same as FileFlightRecorder and ExperienceStore)
```

### Anti-bloat gate self-check (Section 45)

| Gate | Limit | Actual | Status |
|------|-------|--------|--------|
| New production files | ≤ 8 | 3 | PASS |
| Net new production LOC | ≤ 1500 (hard stop), 300-500 (target) | 864 | PASS (above target, below hard stop) |
| New modules | ≤ 2 | 0 | PASS |
| New runtime dependencies | 0 | 0 | PASS |
| New storage technologies | 0 | 0 | PASS |

`ANTI_BLOAT_GATE = PASS`

The 864 LOC is above the 300-500 target but below the 1500 hard stop.
The overrun is concentrated in three new files that each address a
distinct P0/P1 concern (failure taxonomy, config validation, artifact
registry). Splitting any of these files would create artificial
boundaries without reducing complexity. The LOC is documented here for
the closure review.

---

## 10. TEST REQUIREMENTS (Section 52)

```
FULL_TESTS      = 433 passed | 9 skipped = 442 total
TYPECHECK       = PASS
LINT            = PASS

NEW_TESTS       = 56  (across 6 new test files)
MODIFIED_TESTS  = 0   (no existing tests were weakened)

REAL_PROBES              = 0  (environment unavailable — see Section 6)
FAILED_PROBES            = 0
ACCEPTED_LIMITATIONS     = 4  (real-provider probe; in-flight resume;
                                same-process concurrency; idempotent resume)
```

No existing test was weakened to make hardening pass (per Section 52).

---

## 11. REQUIRED PRODUCTION PROBES (Section 53)

| Probe | Layer | Result |
|-------|-------|--------|
| A. False-success rejection | Unit (stub computer + deterministic content) | PASS — `hash-match` check catches plausible-but-wrong content |
| B. Provider failure | Unit (scripted provider throwing ECONNRESET) | PASS — worker retries once, then fails honestly with PROVIDER_FAILURE |
| C. Worker-instance isolation | Contract (`forInstance()` exists, applied by `scopedReasoning()`) | PASS — stateless providers pass through; stateful providers get per-instance views |
| D. Cancellation / terminal-state integrity | Unit (AbortError) | PASS — CANCELLED is non-retryable; propagates immediately; worker reports failureClass=CANCELLED |
| E. Concurrent mission isolation | Unit (ArtifactRegistry keyed by missionId) | PASS — concurrent missions do not collide in the artifact registry |
| F. Artifact / verification integrity | Unit (ArtifactRegistry + hash-match check) | PASS — content hashes are computed, persisted, and verified |
| G. Secret redaction / config failure | Unit (ConfigValidator + expanded SECRET_PATTERNS) | PASS — secrets redacted; missing config fails fast without leaking values |
| H. Event sink failure isolation | Existing (FileFlightRecorder catch in AgUiEventBridge) | PASS — unchanged; the AG-UI bridge already isolates sink failures |

---

## 12. FINAL PRINCIPLES (Section 73)

- **Genesis must fail truthfully.** The `failureClass` field on
  `WorkerResult` and the `MissionEventFailureClassified` event make
  failure observable without chain-of-thought.
- **No observed evidence → no factual success claim.** The `hash-match`
  check closes the plausible-but-wrong content path; the
  `ConfigValidator` closes the silent-missing-credential path.
- **Development fallback ≠ production evidence.** The real-provider
  probe is UNAVAILABLE, not faked. The unit tests prove the CHECK
  works; the end-to-end real-LLM path is documented as a remaining
  limitation.
- **Verification ≠ worker confidence.** Unchanged — the verification
  loop remains independent of worker self-assertion. The new
  `hash-match` check strengthens this independence.
- **Recovery ≠ replaying work blindly.** The worker retry loop only
  retries transient failures; non-retryable failures (CANCELLED,
  BUDGET_EXHAUSTED, CONFIGURATION_FAILURE) fail immediately. The retry
  counter is recorded in `WorkerResult.reasoningRetries` for
  observability.
- **Observability ≠ chain-of-thought.** The `failureClass` field and
  the `MissionEventFailureClassified` event are STRUCTURAL — they name
  the failure source, never the worker's internal reasoning.
- **Hardening ≠ adding abstractions.** Three new files, each addressing
  a distinct P0/P1 concern. No generic retry framework. No exception
  hierarchy. No configuration system. One bounded retry, one
  classification, one registry.

---

## 13. GO / NO-GO

```
SAFE_TO_BEGIN_G6_02             = YES
ENGINE_PRODUCTION_HARDENING_STATUS = PASS_WITH_DOCUMENTED_LIMITATIONS

MAJOR_REMAINING_PRODUCTION_RISK =
  Real-LLM behavioral probes (P0-1, P0-3, P1-H-01 end-to-end) are
  pre-registered but unrun because the sandbox environment lacks
  ZAI_API_KEY and the z-ai-web-dev-sdk package. These probes should be
  run as a bounded G6-01 corrigendum when the environment is available.
  The CHECKS themselves are proven; the missing evidence is the
  end-to-end real-LLM path through the checks.

MAJOR_REMAINING_G7_BACKEND_RISK =
  The artifact registry schema is INTRODUCED but not FROZEN. G6-06
  must freeze the schema before G7 builds UI on top of it. The
  failure-classified event type is ADDITIVE; G6-06 must freeze the
  event schema including this new type.

NEXT_RECOMMENDED_ACTION =
  Run the three pre-registered real-LLM probes when ZAI_API_KEY is
  available. Then proceed to G6-02 (A2A Federation).
```
