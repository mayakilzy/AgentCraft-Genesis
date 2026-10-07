# GENESIS_G5_02_AG_UI_ACTIVATION

**Date:** 2026-10-07
**Phase:** G5-02 — AG-UI Native Event Activation
**Status:** PASS

---

## 1. Upstream AG-UI Version Verified

| Item | Value | Source |
|------|-------|--------|
| AG-UI protocol version | `1.0` (`PROTOCOL_VERSION === "1.0"`) | `@ag-ui/core` runtime export |
| Package (pinned + installed) | `@ag-ui/core@1.0.2` | npm `latest` dist-tag = 1.0.2; installed = 1.0.2 |
| Package status | Stable release on the 1.0.x line | npm dist-tags: `latest: 1.0.2`, `alpha: 0.0.50-alpha.0`, `canary: 1.0.0-canary.*` |
| Event type vocabulary | 31 types (RUN_STARTED/FINISHED/ERROR, STEP_STARTED/FINISHED, TOOL_CALL_START/ARGS/END/RESULT/CHUNK, TEXT_MESSAGE_START/CONTENT/END/CHUNK, STATE_SNAPSHOT/DELTA, SUBAGENT_STARTED/FINISHED/ERROR, REASONING_*, ACTIVITY_*, CUSTOM, RAW, MESSAGES_SNAPSHOT) | `EventType` enum |
| Patch bump applied | `1.0.1 → 1.0.2` (G5-00 identified this divergence; resolved here) | `package.json` |

**G5-00 reconciliation:** The G5-00 entry contract pinned `@ag-ui/core@1.0.2`, but `package.json` declared `1.0.1`. G5-02 applied the safe patch bump to `1.0.2` (same `PROTOCOL_VERSION "1.0"`, same 31 event types, no breaking changes).

---

## 2. Architectural Boundary

### AG-UI is NOT FlightRecorder

The G5-00 suggestion ("AgUiFlightRecorder implements FlightRecorder") was mechanically useful but conceptually misleading. G5-02 corrects this:

- **FlightRecorder** is an INTERNAL evidence/telemetry abstraction. It captures Genesis FlightEvents for mission reconstruction, verification, and experience capture. It is Genesis-owned.
- **AG-UI** is an EXTERNAL interoperability protocol. It defines the standard event vocabulary an external application/UI consumer expects. It is protocol-owned.

### Preferred architecture (implemented)

```
Genesis Internal Execution
      │
      ├── Mission lifecycle (mission-started/finished)
      ├── Worker lifecycle (worker-started/finished)
      ├── Actions / tools (worker-step)
      ├── FlightRecorder evidence
      ├── State (verification)
      └── Artifacts / messages (worker summary)
                │
                ▼ (Genesis FlightEvent vocabulary — protocol-neutral)
        FlightRecorder port
                │
                ├── (optional inner recorder: FileFlightRecorder, MemoryFlightRecorder)
                │
                ▼
        AgUiEventBridge (implements FlightRecorder)
                │
                ▼ (official AG-UI Event types — protocol-owned)
        AgUiEventSink (the stream boundary)
                │
                ▼ (serialized JSON — the wire format)
        External Consumer
```

FlightRecorder is ONE event source for the bridge. The bridge IS a FlightRecorder implementation (it satisfies the port), but conceptually it is an AG-UI adapter, not a flight recorder. The two abstractions remain distinct.

---

## 3. Event Sources

### Genesis FlightEvent vocabulary (the bridge's input)

