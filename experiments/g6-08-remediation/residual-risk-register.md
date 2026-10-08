# G6-08 — Residual Risk Register

**Phase:** 8 (Final Report)
**Status:** COMPLETE
**Owner:** Genesis engineering
**Horizon:** G6-09 attack list

This register enumerates every risk that remains open after the G6-08
remediation marathon (Phases 1-9). Each risk is honest about what was
mitigated, what is still unverified, and what G6-09 must do.

The release gate is **PASS_WITH_LIMITATIONS** precisely because the items
below are real risks. They are documented, bounded, and scheduled — not
hidden.

---

## Risk summary

| ID | Risk | Likelihood | Impact | Composite | Status |
|---|---|---|---|---|---|
| RR-01 | Live production execution never exercised | HIGH (certain) | HIGH | HIGH | BLOCKED_BY_ENVIRONMENT |
| RR-02 | Federation identity verification not enforced | MEDIUM | HIGH | HIGH | DEFERRED |
| RR-03 | OpenBot parent-death detection not implemented | MEDIUM | MEDIUM | MEDIUM | BLOCKED_BY_ENVIRONMENT |
| RR-04 | No restart recovery (in-process state only) | HIGH (certain) | MEDIUM | MEDIUM | DOCUMENTED_LIMITATION |
| RR-05 | 22 P3 low-severity findings deferred | HIGH | LOW | LOW | DEFERRED |
| RR-06 | 12 protocol-compliance findings deferred (upstream SDK changes required) | MEDIUM | MEDIUM | MEDIUM | DEFERRED |
| RR-07 | ZAI SDK credential path unverified at runtime | MEDIUM | MEDIUM | MEDIUM | BLOCKED_BY_ENVIRONMENT |
| RR-08 | 8 new lint errors introduced by G6-08 in production source/tests | HIGH (certain) | LOW | LOW-MEDIUM | OPEN (regression discovered during Phase 8) |
| RR-09 | B-EXEC-FINDING-003 (graceful worker teardown) partially mitigated, not fully closed | MEDIUM | MEDIUM | MEDIUM | OPEN |

Total residual risks: **9** (7 declared in the G6-08 brief + 2 discovered
during Phase 8 verification).

---

## RR-01 — LIVE_PRODUCTION_EXECUTION = BLOCKED_BY_ENVIRONMENT

**Description.**
The entire production execution path (real OpenBot v0.1.0 worker spawn +
real ZAI reasoning) was never executed end-to-end. Every production-mode
test in the G6-08 suite uses the controlled-stub providers
(`GENESIS_REASONING_PROVIDER=stub`, `GENESIS_RUNTIME_PROVIDER=stub`)
which satisfy the production contracts but are NOT real OpenBot/ZAI.

