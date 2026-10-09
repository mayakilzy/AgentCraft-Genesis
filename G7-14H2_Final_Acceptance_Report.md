# G7-14H2 — Final Acceptance Report (independent review correction)

**Mission:** G7-14H2 Final Acceptance — independent diagnostic + correction
**Branch:** `build/g7-14-constrained-mcp`
**Baseline:** `e9ca861ffc60287ececa63bde234619a9c0fe068` (G7-14H Final Acceptance — PARTIAL, awaiting review)
**Date:** 2026-10-10

---

## 0. Authoritative Checkpoint Verification

| Item | Value | Status |
|---|---|---|
| Repository | `github.com/mayakilzy/AgentCraft-Genesis` | cloned ✓ |
| Branch | `build/g7-14-constrained-mcp` | checked out ✓ |
| Local HEAD before work | `e9ca861ffc60287ececa63bde234619a9c0fe068` | matches authoritative checkpoint ✓ |
| Remote HEAD before work | `e9ca861ffc60287ececa63bde234619a9c0fe068` | matches (fetch confirms 0/0 divergence) ✓ |
| SHA discrepancy note | The previous G7-14H acceptance report declared `FINAL_REMOTE_HEAD = 9949337`, but the actual remote HEAD at review time was `e9ca861`. The "discrepancy" is purely in-document wording: `9949337` was the SHA *before* the report file itself was committed; commit `e9ca861` then added the report file. Both local and remote are at `e9ca861`; there is no real divergence. | resolved ✓ |
| Force-push | Never used. No history rewritten. | preserved ✓ |

---

## 1. H1 — Real MCP Mission (corrected)

**Status: PASS**

### Root Cause (independently confirmed — see Section 6)

The previous developer's hypothesis ("MemoryRuntime does not provide MemoryComputer → computer surface null") was **incorrect**. The actual root cause:

The failing test's `outcome` text (`'Analyze the dataset and compute statistics from the numbers.'`) triggered only the `data-analysis` capability need. The `data-analysis` need is satisfied by `shell-execution` (openbot) and `analyze` (mcp), but **NOT** by `workspace-files`. The compiled genome therefore lacked the `openbot:workspace-files` grant. When the worker emitted `write_file`, `WorkerAgent.grantsFor('write_file')` (worker-agent.ts:493-496) refused the action at the grant-check branch (worker-agent.ts:907-923) — **before** reaching the `if (this.computer === null)` branch. The worker's `MemoryComputer` was in fact registered (because `computer.required = true` with `grantedDomains.size > 0`).

This was a **test-fixture configuration issue**, NOT a production defect.

### Correction Applied

Single test-file edit (`tests/g7-14g-real-mission-mcp.test.ts`):

1. **`outcome` text** changed from `'Analyze the dataset and compute statistics from the numbers.'` to `'Analyze the dataset and write a report summarizing the computed statistics.'` — adding the `document-authoring` signal (matches the `report`/`write`/`summarize` heuristics in `NEED_RULES`). This causes `extractNeeds` to add `document-authoring` to `capabilityNeeds`, which `workspace-files.satisfies` covers, granting `openbot:workspace-files`.

2. **Assertions strengthened** (not weakened):
   - `expect(snapshot.status).toBe('SUCCEEDED')` — per spec "Do not accept FAILED as a successful mission."
   - `write_file` events: at least one with `ok:true`.
   - `service.getArtifacts(missionId, CALLER)` returns a record for `output.md` with `bytes > 0` and `verified: true`.
   - All pre-existing assertions retained (call_tool ok:true, terminal, etc.).
   - All other tests in the file (negative, unavailable, cleanup) **unchanged**.

### Evidence

