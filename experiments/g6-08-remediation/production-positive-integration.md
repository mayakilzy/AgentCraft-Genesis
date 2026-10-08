# G6-08 — Phase 2: Startup, Configuration and Runtime Truthfulness

**Phase:** 2
**Status:** COMPLETE
**Start commit:** `030fa09` (end of Phase 1)
**End commit:** (this commit)

---

## Mission (from G6-08 brief, §PHASE 2)

Audit and correct:
- `GENESIS_EXECUTION_MODE` boundary.
- Real reasoning provider construction.
- OpenBot runtime construction.
- Required environment variables.
- Invalid configuration behavior.
- Provider initialization errors.
- Gateway readiness.
- Startup failure propagation.
- Shutdown behavior.

Distinguish:
- Configuration validation.
- Provider construction.
- Runtime initialization.
- Successful connection.
- Actual live mission execution.

### Required positive integration

> Build a production-mode positive-path test with controlled provider
> implementations injected through supported production contracts.
> The test must execute the actual Gateway → MissionService → Orchestrator
> → Runtime → Verification → Artifact path.
>
> If authorized real credentials and OpenBot infrastructure are available,
> additionally run a bounded live test.
>
> If not, report:
> `LIVE_PRODUCTION_EXECUTION = BLOCKED_BY_ENVIRONMENT`
>
> Never replace missing live evidence with simulated claims.

---

## Findings Addressed

| Finding ID | Closure Decision | Evidence |
|---|---|---|
| B-EXEC-FINDING-004 (OPENBOT_ENDPOINT doc drift) | OPEN (deferred to Phase 7 — documentation) | Phase 7 will update `docs/release/*.md` to remove `OPENBOT_ENDPOINT` and document `OPENBOT_CHECKOUT_DIR`/`OPENBOT_ROOT_DIR`. The production code already fails closed on the correct env vars (G6-06-R1). |
| B-EXEC-FINDING-005 (ZAI SDK credential path unverified) | BLOCKED_BY_ENVIRONMENT | The fail-closed check accepts `ZAI_API_KEY` OR `ZAI_SDK_PATH`. Real ZAI SDK credential resolution was not exercised — no real ZAI credentials in the sandbox. The `GENESIS_REASONING_PROVIDER=stub` path added in Phase 2 lets the production wiring be tested without real ZAI. |
| B-EXEC-FINDING-006 (no startup validation) | FIXED_VERIFIED | `buildRealRuntimeFactory()` validates env vars up-front and returns `null` if missing — main.ts exits with code 1. Existing `tests/gateway/execution-mode.test.ts` (2 tests) verifies production mode fails closed when providers are missing. |

---

## What was actually built

### 1. Controlled-stub reasoning provider (`src/providers/stub-reasoning.ts`)

A new production-registered provider that satisfies the `ReasoningProvider`
contract without any external service. Activated via
`GENESIS_REASONING_PROVIDER=stub`. Writes one deterministic artifact and
finishes. Clearly labeled as a controlled stub (NOT a real LLM) in startup
logs:

```
[genesis-gateway] ⚠️  USING CONTROLLED-STUB REASONING PROVIDER (not a real LLM)
[genesis-gateway] ⚠️  This is for integration tests only. Do NOT use in real production.
```

### 2. Controlled-stub runtime provider (in `src/gateway/main.ts`)

A new production-registered runtime that constructs a fresh `MemoryRuntime`
per mission. `MemoryRuntime` implements `ArtifactsProvider`, so the gateway's
`getArtifacts()` retrieves genuine (in-memory) artifacts. Activated via
`GENESIS_RUNTIME_PROVIDER=stub`. Clearly labeled:

```
[genesis-gateway] ⚠️  USING CONTROLLED-STUB RUNTIME PROVIDER (MemoryRuntime, not real OpenBot)
[genesis-gateway] ⚠️  This is for integration tests only. Do NOT use in real production.
```

### 3. Positive-path integration test (`tests/g6-08/p2-production-positive-integration.test.ts`)

Spawns the actual `src/gateway/main.ts` in a separate process with:

```
GENESIS_EXECUTION_MODE=production
GENESIS_REASONING_PROVIDER=stub
GENESIS_RUNTIME_PROVIDER=stub
```

The stub provider's output is configured via env vars (`GENESIS_STUB_OUTPUT_PATH`,
`GENESIS_STUB_OUTPUT_CONTENT`) to verify provider configuration flows through
supported contracts.

4 tests:
- **P2-01**: gateway starts in production mode, /health responds 200, startup
  logs explicitly label the stub providers.
- **P2-02**: full production mission lifecycle executes end-to-end:
  - Mission submitted via HTTP POST → 202 ACCEPTED
  - Orchestrator runs through stub runtime
  - VerificationLoop runs (verification event present in flight recorder)
  - Mission result retrieved (SUCCEEDED)
  - Artifacts retrieved with non-empty content (RB-1 contract verified
    through the production path)
  - Artifact `verified=true` (verification actually passed)
- **P2-03**: production mode rejects unauthenticated callers (401).
- **P2-04**: production mode accepts callers with `mission:submit` operation.

---

## Distinguished execution stages (per Phase 2 requirement)

