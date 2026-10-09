# G7-13E — Final Browser Recovery & Quality Closure

**Mission:** G7-13E — Final Browser Recovery & Quality Closure
**Branch:** `build/g7-13-durable-projects-repository`
**Baseline:** `1fec0c63d5ddfdd554c026f6c28b01a17ce79c19` (G7-13D)
**Date:** 2026-10-09

---

## 1. Mission Summary

G7-13E is a bounded verification and remediation mission. G7-13A/B/C were PASS. G7-13D was PARTIAL because rendered-browser tests PR-19 and PR-20 were NOT_EXECUTED (the script reported an AuthGate stall attributed to a Next.js HMR WebSocket environment limitation).

**Outcome:** G7-13E resolves the PARTIAL. PR-19 and PR-20 PASS with actual rendered-browser evidence.

---

## 2. Root-Cause Investigation

### 2.1 Original hypothesis (G7-13D)

The G7-13D report attributed the AuthGate stall to "the same Next.js HMR WebSocket environment limitation documented in G7-12D." This was a hypothesis carried over from the G7-12D AuthGate stall symptom — but G7-12D had achieved 11 PASS / 1 PARTIAL, so the hypothesis was inconsistent with the reference evidence.

### 2.2 Investigation steps (per spec — "Do not assume HMR is the root cause")

| Step | Finding |
|---|---|
| 1. Compare G7-13D screenshots to G7-12D screenshots | G7-13D screenshots were 9.5KB each (essentially blank — just the "Verifying session" spinner). G7-12D screenshots were 52-60KB (full app shell rendered). |
| 2. Re-read G7-12D Playwright Execution Evidence | G7-12D used **Next.js 16.4.0 production build** (not `npm run dev`). G7-13D used `npm run dev` (Turbopack + HMR WebSocket). |
| 3. Build the web app for production | `npm run build` succeeded. No HMR WebSocket in production server. |
| 4. Re-run with `npm run start` instead of `npm run dev` | Page rendered (HTML length 25,505 chars), but AuthGate still stalled. No `genesis_bff` cookie set after auth. 2 console errors (both 401 on /api/genesis/health). |
| 5. curl-test the BFF login endpoint directly | `POST /api/auth/login` returns 200 with `Set-Cookie: genesis_bff=...; Path=/; Max-Age=28800; SameSite=lax; HttpOnly` (correct). Cookie is recognized by `/api/genesis/health`. |
| 6. Read `web/src/components/genesis/AuthGate.tsx` line 160 | **The submit button uses `type="button"` with `onClick={() => void login()}` — NOT `type="submit"`.** |
| 7. Inspect G7-13D script | The script searched for `button[type="submit"]` — found 0 matches. The PIN form was filled but the form was NEVER submitted. The `genesis_bff` cookie was NEVER issued. AuthGate stalled because the user was never actually authenticated. |

### 2.3 Root cause (definitive)

**A test script bug, NOT an environment limitation.** The G7-13D script searched for `button[type="submit"]`, but AuthGate's submit button uses `type="button"` with an `onClick` handler. The PIN was filled into the input but the "Authenticate" button was never clicked, so `POST /api/auth/login` was never called, so no `genesis_bff` cookie was issued, so the AuthGate's session check returned 401 forever.

The "HMR WebSocket environment limitation" hypothesis was wrong. While HMR WebSocket errors do appear in dev mode, they are NOT the cause of the AuthGate stall — the actual cause was the test script's incorrect button locator.

### 2.4 Correction

The corrected G7-13E script (`scripts/g7-13e-browser-final.cjs`):

```js
// AuthGate uses an "Authenticate" button (type="button", onClick handler).
// Match by text content — not by type="submit".
const submitBtn = page.getByRole('button', { name: /Authenticate/i }).first();
if ((await submitBtn.count()) > 0) {
  await submitBtn.click();
  ...
} else {
  // Fall back to pressing Enter on the PIN input (the form has an
  // onKeyDown handler that triggers login()).
  await pinInput.press('Enter');
  ...
}
```

