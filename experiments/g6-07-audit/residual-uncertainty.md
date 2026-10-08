# G6-07 Residual Uncertainty

**Audited commit:** `8e0ba68d8764d5769127b821cfc2b05918ca8810**

This document honestly reports what was NOT inspected, what was NOT tested, what was simulated vs real, and what uncertainty remains. It exists because G6-07 Section 10 mandates: "Do not claim exhaustive coverage merely because all files were read."

---

## 1. Components Inspected

All 48 production source files in `src/` were read. All 66 test files in `tests/` were read or surveyed. All 14 claim sources in `docs/` and `experiments/` were read. The dependency tree was inspected (`npm audit`, `npm ls`). The lockfile, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, and `.gitignore` were inspected.

**File-by-file inspection coverage:**
- `src/contracts/core.ts` — read
- `src/goal/goal-compiler.ts`, `src/goal/llm-understanding.ts` — read
- `src/organization/organization-planner.ts` — read
- `src/genome/genome-compiler.ts` — read
- `src/routing/decision-provider.ts`, `src/routing/cognitive-router.ts` — read
- `src/providers/zai-reasoning.ts`, `src/providers/jev-decision-provider.ts` — read
- `src/runtime/computer.ts`, `src/runtime/openbot/adapter.ts`, `src/runtime/openbot/computer-api.ts`, `src/runtime/openbot/computer-process.ts` — read
- `src/runtime/mcp/capability-provider.ts` — read
- `src/runtime/federation/service.ts`, `src/runtime/federation/types.ts` — read
- `src/worker/worker-agent.ts`, `src/worker/handoff.ts` — read
- `src/mission/orchestrator.ts`, `src/mission/flight-recorder.ts`, `src/mission/verification.ts`, `src/mission/artifact-record.ts`, `src/mission/failure-class.ts`, `src/mission/config-validator.ts` — read
- `src/gateway/main.ts`, `src/gateway/http-server.ts`, `src/gateway/a2a-server.ts`, `src/gateway/mission-service.ts`, `src/gateway/types.ts` — read
- `src/agui/event-bridge.ts` — read
- `src/learning/*.ts` (8 files) — read
- `src/work/dev-runtime.ts`, `src/work/integration-manager.ts`, `src/work/git-workspace.ts`, `src/work/repo-mission.ts` — read
- `src/index.ts` — read

## 2. Components NOT Inspected at Runtime

The following components were inspected by code reading but NOT exercised at runtime with real dependencies:

- **OpenBot adapter (`src/runtime/openbot/adapter.ts`)**: The actual `bun src/index.ts` child-process spawning was never executed. No OpenBot checkout (v0.1.0) was available in the sandbox. The adapter's `detached: true` + process-group-kill pattern was verified by code inspection against `src/runtime/openbot/computer-process.ts:173-290`, but the actual spawn contract, the `WORKSPACE_DIR`/`PROFILES_DIR`/port/token configuration, and the `COMPUTER_TOKEN` exchange were never tested with a real OpenBot process.

- **ZAI reasoning provider (`src/providers/zai-reasoning.ts`)**: The `ZAIReasoningProvider` was never constructed with real credentials. The `loadClient()` lazy-import path and the `factory.create()` call were never executed. Whether the `z-ai-web-dev-sdk` package reads `ZAI_API_KEY` from `process.env` when no `sdkPath` is configured is **unverified** (see B-EXEC-FINDING-005). The 6-step rate-limit backoff schedule (`DEFAULT_RETRY_BACKOFF_MS`, ~7 min total) is completely untested.

- **Federation outbound (`src/runtime/federation/service.ts`)**: No real remote A2A agent was available. The `ClientFactory` + `DefaultAgentCardResolver` + `sendMessage` + `getTask` chain was verified by reading `tests/runtime/federation-service.test.ts` (which uses stub clients), but never against a real remote agent. The `extractTask` heuristic (`service.ts:402-409`) is brittle to future SDK changes but not currently broken.

- **MCP capability provider (`src/runtime/mcp/capability-provider.ts`)**: No real MCP server was available. The `Client.listTools()` + `Client.callTool()` chain was verified by reading `tests/runtime/mcp-capability-provider.test.ts` (which uses a stub server), but never against a real MCP server. Tool description prompt injection was disproved as currently impossible (descriptions are discarded), but tool OUTPUT injection (C-PROTOCOLS-FINDING-001) is an active risk that was not runtime-tested.

- **AG-UI event bridge (`src/agui/event-bridge.ts`)**: Only the in-process `MemoryAgUiSink` was tested. No real AG-UI consumer (e.g., CopilotKit) was connected. The schema violations (C-PROTOCOLS-FINDING-006/007/008/009/010) suggest a strict consumer would reject or misinterpret events, but this was not verified at runtime.

## 3. Tests Executed

- **Baseline test suite:** `npm test` — 536 passed, 9 skipped, 545 total, 62 files, 26.47s.
- **Typecheck:** `npm run typecheck` — exit 0.
- **Lint:** `npm run lint` — exit 0.
- **Fresh-clone reproduction:** `npm ci && typecheck && lint && test` in `/tmp/fresh-clone-g6-07` — all passed (F-PACKAGE-FINDING-001).
- **Audit tests (new, written during G6-07):**
  - `g6-07-clean-room-probe.mjs` — gateway startup + health probe (B-GATEWAY).
  - `g6-07-prod-failclosed-probe.mjs` — production fail-closed matrix, 7 variants (B-EXEC).
  - `g6-07-registry-growth-probe.mjs` — 100-mission registry growth + admission control + idempotency reuse (B-REGISTRY).
  - `g6-07-concurrency-probe.mjs` — 3 scenarios: 10 concurrent submissions, 5 same-key idempotency, 5 concurrent cancels (E-CONCURRENCY).
  - `g6-07-failure-injection.test.ts` — 6 audit tests covering cancellation/finish race, simultaneous cancels, cross-caller idempotency collision, verifier ensureWorker throw, computer.writeFile throw (D-FAILURE).
- **G6-06 clean-room script:** `bash experiments/g6-06/clean-room-run.sh 8e0ba68…` — reported `overall: PASS` but left 14 orphaned gateway processes (F-PACKAGE-FINDING-002).

## 4. Tests NOT Executed

- **No production-mode positive-path test exists.** This is the single largest evidence gap. The entire production execution path (real OpenBot + real ZAI) is verified only by fail-closed tests, never by a successful mission. This is why RB-1 (getArtifacts returns []) and RB-2 (concurrent collision) shipped.
- **No real OpenBot integration test was run.** `tests/runtime/openbot-adapter.test.ts` has 8 tests, 6 of which are skipped (require `$GENESIS_OPENBOT_DIR`).
- **No real ZAI reasoning test was run.** All reasoning tests use scripted stub providers.
- **No real federation integration test was run.** All federation tests use stub clients.
- **No real MCP integration test was run.** All MCP tests use a stub server.
- **No AG-UI consumer interop test was run.** All AG-UI tests use the in-process `MemoryAgUiSink`.

## 5. Code Paths Exercised

- **Dev-mode mission execution end-to-end:** smoke tests + audit probes. The full Born chain (Goal → Requirements → Plan → Genomes → ensure Workers → Work → Result → retire Workers) was exercised with `MemoryComputer` + scripted reasoning.
- **Production-mode fail-closed matrix:** 7 variants (no provider, zai-only, zai+fake-key, +openbot, +fake-checkout, memory-disallowed, unknown-provider). All exit 1 with FATAL.
- **A2A inbound (in-process):** `tests/gateway/a2a-inbound.test.ts` + `tests/gateway/concurrent-a2a.test.ts` exercise the SDK's `DefaultRequestHandler` + `InMemoryTaskStore` + `JsonRpcTransportHandler` with the `GenesisAgentExecutor`. Caller isolation, concurrent cross-caller, and cancellation are tested.
- **HTTP API (in-process):** `tests/gateway/http-api.test.ts` + `tests/gateway/e2e.test.ts` + `tests/gateway/isolation.test.ts` + `tests/gateway/cancellation.test.ts` exercise the HTTP Service API with `MemoryRuntime`.
- **Verification loop:** `tests/mission/verification.test.ts` + `tests/mission/verification-hash-match.test.ts` exercise the `VerificationLoop` with `MemoryComputer`.

## 6. Code Paths NOT Exercised

- **Successful production mission** — the entire production execution path with real providers.
- **Concurrent production missions** — the RB-2 collision scenario.
- **Real OpenBot worker spawning** — `bun src/index.ts` was never executed.
- **Real ZAI reasoning** — `factory.create()` + `client.chat.completions.create()` never executed.
- **Real MCP tool invocation** — `client.callTool()` against a real MCP server never executed.
- **Real federation delegation** — `sendMessage` + `getTask` against a real remote A2A agent never executed.
- **AG-UI over a real network sink** — only in-process `MemoryAgUiSink`.
- **Restart recovery** — none exists (documented limitation).
- **Crash consistency** — no checkpoints, no WAL, no replay.
- **Real cancellation through OpenBot** — cancellation tests use `MemoryRuntime` only.

## 7. External Systems Unavailable

- **OpenBot v0.1.0** — no checkout in sandbox. The adapter's spawn contract is verified by inspection only.
- **ZAI SDK (`z-ai-web-dev-sdk`)** — no real credentials. The fail-closed probes used fake env vars to verify the gateway refuses to start.
- **Real remote A2A agents** — no federation peers available.
- **Real MCP servers** — no MCP server available.
- **Real AG-UI consumers** — no CopilotKit or other AG-UI consumer available.
- **CI infrastructure** — no `.github/workflows/` exists (F-PACKAGE-FINDING-006).

## 8. Real Integrations Tested

- `@a2a-js/sdk@1.3.0` `InMemoryTaskStore` + `DefaultRequestHandler` + `JsonRpcTransportHandler` (in-process, via `tests/gateway/a2a-inbound.test.ts` + `tests/gateway/concurrent-a2a.test.ts`).
- `@ag-ui/core@1.0.2` `EventType` schemas (validated against `node_modules/@ag-ui/core/dist/schemas.d.ts` by C-PROTOCOLS).
- `@modelcontextprotocol/sdk@1.32.1` `Client` (verified by reading `tests/runtime/mcp-capability-provider.test.ts` fixtures; no real server).
- Native `node:http` server (via all gateway tests).
- Native `node:crypto` `timingSafeEqual` (verified by C-SECURITY for constant-time comparison).
- Native `node:async_hooks` `AsyncLocalStorage` (verified by B-A2A for caller-context propagation).

## 9. Simulated Integrations Tested

- **Stub reasoning providers:** deterministic scripted responses (dev-mode default + audit probes).
- **Stub slow reasoning providers:** never-resolving promises (cancellation tests).
- **`MemoryComputer`:** in-memory filesystem (all dev-mode tests).
- **Stub federation clients:** in `tests/runtime/federation-service.test.ts`.
- **Stub MCP server:** in `tests/runtime/mcp-capability-provider.test.ts`.
- **`MemoryAgUiSink`:** in-process AG-UI sink.

## 10. Security Scenarios Covered

- API key authentication (constant-time comparison, length-leak analysis).
- Cross-caller isolation (HTTP 404 + A2A TaskNotFoundError).
- Prompt injection vectors (tool output, tool description — the latter disproved as currently impossible).
- Path traversal (`getArtifacts` filter, `MemoryComputer` zero-validation).
- Secret redaction (10 patterns, gap analysis).
- Dependency vulnerabilities (`npm audit` 0 findings).
- Credential leakage (`GENESIS_API_KEYS` prefix leak, `worker-step` event leakage, error message leakage).

## 11. Remaining Uncertainty

1. **Whether the real ZAI SDK reads `ZAI_API_KEY` from `process.env`** when no `sdkPath` is configured (B-EXEC-FINDING-005). The fail-closed check accepts it but never wires it through `createEnv`. Latent credential failure. **Recommendation:** G6-08 should verify by code-reading the `z-ai-web-dev-sdk` package or by a live probe with real credentials.

2. **Whether a real OpenBot checkout (v0.1.0) actually starts successfully** under the adapter's spawn contract. The adapter's `detached: true` + process-group-kill pattern is correct by inspection, but the `bun src/index.ts` command was never executed. **Recommendation:** G6-08 should run `tests/runtime/openbot-adapter.test.ts` with a real OpenBot checkout.

3. **Whether concurrent production missions with a fresh-per-mission adapter** (the proposed RB-2 fix) actually isolate workspaces. The fix is straightforward but unverified at runtime. **Recommendation:** G6-08 should add a production-mode concurrency test (see remediation-plan.md Batch 1a regression tests).

4. **Whether the AG-UI event bridge interoperates with a real AG-UI consumer** (e.g., CopilotKit). The schema violations (C-PROTOCOLS-FINDING-006/007/008/009/010) suggest a strict consumer would reject or misinterpret events, but this was not verified. **Recommendation:** G6-08 should add an AG-UI consumer interop test.

5. **Whether the federation `extractTask` heuristic** (`service.ts:402-409`) is correct for all SDK 1.3.0 return shapes. It was verified for the happy path (Task vs Message) but is brittle to future SDK changes. **Recommendation:** G6-08 should add federation tests covering edge cases (empty parts, multi-part messages, error responses).

6. **Whether the `MemoryFlightRecorder` secret-redaction gap** (C-VERIFY-FINDING-007) has already leaked secrets in production. The gateway uses `MemoryFlightRecorder` by default; `getEvents` and `toSnapshot` do not apply `SECRET_PATTERNS`. If any mission was submitted with a secret in the `outcome` or `failureMessage`, it may have been exposed via the HTTP API. **Recommendation:** G6-08 should audit production logs (if any) for leaked secrets.

7. **Whether the learning loop** (`src/learning/`) is wired into any experiment that runs through the gateway. C-LEARNING found it is NOT wired into the gateway, but it may be wired into experiment runners (`experiments/academy/`). **Recommendation:** G6-08 should verify the learning loop's experiment-only status is documented and that no production path enables it.

8. **Whether the `ArtifactRegistry`** (`src/mission/artifact-record.ts`) was ever wired in and then disconnected, or was always dead code. C-VERIFY-FINDING-006 found it is dead code, but git history may reveal a previous wiring. **Recommendation:** G6-08 should `git log -p src/mission/artifact-record.ts` to determine if this was a regression.

---

## 12. Honest Coverage Statement

**Do not equate the absence of discovered P0 defects with proof that no P0 defects exist.** This audit found 3 CRITICAL release blockers (RB-1, RB-2, RB-3), but the production execution path is largely unverified at runtime. A real production-mode integration test (with real or high-fidelity stub OpenBot + ZAI) might surface additional defects that this audit could not reach.

**Do not equate a passing unit test suite with production reliability.** The 536 passing tests all run in dev mode with `MemoryComputer` + scripted reasoning. The production path with real OpenBot + real ZAI is verified only by fail-closed tests. RB-1 and RB-2 are precisely the kind of defects that a passing dev-mode test suite cannot catch.

**Do not claim exhaustive coverage merely because all files were read.** All 48 production source files were read, but reading is not the same as runtime verification. The 7 remaining-uncertainty items above identify the specific gaps between code-reading coverage and runtime coverage.

END OF RESIDUAL UNCERTAINTY.
