# G7-18R Phase 4 — G7-18 Resource & Execution Analysis (Retroactive)

This phase analyzes the G7-18 mission's 798,257-token consumption using the evidence already in `evidence/g7-18/`. **No new Genesis execution was performed for G7-18R** (Phase 2 stopped at the capability gap). Per task instruction: "Do not invent missing usage metrics." Where the evidence supports a measurement, it is reported; where it does not, the gap is named.

## Mission-level cost (measured)

From `evidence/g7-18/mission-snapshot.json`:

| Field | Value |
|---|---|
| `missionId` | `f4ee2752-4339-4f6e-9874-4e9f1cd15273` |
| `status` | PARTIAL |
| `cost.tokens` | 798,257 |
| `cost.wallMs` | 540,578 (≈ 9 min) |
| `cost.usd` | $0.00 (Z.ai included usage) |
| `cost.humanInterventions` | 0 |
| `reasoningCalls` (total) | 22 |
| `worker_reasoning_calls` | 22 |
| `reviewer_calls` | 0 |
| `handoff_calls` | 0 |

## Per-worker telemetry (measured where reported)

The `worker-finished` event reports `steps` and `reasoningCalls` per worker. It does NOT report per-worker token counts. The table below shows only what the evidence directly supports; the token-attribution column is an **estimate** (proportional to reasoning calls), clearly labelled as such.

| Worker ID | Role (from `worker-started`) | Tier | Steps | Reasoning calls | Status | Failure class | Est. tokens (proportional, NOT measured) |
|---|---|---|---|---|---|---|---|
| `software-engineer-1` | Software Engineer | cheap | 1 | 3 | failure | PROVIDER_FAILURE | ~108,853 (3/22 × 798,257) |
| `documentation-writer-2` | Documentation Writer | default | 9 | 11 | success | — | ~399,128 (11/22 × 798,257) |
| `generalist-worker-3` | Generalist Worker | cheap | 8 | 8 | failure | CANCELLED | ~290,275 (8/22 × 798,257) |
| **Total** | | | 18 | 22 | | | **798,257 (measured)** |

The estimate column assumes uniform tokens-per-reasoning-call across workers. This is almost certainly wrong (different roles, different prompt sizes, different response sizes), but the evidence does not let us measure the real per-worker split. **The proportional estimate is a placeholder, not a measurement.**

## Plan vs. actual

The `plan-created` event reports `workers: 5` with this rationale:

> Scope "complex" in domain "software-engineering" with 4 capability needs. Planned 4 specialist role(s): Software Engineer [code-execution], Documentation Writer [document-authoring], Generalist Worker [data-analysis], [4th specialist]. Mission Coordinator added because 3+ specialists require integration.

Only **3** of the 5 planned workers actually started. The Mission Coordinator and the 4th specialist never ran — the mission timed out (540s) before they could be dispatched.

| Planned | Started | Finished |
|---|---|---|
| 5 | 3 | 3 (2 failures, 1 success) |

## Failed reasoning calls (analysis of what was wasted)

**Two of three workers wasted their entire reasoning-call budget on work that did not produce a usable artifact:**

1. **`software-engineer-1`** (3 reasoning calls, 1 step): `PROVIDER_FAILURE` — the worker called the LLM 3 times, never produced a parseable action, then gave up. The single successful step was a `write_file` of `package.json`. Net contribution to the final artifact set: zero (the package.json from this worker was overwritten by `documentation-writer-2` and is not in the final artifact set).

2. **`generalist-worker-3`** (8 reasoning calls, 8 steps): `CANCELLED` by the mission timeout. This worker did the **same work** as `documentation-writer-2` — wrote `server.js`, `public/index.html`, `public/styles.css`, `public/app.js` via `cat > file << EOF` heredocs. The 7 `run_command` actions are:

   | Step | Command (truncated) |
   |---|---|
   | 2 | `pwd` |
   | 3 | `ls -la` |
   | 4 | `mkdir -p public test` |
   | 5 | `cat > server.js << 'EOF'\nconst http = require('node:http');\nconst sqlite3 = require('node:sqlite3')...` |
   | 6 | `cat > public/index.html << 'EOF'\n<!DOCTYPE html>...` |
   | 7 | `cat > public/styles.css << 'EOF'\n/* Global Styles */...` |
   | 8 | `cat > public/app.js << 'EOF'\n// DOM Elements...` (cancelled mid-write) |

   This worker's `server.js` ALSO imports `node:sqlite3` (line 2 of its heredoc), so it would have been broken in the same way as `documentation-writer-2`'s output. **The Generalist Worker is duplicating the Software Engineer's job, badly.**

3. **`documentation-writer-2`** (11 reasoning calls, 9 steps): the only successful worker. Wrote all 9 required files via `write_file`. But its `server.js` import is the broken `node:sqlite3` — the model-quality defect that G7-18R is trying to repair.