```
$ npx vitest run tests/g7-14g-real-mission-mcp.test.ts --reporter=verbose

 ✓ G7-14G G1 — Real MCP mission integration > authorized worker invokes a real MCP tool and writes the verified artifact through the production path (323ms)
 ✓ G7-14G G1 — Real MCP mission integration > unauthorized tool invocation is rejected by the grant check (0ms)
 ✓ G7-14G G1 — Real MCP mission integration > unavailable provider produces honest failure (32ms)
 ✓ G7-14G G1 — Real MCP mission integration > provider resources close on mission completion (181ms)

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

The first test now proves the full production chain end-to-end:
- `MissionService → Orchestrator → WorkerAgent → LazyCompositeMcpProvider → MCP server subprocess` (call_tool ok:true)
- `WorkerAgent → MemoryComputer.writeFile` (write_file ok:true)
- `VerificationLoop → clean-room copy of output.md` (verified:true)
- Final mission status: **SUCCEEDED** (not FAILED)

---

## 2. H2 — Real Studio Browser Acceptance

**Status: PASS**

### Script

`scripts/g7-14h-browser-acceptance.cjs` — reuses the established G7-13F Playwright pattern (spawn Gateway → spawn Next.js production web → launch chromium headless → interact → screenshot → assertions). Spawns the REAL Gateway (with a configured MCP servers YAML file containing distinctive SENTINEL secret values), the REAL Next.js BFF + Studio web app, and a REAL headless Chromium browser.

### Sentinel Secret Values (must NEVER appear in any API response or rendered DOM)

| Sentinel | Value | Where it would leak if redaction failed |
|---|---|---|
| Stdio command path | `/tmp/g7-14h-sentinel-mcp-server.mjs` | `transport.command`/`transport.args[0]` in BFF JSON |
| Stdio env value | `ZAI_G714H_SENTINEL_ENV_VALUE_LEAKED_9f3a7c2d` | `transport.env.G7_14H_SENTINEL_ENV` in BFF JSON |
| Stdio cwd | `/tmp/g7-14h-sentinel-cwd-9f3a7c2d` | `transport.cwd` in BFF JSON |
| HTTP url | `http://g7-14h-sentinel.invalid:9999/mcp` | `transport.url` in BFF JSON (if config used http kind) |
| Stdio arg | `--g7-14h-sentinel-arg-9f3a7c2d` | `transport.args[1]` in BFF JSON |

Per spec: "Do not rely on checking for generic words such as `command` or `url`". The sentinel values are unique and unambiguous — any appearance in DOM or API response is unambiguous evidence of a leak.

### BR-* Test Results (12/12 PASS)

| ID | Status | Detail |
|---|---|---|
| BR-01 | PASS | gateway up (health + plugins with sentinel server), web up |
| BR-02 | PASS | logged in; Home nav visible |
| BR-03 | PASS | Studio Catalog rendered (documentation notice visible) |
| BR-04 | PASS | "Configured MCP Servers" section rendered |
| BR-04b | PASS | sentinel server "g7-14h-sentinel-server" rendered |
| BR-05 | PASS | status badge "CONFIGURED" rendered (truthful — no fabrication) |
| BR-05b | PASS | no fabricated statuses on the MCP server card (AVAILABLE/RUNTIME_VERIFIED/UNAVAILABLE absent from card scope) |
| BR-06 | PASS | grant "mcp:sentinel-analyze" rendered |
| BR-07 | PASS | all sentinel secret values ABSENT from rendered DOM |
| BR-08 | PASS | BFF /api/genesis/v1/plugins: sentinel secrets ABSENT; public fields (name, grants, status=CONFIGURED) present |
| BR-09 | PASS | no unexpected console errors during Studio render (1 total messages; 1 expected pre-login 401s filtered) |
| BR-10 | PASS | browser closed cleanly |

### Evidence Path

`evidence/g7-14h/`:

- `br-results.json` — full BR-* status table with timestamps
- `br-02-after-login.png` — screenshot after PIN authentication
- `br-03-studio-catalog.png` — screenshot of the Studio Catalog
- `br-07-dom-after-checks.png` — full-page screenshot after all DOM checks
- `br-08-bff-plugins-response.json` — the BFF `/api/genesis/v1/plugins` response (proves only public fields returned)
- `br-09-console-messages.json` — captured console messages during the run
- `br-studio-dom.html` — full rendered DOM HTML of the Studio page

### BFF API Response (verified clean)

```json
{
  "plugins": [
    {
      "name": "g7-14h-sentinel-server",
      "transportKind": "stdio",
      "grants": ["mcp:sentinel-analyze"],
      "satisfies": ["sentinel-data-analysis-9f3a7c2d"],
      "description": "Sentinel MCP server for G7-14H browser acceptance — no real invocation expected",
      "status": "CONFIGURED"
    }
  ]
}
```

Only public fields are returned: `name`, `transportKind`, `grants`, `satisfies`, `description`, `status`. No `command`, `args`, `env`, `cwd`, or `url` field is present. The sentinel secret values are absent.

---

## 3. Final Regression

**Status: PASS**

| Check | Command | Result |
|---|---|---|
| Full regression | `npx vitest run` | **819 passed, 9 skipped, 0 failed (84 files)** |
| Engine typecheck | `npx tsc --noEmit` | PASS (0 errors) |
| Web typecheck | `cd web && npx tsc --noEmit` | PASS (0 errors) |
| Engine lint | `npx eslint .` | PASS (0 errors) |
| Web lint | `cd web && npx eslint .` | PASS (0 errors, 4 pre-existing warnings) |
| Frozen contracts | `git diff 2b105e5..HEAD -- src/contracts/core.ts src/mission/verification.ts src/mission/orchestrator.ts src/goal/goal-compiler.ts` | **0 diff lines** (UNCHANGED) |
| ownership.yaml | `git diff 2b105e5..HEAD -- data/ownership.yaml` | **0 diff lines** (UNCHANGED) |

### Frozen contract verification

