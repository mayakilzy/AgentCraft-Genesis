# G7-14R — Final Implementation Report

**Mission:** G7-14R Recovery & Safe Rebuild — Constrained Plugins / MCP Integration
**Branch:** `build/g7-14-constrained-mcp`
**Baseline:** `2b105e5c760e7e8482bffe80e7f1271998aa56fc` (G7-13F Recovery)
**Date:** 2026-10-09

---

## 1. Recovery Summary

**LOST_COMMITS_RECOVERED = NO.** The previously local G7-14 commits (`df4b039` through `0c8b738`) were never pushed to GitHub. When the environment was reset, they were lost. A bounded recovery search (reflog, dangling objects, backups) found no artifacts. The implementation was rebuilt from the verified G7-13F checkpoint with durable remote checkpoints after every slice.

---

## 2. Slice Reports (all remote-verified)

| Slice | Commit SHA | Remote-verified | Tests |
|---|---|---|---|
| G7-14A: Config schema + loader | `c191b62` | ✓ | 17 PASS |
| G7-14B: Gateway routes (read-only) | `9b68b57` | ✓ | 6 PASS |
| G7-14C: BFF + Studio integration | `0373620` | ✓ | typecheck + lint |
| G7-14D: Composite provider + per-mission wiring | `61bad6e` | ✓ | 10 PASS |
| G7-14E: Regression + report | (this commit) | pending | 815 total |

---

## 3. F1-F4 Correction Results

### F1 — Real Mission Integration: PASS

`buildMcpProvidersForMission()` + `LazyCompositeMcpProvider` are wired into the actual mission creation path in `src/gateway/mission-service.ts`:
- `MissionServiceOptions.mcpServers` added.
- At mission start, a `LazyCompositeMcpProvider` is created from the MCP config and passed to the orchestrator via the existing `mcp?` option.
- The lazy provider connects servers on demand (only when a worker whose genome grants `mcp:<tool>` actually calls `invokeTool`).
- After mission success/failure/cancellation, `close()` is called on the provider (best-effort in both `.then()` and `.catch()` handlers).
- **Frozen orchestrator interface preserved** — the `mcp?` option is unchanged.
- **Grants derive from the genome** (set by the GenomeCompiler), not from untrusted user-supplied tool names.
- **Honest failure**: unavailable servers return `{ ok: false, text: 'tool "X" unavailable: <reason>' }` — the worker cannot silently produce successful tool-dependent outcomes.

### F2 — Studio Integration: PASS

`web/src/components/genesis/StudioCatalog.tsx` extended to fetch configured MCP servers from the BFF (`/api/genesis/v1/plugins`) in parallel with the catalog. Displays them in a "Configured MCP Servers" section with honest statuses:
- **CONFIGURED**: configuration was validated at gateway startup.
- **AVAILABLE**: a recent reachability check succeeded (not yet implemented — requires preflight probe from Studio).
- **RUNTIME_VERIFIED**: actual tool invocation evidence (not yet implemented — requires mission execution with MCP tools).
- **UNAVAILABLE**: a recent reachability check failed (not yet implemented).
- Per the architect: "Do not present a configured server as runtime-verified." The API returns `status: 'CONFIGURED'` only — no status is upgraded without evidence.
- No sensitive fields (command, args, env, url) are displayed — the Gateway API strips them before returning.

### F3 — Browser Acceptance: NOT_EXECUTED

The browser evidence script was not written/run in this recovery. The web types, BFF proxy, API client, and Studio component are all in place, but actual rendered-browser evidence was not captured. Per spec: "Do not claim browser or end-to-end tests passed unless they actually ran."

### F4 — Regression and Closure Evidence: PASS

- Full regression: 815 passed, 9 skipped, 0 failed (83 files).
- Engine typecheck: PASS.
- Web typecheck: PASS.
- Engine lint: PASS (0 errors).
- Web lint: PASS (0 errors, 4 pre-existing warnings).
- Frozen contracts: UNCHANGED (0 diff lines vs `2b105e5`).
- No runtime data committed (`.gitignore` includes `data/projects/`).
- No credentials leaked (Gateway API strips all sensitive fields).

---

## 4. Verification Matrix

