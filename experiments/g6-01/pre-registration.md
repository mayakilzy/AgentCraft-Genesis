# G6-01 Pre-Registration

**Date:** 2026-10-07
**Mission:** G6-01 Production Hardening
**Branch:** `build/group-06-productionization`
**Start HEAD:** `2e81b70ced70dcfc630cbee4971a0acd5374ac33`

This pre-registration is IMMUTABLE per Section 49 (No Pass-Chasing) and
Section N of the G6 entry state. If observed reality differs from what
is predicted here, an observation/corrigendum will be added; the
original pre-registration will NOT be rewritten.

---

## 1. P0 Items To Harden

### P0-1: H-06 — Worker hallucinated completion (content correctness under real LLM)

**Prediction:** The existing verification loop checks artifact existence
and substring presence (`file` with `expectIncludes`,
`content-in-artifacts`, `mission-input`). Under a scripted reasoning
provider these checks are sufficient because the script produces
deterministic content. Under a real-LLM provider, a worker can produce
plausible-but-wrong content that EXISTS as a file and CONTAINS the
expected substring but is materially wrong.

**Planned hardening:** Add a `hash-match` check kind to the verification
loop. The check computes the SHA-256 of an artifact file and compares it
to an expected hex string. Missions with a known-correct gold answer
can declare a hash-match check that catches plausible-but-wrong content.

**Expected probe result:** A test that stages wrong-but-plausible
content (file exists, contains expected substring) and verifies the
hash-match check FAILS while the naive `expectIncludes` check PASSES.

**Actual outcome:** See `evidence/p0-h06-hash-match.txt`.

### P0-2: H-33 (partial) — Secret exposure to workers

**Prediction:** The existing `flight-recorder.ts` has a `scrub()`
function with three regex patterns (Bearer, generic token/secret, and
authorization). These patterns miss common provider-specific token
formats: GitHub PATs (`ghp_...`, `github_pat_...`), OpenAI keys
(`sk-...`, `sk-proj-...`), Anthropic keys (`sk-ant-...`), AWS access
key ids (`AKIA...`). A token echoed by a shell command or captured in a
diagnostic string would reach the flight record unredacted.

**Planned hardening:** Expand `SECRET_PATTERNS` with provider-specific
regex patterns. Add a `ConfigValidator` that resolves required env vars
by name and throws a `ConfigurationError` (variable names only, never
values) when a required variable is missing. Add `STANDARD_PROVIDER_REQUIREMENTS`
for the four production providers (zai-reasoning, openbot, opendots, openmuse),
all marked optional so dev mode (scripted reasoning) still works.

**Expected probe result:** Tests that:
  1. Each provider-specific token format is redacted.
  2. Non-credential configuration keys (e.g. `key=hostname`) are NOT
     redacted (no false positives).
  3. `ConfigValidator` returns `ok=false` and lists missing variable
     NAMES ONLY (no values leak into the result or the thrown error).

**Actual outcome:** See `evidence/p0-h33-secret-redaction.txt` and
`evidence/p0-h33-config-validator.txt`.

### P0-3: Worker-instance epistemic isolation under real provider

**Prediction:** The `ScopeableReasoningProvider.forInstance()` contract
exists (TASK-022A) and the `WorkerAgent` constructor calls
`scopedReasoning()` which invokes `forInstance(instanceKey)` when the
provider is scopeable. Under the development fallback (stateful actor),
this scoping is verified. Under a real-LLM provider (stateless API),
scoping is a no-op — the provider has no state to leak.

**Planned hardening:** No code change required for the scoping itself
(the contract already exists and is correctly applied). The hardening
is the addition of `failureClass` and `reasoningRetries` fields to
`WorkerResult`, plus bounded retry on transient provider failures.
This gives Mission Control observability into provider failures
without exposing worker-private state.

**Expected probe result:** A test that a `PROVIDER_FAILURE` (e.g.
ECONNRESET) is retried once and either recovers or fails honestly with
`failureClass='PROVIDER_FAILURE'` and `reasoningRetries=1`. A test that
a `CANCELLED` failure is NOT retried (preserves cancellation semantics).

**Actual outcome:** See `evidence/p0-isolation-worker-retry.txt`.

---

## 2. P1 Items To Harden

### P1-H-01: Provider unavailable
- **Hardening:** WorkerAgent now wraps `reasoning.reason()` in a bounded retry loop (`callReasoningWithRetry`). Transient failures (PROVIDER_FAILURE, TIMEOUT, RUNTIME_FAILURE, UNKNOWN_FAILURE) get one retry after a backoff; non-retryable failures (CANCELLED, BUDGET_EXHAUSTED, CONFIGURATION_FAILURE) fail immediately.

### P1-H-03: Provider timeout (per-call)
- **Hardening:** Timeouts are classified as `TIMEOUT` by `classifyError()` and are retryable. The worker loop emits a `worker-step` event with `action=reasoning-retry:TIMEOUT` for observability.

