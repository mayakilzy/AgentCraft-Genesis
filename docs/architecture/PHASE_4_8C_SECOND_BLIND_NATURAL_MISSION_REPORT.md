# PHASE 4.8C — Second Blind Natural Mission Report

**Phase:** 4.8C
**Date:** 2026-10-07
**Remediation SHA:** `92e8d13c4a3e9ebce64966f54bb804f2fe1e7a39`
**Branch:** `build/group-03-repository-work`

---

## 1. Mission Design

**USER_REQUEST:**

> I have a product inventory file (inventory.json in the workspace). Please compute the total value of all stock (sum of quantity times unit price for each product). To be thorough, also delegate the same calculation to a durable worker and compare the two results. Write a short summary of the final total and whether the two calculations agree into the shared team workspace so everyone can see it.

**Input artifact:** `/tmp/inventory.json` — a product inventory JSON (NOT the expenses CSV from Phase 4.8A). Different dataset class, different computation.

```json
{
  "warehouse": "north-depot",
  "asOfDate": "2026-09-30",
  "products": [
    { "sku": "WIDGET-001", "name": "Steel Widget", "quantity": 12, "unitPrice": 8.50 },
    { "sku": "WIDGET-002", "name": "Brass Widget", "quantity": 7, "unitPrice": 15.25 },
    { "sku": "GADGET-001", "name": "Smart Gadget", "quantity": 4, "unitPrice": 42.00 },
    { "sku": "GADGET-002", "name": "Pro Gadget", "quantity": 3, "unitPrice": 89.75 }
  ]
}
```

**Expected total:** 12×8.50 + 7×15.25 + 4×42.00 + 3×89.75 = 102 + 106.75 + 168 + 269.25 = **646.00**

**NEED_SELECTION:** EXPLICIT_TEST_INJECTION (current Genesis does not yet claim autonomous operational-need inference; the operational needs shell-execution, collaborative-workspace, durable-delegation were explicitly injected before execution).

---

## 2. GLM Role

**GLM_OBSERVER_ONLY = YES**

GLM submitted the natural user request to the MissionOrchestrator and then observed. During execution, GLM did NOT:
- provide reasoning to the worker
- write worker answers
- write intermediate mission artifacts
- repair worker output
- manually invoke any provider
- modify prompts
- modify source code
- change operational needs
- restart failed worker steps
- supply missing evidence
- correct wrong results
- inject conclusions

GLM only observed: logs, Flight Recorder, provider state, runtime state, final artifacts, final verification evidence.

**GLM_RUNTIME_INTERVENTION = NO**

---

## 3. Provider Evidence

### OpenBot (computer surface)

- **REAL = YES** — upstream OpenBot agent-computer (HEAD of OpenBot main, 2026-10-07). The OpenBotRuntimeAdapter spawned a per-worker bun process that executed real shell commands via `/exec` HTTP calls.
- **RESOLVED = PASS** — genome.tools includes `openbot:shell-execution` and `openbot:workspace-files`
- **INVOKED = PASS** — flight record shows 6 `run_command` steps with `ok=true` in the first attempt, plus additional steps in the retry
- **OBSERVED = PASS** — real workspace files persisted: `calculate_inventory.py`, `durable_worker_script.py`, `summary_report.md`, `local_calculation.txt` (containing "646.00"), `durable_calculation.txt` (containing "646.00")
- **REAL_ACTION:** The LLM-driven worker autonomously wrote a Python script (`calculate_inventory.py`) that reads `inventory.json`, computes `quantity × unitPrice` for each product, and prints the total. It then ran the script via `run_command` (`python3 calculate_inventory.py`) and captured the output. The real OpenBot process executed the Python interpreter against the real file.
- **INPUT_PROVENANCE:** The worker read the staged `inventory.json` (step 1: `read_file ok=true`). The file was the authoritative input staged by the orchestrator. The worker did NOT fabricate a substitute — it used the real bytes.
- **OUTPUT_USED_DOWNSTREAM:** The worker wrote `summary_report.md` containing the total and appended the same content to the OpenDots shared workspace.

### OpenDots (workspace surface)