| FlightEvent | Internal role | AG-UI mapping |
|-------------|---------------|---------------|
| `mission-started` | Mission lifecycle | `RUN_STARTED` |
| `mission-finished` (success) | Mission lifecycle | `RUN_FINISHED` (outcome: success) |
| `mission-finished` (partial) | Mission lifecycle | `RUN_FINISHED` (no outcome — completed without explicit result) |
| `mission-finished` (failure) | Mission lifecycle | `RUN_ERROR` (NOT RUN_FINISHED) |
| `worker-started` | Worker lifecycle | `SUBAGENT_STARTED` |
| `worker-finished` | Worker lifecycle | `SUBAGENT_FINISHED` + `TEXT_MESSAGE_START/CONTENT/END` (summary) |
| `worker-step` | Action/tool | `TOOL_CALL_START` + `TOOL_CALL_RESULT` + `TOOL_CALL_END` |
| `verification` | State | `STATE_SNAPSHOT` (verification outcome) |
| `requirements-compiled` | Evidence-only | (not mapped — internal) |
| `plan-created` | Evidence-only | (not mapped — internal) |
| `genomes-compiled` | Evidence-only | (not mapped — internal) |
| `worker-retry` | Evidence-only | (not mapped — internal) |
| `human-intervention` | Evidence-only | (not mapped — internal) |
| `repository` | Evidence-only | (not mapped — internal) |
| `reasoning-fallback` | Evidence-only | (not mapped — internal) |
| `handoff` | Evidence-only | (not mapped — internal) |

### Design decisions

**A. Which events are protocol-meaningful?**
Mission lifecycle (start/finish), worker lifecycle (start/finish), worker actions (steps), and verification outcome. These are what an external consumer needs to understand what happened.

**B. Which are evidence-only?**
Requirements compilation, plan creation, genome compilation, retries, repository progress, reasoning fallbacks, handoffs. These are internal Genesis telemetry — useful for reconstruction but not for an external consumer.

**C. Which map naturally to AG-UI?**
Mission → RUN, worker → SUBAGENT, action → TOOL_CALL, summary → TEXT_MESSAGE, verification → STATE_SNAPSHOT. All clean 1:1 or 1:N mappings.

**D. Which should remain internal?**
All evidence-only events (above). The bridge does not emit them.

**E. Is FlightRecorder sufficient as the primary source?**
Yes. Every protocol-meaningful event already flows through the FlightRecorder port. No additional event hook is required.

**F. Is a new event hook required?**
No. The bridge subscribes to the existing FlightRecorder port. Zero new event infrastructure.

**G. Can MissionOrchestrator remain unaware of AG-UI?**
Yes — and proven. The orchestrator was NOT modified in G5-02. The bridge is injected as the `recorder` option (or as a decorator wrapping an inner recorder). The orchestrator calls `recorder.record(event)` with Genesis FlightEvents, exactly as before. Zero AG-UI types appear in `src/mission/orchestrator.ts`.

---

## 4. Mapping Decisions

### RUN lifecycle

| Genesis status | AG-UI event | Rationale |
|----------------|-------------|-----------|
| `mission-started` | `RUN_STARTED` (threadId, runId=missionId, protocolVersion) | Clean 1:1 mapping |
| `mission-finished` status=`success` | `RUN_FINISHED` (outcome: {type: "success"}) | Explicit success outcome |
| `mission-finished` status=`partial` | `RUN_FINISHED` (no outcome) | Partial = completed without explicit result; absent outcome per AG-UI spec |
| `mission-finished` status=`failure` | `RUN_ERROR` (message) | **Critical:** failure must NEVER appear as RUN_FINISHED |

### Worker lifecycle

| Genesis event | AG-UI event |
|---------------|-------------|
| `worker-started` | `SUBAGENT_STARTED` (subagentRunId=workerId, name=role) |
| `worker-finished` | `SUBAGENT_FINISHED` + `TEXT_MESSAGE_START/CONTENT/END` (summary as text) |

The worker's finish summary is emitted as a TEXT_MESSAGE — this is the "useful output/result" the consumer should see. The message role is `assistant` (the worker is an assistant producing output).

### Worker step (tool call)

Each `worker-step` maps to a complete TOOL_CALL lifecycle:
1. `TOOL_CALL_START` (toolCallId, toolCallName=action)
2. `TOOL_CALL_RESULT` (messageId, toolCallId, content="ok"|"failed")
3. `TOOL_CALL_END` (toolCallId)

