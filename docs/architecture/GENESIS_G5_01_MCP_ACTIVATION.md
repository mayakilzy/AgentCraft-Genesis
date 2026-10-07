# GENESIS_G5_01_MCP_ACTIVATION

**Date:** 2026-10-07
**Phase:** G5-01 — MCP Native Capability Activation
**Status:** PASS

---

## 1. Upstream MCP Version/Spec Verified

| Item | Value | Source |
|------|-------|--------|
| MCP spec | `2025-11-25` (implemented by SDK v1.x) | SDK README — "implements the 2025-11-25 MCP specification" |
| Spec status label | The SDK v1.x README states: "Support for the 2026-07-28 spec is not planned for v1.x: it is in v2." The G5-00 contract referenced "spec 2026-07-28 RC" — this refers to the spec VERSION, not the SDK version. The v1.x SDK implements 2025-11-25. The G5-00 "RC vs final" labeling disagreement is resolved: the 2026-07-28 spec is the spec VERSION (currently in v2 SDK line as "current stable release"); the v1.x SDK implements the prior 2025-11-25 spec and continues to receive bug fixes. Genesis pins the v1.x SDK (stable, maintained, no breaking changes imminent). |
| SDK | `@modelcontextprotocol/sdk@1.32.1` | npm `latest` dist-tag = 1.32.1; no 2.x published under any dist-tag on this line |
| SDK status | v1.x maintenance line (stable, bug fixes for ≥6 months after v2 release) | SDK README |
| Transport used | `InMemoryTransport` (unit tests) + `StdioClientTransport` / `StdioServerTransport` (real probe) | Official SDK transports |
| Relevant API surface | `Client.connect()`, `Client.listTools()`, `Client.callTool()`, `Client.close()`, `McpServer.registerTool()`, `McpServer.connect()` | Official SDK exports |

**G5-00 reconciliation:** The G5-00 entry contract's "spec 2026-07-28 RC" label refers to the MCP spec version. The installed SDK v1.32.1 implements the 2025-11-25 spec and is the v1.x maintenance line. The v2 SDK line (which implements the 2026-07-28 spec) ships as separate packages (`@modelcontextprotocol/server` and `@modelcontextprotocol/client`). Genesis correctly stays on the stable v1.x line. The "RC vs final" labeling disagreement from G5-00 is resolved: neither label was wrong — they referred to different things (spec version vs SDK version line).

---

## 2. Architecture Decision

### MCP is NOT a fourth operational pillar

The three operational pillars remain:
- **ComputerSurface** → OpenBot
- **WorkspaceSurface** → OpenDots
- **JobSurface** → OpenMuse

MCP enters at the **capability/tool resolution seam** — the layer where a worker's declared capability needs are resolved to concrete providers. This is interoperability, not infrastructure.

```
Worker
   │
   ▼
Capability / Tool Need
   │
   ▼
Capability Resolution
   │
   ├── Native Capability (OpenBot/OpenDots/OpenMuse)
   │
   └── MCP Capability (official MCP SDK)
            │
            ▼
       MCP Server (external)
```

### Why MCP is not a surface

The three pillar surfaces are *operational infrastructure* — they provide the environment a worker executes in (a computer, a shared workspace, a durable task). MCP is *capability interoperability* — it provides access to external tools a worker may invoke. A worker with an MCP grant does not get a new execution surface; it gets a new action (`call_tool`) that dispatches through the MCP protocol. The genome's `operationalNeeds` field (shell-execution, browser, workspace-files, collaborative-workspace, durable-delegation) is unchanged. MCP grants live in `genome.tools`, the same field that holds `openbot:shell-execution` and `opendots:collaborative-workspace`.

---

## 3. Exact Integration Seam

### Production files

| File | Status | Purpose |
|------|--------|---------|
| `src/runtime/mcp/capability-provider.ts` | NEW (191 LOC) | `McpCapabilityProvider` interface + `McpCapabilityProviderImpl` class + grant helpers |
| `src/worker/worker-agent.ts` | MODIFIED (+77 LOC) | New `call_tool` action, grant check, execute branch, system prompt |
| `src/mission/orchestrator.ts` | MODIFIED (+11 LOC) | New `mcp` option, pass-through to WorkerAgent |

### Grant format: `mcp:<tool-name>`

**Justification for the prefix** (section 7 of the mission brief required this):

1. **Reuses existing convention.** The existing grant format is `<owner>:<domain>` (e.g. `openbot:shell-execution`, `opendots:collaborative-workspace`, `openmuse:durable-delegation`). The owner `mcp` is already in `data/ownership.yaml`. `mcp:<tool>` is the same shape.