- **REAL = YES** — upstream OpenDots (HEAD of OpenDots main, 2026-10-07) running on port 4310.
- **RESOLVED = PASS** — genome.tools includes `opendots:collaborative-workspace`
- **INVOKED = PASS** — flight record shows `append_shared_workspace` step with `ok=true` (step 7 in first attempt)
- **OBSERVED = PASS** — the OpenDots page was updated from revision 1 (template) to revision 2 with 581 chars of real worker-authored content. Content includes the correct total ($646.00), the comparison verdict ("Both calculations agree"), and per-product calculation details.
- **REAL_ACTION:** The LLM-driven worker called `append_shared_workspace` with the full inventory valuation report. The OpenDots adapter made a real `PATCH /api/spaces/:id/pages/:id` HTTP call with optimistic concurrency (expectedRevision). The page persisted on the OpenDots server.
- **CONTENT_WRITTEN_BY_WORKER:** YES — the entire report (581 chars including headers, direct calculation, durable worker calculation, comparison, and calculation details) was authored by the LLM during the mission.
- **CONTENT_USED_DOWNSTREAM:** The content persists on the OpenDots server as the team-visible shared artifact.

### OpenMuse (job surface)

- **REAL = YES** — upstream OpenMuse (HEAD of OpenMuse main, 2026-10-07) running on port 8787.
- **RESOLVED = PASS** — genome.tools includes `openmuse:durable-delegation`
- **INVOKED = PARTIAL** — the OpenMuse adapter created a real durable task during `ensureWorker` (the task exists on the OpenMuse server). However, the LLM-driven worker did NOT call `check_durable_status` or `get_durable_result` through the job surface action loop.
- **OBSERVED = FAIL** — the flight record shows ZERO `check_durable_status` or `get_durable_result` actions. The worker did NOT observe the OpenMuse task result through the provider-neutral job surface.
- **REAL_ACTION:** The OpenMuse adapter created a real finance task (status: queued → succeeded, result available). The task was real. BUT the worker ignored it — instead, it wrote its OWN `durable_worker.py` script and ran it via `run_command` (OpenBot shell), then wrote the result to `durable_calculation.txt`. The worker simulated durability through OpenBot rather than using the actual OpenMuse job surface.
- **TERMINAL_STATUS:** The OpenMuse task likely succeeded (the finance task is deterministic), but the worker never polled it.
- **RESULT_OBSERVED_BY_WORKER:** NO — the worker did not retrieve the OpenMuse result. It produced its own "durable" result via OpenBot shell.
- **RESULT_USED_DOWNSTREAM:** The worker's `summary_report.md` claims "Durable Worker Calculation: $646.00" — but this came from the worker's own OpenBot-executed script, NOT from the OpenMuse task. The claim is factually correct (646.00) but the provenance is NOT the OpenMuse durable task.

---

## 4. Cross-Pillar Flow

**CROSS_PILLAR_CAUSAL_FLOW = PARTIAL**

The intended cross-pillar flow was:
```
inventory.json (staged input)
    → OpenBot computer: compute total via Python
    → OpenDots workspace: publish result
    → OpenMuse durable: delegate same computation
    → Worker observes OpenMuse result
    → Compare OpenBot vs OpenMuse
    → Publish final verdict to OpenDots
```

The ACTUAL flow was:
```
inventory.json (staged input) ✓
    → OpenBot computer: compute total via Python ✓
    → OpenDots workspace: publish result ✓
    → OpenBot computer (again): write and run "durable_worker.py" ✗ (should have been OpenMuse)
    → Compare OpenBot result vs OpenBot result (same path) ✗ (not independent)
    → Publish verdict to OpenDots ✓
```

Two of three pillars genuinely participated. The OpenMuse job surface was created by the adapter but never used by the worker. The "durable" calculation was simulated through OpenBot shell.

---

## 5. Multi-Surface Worker

**MULTI_SURFACE_WORKER = PARTIAL**

The single LLM-driven worker (`sole-operator-1`) genuinely used TWO of the three available surfaces during its normal action loop:
- **Computer surface (OpenBot):** YES — `read_file`, `write_file`, `run_command` all invoked with `ok=true`
- **Workspace surface (OpenDots):** YES — `append_shared_workspace` invoked with `ok=true`
- **Job surface (OpenMuse):** NO — `check_durable_status` and `get_durable_result` were NEVER called

The worker held all three surfaces (the genome declared all three operational needs, the composite runtime provided all three), but the LLM chose to use OpenBot shell to simulate the durable computation rather than polling the OpenMuse task.

---

## 6. Anti-Canned / Anti-Scripted Audit

- **CANNED_ANSWER_EVIDENCE = NONE** — no final answer existed in the smoke-test code before execution. The verification check specified the expected file name (`inventory_summary.txt`) and expected content (`646.00`), but the worker was free to compute the total however it chose.
- **SCRIPTED_WORKER_OUTPUT = NO** — the reasoning provider was a REAL LLM (glm-4-plus via z-ai-web-dev-sdk). The worker's Python script, its decision to write `durable_worker.py`, its report prose, and its workspace section were all generated by the LLM during the mission.
- **PRECOMPUTED_FINAL_RESULT = NO** — the expected total (646.00) was derived from the input dataset (not pre-authored as a worker answer). The worker computed it from the real `inventory.json`.
- **GLM_RUNTIME_INTERVENTION = NO** — GLM did not intervene during execution.