### P1-H-04: Worker crash
- **Hardening:** Worker failures now carry a `failureClass` field. A worker that crashes due to a provider error reports `failureClass='PROVIDER_FAILURE'`; a worker that exhausts its step budget reports `failureClass='BUDGET_EXHAUSTED'`; a worker that reports missing artifacts reports `failureClass='WORKER_FAILURE'`.

### P1-H-21: Process restart
- **Status:** DEFERRED — the existing flight recorder is durable (JSONL files survive restart). In-flight checkpoint resume is NOT supported by the current architecture; this is documented as ACCEPTED_LIMITATION per Section 23.

### P1-H-24: Concurrent missions
- **Status:** PARTIALLY_HARDENED — the `ArtifactRegistry` is per-mission (records are keyed by `missionId:workerId:path`), so concurrent missions do not collide. The `CompositeRuntime` uses a `Map<workerId, CompositeEntry>` which assumes unique workerIds per process; concurrent missions in the same process with overlapping workerIds would collide. This is documented as ACCEPTED_LIMITATION — concurrent missions should run in separate processes.

### P1-H-29: Budget exhaustion
- **Hardening:** A worker that exhausts its step budget now reports `failureClass='BUDGET_EXHAUSTED'` (was previously a generic failure). The orchestrator's existing budget-tracking via `MissionCost.usd` is unchanged (provider-reported; zeros when absent).

### P1-H-33: Secret/configuration missing
- **Hardening:** The new `ConfigValidator` resolves required env vars at mission start and throws `ConfigurationError` (variable names only) when a required variable is missing. The error carries `failureClass='CONFIGURATION_FAILURE'`.

### P1-H-41: Artifact persistence
- **Hardening:** The new `ArtifactRegistry` persists artifact records to a JSONL file (`data/artifact-records/artifact-records.jsonl` by default). Each record carries: `missionId`, `workerId`, `path`, `type`, `provider`, `contentHash` (SHA-256), `bytes`, `verificationState`, `createdAt`, `updatedAt`, optional `sourceWorkerId` for lineage. This is the smallest persistence needed for verification, recovery, and audit per Section 40.

---

## 3. Items Deferred To Later G6 Stages

| Item | Deferred To | Reason |
|------|-------------|--------|
| H-21 in-flight resume | POST_V1 | True in-flight checkpoint resume requires durable workflow state; current architecture supports only queued recovery (OpenMuse). |
| H-22 in-flight durable recovery | G6-04 | Requires configuration metadata and provider health checks. |
| H-23 idempotent resume | POST_V1 | Depends on H-21. |
| H-41 artifact metadata freeze | G6-06 | The artifact record schema is introduced in G6-01 but frozen in G6-06. |
| Event schema freeze | G6-06 | Per Section 41, the event schema is NOT frozen in G6-01. The new `failure-classified` event type is ADDITIVE. |
| Capability registry | G6-04/G6-06 | Per Section 37, capability registry is better addressed around G6-04/G6-06. |
| Decision metadata | G6-03/G6-06 | Per Section 42, decision metadata may depend on G6-03 (Jev benchmark). |

---

## 4. Anti-Bloat Gate Self-Check

Per Section 45, the hardening task should not cause architectural
explosion. Self-check before implementation:

- New production files: 3 (`failure-class.ts`, `config-validator.ts`, `artifact-record.ts`) — UNDER the 8-file limit.
- New modules: 0 (all three files live in the existing `src/mission/` module) — UNDER the 2-module limit.
- Estimated net new production LOC: ~420 — UNDER the 1500-LOC hard stop, within the 300-500 LOC target.
- New runtime dependencies: 0 — `node:crypto` is a Node.js built-in.
- New storage technologies: 0 — `ArtifactRegistry` uses JSONL files (same as `FileFlightRecorder` and `ExperienceStore`).

**Anti-bloat gate: PASS.**

---

## 5. Real Provider Hardening Probe

Per Section 16, at least one bounded real-provider hardening probe is
required if credentials/environment make it reasonably possible.

**Probe plan:** If `ZAI_API_KEY` is present in the environment, run a
bounded single-call probe against the ZAI reasoning provider to verify
that:
  1. A successful call returns non-empty text.
  2. A deliberately malformed input (e.g. empty prompt) is classified
     correctly by `classifyError()`.
  3. The provider's response is scrubbed by the expanded secret
     redaction patterns before reaching the flight record.

**If `ZAI_API_KEY` is absent:** Report
`REAL_PROVIDER_HARDENING_EVIDENCE = UNAVAILABLE` and classify the
remaining limitation truthfully (per Section 16: "do NOT fake the
evidence").

**Actual outcome:** See `evidence/real-provider-probe.txt`.