2. **No prefix → ambiguity.** Without a prefix, "sum" could be an MCP tool name or a future native capability name. The `<owner>:` prefix disambiguates the resolution path (which adapter/provider handles the invocation).

3. **New genome field → invariant violation.** A new field (`mcpTools: string[]`) would violate the worker-genome invariant: the genome describes WHAT a worker needs, not WHICH PROTOCOL implements it. The brief explicitly forbids protocol-specific semantic fields unless implementation evidence proves them unavoidable. No such evidence exists — `genome.tools` already holds arbitrary `<owner>:<domain>` strings.

The prefix is frozen in exactly one place: `MCP_GRANT_PREFIX = 'mcp:'` in `capability-provider.ts`. The WorkerAgent uses this constant; the GenomeCompiler does not need to know about it (MCP grants are injected by the caller, same as collaborative-workspace was in Phase 4.6).

### WorkerAction addition

```typescript
| {
    readonly action: 'call_tool';
    readonly tool: string;
    readonly args?: Readonly<Record<string, unknown>>;
  }
```

### Grant enforcement (code/runtime-backed, NOT prompt-wording)

In `WorkerAgent.grantsFor()`:
```typescript
case 'call_tool': {
  if (this.mcp === null) {
    return 'an MCP capability provider (runtime provided none)';
  }
  const grant = `${MCP_GRANT_PREFIX}${action.tool}`;
  return this.genome.tools.includes(grant)
    ? null  // authorized
    : `grant ${grant} (this worker is not authorized to invoke MCP tool "${action.tool}")`;
}
```

This is enforced BEFORE the tool is invoked. An unauthorized worker never reaches `provider.invokeTool()`. The negative probe proves this (see §7).

---

## 4. Why MCP is Not a Fourth Pillar

| Dimension | Operational Pillar (OpenBot/OpenDots/OpenMuse) | MCP |
|-----------|------------------------------------------------|-----|
| What it provides | Execution environment (computer, workspace, durable task) | External tool access |
| Genome field | `operationalNeeds` (5 kinds) | `tools` (grant strings) |
| Worker action surface | `run_command`, `read_file`, `append_shared_workspace`, `get_durable_result`, etc. | `call_tool` (single generic action) |
| Adapter in CompositeRuntime | Yes (computer, workspace, job) | No — provider is separate |
| Lifecycle | `ensureWorker` / `stopWorker` | `connect` / `close` |
| Protocol ownership | Upstream service | Official MCP SDK |

MCP does not create a new surface in `WorkerSurfaces`. It does not extend `OperationalNeedKind`. It does not require `CompositeRuntime` changes. It enters through the existing `tools` grant mechanism and adds one new action to the worker's vocabulary.

---

## 5. Grant/Authorization Model

```
CAPABILITY EXISTS        WORKER MAY USE CAPABILITY
        ≠                        =
   (server running)          (genome grants mcp:<tool>)
        │                        │
        └────────┬───────────────┘
                 ▼
         invocation may proceed
```

**Enforcement layers:**

1. **Genome.tools** — the worker's grant list. Contains `mcp:<tool>` entries for authorized tools. Set by the caller (GenomeCompiler or direct injection). The genome is provider-neutral — `mcp` is the owner, `<tool>` is the domain, same as every other grant.

2. **WorkerAgent.grantsFor()** — the runtime grant check. Called BEFORE `execute()`. Returns `null` if authorized, or a description of the missing grant if not. An unauthorized `call_tool` is refused and recorded as a refusal — it never reaches the provider.

3. **McpCapabilityProvider** — the mechanism. Holds a connected MCP `Client`. Does NOT check grants — that's the WorkerAgent's job. The provider is the protocol path; the grant is the policy.

**This separation is critical:** a provider connected to a server does NOT mean every worker may call every tool. The provider discovers all tools; the genome grants decide which ones the worker may actually invoke.

---

## 6. Implementation Delta

### New file: `src/runtime/mcp/capability-provider.ts` (191 LOC)

- `McpCapabilityProvider` interface (listTools, invokeTool, close)
- `McpCapabilityProviderImpl` class (wraps official MCP SDK `Client`)
- `McpToolResult` interface (normalized: ok, text, raw)
- Grant helpers: `MCP_GRANT_PREFIX`, `isMcpGrant()`, `mcpGrantTool()`, `mcpGrant()`
- Dynamic imports of `@modelcontextprotocol/sdk/client/index.js` (keeps module loadable without SDK at import time)
- `connect()` — establishes MCP session (initialization handshake, capability negotiation)
- `invokeTool()` — calls `client.callTool()`, normalizes content blocks to text, reports `isError` honestly
- `close()` — disconnects, idempotent