**Source.**
- Recovery baseline §6 Stop Conditions (inherited from G6-07 audit).
- B-EXEC-FINDING-005 (ZAI SDK credential path unverified at runtime).
- Phase 2 evidence (`production-positive-integration.md` §"What was NOT
  done").

**Assessment.**
- Likelihood = HIGH (certain — sandbox has no real credentials).
- Impact = HIGH (any defect in real OpenBot spawn / real ZAI client
  construction would only surface in production).
- Composite = HIGH.

**Mitigation applied.**
- Phase 2 added two controlled-stub providers (`stub-reasoning.ts`,
  `MemoryRuntime` runtime factory) registered through the **supported
  production contract** (provider factories). They are NOT test doubles
  injected via dependency-injection seams; they exercise the real gateway
  → MissionService → Orchestrator → Runtime → Verification → Artifact
  path.
- Phase 2 added `p2-production-positive-integration.test.ts` (P2-01..
  P2-04) which spawns the real `src/gateway/main.ts` in a child process,
  submits a mission via HTTP, observes the full lifecycle, retrieves
  artifacts with non-empty content (RB-1 verified through the production
  path), and verifies `artifact.verified = true`.
- Production-mode fail-closed matrix (7 variants) was already in place
  from G6-06-R1 and is exercised by `tests/gateway/execution-mode.test.ts`.

**Recommended action for G6-09.**
1. Provision a sandbox with real ZAI credentials (`ZAI_API_KEY`) and
   exercise `ZAIReasoningProvider.loadClient()` + `factory.create()` +
   `client.chat.completions.create()` end-to-end. Verify the 6-step
   rate-limit backoff schedule (DEFAULT_RETRY_BACKOFF_MS) actually fires.
2. Provision a sandbox with a real OpenBot v0.1.0 checkout and exercise
   `tests/runtime/openbot-adapter.test.ts` (currently 6 of 8 tests are
   skipped pending `$GENESIS_OPENBOT_DIR`).
3. Once both are exercised, document a `LIVE_PRODUCTION_EXECUTION = PASS`
   evidence file mirroring the Phase 2 evidence structure.

**Residual until:** a deployment with real credentials is exercised.

---

## RR-02 — Federation identity verification not enforced

**Description.**
The audit (C-PROTOCOLS-FINDING-013) recommended evaluating TLS pinning
or signed-AgentCard identity verification for federation outbound
calls. G6-08 Phase 5 documented that the existing transport-level
controls (TLS, DNS, network policy) are deployment concerns and deferred
full identity verification to a future version.

**Source.**
- C-PROTOCOLS-FINDING-013 (TLS pin / signature requirement for
  federation) — DEFERRED per Phase 5 §"What was NOT done (and why)".
- Phase 5 evidence (`security-remediation.md` §"What was NOT done").
- Phase 6 evidence (`protocol-validation.md` §"Findings deferred").

**Assessment.**
- Likelihood = MEDIUM (depends on threat model — is the federation
  peer on a trusted network or hostile?).
- Impact = HIGH (a malicious peer could impersonate a trusted agent).
- Composite = HIGH.

**Mitigation applied.**
- Federation calls go through `ClientFactory` which uses standard
  HTTPS. TLS certificate validation is ON by default.
- The A2A SDK's `DefaultAgentCardResolver` is used for discovery; the
  AgentCard is fetched over HTTPS.
- Genesis does NOT currently trust AgentCard claims blindly — caller
  authentication on the inbound side uses `timingSafeEqual` on the
  Authorization header (constant-time, see Phase 5 §3).

**Recommended action for G6-09.**
1. Evaluate deployment trust model: is the federation peer on a private
   network (TLS is sufficient) or a hostile network (TLS pin required)?
2. If TLS pin is required, add a `GENESIS_FEDERATION_PINNED_CAS`
   environment variable and a `tls.checkServerIdentity` override in
   `src/runtime/federation/service.ts`.
3. If AgentCard signing is required, evaluate the A2A SDK's signed-
   card support (track `@a2a-js/sdk` changelog for signature
   primitives).

**Residual until:** federation threat model is documented and the
appropriate identity mechanism is selected.

---

## RR-03 — OpenBot parent-death detection not implemented

**Description.**
If the gateway process is killed with SIGKILL (or segfaults), OpenBot
worker processes are orphaned with `detached: true`. They continue
running, consuming resources until manually killed. The audit
(C-LEARNING-FINDING-017) noted this as a BLOCKED_BY_ENVIRONMENT risk.

**Source.**
- C-LEARNING-FINDING-017 (OpenBot parent-death detection).
- Phase 9 evidence (`architecture-decisions.md` §"OpenBot parent-death
  detection").
- B-EXEC-FINDING-003 (graceful teardown of OpenBot workers on shutdown)
  — partially overlaps with this risk (see RR-09).

**Assessment.**
- Likelihood = MEDIUM (gateway crashes are rare but possible under
  memory pressure or unhandled rejections).
- Impact = MEDIUM (orphaned workers consume CPU/memory; no data
  corruption because each worker's workspace is per-mission).
- Composite = MEDIUM.

**Mitigation applied.**
- Phase 1 RB-3 fix added process-group kill for the gateway itself:
  `detached: true` + `process.kill(-pgid, signal)` on SIGTERM/SIGINT.
  On POSIX systems, OpenBot workers spawned via the adapter inherit
  the gateway's PGID (because they are also `detached: true`), so
  SIGTERM/SIGKILL to the gateway's process group WILL reach them.
- This mitigation does NOT cover SIGKILL of the gateway (which cannot
  be intercepted) or kernel-level crashes (OOM killer).

**Recommended action for G6-09.**
1. Once real OpenBot is exercised (RR-01), add a heartbeat mechanism:
   OpenBot workers ping the gateway every N seconds; if the gateway
   doesn't respond within 2N seconds, the worker self-terminates.
2. Alternative: OpenBot workers periodically check `process.ppid`; if
   the parent PID changes (parent died and PID was reused), self-
   terminate.
3. Document the chosen mechanism in `docs/release/engine-v1-known-
   limitations.md` once implemented.

**Residual until:** real OpenBot integration is exercised (depends on
RR-01).

---

## RR-04 — No restart recovery (in-process state only)

**Description.**
MissionService, the A2A bindings Map, the idempotency index, and the
flight recorder state all live in-process. A restart loses all in-
flight mission state. There is no WAL, no checkpoint, no replay.

**Source.**
- Phase 9 architectural decision (`architecture-decisions.md` §
  "Decision: DEFER_TO_FUTURE_VERSION").
- C-LEARNING-FINDING-009/-010/-011 (no durability — learning loop /
  idempotency / mission state across restart).
- Recovery baseline §6 Stop Conditions.

**Assessment.**
- Likelihood = HIGH (certain — restart WILL lose state; documented
  in the public API contract).
- Impact = MEDIUM (in-flight missions are lost; terminal missions
  beyond the 5-minute retention window are already evicted by Phase
  3, so the working set is bounded).
- Composite = MEDIUM.

**Mitigation applied.**
- The public API contract documents this limitation explicitly:
  `MissionService` constructor docstring states "Lifetime (Section 6):
  in-process only. State does NOT survive process restart. This is a
  documented release limitation (RESTART_RECOVERY = LIMITED)."
- The gateway startup banner prints `[genesis-gateway] In-process
  state; no durability across restart.`
- Phase 3 bounded the in-process memory footprint to a 5-minute
  retention window for terminal missions; active missions are bounded
  by admission control.
- `docs/release/engine-v1-known-limitations.md` lists this as a
  known limitation.

**Recommended action for G6-09.**
1. When a concrete deployment requires restart recovery, follow the
   migration plan in `architecture-decisions.md` §"Future migration
   plan":
   - Preferred: reuse OpenMuse's durable task store primitives (when
     available in the deployment).
   - Smallest local option: single-table SQLite file keyed by
     idempotency key, storing `{missionId, callerId, status,
     finishedAt}`. On restart, replay; mark in-flight as FAILED.
   - Mission-state durability (intermediate flight events) — defer to
     v2 when a concrete use case requires it.

**Residual until:** a deployment requires durability (v1.1+ scope).

---

## RR-05 — 22 P3 low-severity findings deferred

**Description.**
The G6-07 remediation plan summary identified 22 isolated low-severity
(P3) findings that "can be addressed opportunistically during G6-08 or
deferred to v1.1". G6-08 prioritized the release-blocker / RC-cluster
/ security findings and deferred these.

The remediation-ledger.json `closure_decision_counts.DEFERRED_WITH_JUSTIFICATION`
shows the full count (57 after Phase 8 ledger reconciliation), which
includes the 22 P3 class plus additional C-LEARNING dormant-loop
risks and other cross-references. The "22 P3" figure is the audit's
headline count of the strictly-P3 opportunistic class.

**Source.**
- G6-07 remediation plan §Summary ("remaining 22 are isolated low-
  severity issues (P3) that can be addressed opportunistically during
  G6-08 or deferred to v1.1").
- Remediation ledger entries with `remediationBatch = "deferred"`.

**Assessment.**
- Likelihood = HIGH (certain — they exist in the codebase).
- Impact = LOW (each is isolated; none affects the release blockers
  or root-cause clusters).
- Composite = LOW.

**Mitigation applied.**
- Each P3 finding is documented in `remediation-ledger.json` with:
  - `closureDecision = DEFERRED_WITH_JUSTIFICATION`
  - `closureEvidence = "Deferred per remediation-plan.md Summary
    (P3 opportunistic class)"`
  - `residualRisk = "MEDIUM/LOW impact; no RB-class risk; tracked
    for opportunistic remediation"`
- The P3 class is heterogeneous: B-A2A edge cases, C-LEARNING dormant
  loop, C-SECURITY low-severity gaps, D-FAILURE missing regression
  tests, E-CONCURRENCY theoretical races, F-PACKAGE packaging gaps.
  None of these is a release blocker.

**Recommended action for G6-09.**
1. Triage the 22 P3 class: which can be closed in <1 hour each?
2. Close the easy wins (e.g., F-PACKAGE-FINDING-007 `engine-strict`,
   F-PACKAGE-FINDING-009 `bun` undeclared dep, E-CONCURRENCY-FINDING-001
   doc the synchronous-start assumption).
3. Add regression tests for D-FAILURE-FINDING-004/-005/-006/-007 (the
   audit confirmed consistency; the tests would lock it in).

**Residual until:** G6-09 P3 sweep.

---

## RR-06 — 12 protocol-compliance findings deferred (upstream SDK changes required)

**Description.**
The Phase 6 evidence file (`protocol-validation.md` §"Findings deferred")
documents 12 protocol-compliance findings that require either upstream
SDK changes (A2A AgentCard provider/skill fields, federation retries)
or deployment trust-model evaluation:

- C-PROTOCOLS-FINDING-003 (event ordering — low-impact; events emitted
  in worker-step order which is causally consistent).
- C-PROTOCOLS-FINDING-006 (AG-UI RUN_STARTED guard — theoretical
  concern about late subscribers).
- C-PROTOCOLS-FINDING-009 through C-PROTOCOLS-FINDING-018 (10 findings
  on A2A AgentCard provider/skill fields, federation retries,
  federation identity verification).

**Source.**
- Phase 6 evidence (`protocol-validation.md` §"Findings deferred
  (architectural or low-impact)").
- Remediation ledger entries with `remediationBatch = "6"` and
  `closureDecision = DEFERRED_WITH_JUSTIFICATION` (after Phase 8
  reconciliation).

**Assessment.**
- Likelihood = MEDIUM (some are theoretical, others depend on
  consumer strictness).
- Impact = MEDIUM (a strict AG-UI consumer could reject events;
  federation identity gaps could allow impersonation).
- Composite = MEDIUM.

**Mitigation applied.**
- The 3 fixed AG-UI schema violations (C-PROTOCOLS-FINDING-002/-007/
  -008) cover the schema correctness dimension. The remaining 12 are
  either theoretical (003, 006) or require upstream SDK changes.
- The federation identity dimension overlaps with RR-02.

**Recommended action for G6-09.**
1. Track `@a2a-js/sdk` and `@ag-ui/core` changelogs for the required
   schema/field support.
2. For C-PROTOCOLS-FINDING-003/-006 (event ordering / RUN_STARTED
  guard), add explicit "late subscriber" tests once a real AG-UI
  consumer is exercised.
3. For C-PROTOCOLS-FINDING-009..-018, evaluate whether the missing
   fields are required by the deployment's consumers; if so, add
   them to `buildAgentCard()`.

**Residual until:** upstream SDK releases the required features OR
deployment identifies the required fields.

---

## RR-07 — ZAI SDK credential path unverified at runtime (B-EXEC-005)

**Description.**
The fail-closed check accepts `ZAI_API_KEY` OR `ZAI_SDK_PATH`, but
whether the real `z-ai-web-dev-sdk` package reads `ZAI_API_KEY` from
`process.env` when no `sdkPath` is configured is **unverified**.
The audit (B-EXEC-FINDING-005) flagged this as a latent credential-
failure risk.

**Source.**
- B-EXEC-FINDING-005 (ZAI SDK credential path unverified).
- G6-07 residual uncertainty §1 (whether real ZAI SDK reads
  `ZAI_API_KEY` from env when no sdkPath is configured).
- Phase 2 evidence (`production-positive-integration.md` §
  "Findings Addressed" — B-EXEC-FINDING-005 marked
  BLOCKED_BY_ENVIRONMENT).

**Assessment.**
- Likelihood = MEDIUM (the SDK's behavior is undocumented in our
  context; the fail-closed check passes but the actual `factory.create()`
  call may fail at runtime).
- Impact = MEDIUM (a production deployment would fail to start; the
  fail-closed check is a defense-in-depth that does NOT verify the
  actual SDK call).
- Composite = MEDIUM.

**Mitigation applied.**
- Phase 2 added `GENESIS_REASONING_PROVIDER=stub` to test the
  production wiring without real ZAI. The stub provider satisfies
  the `ReasoningProvider` contract and is registered through the
  production factory mechanism.
- The fail-closed check (`buildRealReasoningProvider()` returns
  `null` if neither `ZAI_API_KEY` nor `ZAI_SDK_PATH` is set) is
  exercised by `tests/gateway/execution-mode.test.ts`.
- `docs/release/engine-v1-known-limitations.md` lists this as
  limitation 11a (Live ZAI/OpenBot Execution: BLOCKED_BY_ENVIRONMENT).

**Recommended action for G6-09.**
1. Read the `z-ai-web-dev-sdk` source to verify whether
   `factory.create()` reads `process.env.ZAI_API_KEY` when no
   sdkPath is configured.
2. If it does NOT, either:
   - Pass `apiKey: process.env.ZAI_API_KEY` explicitly to
     `factory.create()` in `src/providers/zai-reasoning.ts`, OR
   - Document that `ZAI_SDK_PATH` is the required mechanism.
3. Once verified, downgrade B-EXEC-FINDING-005 to FIXED_VERIFIED
   (or confirm BLOCKED_BY_ENVIRONMENT if real credentials are still
   unavailable).

**Residual until:** a sandbox with real ZAI credentials is exercised
(depends on RR-01).

---

## RR-08 — 8 new lint errors introduced by G6-08 (regression discovered during Phase 8)

**Description.**
The clean-room verification (Phase 8) discovered 8 new ESLint errors
in G6-08 production source and test files. These were introduced by
Phase 2 (controlled-stub provider additions) and Phase 4 (orchestrator
in-memory flight events). The Phase 7 evidence file claimed "Lint: PASS
(production source clean)" based on the recovery-baseline observation,
but the actual current state has 11 errors total (3 historical audit-
evidence + 8 new).

**Source.**
- Phase 2 commit `86eca26` introduced:
  - `src/providers/stub-reasoning.ts:54:16` — `_input` is defined but
    never used (the `ReasoningProvider.reason()` interface signature
    has an `_input` parameter that the stub implementation ignores).
  - `src/gateway/main.ts:178:13` — `_ctx` is defined but never used
    (a context parameter in the stub runtime factory).
- Phase 4 commit `9d12ed6` introduced:
  - `src/mission/orchestrator.ts:25:10` — `MemoryFlightRecorder`
    import is no longer used (Phase 4 changed the orchestrator to
    capture flight events in-memory via `inMemoryFlightEvents: []`
    array, removing the `recorder instanceof MemoryFlightRecorder`
    branch).
  - `tests/g6-08/p4-verification-integrity.test.ts` — 5 unused
    imports (`MissionService`, `MemoryFlightRecorder`,
    `CallerIdentity`, `RuntimeHandle`, `WorkerGenome`).

**Assessment.**
- Likelihood = HIGH (certain — `npm run lint` exits with code 1).
- Impact = LOW (the errors are stylistic — unused imports/parameters;
  no runtime impact; typecheck still passes; all 578 tests still pass).
- Composite = LOW-MEDIUM.

**Mitigation applied.**
- None yet — discovered during Phase 8 verification.
- The CI workflow added in Phase 7 (`.github/workflows/ci.yml`)
  runs `npm run lint` and would FAIL on push/PR until these are fixed.
  This means CI is currently broken on the
  `build/group-06-productionization` branch.

**Recommended action for G6-09 (urgent, pre-merge).**
1. Remove the unused `MemoryFlightRecorder` import from
   `src/mission/orchestrator.ts`.
2. Either use the `_input` parameter in `stub-reasoning.ts` or
   rename to `_<name>` convention (the eslint config's
   `no-unused-vars` rule may need to be configured to allow `_`
   prefix).
3. Same for `_ctx` in `main.ts:178`.
4. Remove the 5 unused imports from `p4-verification-integrity.test.ts`.
5. Optionally, configure the eslint `argsIgnorePattern: '^_'` to
   tolerate intentionally-unused parameters (the existing `_input`/
   `_ctx` names suggest this convention was intended but not
   configured).
6. Re-run `npm run lint` and confirm exit=0 (modulo the 3 historical
   audit-evidence errors, which could be addressed by adding
   `experiments/g6-07-audit/reproduction-evidence/**` to the eslint
   `ignores` list — separate decision).

**Residual until:** the 8 errors are removed (estimated <15 minutes
of work). Should be done before the G6-08 branch is merged to `main`.

---

## RR-09 — B-EXEC-FINDING-003 (graceful worker teardown) partially mitigated, not fully closed

**Description.**
B-EXEC-FINDING-003 (no graceful teardown of OpenBot workers on shutdown)
remains OPEN in the ledger. The Phase 1 RB-3 fix added process-group
kill for the gateway itself, which on POSIX systems reaches OpenBot
workers via the shared PGID. But the audit's full concern — explicit
`close()` calls on the OpenBot adapter, `abortAll()` on MissionService,
and proper SIGTERM propagation to workers — is not yet implemented.

**Source.**
- B-EXEC-FINDING-003 (no graceful teardown of OpenBot workers on
  shutdown).
- Phase 9 architectural decision noted the parent-death detection
  aspect (C-LEARNING-FINDING-017) as BLOCKED_BY_ENVIRONMENT.
- Phase 1 RB-3 fix (`release-blocker-evidence.md`-adjacent — see
  `tests/gateway/clean-room-gateway.test.ts` GATEWAY-04/GATEWAY-05).

**Assessment.**
- Likelihood = MEDIUM (only triggered on shutdown with in-flight
  missions).
- Impact = MEDIUM (orphaned workers + potential incomplete
  verification state).
- Composite = MEDIUM.

**Mitigation applied.**
- Phase 1 RB-3 fix: `detached: true` + `process.kill(-pgid, signal)`
  on SIGTERM/SIGINT/SIGQUIT. Verified by GATEWAY-04/GATEWAY-05
  tests.
- OpenBot workers spawned via the adapter inherit the gateway's
  process group; SIGTERM to the gateway's process group reaches
  them on POSIX.
- This is a PARTIAL mitigation: it does NOT cover SIGKILL, OOM
  killer, or kernel crashes.

**Recommended action for G6-09.**
1. Add a `MissionService.shutdown()` method that calls
   `runtime.close()` on each active mission's adapter (the
   `OpenBotRuntimeAdapter.close()` method exists but is NEVER
   called by the gateway — see B-EXEC-FINDING-003 affected files).
2. Wire `MissionService.shutdown()` into the gateway's SIGTERM
   handler.
3. Add a regression test that spawns a real OpenBot worker (once
   RR-01 is resolved), submits a mission, sends SIGTERM, and
   verifies the worker process exits within a deadline.
4. Once implemented, downgrade B-EXEC-FINDING-003 from OPEN to
   FIXED_VERIFIED.

**Residual until:** real OpenBot integration (RR-01) + explicit
shutdown wiring.

---

## Cross-reference matrix

| Risk | Finding IDs closed in G6-08 | Finding IDs remaining |
|---|---|---|
| RR-01 | (no findings — environmental) | B-EXEC-FINDING-005, B-EXEC-FINDING-006 (partial) |
| RR-02 | (none — deferred) | C-PROTOCOLS-FINDING-013, -009..-018 |
| RR-03 | (partial — RB-3 process-group kill) | C-LEARNING-FINDING-017 |
| RR-04 | (none — architectural decision) | C-LEARNING-FINDING-009/-010/-011/-013 |
| RR-05 | (none — P3 opportunistic) | 22 P3 findings (see remediation-plan.md) |
| RR-06 | C-PROTOCOLS-FINDING-002/-007/-008 (AG-UI schema) | C-PROTOCOLS-FINDING-003/-006/-009..-018 |
| RR-07 | (none — BLOCKED_BY_ENVIRONMENT) | B-EXEC-FINDING-005 |
| RR-08 | (none — discovered in Phase 8) | 8 new lint errors (Phase 2 + Phase 4 regressions) |
| RR-09 | (partial — RB-3) | B-EXEC-FINDING-003 |

---

## Honest summary

- The release gate is **PASS_WITH_LIMITATIONS**.
- The 9 residual risks above are real, documented, and bounded.
- None of them is a release blocker for Engine v1.
- 4 of them (RR-01, RR-03, RR-04, RR-07) are environmental — they
  require real external infrastructure (ZAI, OpenBot, OpenMuse) that
  was not available in the G6-08 sandbox.
- 3 of them (RR-02, RR-06, RR-09) require either upstream SDK changes
  or architectural decisions outside Engine v1's declared scope.
- 1 (RR-05) is the documented P3 opportunistic class.
- 1 (RR-08) is a regression discovered during Phase 8 verification —
  it must be fixed before merge (estimated <15 minutes).

The G6-09 attack plan should prioritize:
1. RR-08 (lint regression — quick fix, unblocks CI).
2. RR-09 (worker teardown wiring — partial mitigation already in
   place).
3. RR-01 (live production execution — biggest evidence gap).
4. RR-07 (ZAI SDK credential verification — depends on RR-01).
5. RR-02 (federation identity — depends on deployment threat model).
6. RR-03 (parent-death detection — depends on RR-01).
7. RR-04 (restart recovery — only when a deployment requires it).
8. RR-05 + RR-06 (P3 sweep + protocol compliance — opportunistic).

---

END OF RESIDUAL RISK REGISTER.