## Repeated actions / duplicate work

| File written | By which workers? |
|---|---|
| `server.js` | `documentation-writer-2` (write_file, 8155b) AND `generalist-worker-3` (heredoc) AND `software-engineer-1` (write_file, 8909b — but `software-engineer-1`'s output was overwritten by `documentation-writer-2`) |
| `public/index.html` | `documentation-writer-2` AND `generalist-worker-3` |
| `public/styles.css` | `documentation-writer-2` AND `generalist-worker-3` |
| `public/app.js` | `documentation-writer-2` AND `generalist-worker-3` |
| `package.json` | `documentation-writer-2` AND `software-engineer-1` (overwritten) |

Three workers independently wrote the same files. Two of them failed; only the surviving copy made it to the artifact set. **No file in the final artifact set required 3 independent regenerations** — the work was duplicated because the plan dispatched specialists with overlapping scopes (Software Engineer + Documentation Writer + Generalist Worker all writing code).

## Unnecessary workers (contribution analysis)

| Worker | Did it contribute to the final artifact set? | Reasoning calls spent | Verdict |
|---|---|---|---|
| `software-engineer-1` | No (its package.json was overwritten by `documentation-writer-2`) | 3 | Unnecessary — produced nothing usable |
| `documentation-writer-2` | Yes (all 9 final files came from this worker) | 11 | Necessary — sole producer |
| `generalist-worker-3` | No (cancelled mid-write; even if it had finished, its `server.js` would have been broken too) | 8 | Unnecessary — duplicate work, cancelled |

Of 22 reasoning calls, 11 (50%) were spent on workers that produced nothing the artifact set kept. **If a single Software Engineer with staged inputs had been dispatched for the same 9-file generation, the proportional token cost would have been roughly 798,257 × (11/22) ≈ 399,128 tokens** — about half of what was actually spent. (This is an estimate, not a measurement.)

For the G7-18R repair specifically, the planned budget in `phase-2-capability-gap-report.md` was 250,000 tokens — about 1/3 of G7-18's actual cost — because a targeted repair touches 2 files (not 9) and stages the existing 9 files so the worker doesn't regenerate them. The capability gap blocked this from being tested.

## Repair execution vs. full regeneration (G7-18R's actual spend)

| Mission | Tokens spent | What it produced |
|---|---|---|
| G7-18 | 798,257 | Full 9-file app generation — structural verification PASS, but behavioral FAIL (`node:sqlite3` import) |
| G7-18R | **0** | No Genesis execution. Capability gap blocked Phase 2 before any mission submission. |

G7-18R did NOT regenerate the application. It also did NOT repair it (capability gap). The application files in `evidence/g7-18/clean-room-app/` remain byte-for-byte identical to G7-18's `documentation-writer-2` output (verified in Phase 0). **MANUAL_APPLICATION_CODE_INTERVENTION = NO** — no code was modified by GLM.

## What the evidence does NOT support

The following metrics are NOT derivable from the evidence and are NOT reported here (per "Do not invent missing usage metrics"):

- Per-worker token attribution (only mission-level `cost.tokens` is reported).
- Prompt-token vs. completion-token split (the ZAI reasoning provider exposes a `usage()` method, but the per-call breakdown is not persisted in `mission-events.json`).
- Latency per reasoning call (only `worker-step` elapsedMs is recorded, and that is the action's elapsed time, not the LLM call's).
- Why `software-engineer-1` failed to produce a valid action (the `worker-finished` summary says "could not produce a valid action after repeated attempts" but the 3 raw LLM responses are not in the evidence).

## Phase 4 summary

- **G7-18 token consumption**: 798,257 (measured). 50% of reasoning calls (11/22) were spent on workers that produced no usable artifact.
- **Failed reasoning calls**: 3 from `software-engineer-1` (PROVIDER_FAILURE — never produced a parseable action) and 8 from `generalist-worker-3` (CANCELLED — aborted mid-write). 11/22 = 50% of all reasoning calls wasted.
- **Repeated actions**: 3 workers independently wrote the same files (`server.js`, `public/index.html`, `public/styles.css`, `public/app.js`, `package.json`). Only `documentation-writer-2`'s copies survived.
- **Unnecessary workers**: yes. Of the 3 that ran, 2 (`software-engineer-1`, `generalist-worker-3`) contributed nothing to the final artifact set. The plan's "4 specialists + Mission Coordinator" structure caused overlapping scopes.
- **Repair vs. regeneration**: G7-18R spent 0 tokens on repair (capability gap). G7-18 spent 798,257 on full regeneration. A targeted repair with staged inputs would have been a fraction of that, but the capability gap prevented verification.