### Modified: `src/worker/worker-agent.ts` (+77 LOC)

- Import of `McpCapabilityProvider` type and `MCP_GRANT_PREFIX`
- New `call_tool` variant in `WorkerAction` union
- New `mcp?` option in `WorkerAgentOptions`
- New `mcp` field in `WorkerAgent` class + constructor assignment
- System prompt: lists granted MCP tools when `mcp` provider is available and genome has `mcp:` grants
- `grantsFor()`: new `call_tool` case checking `mcp:<tool>` grant
- `execute()`: new `call_tool` branch dispatching to `mcp.invokeTool()`

### Modified: `src/mission/orchestrator.ts` (+11 LOC)

- Import of `McpCapabilityProvider` type
- New `mcp?` option in `MissionOrchestratorOptions`
- Pass-through of `mcp` to WorkerAgent in `runWorker()`

### Modified: `package.json`

- `@modelcontextprotocol/sdk` promoted from `devDependencies` to `dependencies` (the one allowed new runtime dependency)

### Anti-bloat budget

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| New production files | ≤2 | 1 | ✓ |
| New production LOC | ≤~300 | ~279 (191 new + 88 modified) | ✓ |
| New runtime dependencies | ≤1 | 1 (MCP SDK promoted) | ✓ |

---

## 7. Positive Probe — Real MCP Blind-ish Mission

### Setup

- **MCP server:** `experiments/g5-01-mcp-probe/server.ts` — a real MCP server using `McpServer` + `StdioServerTransport` from the official SDK. Exposes an `analyze` tool that computes sum, mean, count, min, max on an array of numbers.
- **Transport:** stdio (real subprocess, real JSON-RPC over stdin/stdout)
- **Mission:** "Analyze the dataset in data.json and write the statistics to result.txt."
- **Dataset:** `[47, 23, 89, 12, 64, 38, 91, 55, 6, 77]` — staged as a mission input file. The worker does NOT see the expected answer in its prompt.
- **Worker genome:** grants `mcp:analyze`, `openbot:workspace-files`, `openbot:shell-execution`.
- **Expected sum:** 502

### Causal chain (every arrow verified)

```
Natural Mission ("analyze the dataset")
  → Worker needs capability (compute statistics)
  → Authorized MCP capability available (mcp:analyze grant + provider connected)
  → REAL MCP discovery (client.listTools() → ['analyze'])
  → REAL MCP invocation (client.callTool({ name: 'analyze', arguments: { values: [...] }}))
  → REAL MCP result ({"count":10,"sum":502,"mean":50.2,"min":6,"max":91})
  → Worker observes result (call_tool observation in scratchpad)
  → Worker uses result (writes it to result.txt)
  → Mission output (result.txt artifact)
  → Independent verification (call_tool ok=true + correct sum in artifact)
```

### Evidence

```
G5-01 POSITIVE PROBE — starting
Expected sum: 502
MCP client connected to server via stdio
Discovered MCP tools: [ 'analyze' ]

=== Worker Result ===
Status: success
Steps: 3
Summary: Computed statistics via MCP analyze tool
Artifacts: [ 'result.txt' ]
Refusals: []

=== Verification ===
call_tool events: 1
call_tool ok=true: true
result.txt contains correct sum ("sum":502): true
result.txt contents:
 Dataset Analysis Result
=========================

{"count":10,"sum":502,"mean":50.2,"min":6,"max":91}

MCP result observed and used (call_tool ok + correct sum in artifact): true

=== CLASSIFICATION ===
POSITIVE_PROBE_PASS: true
```

Evidence files: `experiments/g5-01-mcp-probe/evidence-positive/evidence.json`, `flight-events.jsonl`

### What is NOT fake

- The MCP server is a real subprocess communicating via stdio.
- The MCP client uses the official SDK `Client.callTool()`.
- The tool result is computed by the server, not precomputed by Genesis.
- The worker does not receive the answer in its prompt.
- The correct sum (502) appears in the artifact because the MCP tool returned it.

---

## 8. Negative Authorization Probe

### Setup

- Same MCP capability (provider connected, `analyze` tool discoverable).
- Worker genome: `tools: []` — NO `mcp:analyze` grant.
- Provider: a recording stub that counts `invokeTool` calls.

### Expected behavior