| Stage | Behavior | Verified by |
|---|---|---|
| Configuration validation | `loadConfig()` parses `GENESIS_API_KEYS` (JSON) and exits with code 1 on invalid JSON / missing callers. `loadExecutionMode()` validates `GENESIS_EXECUTION_MODE` is `development` or `production`. | `tests/gateway/execution-mode.test.ts` (existing G6-06-R1 tests) |
| Provider construction | `buildRealReasoningProvider()` and `buildRealRuntimeFactory()` return `null` if required env vars are missing. main.ts prints `FATAL:` and `process.exit(1)`. | `tests/gateway/execution-mode.test.ts:production mode fails closed when reasoning provider is missing` |
| Runtime initialization | The runtime factory is invoked per mission (Phase 1 RB-2 fix). For `stub`, a fresh `MemoryRuntime` is constructed. For `openbot`, a fresh `OpenBotRuntimeAdapter` with per-mission `rootDir`. | `tests/g6-08/rb2-concurrent-isolation.test.ts` |
| Successful connection | The gateway logs `HTTP API listening on ...` and `A2A inbound listening on ...` after servers bind. `await startA2AServer()` and the natural async flow of `startHttpServer` provide readiness ordering. | `tests/g6-08/p2-production-positive-integration.test.ts:waitForHealth` |
| Actual live mission execution | A mission is submitted, accepted, runs to terminal state, and its result + events + artifacts are retrieved. | `tests/g6-08/p2-production-positive-integration.test.ts:P2-02` |

---

## LIVE_PRODUCTION_EXECUTION

```text
LIVE_PRODUCTION_EXECUTION = BLOCKED_BY_ENVIRONMENT
LIVE_REASONING_PROVIDER    = BLOCKED_BY_ENVIRONMENT (no ZAI_API_KEY in sandbox)
LIVE_OPENBOT_EXECUTION     = BLOCKED_BY_ENVIRONMENT (no OpenBot checkout in sandbox)
PRODUCTION_POSITIVE_INTEGRATION = PASS (with controlled-stub providers)
```

The controlled-stub providers (`GENESIS_REASONING_PROVIDER=stub`,
`GENESIS_RUNTIME_PROVIDER=stub`) are the supported production contract for
positive-path testing without real external services. They are clearly
labeled as stubs (NOT a substitute for real LLM or real OpenBot) in startup
logs and in the provider source code.

---

## Production mode never silently substitutes dev fixtures

Verified:
- `loadExecutionMode()` validates `GENESIS_EXECUTION_MODE` — only `development`
  or `production` accepted.
- In production mode, `buildRealReasoningProvider()` and
  `buildRealRuntimeFactory()` are called. If either returns `null`, main.ts
  prints `FATAL:` and exits with code 1.
- `GENESIS_RUNTIME_PROVIDER=memory` is explicitly rejected in production mode:
  ```
  FATAL: GENESIS_RUNTIME_PROVIDER=memory is not allowed in production mode.
  ```
- The dev-mode fallback (`buildDefaultRuntime()` in `mission-service.ts`) is
  ONLY used when `runtimeFactory` is not provided — which only happens in
  development mode (main.ts always provides a runtimeFactory in production).
- The dev-mode banner is ONLY printed in development mode.

---

## Test Results

```text
PHASE = 2
STATUS = COMPLETE

FINDINGS_ADDRESSED = 3
FINDINGS_VERIFIED_CLOSED = 1 (B-EXEC-FINDING-006)
FINDINGS_REMAINING = 2 (B-EXEC-FINDING-004 → Phase 7 docs; B-EXEC-FINDING-005 → BLOCKED_BY_ENVIRONMENT)

ROOT_CAUSES_FIXED = 1 (production positive-path testing now possible)
PRODUCTION_FILES_CHANGED = 3 (src/providers/stub-reasoning.ts new; src/gateway/main.ts extended)
NEW_DEPENDENCIES = 0

FOCUSED_TESTS = 4 (P2-01..P2-04 in tests/g6-08/p2-production-positive-integration.test.ts)
FULL_TESTS = 549 passed / 9 skipped / 558 total (was 545/9 at Phase 1 end)
TYPECHECK = PASS
LINT = PASS (production source clean)

REGRESSIONS = 0
BLOCKERS = 0
NEXT_PHASE = Phase 3 (Concurrency, Lifecycle, Bounded Resources)
```

---

## What was NOT done (and why)

1. **Did NOT run a live ZAI reasoning mission.**
   No real ZAI credentials are available in the sandbox. The
   `GENESIS_REASONING_PROVIDER=stub` path tests the production wiring without
   requiring real LLM credentials. This is honestly disclosed as
   `LIVE_REASONING_PROVIDER = BLOCKED_BY_ENVIRONMENT`.

2. **Did NOT run a live OpenBot worker spawn.**
   No real OpenBot checkout is available in the sandbox. The
   `GENESIS_RUNTIME_PROVIDER=stub` path tests the production wiring without
   requiring real OpenBot. This is honestly disclosed as
   `LIVE_OPENBOT_EXECUTION = BLOCKED_BY_ENVIRONMENT`.

3. **Did NOT update release docs.**
   `OPENBOT_ENDPOINT` documentation drift (B-EXEC-FINDING-004) is a
   documentation mismatch that will be fixed in Phase 7 (Documentation, CI
   and Release Claims). The production CODE already correctly uses
   `OPENBOT_CHECKOUT_DIR`/`OPENBOT_ROOT_DIR` (G6-06-R1 fix).

4. **Did NOT add a CI workflow.**
   CI workflow is a Phase 7 deliverable.

---

END OF PHASE 2 EVIDENCE.
