# GENESIS_GROUP5_ENTRY_CONTRACT

**Date:** 2026-10-07
**Purpose:** Authoritative entry point for a fresh Group 5 conversation

---

## WHAT GENESIS IS

AgentCraft Genesis is a Goal-to-Organization Runtime. Give it a goal; it builds the AI organization needed to achieve it. Genesis owns the organizational layer (goal understanding, organization design, worker composition, operational requirement selection, experience, learning, evolution). It does NOT own infrastructure (OpenBot, OpenDots, OpenMuse) or protocols (MCP, AG-UI, A2A).

---

## WHAT IS PROVEN

1. **Natural three-pillar execution** (Phase 4.8E): a genuinely LLM-driven worker can execute a natural mission across real computer, durable-delegation, and collaborative-workspace surfaces, satisfy mission-required obligations using runtime evidence, reconcile results, publish to shared workspace, and pass independent verification without developer intervention.

2. **Learning loop closed** (Phase 4.11): Experience → Candidate → Evaluation → Pattern → Retrieval → OrganizationPlanner → different real organization → measured improvement (5→2 workers, 10→4 reasoning calls).

3. **Mission obligations enforced** (Phase 4.8D): worker prose alone cannot satisfy a mission requirement — runtime evidence (flight-action checks) is required.

4. **Provider-neutral architecture** (Phase 4.5-4.8): WorkerGenome, operationalNeeds, MissionObligations, and worker actions contain NO provider names. Provider resolution is separate from mission semantics.

5. **Full regression green**: 310 tests pass, 9 skipped (environment-gated), typecheck PASS, lint PASS.

---

## WHAT IS NOT PROVEN

1. **Autonomous operational-need inference** — operational needs are explicitly injected (EXPLICIT_TEST_INJECTION). The OrganizationPlanner does not yet infer needs from the goal. Academy evidence needed.

2. **OpenMuse in-flight checkpoint resume** — Phase 4.7 proved persisted queued-work recovery only. In-flight execution checkpoint resume remains NOT_PROVEN.

3. **Statistical learning claims** — N=1 remains N=1. Broad self-improvement is NOT claimed.

4. **Optimal organization** — Genesis does not always find the optimal organization. Learning produces MORE APPROPRIATE organization, not OPTIMAL.

5. **Production readiness** — Alpha software, sample mode, scripted experiments. Not production-hardened.

---

## CURRENT ARCHITECTURE

See `GENESIS_ARCHITECTURE_MAP_v1.md`.

**Key contracts:**
- `WorkerGenome` (10 fields + `operationalNeeds`)
- `WorkerAction` (12 provider-neutral actions)
- `MissionObligation` (3 kinds: delegated-result, shared-publication, computer-execution)
- `AcceptanceCheck` (6 kinds: command, file, evidence, mission-input, flight-action, content-in-artifacts)
- `Experience` (schemaVersion 2)

**Key modules:**
- `GoalCompiler` → `OrganizationPlanner` → `GenomeCompiler` → `MissionOrchestrator` → `WorkerAgent`
- `CompositeRuntime` → `OpenBotRuntimeAdapter` + `OpenDotsWorkspaceAdapter` + `OpenMuseAdapter`
- `VerificationLoop` (clean-room + flight-action + content-in-artifacts)
- `Experience` → `StatisticalCandidateGenerator` → `RuleCandidateEvaluator` → `OrganizationalPattern` → `RulePatternRetriever` → `OrganizationPlanner`

---

## CURRENT LEARNING ARCHITECTURE

See `GENESIS_LEARNING_STATE_v2.md`.

The learning loop is CLOSED: Experience → Candidate → Evaluation → Pattern → Retrieval → OrganizationPlanner (via orchestrator `patterns` option) → GenomeCompiler → different organization.

**Learning is advisory, not mandatory.** Patterns may be applied or ignored. User explicit requirements always outrank learned optimization.

---

## THREE-PILLAR MODEL

| Pillar | Provider | Surface | Worker Actions |
|--------|----------|---------|----------------|
| Computer | OpenBot | ComputerSurface | run_command, read_file, write_file, list_files, browser_* |
| Workspace | OpenDots | WorkspaceSurface | read_shared_workspace, append_shared_workspace |
| Durable | OpenMuse | JobSurface | check_durable_status, get_durable_result |

---

## MISSION OBLIGATION MODEL

Mission obligations are provider-neutral declarations of mandatory behavior:

| Obligation | Required Action | Enforcement |
|------------|-----------------|-------------|
| delegated-result | get_durable_result | flight-action check |
| shared-publication | append_shared_workspace | flight-action check |
| computer-execution | run_command | flight-action check |

Worker prose cannot satisfy an obligation — runtime evidence is required.

---

## PROVIDER-NEUTRALITY RULES

1. WorkerGenome describes WHAT (operationalNeeds), not HOW (providers).
2. Worker actions are provider-neutral (no provider names).
3. MissionObligations map to provider-neutral actions, not providers.
4. Learned patterns use domain + capabilityNeeds, never provider names.
5. No provider-specific worker types (no HybridWorker, MuseWorker, etc.).

---

## CURRENT TEST / BUILD STATUS

- **Test files:** 39 passed
- **Tests:** 310 passed | 9 skipped (319 total)
- **9 skipped:** all environment-gated on OpenBot checkout (intentional)
- **typecheck:** PASS
- **lint:** PASS
- **Runtime dependencies:** 1 (yaml)
- **Production LOC:** ~9797 across 35 files

---

## ALLOWED CLAIMS

