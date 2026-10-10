# G7-18R Phase 2 — Capability Gap Report (Production Interface Does Not Accept Existing Project)

## Task instruction

> "Give Genesis access to the existing generated project and the diagnostic evidence through its supported production execution path."
> "If Genesis cannot receive an existing project workspace through the current production interface, stop and report that capability gap. Do not simulate autonomous repair by manually copying corrected code into the project."

## What the production interface accepts

The gateway HTTP API `POST /v1/missions` accepts a JSON body parsed by `parseSubmission()` in `src/gateway/http-server.ts`. The accepted fields are exactly:

| Field | Type | Purpose |
|---|---|---|
| `outcome` | string (required, ≤ 10000 chars gateway-level, ≤ 2000 chars GoalCompiler) | The Goal's high-level outcome text. |
| `context` | string (optional, unlimited) | The Goal's context (detailed spec). |
| `constraints` | string array (optional) | The Goal's hard constraints. |
| `budget` | `{maxUsd?, tier?}` (optional) | Mission budget hint. |
| `idempotencyKey` | string (optional) | Caller-supplied dedup key. |
| `label` | string (optional) | Caller-supplied correlation label. |
| `acceptanceCriteria` | array of `{kind: 'file'|'content-in-artifacts'|'hash-match', ...}` (optional) | Caller-supplied structural verification checks. |

That is the complete set. See `src/gateway/http-server.ts:428-490` (`parseSubmission`) and `src/gateway/types.ts:85-123` (`MissionSubmission` interface).

## What the engine supports but the production interface does NOT expose

The orchestrator DOES have a `missionInputs` option (`src/mission/orchestrator.ts:134`, type `MissionInput[]` at `src/mission/orchestrator.ts:168-173`):

```ts
export interface MissionInput {
  /** Workspace-relative path (e.g. "expenses.csv", "input/orders.json"). */
  readonly path: string;
  /** The authoritative file contents. */
  readonly contents: string;
}
```

The orchestrator stages each `MissionInput` into every computer-bearing worker's workspace BEFORE the worker starts (`src/mission/orchestrator.ts:489-514`). The worker's task brief is augmented to tell the worker about the staged inputs (`src/mission/orchestrator.ts:324-328`). The verification loop also supports mission-input checks (`src/mission/verification.ts:273, 412`).

So the ENGINE has the capability — Phase 4.8B introduced it (see `src/mission/orchestrator.ts:128-134` comment). But the GATEWAY does not wire `missionInputs` through to the orchestrator. There is:

- No `missionInputs` field on `MissionSubmission` (transport type).
- No `missionInputs` parsing in `parseSubmission()`.
- No `missionInputs` passed when `MissionService` constructs the orchestrator (`src/gateway/mission-service.ts:831-868`).
- No A2A surface for file upload (no matches in `src/gateway/a2a-server.ts`).
- No MCP tool that places files into worker workspaces (the worker only has `write_file`, `read_file`, `list_files`, `run_command`, `browser` — all writing is from the worker side, not the caller side).

## What I would have needed to do Phase 2 autonomously

To repair the existing Community Project Hub via the production interface, I would have needed to:

1. Submit a mission whose goal instructs the worker to repair `server.js` and `test/db.test.js` (replace `sqlite3` API with `node:sqlite` `DatabaseSync` API, preserve everything else).
2. Stage the **9 existing files** into the worker's workspace as `missionInputs`, so the worker can `read_file` them, diagnose, and overwrite only the broken ones.
3. Stage the **Phase 1 diagnostic report** as an additional mission input so the worker knows exactly which lines to fix.
4. Set acceptance criteria that the worker must produce a `server.js` that imports `node:sqlite` (not `node:sqlite3`) and that the test suite passes.
5. Configure `maxWorkerSteps` and `missionTimeoutMs` within a finite documented budget.

**Step 2 is impossible through the current production HTTP interface.** Without staged inputs, the worker would have to regenerate the entire application from the goal text (which is what G7-18 already did — and that produced the broken `node:sqlite3` import). A "repair" that regenerates from scratch is not a repair; it is G7-18 again.

## Documented finite repair budget (not executed — capability gap)

For record-keeping, the budget that WOULD have been requested if the interface supported staging:

| Resource | Value | Justification |
|---|---|---|
| `maxWorkerSteps` per worker | 25 | Repair touches 2 files; worker needs ≤ 6 reads + 4 writes + 4 test runs + 2 fixups = ~16 steps. 25 gives headroom. (vs. G7-18's 80, because we are NOT regenerating 9 files.) |
| `missionTimeoutMs` | 300,000 (5 min) | Targeted repair on staged files; shorter than G7-18's 540s because no generation. |
| Token budget ceiling | 250,000 | 1/3 of G7-18's actual (798,257); targeted repair should fit in this. |
| Retry policy | none | Per task instruction: "no unbounded retries". One attempt; on failure, report the blocker. |
| Workers planned | 1 (single Software Engineer) | G7-18 ran 5 workers; only `documentation-writer-2` succeeded. For a targeted repair with staged inputs, a single specialist suffices. |

These are NOT executed. The capability gap blocks Phase 2 before any worker is spawned.

## Stop condition

Per task instruction: **"If Genesis cannot receive an existing project workspace through the current production interface, stop and report that capability gap."**

**STOP.** Phase 2 is not executed. No mission is submitted. No worker is spawned. No tokens are spent on a repair attempt. No file is modified.

**Do not simulate autonomous repair by manually copying corrected code into the project.** That would be exactly the "manual intervention dressed up as autonomous repair" pattern the task instruction explicitly forbids. The honest answer is that the production interface lacks the capability, and that is what gets reported.

## Required-status impact

| Field | Value | Reason |
|---|---|---|
| `EXISTING_PROJECT_REPAIR_SUPPORTED` | **NO** | Gateway HTTP API has no `missionInputs` field; `parseSubmission()` does not accept file contents; `MissionService` does not pass `missionInputs` to the orchestrator. The engine has the capability, the interface does not. |
| `AUTONOMOUS_REPAIR` | **FAIL** | Not attempted — capability gap blocks before any execution. Per task instruction: stop and report. |
| `GENESIS_MISSION_STATUS` | **NOT_ATTEMPTED** | No mission submitted. Zero tokens spent on repair. |
| `MANUAL_APPLICATION_CODE_INTERVENTION` | **NO** | The application files in `evidence/g7-18/clean-room-app/` remain byte-for-byte identical to G7-18 (verified in Phase 0). No code was modified by GLM. |

The next phases (3 — Independent Acceptance, 4 — Resource Analysis) handle this honestly: Phase 3 has no repaired artifacts to test, so all behavioral fields are N/A. Phase 4 analyzes the G7-18 token consumption retroactively (no new tokens to analyze for G7-18R). Phase 5 still runs the engine regression, typecheck, and lint — none of which require a Genesis mission.
