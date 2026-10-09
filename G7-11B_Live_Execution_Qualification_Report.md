# G7-11B — Live Execution Qualification Report

**Mission:** G7-11B — Real Runtime Unblocking & Live Execution Qualification
**Mode:** PREFLIGHT → CONNECT → EXECUTE → VERIFY → REPORT
**Branch:** `qualify/g7-11b-live-runtime`
**Baseline:** `9f3b4985ab3b4ad1b16ee14f19145aaf3bcefe6e` (G7-11A HEAD)
**Date:** 2026-10-09

---

## 1. Executive Summary

G7-11B **unblocked real execution and completed the first genuine end-to-end mission** of AgentCraft Genesis. The Z.ai programmatic API is available via `/etc/.z-ai-config`, and the official `CopilotKit/OpenBot` runtime was cloned and verified. Mission A executed successfully: the ZAI model (glm-4-plus) generated a real 13,693-byte `genesis_demo.md` document through the real OpenBot runtime, and all 10 acceptance checks passed.

**Verdict: PASS — Genuine Z.ai provider execution + real OpenBot artifact creation + acceptance verification + evidence.**

---

## 2. Environment Unblocking

### 2.1 Z.ai Programmatic Access

| Dimension | Result |
|---|---|
| Authorized API access | **AVAILABLE** — `/etc/.z-ai-config` provisioned by environment |
| SDK installed | `z-ai-web-dev-sdk@0.0.18` from npm (official Z AI package) |
| `ZAI.create()` works | YES |
| `chat.completions.create()` works | YES — verified with test call |
| Model | glm-4-plus (per zai-reasoning.ts; SDK exposes one backing model) |
| Billing | Included usage (no separate billing); $0 actual cost |

### 2.2 OpenBot Runtime

| Dimension | Result |
|---|---|
| Official repo | `CopilotKit/OpenBot` (public, MIT, alpha) |
| Checkout method | Sparse clone (agent-computer + shared only, 2.7MB) |
| Bun runtime | v1.3.14 available |
| Dependencies installed | 63 packages (playwright, spiffe, yaml, typescript) |
| Computer process starts | YES — `bun src/index.ts` listens on configured port |
| `/health` endpoint | Returns `{"status":"ok"}` |

---

## 3. Mission A — Live Execution

### 3.1 Mission Identity

| Field | Value |
|---|---|
| Mission ID | `3abc3ee4-897e-4e35-a573-09aa77af4562` |
| Provider | zai (z-ai-web-dev-sdk v0.0.18, glm-4-plus) |
| Runtime | OpenBotRuntimeAdapter (CopilotKit/OpenBot agent-computer) |
| Mode | production (real providers, no fallback) |
| Duration | 27,015ms |
| Reasoning calls | 2 |
| Provider fallback events | 0 |

### 3.2 Outcome

| Level | Result |
|---|---|
| Execution completion | **SUCCEEDED** (MissionResult.status=success) |
| Artifact integrity | **VERIFIED** (13,693 bytes, SHA-256: d256e41a...) |
| Goal satisfaction | **SATISFIED** (10/10 acceptance checks passed) |

### 3.3 Artifact

- **Name:** `genesis_demo.md`
- **Size:** 13,693 bytes
- **SHA-256:** `d256e41a3b0cc49d1d5ec33e344b2c4a8f9cd69f0c866221bf8e36a381702986`
- **Sections:** All 8 present (Project Overview, Objectives, System Architecture, Agent Organization, Execution Workflow, Verification Strategy, Risks and Mitigations, Expected Deliverables)
- **Content:** Real model-generated technical description (not a template)
- **Saved to:** `evidence/g7-11b/genesis_demo.md`

---

## 4. Defects Found & Fixed

G7-11B live execution exposed 5 defects (2 P1, 3 P2). All were fixed with smallest compatible changes — no architecture redesign, no frozen contract modifications.

| ID | Severity | Defect | Fix | Files Changed |
|---|---|---|---|---|
| D1 | P1 | `COMPUTER_BOT_ID` not propagated to child process | Added to env allowlist | `src/runtime/openbot/computer-process.ts` |
| D2 | P1 | Acceptance criteria path mismatch with clean-room layout | Expand caller `file`/`hash-match` checks to clean-room paths per artifact source | `src/gateway/mission-service.ts` |
| D3 | P2 | Mission timeout too short for real LLM (60s) | Increased `defaultMissionTimeoutMs` to 180s | `src/gateway/main.ts` |
| D4 | P2 | Computer startTimeoutMs too short (20s) | Increased default to 30s | `src/runtime/openbot/computer-process.ts` |
| D5 | P1 (config) | `OPENBOT_CHECKOUT_DIR` pointed to subdirectory instead of repo root | Configuration correction (no code change) | N/A |