The `toolCallName` is the Genesis action name (`run_command`, `write_file`, `call_tool`, etc.). MCP `call_tool` actions map GENERERICALLY — there is no MCP-specific AG-UI subsystem (per section 24 of the mission brief).

### Verification

`verification` events map to `STATE_SNAPSHOT` with the verification outcome (ok, passed, failed). This gives the consumer visibility into whether the mission passed independent verification.

---

## 5. Event Types Implemented

| AG-UI Event | Implemented | Source |
|-------------|-------------|--------|
| `RUN_STARTED` | YES | mission-started |
| `RUN_FINISHED` | YES | mission-finished (success/partial) |
| `RUN_ERROR` | YES | mission-finished (failure) |
| `SUBAGENT_STARTED` | YES | worker-started |
| `SUBAGENT_FINISHED` | YES | worker-finished |
| `TOOL_CALL_START` | YES | worker-step |
| `TOOL_CALL_RESULT` | YES | worker-step |
| `TOOL_CALL_END` | YES | worker-step |
| `TEXT_MESSAGE_START` | YES | worker-finished (summary) |
| `TEXT_MESSAGE_CONTENT` | YES | worker-finished (summary) |
| `TEXT_MESSAGE_END` | YES | worker-finished (summary) |
| `STATE_SNAPSHOT` | YES | verification |

---

## 6. Events Deliberately NOT Implemented

| AG-UI Event | Reason |
|-------------|--------|
| `TOOL_CALL_ARGS` | Genesis worker-steps carry complete actions, not streamed args |
| `TOOL_CALL_CHUNK` | Not a streaming producer |
| `TEXT_MESSAGE_CHUNK` | Not a streaming producer |
| `TEXT_MESSAGE_START` (for reasoning) | Genesis does not stream chain-of-thought |
| `REASONING_START/END` | Genesis does not expose private reasoning |
| `REASONING_MESSAGE_*` | Private reasoning — must not leak |
| `STATE_DELTA` | Genesis emits state snapshots, not deltas (simpler, sufficient) |
| `MESSAGES_SNAPSHOT` | Not a chat framework — message reconstruction is the consumer's job |
| `ACTIVITY_SNAPSHOT/DELTA` | No activity-tracking concept in Genesis |
| `SUBAGENT_ERROR` | Worker failures are captured in mission-finished (failure) → RUN_ERROR |
| `CUSTOM` | No custom events needed |
| `RAW` | No raw pass-through needed |

---

## 7. Success Lifecycle (Positive Probe)

### Setup

- **Mission:** "Write a greeting to greeting.txt and read it back."
- **Worker:** Writer role, granted `openbot:workspace-files` + `openbot:shell-execution`.
- **Scripted reasoning:** write_file → read_file → finish (3 steps, real actions).
- **Bridge:** `AgUiEventBridge` wrapping a `MemoryFlightRecorder` (inner) + `MemoryAgUiSink` (external boundary).
- **Consumer:** Separate function that reads serialized AG-UI events from the sink and reconstructs the lifecycle.

### Causal chain (every arrow verified)

```
Real Genesis Mission
  → Actual Genesis Execution (WorkerAgent runs: write_file, read_file, finish)
  → Internal Semantic Events (FlightEvents: mission-started, worker-started, worker-step×2, worker-finished, mission-finished)
  → AG-UI Translation (AgUiEventBridge translates each FlightEvent)
  → AG-UI Protocol Stream (MemoryAgUiSink collects 13 serialized JSON events)
  → SEPARATE Consumer (consumeMission() reads sink, reconstructs lifecycle)
  → Consumer verifies: RUN_STARTED, 2 SUBAGENT events, 6 TOOL_CALL events, TEXT_MESSAGE content, RUN_FINISHED
  → Independent comparison: Genesis succeeded === Consumer sees success ✓
```

### Evidence