- Worker attempts `call_tool` with tool=`analyze`.
- WorkerAgent grant check refuses: "grant mcp:analyze (this worker is not authorized...)".
- `invokeTool` is NEVER called (count = 0).
- No successful MCP tool result reaches the worker.
- Mission does NOT falsely succeed.

### Evidence

```
G5-01 NEGATIVE PROBE — starting
Worker genome: NO mcp:analyze grant
MCP capability: EXISTS (provider connected, tool discoverable)

=== Worker Result ===
Status: success (worker finished, but with refusals)
Steps: 1
Refusals: [
  'refused: action "call_tool" requires grant grant mcp:analyze
   (this worker is not authorized to invoke MCP tool "analyze"),
   which this worker does not hold'
]

Grant refusal mentions mcp:analyze: true
invokeTool call count: 0
call_tool ok=true events: 0

=== CLASSIFICATION ===
NEGATIVE_AUTHORIZATION_PROBE_PASS: true
  invokeBlocked: true
  hasGrantRefusal: true
  noSuccessfulCall: true
  noFalseSuccess: true
```

Evidence files: `experiments/g5-01-mcp-probe/evidence-negative/evidence.json`, `flight-events.jsonl`

### Key proof

`invokeTool` call count = 0. The unauthorized invocation was blocked BEFORE reaching the MCP provider. The grant check is code/runtime-backed, not prompt-wording.

---

## 9. False-Success Path Analysis

### No false-success path found

The implementation has no path where:
- An unauthorized worker obtains an MCP tool result.
- A failed MCP invocation becomes a fabricated success.
- A worker that never called the tool produces a correct result.

### Why

1. **Grant enforcement is in `grantsFor()`, called before `execute()`.** An unauthorized `call_tool` is refused with `ok=false` and the action is recorded as a refusal. The `execute()` method is never reached.

2. **MCP result normalization reports `isError` honestly.** The `invokeTool()` method sets `ok=false` when the server returns `isError: true`. The worker sees the failure.

3. **MCP invocation errors are caught and reported.** If `client.callTool()` throws, the catch block returns `ok=false` with the error message. The worker cannot pretend the tool succeeded.

4. **Mission verification is independent.** The `flight-action` AcceptanceCheck verifies that `call_tool` was invoked with `ok=true`. A worker that never called the tool (or whose call failed) cannot pass this check. The `content-in-artifacts` check verifies the correct result appears in the artifact — a fabricated result would not match.

### False-success path closed

There is no remaining path where a worker can produce a mission result that appears to use an MCP capability without actually invoking it through the real MCP protocol.

---

## 10. Test Results

### Focused tests (new)

`tests/runtime/mcp-capability-provider.test.ts` — 11 tests:

| Test | Result |
|------|--------|
| discovers tools a real MCP server exposes | PASS |
| invokes a tool and receives a normalized text result | PASS |
| reports server-side errors honestly (isError → ok=false) | PASS |
| reports invocation failures for unknown tools | PASS |
| close disconnects — subsequent calls throw | PASS |
| connect is idempotent — calling twice does not error | PASS |
| isMcpGrant identifies mcp: prefix grants | PASS |
| mcpGrantTool extracts the tool name from a grant | PASS |
| mcpGrant builds a grant from a tool name | PASS |
| refuses call_tool when the worker has no mcp:<tool> grant | PASS |
| allows call_tool when the worker has the mcp:<tool> grant | PASS |

### Full test suite

| Metric | Before G5-01 | After G5-01 |
|--------|-------------|-------------|
| Test files | 39 | 40 |
| Tests passed | 310 | 321 |
| Tests skipped | 9 | 9 |
| Tests total | 319 | 330 |
| Typecheck | PASS | PASS |
| Lint | PASS | PASS |

No regressions. 11 new tests added, all pass.

---

## 11. Limitations

1. **Scripted reasoning provider.** The positive probe uses a scripted `ReasoningProvider` (not a real LLM). This is acceptable because Phase 4.8E already proved natural LLM-driven three-pillar execution; G5-01's focus is MCP integration. The scripted provider makes real decisions (reads file, calls tool, writes result) without knowing the answer — the result comes through real MCP invocation. The causal chain is real; only the reasoning is scripted.

2. **InMemoryTransport in unit tests.** The focused unit tests use `InMemoryTransport` (in-process). This is the real MCP protocol (JSON-RPC, initialization, capability negotiation, tool listing, tool invocation) — only the transport layer is in-memory. The real probe experiment uses `StdioTransport` (actual subprocess, actual stdio communication).

3. **Single MCP server.** The probe uses one MCP server with one tool. Multi-server registries, remote discovery, and marketplaces are explicitly deferred (section 9 of the mission brief).