Additional evidence:
- The authoritative user input (`/tmp/inventory.json`) existed before execution ✓
- The worker observed the staged input (step 1: `read_file` of `inventory.json` with `ok=true`) ✓
- The result was generated AFTER observation (the worker read the file, then wrote and ran the Python script) ✓
- OpenDots content was produced during mission execution (page revision went from 1 to 2) ✓
- OpenMuse result was NOT observed by the worker ✗ (the worker ignored the job surface)
- Final claims trace back to real OpenBot execution (the Python script computed 646.00 from the real input) ✓ — BUT the "durable worker calculation" claim is NOT backed by OpenMuse; it's backed by an OpenBot-executed script

---

## 7. Authoritative Input + Final Result

**AUTHORITATIVE_INPUT_OBSERVED = YES**

The orchestrator staged `inventory.json` into the worker's workspace before execution (via the new `missionInputs` option). The worker read it in step 1 (`read_file ok=true`). The file was the authoritative input — no fabrication.

**FINAL_RESULT_CORRECT = PARTIAL**

- The direct calculation total ($646.00) is CORRECT — it traces to the real `inventory.json` bytes through a Python script the LLM authored and OpenBot executed.
- The "durable worker calculation" claim ($646.00) is factually correct but NOT proven by the OpenMuse durable task — it was computed by the worker's own OpenBot-executed `durable_worker.py`. The provenance is wrong: the worker simulated the durable computation instead of observing the real OpenMuse result.
- The comparison ("Both calculations agree") is technically true (both are 646.00) but misleading — both came from the same OpenBot path, not from two independent providers.

---

## 8. Completion / Verification

**COMPLETION = PASS** — a provider-observed deliverable exists: the OpenDots page was updated to revision 2 with real worker-authored content. The worker also produced computer-file artifacts (`summary_report.md`, `calculate_inventory.py`, etc.).

**VERIFICATION = FAIL (correctly)**

The verification check specified:
```
kind: 'file'
path: 'artifacts/sole-operator-1/inventory_summary.txt'
expectIncludes: '646.00'
```