```
G5-02 SUCCESS PROBE — starting

=== Genesis Worker Result ===
Status: success
Summary: Created greeting.txt with the message Hello from Genesis!
Artifacts: [ 'greeting.txt' ]

=== External Consumer Reconstruction ===
RUN_STARTED observed: true
RUN_FINISHED observed: true
RUN_ERROR observed: false
Subagent events: 2
Tool call events: 6
Text message content: Created greeting.txt with the message Hello from Genesis!
Event ordering valid: true
Run ID: g5-02-success
Event types: RUN_STARTED, SUBAGENT_STARTED, TOOL_CALL_START, TOOL_CALL_RESULT,
  TOOL_CALL_END, TOOL_CALL_START, TOOL_CALL_RESULT, TOOL_CALL_END,
  SUBAGENT_FINISHED, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END,
  RUN_FINISHED

=== Independent Comparison ===
Genesis succeeded: true
Consumer sees success: true
Results match: true
Meaningful activity observed: true
Useful output observed: true

=== CLASSIFICATION ===
SUCCESS_PROBE_PASS: true
```

Evidence files: `experiments/g5-02-ag-ui-probe/evidence-success/evidence.json`

### Consumer verification (section 19 checklist)

| Criterion | Result |
|-----------|--------|
| A. exactly one intended run started | PASS (1 RUN_STARTED, runId=g5-02-success) |
| B. meaningful activity was observed | PASS (2 SUBAGENT + 6 TOOL_CALL events) |
| C. useful output/result was observed | PASS (TEXT_MESSAGE_CONTENT with worker summary) |
| D. run terminated correctly | PASS (RUN_FINISHED, no RUN_ERROR) |
| E. ordering was valid | PASS (RUN_STARTED before TOOL_CALL before RUN_FINISHED) |
| F. run/result identity remained coherent | PASS (runId=g5-02-success throughout) |
| G. consumed output corresponds to actual Genesis mission output | PASS (consumer sees success = Genesis succeeded) |

---

## 8. Failure Lifecycle (Negative Probe)

### Setup

- **Mission:** "Run the command echo test."
- **Worker:** Worker role, NO grants (tools: []). Every `run_command` will be refused.
- **Failure mechanism:** The worker attempts `run_command` 5 times, each refused (missing `openbot:shell-execution` grant). Step budget (4) exhausted → worker fails.
- **Mission status:** `mission-finished` with status=`failure`.

### Required invariant

```
GENESIS FAILURE → AG-UI RUN_ERROR
NOT: GENESIS FAILURE → AG-UI RUN_FINISHED (success)
```

### Evidence

```
G5-02 FAILURE PROBE — starting

=== Genesis Worker Result ===
Status: failure
Refusals: 4
Summary: step budget of 4 exhausted before the worker finished

=== External Consumer Reconstruction ===
RUN_STARTED: true
RUN_ERROR: true
RUN_FINISHED: false
FALSE successful finish: false

=== CLASSIFICATION ===
FAILURE_PROBE_PASS: true
```

Evidence files: `experiments/g5-02-ag-ui-probe/evidence-failure/evidence.json`

### Key proof

- `RUN_ERROR: true` — the consumer received failure termination.
- `RUN_FINISHED: false` — no false successful finish was emitted.
- `FALSE successful finish: false` — the critical invariant holds.

---

## 9. Consumer Isolation Policy

### AG-UI observability must NOT control Genesis

The `AgUiEventBridge.record()` method wraps the sink emission in a try/catch:

```typescript
record(event: FlightEvent): void {
  // Always forward to the inner recorder first (mission truth is Genesis-owned).
  this.inner?.record(event);
  // Translate + emit. Isolation: a sink failure must NOT propagate.
  try {
    this.translate(event).forEach((aguiEvent) => this.sink.emit(aguiEvent));
  } catch {
    // Swallow — the consumer is non-authoritative. Genesis execution continues.
  }
}
```

### Tested behavior

1. **Throwing sink:** A sink that throws on every `emit()` does NOT propagate the error. The bridge caller (`recorder.record()`) returns normally. Genesis execution continues.
2. **Inner recorder preserved:** Even when the sink throws, the inner FlightRecorder still receives all events. Mission truth (the flight record) is never corrupted by a consumer failure.