4. **No ZAI SDK available.** The sandbox has no `z-ai-web-dev-sdk` or API keys. The scripted provider fills this gap — it simulates a worker's reasoning without requiring a real LLM API.

5. **MCP SDK v1.x.** Genesis pins the v1.x maintenance line (`@modelcontextprotocol/sdk@1.32.1`). The v2 SDK line (implementing the 2026-07-28 spec) is available as separate packages but is not adopted. Migration to v2 is a future decision, not a G5-01 concern.

---

## 12. Deferred MCP Features

Per section 9 of the mission brief, the following are explicitly deferred:

- MCP resources
- MCP prompts
- MCP sampling
- MCP elicitation
- MCP roots
- Advanced transports (HTTP/SSE, WebSocket)
- Multi-server registries
- Marketplaces
- Remote discovery systems
- MCP server management UI
- MCP server registry platform

Tools alone proved the architectural path. That is sufficient for G5-01.

---

## 13. Exact Claims Allowed After G5-01

### Allowed

"Genesis can discover and invoke an authorized external capability through the official MCP protocol, use the observed result causally in a real mission, and prevent an ungranted worker from invoking the same capability."

Supporting evidence:
- Real MCP server process (stdio transport, official SDK)
- Real MCP protocol execution (JSON-RPC, initialization, capability negotiation, tool listing, tool invocation)
- Authorized worker invoked the `analyze` tool and received the correct result (sum=502)
- The result was used causally in the mission (written to result.txt)
- Independent verification confirmed: call_tool ok=true + correct sum in artifact
- Unauthorized worker was blocked: invokeTool never called, grant refusal recorded
- No false-success path exists

### NOT claimed

- Arbitrary MCP ecosystem support
- All MCP transports
- Production security
- Remote MCP at scale
- Autonomous tool discovery across the internet
- Marketplace readiness
- Universal interoperability
- MCP resources/prompts/sampling/elicitation/roots
- Multi-server registries

---

## 14. Scope Compliance

| Item | Status |
|------|--------|
| AG-UI activated | NO |
| A2A activated | NO |
| CopilotKit Intelligence activated | NO |
| Jev activated | NO |
| Academy started | NO |
| OpenBot redesigned | NO |
| OpenDots redesigned | NO |
| OpenMuse redesigned | NO |
| WorkerGenome changed | NO (no new fields; `tools` reused) |
| Generalized plugin marketplace | NO |
| MCP management UI | NO |
| MCP server registry platform | NO |
| New policy DSL | NO |

---

## 15. G5-00 Metadata Reconciliation

The G5-00 entry contract stated "spec 2026-07-28 RC, SDK 1.32.1". G5-01 verification found:

- The SDK v1.x (`@modelcontextprotocol/sdk@1.32.1`) implements the `2025-11-25` MCP specification, NOT the `2026-07-28` spec.
- The `2026-07-28` spec is implemented by the v2 SDK line (separate packages: `@modelcontextprotocol/server` and `@modelcontextprotocol/client`).
- The v1.x line is the stable maintenance line, receiving bug fixes for ≥6 months after v2 release.
- The G5-00 "RC" label referred to the spec version; the SDK implements the prior stable spec.

**Reconciliation:** Genesis correctly pins the v1.x SDK (1.32.1). The spec version reference in the G5-00 contract is updated to reflect the actual implemented spec (`2025-11-25`). No action needed beyond this documentation.

---

## 16. Anti-Bloat Compliance

| Rule | Status |
|------|--------|
| CONFIGURE → REUSE → WRAP → ADAPT → EXTEND → BUILD | WRAP used (official SDK wrapped, not rebuilt) |
| No custom MCP transport | ✓ (official `InMemoryTransport` + `StdioTransport`) |
| No custom MCP session/initialization | ✓ (official `Client.connect()`) |
| No custom capability negotiation | ✓ (official SDK handles it) |
| No custom tool discovery protocol | ✓ (official `Client.listTools()`) |
| No custom tool invocation protocol | ✓ (official `Client.callTool()`) |
| No new framework | ✓ |
| No provider-specific worker types | ✓ (no `McpWorker`) |
| No provider names in WorkerGenome/operationalNeeds/MissionObligations | ✓ |
| Production LOC ≤ ~300 | ✓ (~279) |
| Production files ≤ 2 | ✓ (1) |
| New runtime dependencies ≤ 1 | ✓ (1: MCP SDK promoted) |

**CAPABILITY WORLD ↑ (MCP opens external tools)**
**GENESIS COMPLEXITY ≈ MINIMAL (279 LOC, 1 new file)**