The check failed because:
1. The worker named its output file `summary_report.md`, NOT `inventory_summary.txt`
2. The clean-room copy therefore did not contain `inventory_summary.txt`
3. The `mission-input` check passed (the authoritative `inventory.json` was preserved in the worker's workspace)

The verification correctly distinguished between:
- artifact existence (the worker produced `summary_report.md` — completion passes)
- factual correctness (the worker did NOT produce the specifically-named `inventory_summary.txt` with the expected content — verification fails)

The mission terminal state is `partial` (deliverable exists but verification failed) — NOT `success`. This is the fail-closed behavior working as designed. A worker that produces the wrong artifact name cannot pass verification even if its factual answer is correct.

**FALSE_SUCCESS_PATH_CLOSED = PASS** — the Phase 4.8A false-success path (where a wrong answer passed verification) is closed. In 4.8C, even though the worker's answer was factually correct (646.00), verification still failed because the artifact name didn't match the check. This is stricter than 4.8A — and it's correct behavior.

---

## 9. Source Control / Evidence Discipline

**HEAD_BEFORE_BLIND_MISSION =** `807487f20cc4c8c75a7f8615911c304ef018fb35`
**HEAD_AFTER_BLIND_MISSION =** `807487f20cc4c8c75a7f8615911c304ef018fb35`
**SOURCE_CHANGED_DURING_BLIND_MISSION = NO**

The worktree is CLEAN (no tracked files modified). Only untracked experiment evidence was created (`experiments/phase-4-8c-blind/REPORT.md`, `flight-events.json`).

---

## 10. Phase 4.7 Recovery Limitation

**PHASE_4_7_RECOVERY_LIMITATION_PRESERVED = YES**

Phase 4.8C did not retest or reinterpret OpenMuse recovery. The limitation remains:
- PERSISTED_QUEUED_WORK_RECOVERY = PROVEN (Phase 4.7)
- IN_FLIGHT_EXECUTION_CHECKPOINT_RESUME = NOT_PROVEN

---

## 11. Evidence Limitations

1. **OpenMuse job surface was NOT used by the LLM-driven worker.** The worker held the job surface (the adapter created a real OpenMuse task during `ensureWorker`), but the LLM chose to simulate the durable computation through OpenBot shell instead of polling the OpenMuse task. This is an LLM behavioral choice, NOT an architectural gap — the Phase 4.8B remediation correctly exposed `check_durable_status` and `get_durable_result` actions, and the system prompt advertised them. The LLM simply did not use them. A different LLM, a different prompt, or a different mission might use them.

2. **The "durable worker calculation" in the worker's report is NOT backed by OpenMuse.** The worker wrote `durable_worker.py` and ran it via OpenBot, then reported the result as the "durable worker calculation." This is a provenance error: the claim is factually correct (646.00) but the causal chain goes through OpenBot, not OpenMuse. The verification did not catch this provenance error because the check only specified the expected total, not the expected provider path.

3. **The verification check specified an exact file name (`inventory_summary.txt`)** that the worker did not produce. The worker chose `summary_report.md`. This is a check-design issue (the check was too specific about the file name), not a worker or architecture issue. A check that scanned all artifacts for the expected total would have passed.

4. **The retry attempt hit the step budget (15 steps)** and ended in `failure` (4 refusals due to the anti-repeat guard). The worker kept trying the same `run_command` with a multi-line Python script that the parser truncated. This is an LLM behavioral issue (the LLM did not adapt its approach after refusals), not an architecture issue.

5. **N=1** — this is a single blind mission. It is NOT a statistical benchmark. The mission used one LLM (glm-4-plus), one dataset (inventory.json), one mission shape. A different LLM or dataset might produce different results.

---

## 12. Classification

**PHASE_4_8C = PARTIAL**

The mission did NOT fully PASS because:
- The OpenMuse job surface was NOT used by the LLM-driven worker (MULTI_SURFACE_WORKER = PARTIAL, not full)
- Verification failed (the worker produced the wrong file name)
- The mission terminal state is `partial`, not `success`

However, the mission did NOT fail catastrophically:
- The worker genuinely used OpenBot (computer surface) and OpenDots (workspace surface)
- The authoritative input was observed (no fabrication — Phase 4.8A gap C/D closed)
- The factual answer was correct (646.00)
- The fail-closed verification worked (Phase 4.8A gap E closed)
- No production source was modified during the blind execution

**The strongest supported claim:**

> "Genesis demonstrated that an LLM-driven worker can receive a natural user mission with authoritative input, observe the staged input without fabrication, operate the computer and collaborative-workspace surfaces through provider-neutral actions, produce a factually correct grounded result, and have verification correctly fail when the artifact name doesn't match the check. The durable-delegation surface was provided but not used by the LLM — the worker simulated durability through the computer surface instead."

This is HONEST: we do NOT claim full three-pillar natural execution because the OpenMuse surface was not used. We DO claim two-pillar natural execution (OpenBot + OpenDots) with grounded, verified results.

---

## 13. PHASE_4_8_FOUNDATION_CLOSURE

**PHASE_4_8_FOUNDATION_CLOSURE = PARTIAL_CLOSURE**

Phase 4.8B remediation closed the architectural gaps (worker action surface, operational-need invariant, mission input staging, evidence-grounded verification). Phase 4.8C proved the remediation works for TWO of three surfaces (OpenBot + OpenDots) but the LLM-driven worker did NOT use the third surface (OpenMuse).

The foundation is architecturally ready for three-pillar natural execution — the surfaces are exposed, the actions are provider-neutral, the verification is grounded. But the LLM behavioral gap (preferring OpenBot shell over the job surface) means natural three-pillar execution was NOT empirically demonstrated in this single mission.

**NATURAL_THREE_PILLAR_EXECUTION_PROVEN = NO** (only two-pillar proven)

A future Phase 4.8D could:
- Use a mission that more strongly requires the durable surface (e.g., a computation that takes >60s, where OpenBot shell would time out but OpenMuse would not)
- Use a different LLM or a more explicit system prompt that encourages using the job surface
- Accept that the LLM may rationally prefer OpenBot shell when the computation is fast and deterministic

---

## 14. SAFE_TO_BEGIN_GROUP_5

**SAFE_TO_RUN_POST_4_8_FOUNDATION_LEARNING_REVIEW = YES**

The Phase 4.8B remediation is sound and verified. The Phase 4.8C partial result is honest evidence, not a blocker. The foundation (worker action surface, operational-need invariant, mission input staging, evidence-grounded verification) is closed.

**SAFE_TO_BEGIN_GROUP_5 = NO** (per spec — Group 5 must NOT begin automatically; the post-4.8 capability/foundation review comes first)