Additional setup corrections:
- Use **production build** (`next build` + `npm run start`) instead of dev server. This eliminates HMR WebSocket errors entirely and matches the G7-12D reference setup.
- Set `GENESIS_BFF_SECRET` (production-mode fail-closed bypass).
- Set `NODE_ENV=production` for the web spawn.
- Aligned API keys: BFF's `GENESIS_API_KEY=g7-13e-test-key` matches Gateway's `GENESIS_API_KEYS={"g7-13e-test-key":...}`.
- `GENESIS_COOKIE_SECURE=false` for local HTTP.
- `GENESIS_OPERATOR_PIN=g7-13e-test-pin` (so the BFF doesn't fall back to `dev-local-pin`).

---

## 3. Rendered-Browser Acceptance Results

### 3.1 Diagnostic capture

The script captures:
- Network log (every BFF + same-origin response): `evidence/g7-13e/network-log.json`.
- Cookie state after initial load + after auth.
- Console messages: `evidence/g7-13e/console-messages.json`.
- Uncaught page errors: `evidence/g7-13e/page-errors.json`.
- Screenshots at every step: 11 PNG files.

### 3.2 Network evidence (matches G7-12D pattern)

```
401 GET /api/genesis/health           ← Initial check (no cookie, expected)
200 POST /api/auth/login              ← Login successful, cookie issued
200 GET /api/genesis/health           ← After login, cookie sent ✓
200 GET /api/genesis/v1/conversations  ← Conversations accessible ✓
```

### 3.3 Cookie verification (matches G7-12D attributes)

```
genesis_bff: domain=127.0.0.1 path=/ secure=false sameSite=Lax httpOnly=true
```

### 3.4 PR-19 + PR-20 results

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| BR-19-01 | Gateway + web up (production build) | **PASS** | Both services started within 90s |
| DIAG-cookies-after-load | No cookies before auth | INFO | 0 cookies — expected |
| DIAG-cookie-state | genesis_bff cookie present after auth | **PASS** | domain=127.0.0.1, secure=false, sameSite=Lax, httpOnly=true |
| PR-19-NAV | Nav buttons visible after auth | **PASS** | 2 nav buttons visible (Projects + Home) |
| PR-19-02 | Navigate to Projects section | **PASS** | Create-project form rendered |
| PR-19-03 | Create a project via the UI | **PASS** | Project detail view rendered after create |
| PR-19-04 | Refresh + verify project visible | **PASS** | Project reappeared after browser refresh |
| PR-19-05 | Reopen project from the list | **PASS** | Project detail rendered with Brief editor |
| PR-20-01 | Open the Brief editor | **PASS** | Project Brief card visible |
| PR-20-02 | Fill in Brief fields | **PASS** | Brief save submitted; revision counter shows 1 |
| PR-20-03 | Save Brief; verify revision increments | **PASS** | Brief revision incremented to 1 |
| PR-20-04 | Open Home section; verify active-project banner | **PASS** | Home section rendered with banner |
| BR-12 | Console errors check | **PARTIAL** | 1 console error: 401 on initial /health before login (expected behavior, same as G7-12D) |

**PR-19: PASS. PR-20: PASS. BR-12: PARTIAL (expected pre-login 401 — same as G7-12D's BR-12 PARTIAL).**

### 3.5 API-level regression coverage (kept separate per spec)

| ID | Scenario | Result |
|---|---|---|
| AP-01 | login via /api/auth/login | PASS |
| AP-02 | create project via /v1/projects | PASS |
| AP-03 | list projects | PASS |
| AP-04 | get project metadata | PASS |
| AP-05 | update Brief | PASS |
| AP-06 | overview (durable recovery) | PASS |

API-level coverage is NOT substituted for rendered-browser tests per spec. Both are reported separately above.

---

## 4. Code Size Review

### 4.1 Source/test/docs breakdown of the 6196 added lines

| Category | Files | Lines | % of total |
|---|---|---|---|
| Engine source (src/) | 3 | 1886 | 30% |
| Web source (web/src/) | 8 | 1462 | 24% |
| Tests (tests/) | 2 | 1434 | 23% |
| Documentation (.md) | 5 | 1317 | 21% |
| Evidence (g7-13d + g7-13e) | 4 | 89 + 11 PNGs | 1% |
| Config (eslint.config.js) | 1 | 6 | <1% |
| Scripts | 1 (already committed in D) | — | — |
| **Total** | **24 files** | **6196** | **100%** |

### 4.2 Source files breakdown

| File | Lines | Role |
|---|---|---|
| `src/project/project-store.ts` | 1049 | FileProjectStore: atomic writes, revision-controlled Brief, idempotency keys, owner-scoped queries, cross-project conversation-uniqueness, path safety, corrupt-file preservation. |
| `src/gateway/project-routes.ts` | 834 | 10 routes with auth + caller ownership + ownership verification for mission/conversation/artifact links + overview derivation. |
| `web/src/components/genesis/ProjectsSection.tsx` | 939 | List view + detail view + Brief editor + relationships grid (3 sub-components) + project metadata editor + Brief entry provenance rendering. |
| `web/src/lib/genesis/client.ts` | +257 | 9 project API methods (createProject, listProjects, getProject, updateProject, getBrief, updateBrief with typed BRIEF_REVISION_CONFLICT result, getProjectOverview, linkConversation, linkMissionToProject, linkArtifactToProject). |
| `web/src/lib/genesis/types.ts` | +164 | 11 project types + extended GatewayErrorCode union. |
| `web/src/app/api/genesis/[...path]/route.ts` | +22 | 7 new verified patterns + PUT handler + PUT method. |
| `web/src/components/genesis/HomeSection.tsx` | +37 | Optional project context — new conversations auto-link to activeProjectId. |
| `src/gateway/http-server.ts` | +11 | projectStore param + project route routing. |
| `web/src/lib/genesis/store.ts` | +18 | activeProjectId + setActiveProjectId + 'projects' section. |
| `src/gateway/main.ts` | +7 | Construct FileProjectStore + pass to startHttpServer. |
| `web/src/components/genesis/AppShell.tsx` | +6 | FolderKanban icon mapping + Alt+1..8 keyboard shortcuts. |
| `web/src/components/genesis/GenesisApp.tsx` | +2 | Render ProjectsSection. |

### 4.3 Test files breakdown

| File | Lines | Tests | Avg lines/test |
|---|---|---|---|
| `tests/g7-13-project-store.test.ts` | 630 | 35 | ~18 |
| `tests/gateway/g7-13-project-routes.test.ts` | 804 | 26 | ~31 |

The gateway tests have a higher avg because several tests (PR-11 + PR-13) simulate full restart cycles with multi-step scenarios. This is appropriate — these tests are the actual evidence for the acceptance scenarios per spec.

### 4.4 Assessment

- **No duplicate abstractions**: each `sendJson`/`sendError`/`readJsonBody` is private within its route file (mirrors the existing G7-12 conversation-routes.ts pattern). Pulling these out would require touching frozen contract areas.
- **No oversized tests**: the longest single test (PR-11 restart recovery) is ~80 lines and exercises a real end-to-end scenario with simulated restart. Acceptable.
- **No accidental files**: only `data/projects/` (runtime data, gitignored) and `evidence/g7-13e/` (new evidence) are untracked. No `.next/` build artifacts committed (the auto-regenerated `web/next-env.d.ts` was reverted before commit).
- **No unnecessary generated code**: the ProjectsSection at 939 lines includes 5 distinct UI sections (list view, detail view, Brief editor, relationships grid, project metadata editor) — each is user-facing functionality required by spec.
- **No refactor of functioning code solely to reduce line count** (per spec).

### 4.5 Healthy ratio

| Bucket | % |
|---|---|
| Source | 54% |
| Tests | 23% |
| Documentation | 21% |
| Other | 2% |

Source:test ratio is ~2.3:1 — appropriate for a mission with 18 mandatory acceptance scenarios. Documentation is comprehensive but proportional to the 5 required deliverables.

---

## 5. Full Regression Results

| Check | Result |
|---|---|
| Engine tests | 756 passed, 9 skipped, 0 failed (80 files) |
| Engine typecheck | PASS |
| Engine lint | PASS (0 errors) |
| Web typecheck | PASS |
| Web lint | PASS (0 errors, 4 pre-existing warnings in MissionBreadcrumb.tsx — unchanged by G7-13) |
| Frozen contracts | UNCHANGED (0 diff lines vs `86de847`) |
| Rendered-browser PR-19 | PASS |
| Rendered-browser PR-20 | PASS |
| BR-12 (console errors) | PARTIAL (1 expected 401 on /health before login — same as G7-12D) |
| API-level coverage AP-01..AP-06 | 6/6 PASS (kept separate from rendered-browser) |
| Secrets in source control | NONE |
| Production deployment | NONE |
| New dependencies | NONE |

---

## 6. Files Added/Modified in G7-13E

| File | Change |
|---|---|
| `scripts/g7-13e-browser-final.cjs` | New — corrected browser test script (uses production build + matches the "Authenticate" button by text, not by `type="submit"`). |
| `eslint.config.js` | Added `scripts/g7-13e-browser-final.cjs` to the test-tooling exclusion (same CommonJS pattern as the G7-13D script). |
| `evidence/g7-13e/` | New — 11 screenshots (50-114 KB each, full rendered content) + pr-results.json + network-log.json + console-messages.json + page-errors.json. |
| `G7-13E_Final_Browser_Recovery_And_Quality_Closure.md` | New — this report. |

No source code changes (the bug was in the test script, not in the implementation).

---

## 7. Stop-Condition Check

Per spec: "Stop conditions: security regression, data corruption, frozen-contract modification, or unresolved critical test failure."

| Stop condition | Status |
|---|---|
| Security regression | NONE — no security boundary modified |
| Data corruption | NONE — atomic writes verified; corrupt files preserved, never silently replaced |
| Frozen-contract modification | NONE — 0 diff lines vs `86de847` |
| Unresolved critical test failure | NONE — all 756 engine tests + 11 rendered-browser tests PASS |

**No stop conditions triggered.**

---

## 8. Final Status

```text
G7_13E_STATUS = PASS
PR_19 = PASS
PR_20 = PASS
BROWSER_ROOT_CAUSE = Test script bug, NOT environment limitation. The G7-13D script searched for `button[type="submit"]`, but AuthGate's submit button uses `type="button"` with `onClick={() => void login()}`. The PIN was filled into the input but the "Authenticate" button was never clicked, so POST /api/auth/login was never called, so the genesis_bff cookie was never issued, so the AuthGate's session check returned 401 forever. The "HMR WebSocket environment limitation" hypothesis was wrong. Correction: (1) match the button by accessible name (`/Authenticate/i`), (2) fall back to pressing Enter on the input (the form has an onKeyDown handler), (3) use production build (`next build` + `npm run start`) to eliminate HMR WebSocket noise, (4) align BFF + Gateway API keys, (5) set GENESIS_BFF_SECRET + GENESIS_OPERATOR_PIN + GENESIS_COOKIE_SECURE=false for local HTTP.
CODE_SIZE_REVIEW = Healthy ratio (54% source / 23% tests / 21% docs / 2% other). No duplicate abstractions, no oversized tests, no accidental files. Largest file is src/project/project-store.ts at 1049 lines — necessary for atomic writes + revision-controlled Brief + idempotency + ownership verification + corrupt-file preservation + 3 relationship link types. No refactor of functioning code solely to reduce line count.
FULL_REGRESSION = 756 passed, 9 skipped, 0 failed (80 files); engine typecheck PASS; web typecheck PASS; engine lint PASS (0 errors); web lint PASS (0 errors, 4 pre-existing warnings in MissionBreadcrumb.tsx unchanged by G7-13); frozen contracts UNCHANGED (0 diff lines vs 86de847); secrets NONE; new dependencies NONE.
FINAL_LOCAL_HEAD = (set after this commit)
READY_FOR_REMOTE_REVIEW = YES
```

---

**End of Final Browser Recovery & Quality Closure.**
