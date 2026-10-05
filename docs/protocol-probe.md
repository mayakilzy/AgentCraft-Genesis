# Protocol & Compatibility Probe — Results (TASK-004)

Probe date: **2026-10-05** · Executed by: `tests/protocol-probe.test.ts` (vitest)
Purpose: prove the AG-UI / MCP / A2A baselines are actually usable **before** Genesis
designs anything on top of them. All probes use the official SDKs exactly as shipped —
no custom protocol code, no custom transports.

## Summary

| Protocol | SDK (pinned) | Verdict | Notes |
| --- | --- | --- | --- |
| **MCP** | `@modelcontextprotocol/sdk@1.32.1` | **PASS** | In-process client ↔ server over `InMemoryTransport`; tool registration, listing and invocation verified end-to-end |
| **AG-UI** | `@ag-ui/core@1.0.1` | **PASS** | `PROTOCOL_VERSION === "1.0"`; 31 event types incl. subagent + reasoning events |
| **A2A** | `@a2a-js/sdk@1.3.0` | **PASS** | Agent Card construction + canonical JSON + task-state enum verified. **Integration into Genesis: DEFER** (internal Bot-to-Bot first) |
| Node/TS | Node 24 · TS 5.9.3 strict · ESM/NodeNext | **PASS** | Toolchain round-trips inside the test runtime |

## MCP — detail

- `McpServer` + `Client` connected via `InMemoryTransport.createLinkedPair()`.
- Tool registered with a zod input schema, discovered via `listTools()`, and invoked
  via `callTool()` with a verified text result.
- **WATCH**: the architecture references a "TS SDK v2" line — the v2 docs site is live
  (HTTP 200), but the npm `latest` dist-tag is **1.32.1**; no 2.x is published under any
  dist-tag. Stay on 1.32.1 and re-verify before any deep integration.

## AG-UI — detail

- `PROTOCOL_VERSION` is exactly `"1.0"`.
- Event vocabulary observed (31 types) covers: message lifecycle
  (`TEXT_MESSAGE_*`), tool calls (`TOOL_CALL_*`), state sync (`STATE_SNAPSHOT`,
  `STATE_DELTA`, `MESSAGES_SNAPSHOT`), run/step lifecycle (`RUN_*`, `STEP_*`),
  reasoning (`REASONING_*`), **subagents** (`SUBAGENT_STARTED/FINISHED/ERROR`) and
  activities (`ACTIVITY_*`).
- Conclusion: lifecycle, tool, state and subagent semantics all exist upstream —
  **Genesis must never invent parallel events for these meanings**.

## A2A — detail

- `AgentCard.fromJSON()` builds a typed card; `canonicalizeAgentCard()` produces the
  canonical JSON string; task-state enum round-trips (`TASK_STATE_SUBMITTED` ↔ `1`).
- `A2AClient` is **not** exported from the package root — it lives in a subpath; not
  probed because Genesis defers all A2A integration (internal Bot-to-Bot first).
- **WATCH**: AG-UI ↔ A2A bridge semantics remain unverified — check before any
  federation work (GROUP 6 concern, not GROUP 1).

## Toolchain coexistence

- Node 24 + TypeScript 5.9.3 (strict, `verbatimModuleSyntax`, NodeNext) coexist with
  all three SDKs without shims or patches.
- OpenBot (Bun-based upstream) is not imported at all in GROUP 1 — the adapter boundary
  remains clean for GROUP 2.

## Disposition

- PoC status: the probe **test file stays** as a living smoke gate (it is tiny and
  protects the baseline); all scaffolding around it was avoided. No protocol code
  entered `src/` — by design.