- "Genesis demonstrated that a genuinely LLM-driven worker can execute a natural mission with authoritative input across real computer, durable-delegation, and collaborative-workspace surfaces, satisfy a mission-required independent delegated result using runtime evidence, reconcile that result with its primary work, publish the grounded outcome to shared state, and pass independent verification without developer intervention during execution."
- "Genesis demonstrated in a measured real-runtime experiment that experience-derived organizational knowledge was promoted, retrieved by future planning, changed a subsequent organization, and produced a measurably more appropriate outcome on a related unseen mission."

---

## FORBIDDEN OVERCLAIMS

- "Genesis universally self-improves." (N=1)
- "Genesis always finds the optimal organization." (learning is advisory)
- "Genesis is production-ready." (alpha, sample mode)
- "OpenMuse in-flight checkpoint resume was proven." (NOT_PROVEN)
- "Genesis autonomously infers operational needs." (explicit injection)
- "Genesis learned the optimal organization." (more appropriate, not optimal)

---

## DEFERRED ITEMS

| Item | Reason | Owner | Target Phase |
|------|--------|-------|--------------|
| Autonomous operational-need inference | Needs diverse Academy evidence | Group 5 Academy | Group 5 |
| MCP runtime activation | ADOPTed; activate at Group 5 entry | Group 5 | Group 5 entry |
| AG-UI runtime activation | ADOPTed; activate at Group 5 entry | Group 5 | Group 5 entry |
| CopilotKit Intelligence | ADAPT; evaluate after charters | Council | Post-Academy |
| A2A federation | DEFER; federation milestone | Group 6 | TASK-036+ |
| Jev benchmark | Optional primitive | Council | TASK-037 |
| OpenMuse checkpoint resume | NOT_PROVEN | Council | Future |
| Statistical learning claims | N=1 | Council | Post-Academy |

---

## MCP ACTIVATION TARGET

**MCP_ACTIVATION_TARGET = Group 5 entry / early Group 5**

MCP is strategically important for the Academy — diverse capability requirements need the MCP tool/resource/prompt protocol. Pin spec `2026-07-28` (RC), SDK `@modelcontextprotocol/sdk@1.32.1`. Track RC→GA.

---

## AG-UI ACTIVATION TARGET

**AG_UI_ACTIVATION_TARGET = Group 5 entry**

AG-UI (protocol 1.0, `@ag-ui/core@1.0.2`) is the agent→user event-stream boundary. Activate at Group 5 entry alongside MCP.

---

## A2A ACTIVATION TARGET

**A2A_ACTIVATION_TARGET = Federation milestone (TASK-036+)**

A2A is for external agent federation only. Internal Genesis workers do not speak A2A. Activate when Genesis needs to call or expose external agents.

---

## COPILOTKIT DECISION

**COPILOTKIT_INTELLIGENCE = ADAPT**

ADOPT AG-UI + CopilotKit OSS (React + Channels). DEFER CopilotKit Intelligence (managed platform) as optional, swappable backend. Do NOT make Intelligence the canonical memory/thread store.

---

## JEV STATUS

**JEV_BOUNDARY = DecisionProvider (optional primitive)**

Jev is GA (self-serve since Sep 2026). Wrap as MCP tool. Keep behind DecisionProvider contract. Benchmark at TASK-037.

---

## GROUP 5 PURPOSE

**GROUP 5 = ORGANIZATIONAL CAPABILITY ACADEMY**

Expose Genesis to diverse real mission families so it can accumulate, test, and refine reusable organizational capability.

**Expected direction:**
- Mission-family curriculum
- Increasingly diverse tasks
- Real runtime execution
- Organizational pattern accumulation
- Transfer to unseen tasks
- Progressive scale-up
- Eventual blind transfer
- Greenfield product mission

---

## GROUP 5 FIRST TASK

**GROUP_5_FIRST_RECOMMENDED_ACTION =**

1. Activate MCP + AG-UI (pin versions per this contract)
2. Run the first Academy mission family (start simple — e.g., 3-5 mission families across different domains)
3. For each family: run 2-3 missions, derive experiences, generate candidates, evaluate, promote patterns
4. Test pattern transfer to unseen missions in the same family
5. Measure improvement (workers, reasoning, verification, correctness)
6. Only after N>3 per family: consider promoting operational-need learning from explicit injection to autonomous inference

---

## GROUP 5 ANTI-BLOAT RULES

- Soft warning: > 700 net new production LOC per phase
- Hard stop: > 1200 LOC OR > 6 new production files OR any new runtime dependency OR new framework
- Prefer: CONFIGURE → REUSE → WRAP → ADAPT → EXTEND → BUILD (BUILD last)
- Do NOT create: LearningGraph, OrganizationalKnowledgeGraph, Pattern Engine v2, Evolution Engine v2, Optimization Platform
- Do NOT introduce provider-specific worker types
- Do NOT encode provider names in WorkerGenome/operationalNeeds/MissionObligations

---

## REPOSITORY

- **Repo:** `https://github.com/mayakilzy/AgentCraft-Genesis.git`
- **Branch:** `build/group-03-repository-work`
- **Final HEAD:** (recorded in GENESIS_GROUP4_FINAL_STATE.md)
- **Upstream services:** OpenBot (`/home/z/my-project/upstream/OpenBot`), OpenDots (`/home/z/my-project/upstream/OpenDots`), OpenMuse (`/home/z/my-project/upstream/OpenMuse`)
- **Start script:** `python3 /home/z/my-project/scripts/start_upstream.py start all`