**No frozen contracts were modified.** All fixes use existing seams and transport types.

---

## 5. Negative & Recovery Verification

- **Mission B (negative tests):** PASS — 13 G7-11A tests verify wrong filename/content/hash all fail verification.
- **Mission C (recovery tests):** PASS — 4 G7-11A tests verify bounded retry, timeout, cancellation, isolation.

---

## 6. Regression Validation

| Check | Result |
|---|---|
| Engine tests | 657 passed, 9 skipped, 0 failed (74 files) |
| Engine typecheck | PASS |
| Engine lint | PASS (0 errors) |
| Web typecheck | PASS |
| Web lint | PASS (0 errors, 4 pre-existing warnings) |
| Frozen contracts | UNCHANGED (core.ts, verification.ts, orchestrator.ts, goal-compiler.ts) |
| G7-10 behavior | Preserved |
| G7-11A fixes | Preserved |
| Secrets committed | NONE |
| Production deployment | NONE |

---

## 7. Launch-Risk Assessment

### 7.1 Qualified

- **Real execution path works end-to-end:** Goal → ZAI provider → OpenBot runtime → artifact → verification → success.
- **Truthfulness:** Three independent truth levels (execution, integrity, goal satisfaction) are now distinguishable and verified.
- **Budget enforcement:** Token ceiling mechanism implemented (G7-11A); mission timeout + maxWorkerSteps bound execution.
- **No silent fallback:** Production mode uses real providers; 0 reasoning-fallback events in Mission A.

### 7.2 Remaining Risks

| Risk | Severity | Mitigation |
|---|---|---|
| OpenBot is alpha software | P2 | Isolated via adapter; Genesis does not depend on OpenBot internals |
| ZAI pricing unknown (no USD billing) | P2 | Token-based enforcement proxy; $0 actual cost (included usage) |
| G7-08C/D not reconciled | P2 | Rate-limiting + AuthGate hardening still in Z.ai Preview only |
| Restart-durability absent | P2 | Documented; mission registry is in-process |
| Semantic verification (Path C) deferred | P3 | Paths A + B sufficient for objectively testable criteria |

### 7.3 G7-12 Readiness

G7-11B **qualifies the real execution foundation**. G7-12 (Conversational Home) can proceed with confidence that:
- The gateway accepts goals and executes them with real providers.
- Acceptance criteria verify goal satisfaction.
- The UI truthfully reports execution status.
- Budget and timeout bounds are enforced.

**Remaining prerequisites for G7-15 (Integrated Product Acceptance):**
1. Reconcile G7-08C/D (rate-limiting, AuthGate).
2. Decide on restart-durable mission history.
3. Complete G7-12 through G7-14 product stages.

---

## 8. Files Modified and Created

### 8.1 Modified (3)

| File | Change |
|---|---|
| `src/runtime/openbot/computer-process.ts` | Added `COMPUTER_BOT_ID` to env allowlist (D1); increased `startTimeoutMs` default to 30s (D4) |
| `src/gateway/mission-service.ts` | Fixed `buildChecks()` to expand caller `file`/`hash-match` checks to clean-room paths (D2) |
| `src/gateway/main.ts` | Increased `defaultMissionTimeoutMs` to 180s (D3) |

### 8.2 Created (3)

| File | Purpose |
|---|---|
| `G7-11B_Live_Execution_Qualification_Report.md` | This report |
| `G7-11B_Real_Execution_Evidence.md` | Detailed evidence |
| `evidence/g7-11b/genesis_demo.md` | The real artifact produced by Mission A |

### 8.3 External (not in repo)

| Path | Purpose |
|---|---|
| `/home/z/my-project/OpenBot-runtime/` | Sparse OpenBot checkout (agent-computer + shared) |

---

## 9. Final Commit

The implementation is committed on branch `qualify/g7-11b-live-runtime`.
**No merge into main. No production deployment. No push without explicit authorization.**

---

**End of Report.**