```text
$ git diff 2b105e5..HEAD -- src/contracts/core.ts src/mission/verification.ts src/mission/orchestrator.ts src/goal/goal-compiler.ts | wc -l
0
```

### No runtime data tracked

`.gitignore` includes `data/projects/` (fixed in G7-14G). `git ls-tree -r --name-only HEAD | grep data/projects/` returns nothing — no tracked runtime data.

### No secrets in source

`git grep -l -E "g7-14h-test-key|g7-14h-bff-test-secret" HEAD -- src/ web/src/` returns nothing. Test sentinel values are confined to the browser script (gitignored except for force-add) and the evidence directory (committed as evidence).

---

## 4. G3 — Status Truthfulness

**Status: PASS**

The Studio Catalog implementation:
- Only returns `status: "CONFIGURED"` from the Gateway API.
- `AVAILABLE`, `RUNTIME_VERIFIED`, `UNAVAILABLE` are defined in the type system but NOT fabricated without evidence.
- The `PluginCard` component handles all four statuses but only displays what the API returns.
- BR-05b verifies that on the actual MCP server card, only `CONFIGURED` is shown (the Status filter dropdown's "Available" / "Runtime verified" labels are filter options, NOT fabricated statuses on the MCP server card).

---

## 5. G4 — Repository Integrity

**Status: PASS**

- `.gitignore` includes `data/projects/` (fixed in G7-14G).
- No tracked runtime data files.
- No unintended deletions in `git diff 2b105e5..HEAD`.
- No force-push; all existing commits preserved.

---

## 6. Files Changed (G7-14H2)

| File | Status | Notes |
|---|---|---|
| `tests/g7-14g-real-mission-mcp.test.ts` | MODIFIED | outcome text + strengthened assertions (H1) |
| `scripts/g7-14h-browser-acceptance.cjs` | NEW (force-added; `scripts/` is gitignored) | H2 browser acceptance script |
| `evidence/g7-14h/` | NEW (7 files) | H2 browser evidence (screenshots, JSON, HTML) |
| `eslint.config.js` | MODIFIED | Added `scripts/g7-14h-browser-acceptance.cjs` to ignore list (same pattern as g7-13d/e/f) |

**No frozen-contract modifications.** No production source modifications (`src/`, `web/src/`). No `data/ownership.yaml` modification.

---

## 7. Final Status

```text
G7_14_ACCEPTANCE = PASS

H1_SUCCESSFUL_MCP_MISSION = PASS
  (call_tool ok:true + write_file ok:true + artifact verified:true
   + mission status SUCCEEDED through real production path)

H2_STUDIO_BROWSER_ACCEPTANCE = PASS
  (12/12 BR-* checks PASS; sentinel secrets absent from DOM and API;
   CONFIGURED status truthful; no fabrication)

H3_FINAL_REGRESSION = PASS
  (819 tests, 0 failures; typecheck PASS; lint PASS;
   frozen contracts UNCHANGED; ownership.yaml UNCHANGED)

G3_STATUS_TRUTHFULNESS = PASS
G4_REPOSITORY_INTEGRITY = PASS

PRODUCTION_CODE_IMPACT = NONE (test-only correction + new browser script)
FROZEN_CONTRACT_IMPACT = NONE (0 diff lines vs 2b105e5)
OWNERSHIP_YAML_IMPACT = NONE (0 diff lines vs 2b105e5)
NEW_DEPENDENCIES = NONE

NOT_DECLARED_CLOSED = NO
  (Independent review correction complete; awaiting remote verification.)
```

---

## 8. Evidence Locations

| Evidence | Path |
|---|---|
| H1 corrected test | `tests/g7-14g-real-mission-mcp.test.ts` |
| H2 browser script | `scripts/g7-14h-browser-acceptance.cjs` |
| H2 BR-* results | `evidence/g7-14h/br-results.json` |
| H2 screenshots | `evidence/g7-14h/br-02-after-login.png`, `br-03-studio-catalog.png`, `br-07-dom-after-checks.png` |
| H2 BFF API response | `evidence/g7-14h/br-08-bff-plugins-response.json` |
| H2 console messages | `evidence/g7-14h/br-09-console-messages.json` |
| H2 rendered DOM | `evidence/g7-14h/br-studio-dom.html` |
| Previous reports | `G7-14R_Final_Implementation_Report.md`, `G7-14H_Final_Acceptance_Report.md` |

---

## 9. Engineering Principle

**SMALL IN CODE. LARGE IN CAPABILITY.**

The correction was 44 lines in a single test file plus a new browser script — production code unchanged, frozen contracts unchanged, ownership registry unchanged. The result: H1 advanced from PARTIAL to PASS, H2 advanced from NOT_EXECUTED to PASS, and the full 819-test regression remains green.

---

**End of G7-14H2 Final Acceptance Report.**