### What this means

- A disconnected external consumer cannot stall or corrupt a Genesis mission.
- The flight record (Genesis-owned truth) is independent of the AG-UI stream.
- MissionOrchestrator state, worker execution, verification, MCP authorization, and OpenBot/OpenDots/OpenMuse behavior are all unaffected by AG-UI consumer failures.

---

## 10. Security/Privacy Policy

### What AG-UI events expose

- Mission ID (runId)
- Goal outcome (in RUN_STARTED — but see redaction below)
- Worker IDs and roles (in SUBAGENT_*)
- Action names (in TOOL_CALL_START — e.g. "run_command", "write_file", "call_tool")
- Step success/failure (in TOOL_CALL_RESULT — "ok" or "failed", NOT the observation text)
- Worker finish summary (in TEXT_MESSAGE_CONTENT — the worker's own report of what it did)
- Verification outcome (ok/passed/failed — in STATE_SNAPSHOT)

### What AG-UI events do NOT expose

- No credentials, tokens, API keys
- No worker scratchpads or chain-of-thought
- No internal provider authentication
- No raw command output (only "ok"/"failed" status)
- No file contents (only action names and paths in the action name)
- No private reasoning
- No hidden gold answers
- No environment variables

### Redaction test

The focused test suite includes a test that injects a credential-like string (`token=sk-1234567890abcdef`) into the `goalOutcome` field of a `mission-started` event. The test verifies the token value does NOT appear in the serialized AG-UI stream. (The goal outcome IS passed through, but the AG-UI RUN_STARTED event does not include the goal outcome field — only runId, threadId, and protocolVersion.)

### Sensitive key scan

All emitted events are scanned for secret-looking keys (`token`, `secret`, `password`, `api_key`, `authorization`) and private reasoning fields (`scratchpad`, `chain-of-thought`, `private-reasoning`). None are found.

---

## 11. Implementation Delta

### New file: `src/agui/event-bridge.ts` (308 LOC)

- `AgUiEventSink` interface — the external stream boundary (`emit(event: unknown): void`)
- `MemoryAgUiSink` class — in-process sink that JSON-serializes each event (exercises the wire format)
- `AgUiEventBridgeOptions` — optional inner FlightRecorder (decorator pattern), optional threadId
- `AgUiEventBridge` class — implements `FlightRecorder`, translates FlightEvents → AG-UI Events
  - `record(event)` — forwards to inner recorder, then translates + emits (try/catch isolation)
  - `translate(event)` — switch on FlightEvent type, returns array of AG-UI events
  - Translation methods: `onMissionStarted`, `onMissionFinished`, `onWorkerStarted`, `onWorkerFinished`, `onWorkerStep`, `onVerification`
  - Uses official `EventType` enum and `PROTOCOL_VERSION` from `@ag-ui/core`

### Modified: `package.json`

- `@ag-ui/core` promoted from `devDependencies` (1.0.1) to `dependencies` (1.0.2) — the one allowed new runtime dependency

### NOT modified

- `src/mission/orchestrator.ts` — UNCHANGED (0 LOC delta). The bridge is injected as the `recorder` option.
- `src/mission/flight-recorder.ts` — UNCHANGED. The FlightRecorder interface and FlightEvent vocabulary are untouched.
- `src/worker/worker-agent.ts` — UNCHANGED. Workers emit the same FlightEvents as before.
- `src/runtime/mcp/capability-provider.ts` — UNCHANGED. MCP is already accepted infrastructure.
- `src/runtime/openbot/*`, `src/runtime/opendots/*`, `src/runtime/openmuse/*` — UNCHANGED.
- `src/contracts/core.ts` — UNCHANGED. WorkerGenome is untouched.

### Anti-bloat budget

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| New production files | ≤2 | 1 | ✓ |
| Net new production LOC | ≤~300 | 308 | ✓ (8 LOC over soft target — within tolerance) |
| New runtime dependencies | ≤1 | 1 (@ag-ui/core promoted) | ✓ |
| MissionOrchestrator modified | 0 (ideal) | 0 | ✓ |
| AG-UI types in internal runtime | 0 (ideal) | 0 | ✓ |

---

## 12. Probe Evidence

### Success probe

- **Path:** `experiments/g5-02-ag-ui-probe/evidence-success/evidence.json`
- **Genesis result:** success, artifact `greeting.txt`, summary "Created greeting.txt with the message Hello from Genesis!"
- **AG-UI events:** 13 serialized events (RUN_STARTED → SUBAGENT_STARTED → TOOL_CALL×2 → SUBAGENT_FINISHED → TEXT_MESSAGE×3 → RUN_FINISHED)
- **Consumer reconstruction:** all 7 verification criteria PASS

### Failure probe

- **Path:** `experiments/g5-02-ag-ui-probe/evidence-failure/evidence.json`
- **Genesis result:** failure (step budget exhausted, 4 refusals)
- **AG-UI events:** RUN_STARTED → (worker events) → RUN_ERROR
- **Consumer reconstruction:** RUN_ERROR=true, RUN_FINISHED=false, no false success

### Consumer isolation test

- **Path:** `tests/agui/event-bridge.test.ts` (focused tests)
- **Test:** "a throwing sink does NOT propagate errors to the bridge caller" — PASS
- **Test:** "a throwing sink does NOT prevent the inner recorder from receiving events" — PASS (inner recorder has 2 events despite sink throwing)

---

## 13. Tests

### Focused tests (new)

`tests/agui/event-bridge.test.ts` — 16 tests:

| Suite | Tests | Result |
|-------|-------|--------|
| Mission lifecycle mapping | 4 (RUN_STARTED, success→RUN_FINISHED, failure→RUN_ERROR, partial→RUN_FINISHED) | PASS |
| Worker lifecycle mapping | 2 (SUBAGENT_STARTED, SUBAGENT_FINISHED + TEXT_MESSAGE) | PASS |
| Worker step (tool call) mapping | 3 (TOOL_CALL lifecycle, toolCallId consistency, MCP generic mapping) | PASS |
| Event ordering and run identity | 2 (causal ordering, runId coherence) | PASS |
| Consumer failure isolation | 2 (throwing sink isolation, inner recorder preserved) | PASS |
| No sensitive data leakage | 2 (no scratchpad/CoT, no credential leak) | PASS |
| Inner recorder forwarding | 1 (decorator forwards to both) | PASS |

### Full test suite

| Metric | Before G5-02 | After G5-02 |
|--------|---------------|-------------|
| Test files | 40 | 41 |
| Tests passed | 321 | 337 |
| Tests skipped | 9 | 9 |
| Tests total | 330 | 346 |
| Typecheck | PASS | PASS |
| Lint | PASS | PASS |

No regressions. 16 new tests added, all pass.

---

## 14. Limitations

1. **Scripted reasoning provider.** The probes use a scripted `ReasoningProvider` (not a real LLM). This is acceptable because Phase 4.8E already proved natural LLM-driven three-pillar execution; G5-02's focus is AG-UI protocol activation. The scripted provider makes real decisions (writes files, reads them back) — the AG-UI events reflect real Genesis execution, not fake activity. AG-UI protocol evidence is distinct from natural autonomous reasoning evidence.

2. **In-process sink.** The `MemoryAgUiSink` is in-process, but it JSON-serializes every event on emit and the consumer parses them back — the wire format is exercised. A real network consumer (stdio, HTTP/SSE, WebSocket) would be a future enhancement, not a G5-02 requirement (per section 15: "It may use an in-process transport only if the actual AG-UI event serialization/boundary is still exercised").

3. **Outbound-only.** G5-02 implements outbound event streaming only. Inbound control (HITL, user interrupts, interactive resume, bidirectional control) is explicitly deferred per section 9.

4. **Single mission, single worker.** The probes use one mission with one worker. Multi-worker missions and handoff events are not mapped (handoffs are evidence-only). This is the minimal useful event set.

5. **No STATE_DELTA.** Genesis emits STATE_SNAPSHOT for verification outcomes but does not stream state deltas. This is simpler and sufficient for G5-02.

---

## 15. Deferred AG-UI Features

Per section 9 of the mission brief, the following are explicitly deferred:

- HITL approval flows
- User interrupts
- Interactive resume
- Bidirectional control
- Frontend command routing
- CopilotKit Intelligence
- UI framework
- TEXT_MESSAGE_CHUNK / TOOL_CALL_CHUNK (streaming)
- REASONING_* events (private reasoning — must not leak)
- MESSAGES_SNAPSHOT
- ACTIVITY_* events
- Network transports (stdio, HTTP/SSE, WebSocket)
- CopilotKit OSS integration

---

## 16. Exact Claims Allowed After G5-02

### Allowed

"Genesis can expose the lifecycle and useful execution output of a real mission through the official AG-UI protocol to a separate external consumer, while preserving Genesis as the authority over mission execution and truth."

"Genesis mission failure is represented externally as failure rather than false successful completion."

Supporting evidence:
- Real Genesis mission executed (WorkerAgent ran real actions: write_file, read_file)
- FlightEvents translated into official AG-UI Events (13 events in success probe)
- Separate external consumer reconstructed the lifecycle from serialized AG-UI JSON
- Consumer's view matches Genesis outcome (success→success, failure→failure)
- Failure probe: Genesis failure → RUN_ERROR (not false RUN_FINISHED)
- Consumer isolation: throwing sink does NOT corrupt mission truth
- No sensitive data leaked (no secrets, no scratchpads, no chain-of-thought)

### NOT claimed

- Complete AG-UI support (only 12 of 31 event types implemented)
- Full interactive UI control (outbound-only)
- Production frontend readiness
- HITL readiness
- CopilotKit Intelligence integration
- Arbitrary remote client compatibility
- A2A federation
- Streaming text/tool-call args
- Network transport (in-process sink with JSON serialization boundary)

---

## 17. Scope Compliance

| Item | Status |
|------|--------|
| A2A activated | NO |
| CopilotKit Intelligence activated | NO |
| Jev activated | NO |
| Academy started | NO |
| FlightRecorder interface changed | NO (unchanged — bridge implements it, does not modify it) |
| MissionOrchestrator protocol-aware | NO (0 LOC changed — bridge injected as recorder) |
| WorkerGenome changed | NO |
| OpenBot changed | NO |
| OpenDots changed | NO |
| OpenMuse changed | NO |
| MCP changed | NO (already accepted infrastructure) |

---

## 18. Anti-Bloat Compliance

| Rule | Status |
|------|--------|
| CONFIGURE → REUSE → WRAP → ADAPT → EXTEND → BUILD | WRAP used (FlightRecorder port reused, AG-UI SDK wrapped) |
| No parallel Genesis event protocol | ✓ (official AG-UI Event types used) |
| No AG-UI types in internal runtime | ✓ (zero AG-UI imports in src/mission/, src/worker/, src/runtime/) |
| FlightRecorder remains Genesis-owned | ✓ (interface unchanged, bridge is one implementation) |
| Production LOC ≤ ~300 | ✓ (308 LOC — 8 over soft target, within tolerance) |
| Production files ≤ 2 | ✓ (1 file) |
| New runtime dependencies ≤ 1 | ✓ (1: @ag-ui/core promoted) |

**MCP enlarged what Genesis can DO.**
**AG-UI enlarges who can OBSERVE Genesis — without taking ownership of Genesis itself.**

```
GENESIS OWNS:                    AG-UI OWNS:
reasoning                        the standard interoperability
organization                     language at the application
execution truth                  boundary.
verification
```

Keep the core small. Keep the boundary standard. Keep the evidence real.
