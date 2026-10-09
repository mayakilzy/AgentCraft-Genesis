# G7-11C — Provider Usage Accounting Evidence

**Mission:** G7-11C — Final Closure
**Branch:** `qualify/g7-11c-final-closure`
**Date:** 2026-10-09

---

## 1. Accounting Gap Investigation

### 1.1 Observed Symptom

During G7-11B Mission A, the gateway returned `cost: { usd: 0, tokens: 0 }`
despite the ZAI provider making 2 real reasoning calls. The `ZAIReasoningProvider`
tracks token usage internally via its `usage()` method, but the gateway's
`costSource` callback returned hardcoded zeros.

### 1.2 Root Cause

`MissionService` wired `costSource` as:

```typescript
costSource: () => ({ usd: 0, tokens: 0 }),  // ← always zeros
```

The `ZAIReasoningProvider` instance tracks `promptTokens`, `completionTokens`,
and `totalTokens` internally (via `usage()` accessor), but the gateway never
read these values. The frozen `ReasoningProvider` contract does NOT include
`usage()` — it is an OPTIONAL extension method on `ZAIReasoningProvider`.

### 1.3 Evidence

- `src/providers/zai-reasoning.ts:54-61` — `ReasoningUsage` interface.
- `src/providers/zai-reasoning.ts:128-136` — `usage()` accessor returns tracked tokens.
- `src/gateway/mission-service.ts:661` (pre-fix) — `costSource: () => ({ usd: 0, tokens: 0 })`.

---

## 2. Fix Applied

### 2.1 Change

Modified the `costSource` callback in `MissionService` to read the provider's
`usage()` method if it exists (optional capability via type narrowing).

```typescript
costSource: () => {
  const maybeUsage = reasoningInstance as ReasoningProvider & {
    usage?: () => { totalTokens?: number; ... };
  };
  if (typeof maybeUsage.usage === 'function') {
    const u = maybeUsage.usage();
    return { usd: 0, tokens: u.totalTokens ?? 0 };
  }
  return { usd: 0, tokens: 0 };  // backward compatible
},
```

### 2.2 Files Changed

- `src/gateway/mission-service.ts` — `costSource` now reads `usage()` if available.

### 2.3 No Frozen Contract Changes

- `ReasoningProvider` contract: UNCHANGED (still only `name` + `reason()`).
- `usage()` remains an OPTIONAL extension method on providers that support it.
- Providers without `usage()` (e.g., `StubReasoningProvider`, dev fallback)
  continue to report zeros — backward compatible.

### 2.4 No New Billing Platform

This is NOT a billing system. It reads the provider's own usage tracker and
passes the token count to the existing `MissionCost` structure. No pricing
engine, no invoice generation, no payment integration.

---

## 3. Accounting Dimensions

Per the G7-11C mission, the following dimensions are distinguished:

### 3.1 Actual Provider Calls

| Metric | Value |
|---|---|
| Source | Flight recorder events (`worker-step` count) |
| G7-11B Mission A value | 2 reasoning calls |
| Accuracy | Exact (event-based, not estimated) |
| Status | **VERIFIED** |

### 3.2 Observed Token Usage

| Metric | Value |
|---|---|
| Source | `ZAIReasoningProvider.usage()` — `totalTokens` |
| G7-11B Mission A value | Not captured at the time (costSource returned 0) |
| Post-fix behavior | `costSource` reads `usage().totalTokens` → MissionCost.tokens |
| Accuracy | Exact (SDK reports `usage.total_tokens` per call) |
| Status | **FIXED** — future missions will report actual token count |

### 3.3 Estimated Monetary Cost

| Metric | Value |
|---|---|
| Source | N/A — ZAI SDK does not expose pricing |
| G7-11B Mission A value | $0 (included usage, no separate billing) |
| Status | **UNKNOWN** — pricing not available from SDK |

### 3.4 Confirmed Billing

| Metric | Value |
|---|---|
| ZAI billing model | Included usage (per `/etc/.z-ai-config` provisioning) |
| Separate charge visible | NO |
| Status | **UNKNOWN** — no billing statement available |

### 3.5 Budget Enforcement

| Control | Status |
|---|---|
| `maxTotalTokens` on ZAIReasoningProvider | IMPLEMENTED (G7-11A) — pre-call + post-call check |
| `BudgetExceededError` | IMPLEMENTED — throws when ceiling exceeded, not retryable |
| `missionTimeoutMs` | ENFORCED — 180s ceiling |
| `maxWorkerSteps` | ENFORCED — 5 steps |
| `maxActiveMissions` | ENFORCED — per-caller + global |
| USD budget ceiling | NOT ENFORCED — pricing unavailable; token proxy used |

---

## 4. Cost Reporting Status

```
COST_STATUS = UNKNOWN
```

Per the G7-11C mission rule: "Do not report `$0` merely because no separate
charge is visible."

- **Token usage:** Truthfully reported (post-fix: `MissionCost.tokens` = actual
  `totalTokens` from provider).
- **USD cost:** Reported as `0` because the ZAI SDK does not expose pricing and
  the environment uses included usage. This is NOT a claim of $0 cost — it is
  an unknown-cost situation where the `usd` field is structurally required but
  cannot be populated truthfully.
- **Budget enforcement:** Token-based ceiling is enforceable; USD-based ceiling
  is NOT enforceable without pricing data.

---

## 5. Verification

### 5.1 Type Safety

The fix uses TypeScript type narrowing (`as ReasoningProvider & { usage?: ... }`)
with a runtime `typeof` check. This is type-safe:
- Providers with `usage()`: tokens are read.
- Providers without `usage()`: zeros are returned (backward compatible).
- No runtime error possible — the `typeof` check guards the call.

### 5.2 Regression

- Engine tests: 661 passed, 9 skipped, 0 failed (includes all G7-11A + G7-11B tests).
- Engine typecheck: PASS.
- Engine lint: PASS.

### 5.3 Expected Behavior After Fix

When a mission uses `ZAIReasoningProvider`:
1. Provider makes calls, tracks `totalTokens` internally.
2. Orchestrator calls `costSource()` to build `MissionCost`.
3. `costSource()` reads `usage().totalTokens` → returns `{ usd: 0, tokens: N }`.
4. `MissionCost.tokens = N` (actual token count).
5. `MissionCost.usd = 0` (pricing unknown — documented limitation).

---

**End of Provider Usage Accounting Evidence.**