| Verification | Result | Evidence |
|---|---|---|
| Positive real MCP tool invocation | PASS | `tests/runtime/g7-14-mcp-activation.test.ts` — "positive: real MCP tool invocation" (analyze, sum=15) |
| Negative unauthorized invocation | PASS | Same test file — "negative: tool not in genome grants" (ok: false, "not found") |
| Duplicate tool-name rejection | PASS | `tests/g7-14-mcp-config.test.ts` — "throws on duplicate tool names" |
| Malformed config rejection | PASS | `tests/g7-14-mcp-config.test.ts` — 8 error cases (missing file, malformed YAML, missing name, unknown transport, bad grant prefix, empty grants, duplicate names, duplicate tools) |
| Unreachable server with honest failure | PASS | `tests/runtime/g7-14-mcp-activation.test.ts` — "returns honest failure for tools from unreachable servers" |
| Provider crash (isError) | PASS | `tests/g7-14-mcp-activation.test.ts` — provider returns ok: false honestly |
| Provider cleanup after completion | PASS | `tests/runtime/g7-14-mcp-activation.test.ts` — "close() calls close() on all child providers" |
| No credentials leaked | PASS | `tests/gateway/g7-14-plugin-routes.test.ts` — "response does NOT contain sensitive fields" |
| Full regression | PASS | 815 passed, 9 skipped, 0 failed |
| Typecheck + lint | PASS | Engine + web typecheck PASS; engine + web lint PASS (0 errors) |
| Frozen contracts unchanged | PASS | 0 diff lines vs `2b105e5` |
| No runtime data committed | PASS | `.gitignore` includes `data/projects/` |
| Browser evidence (F3) | NOT_EXECUTED | Not written/run |

---

## 5. Files Changed (G7-14R)

| File | Status |
|---|---|
| `src/plugins/mcp-config.ts` | NEW |
| `src/plugins/mcp-activation.ts` | NEW |
| `src/gateway/plugin-routes.ts` | NEW |
| `tests/g7-14-mcp-config.test.ts` | NEW |
| `tests/gateway/g7-14-plugin-routes.test.ts` | NEW |
| `tests/runtime/g7-14-mcp-activation.test.ts` | NEW |
| `src/gateway/http-server.ts` | MODIFIED |
| `src/gateway/main.ts` | MODIFIED |
| `src/gateway/mission-service.ts` | MODIFIED |
| `package.json` | MODIFIED (zod devDeps → deps) |
| `web/src/app/api/genesis/[...path]/route.ts` | MODIFIED |
| `web/src/lib/genesis/types.ts` | MODIFIED |
| `web/src/lib/genesis/client.ts` | MODIFIED |
| `web/src/components/genesis/StudioCatalog.tsx` | MODIFIED |
| `.gitignore` | MODIFIED (data/projects/) |

**No frozen-contract modifications.** zod moved from devDependencies to dependencies (was already installed; 0 new packages).

---

## 6. Known Gaps

1. **Browser evidence NOT_EXECUTED (F3).** The web types + BFF proxy + API client + Studio component are all in place, but no rendered-browser evidence was captured.
2. **Studio AVAILABLE/RUNTIME_VERIFIED/UNAVAILABLE statuses not yet wired.** The Gateway API returns `status: 'CONFIGURED'` only. AVAILABLE would require a preflight probe from Studio; RUNTIME_VERIFIED would require mission execution evidence; UNAVAILABLE would require a failed preflight. These are future enhancements.
3. **Real end-to-end mission with MCP tools not yet proven.** The lazy provider is wired into the mission service, but the dev-mode reasoning fallback doesn't emit `call_tool` actions (it emits `write_file` + `finish`). Proving a real mission that invokes an MCP tool would require either production mode (real LLM) or a custom reasoning provider that emits `call_tool`.

---

## 7. Final Status

```text
G7_14R_STATUS = PARTIAL

F1_REAL_MISSION_INTEGRATION = PASS
F2_STUDIO_INTEGRATION = PASS
F3_BROWSER_ACCEPTANCE = NOT_EXECUTED
F4_REGRESSION_CLOSURE = PASS

FULL_REGRESSION = 815 passed, 9 skipped, 0 failed (83 files)
TYPECHECK = PASS (engine + web)
LINT = PASS (0 errors engine + 0 errors web; 4 pre-existing web warnings)
FROZEN_CONTRACTS = UNCHANGED (0 diff lines vs 2b105e5)
NEW_DEPENDENCIES = zod moved devDeps → deps (0 new packages)

FINAL_LOCAL_HEAD = (set after commit)
FINAL_REMOTE_HEAD = (set after push)
HEAD_MATCH = (verified after push)

NOT_DECLARED_CLOSED = YES (per spec: 'Do not declare G7-14 closed. Await independent review.')
```

---

**End of G7-14R Final Implementation Report. Awaiting independent architectural review.**
