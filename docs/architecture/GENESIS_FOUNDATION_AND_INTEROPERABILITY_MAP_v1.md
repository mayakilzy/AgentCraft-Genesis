# GENESIS_FOUNDATION_AND_INTEROPERABILITY_MAP_v1

**Version:** v1 (Phase 4.9 output — frozen for Group 5)
**Date:** 2026-10-07
**Authority:** Phase 4.9 Foundation & Interoperability Review

---

## 1. Genesis Ownership Map

Genesis owns the **organizational layer** — everything between the user's goal and the operational infrastructure. Genesis does NOT own infrastructure, protocols, or tools that upstream systems already provide.

| Domain | Owner | Decision | Boundary |
|--------|-------|----------|----------|
| Goal understanding | Genesis | GENESIS-BUILD | GoalCompiler + GoalUnderstandingProvider |
| Organization design | Genesis | GENESIS-BUILD | OrganizationPlanner |
| Worker genome | Genesis | GENESIS-BUILD | WorkerGenome (10 fields + operationalNeeds) |
| Genome compilation | Genesis | GENESIS-BUILD | GenomeCompiler |
| Cognitive routing | Genesis | GENESIS-BUILD | CognitiveRouter + DecisionProvider |
| Mission orchestration | Genesis | GENESIS-BUILD | MissionOrchestrator |
| Worker action loop | Genesis | GENESIS-BUILD | WorkerAgent + WorkerAction |
| Experience | Genesis | GENESIS-BUILD | Experience (schemaVersion 2) |
| Learning | Genesis | GENESIS-BUILD | Candidate → Evaluation → Pattern → Retrieval |
| Evolution | Genesis | GENESIS-BUILD | EvolutionSandbox (bounded variant evaluation) |
| Mission obligations | Genesis | GENESIS-BUILD | MissionObligation + flight-action verification |
| Mission input staging | Genesis | GENESIS-BUILD | MissionInput + missionInputs orchestrator option |
| Completion / Verification | Genesis | GENESIS-BUILD | hasDeliverable + AcceptanceCheck + VerificationLoop |

**Anti-reimplementation rule:** Genesis must not rebuild what OpenBot, OpenDots, OpenMuse, MCP, AG-UI, A2A, CopilotKit, or Jev already own.

---

## 2. Three-Pillar Infrastructure Map

```
                         USER GOAL
                            │
                            ▼
                    AGENTCRAFT GENESIS
                            │
                   Goal → Organization
                            │
                    Worker / Organization
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
    ComputerSurface   WorkspaceSurface    JobSurface
          │                 │                 │
          ▼                 ▼                 ▼
       OpenBot           OpenDots          OpenMuse
```

| Pillar | Provider | Surface | Worker Actions | Operational Need |
|--------|----------|---------|----------------|------------------|
| Computer execution | OpenBot | ComputerSurface | run_command, write_file, read_file, list_files, browser_* | shell-execution, workspace-files, browser |
| Collaborative workspace | OpenDots | WorkspaceSurface | read_shared_workspace, append_shared_workspace | collaborative-workspace |
| Durable delegation | OpenMuse | JobSurface | check_durable_status, get_durable_result | durable-delegation |

**Provider-neutrality rule:** WorkerGenome describes WHAT a worker needs (operationalNeeds). Runtime/provider resolution determines HOW that need is supplied. Worker actions are provider-neutral (no provider names in the action vocabulary). One worker may use multiple infrastructures without becoming a special type (no HybridWorker/MuseWorker/BotWorker).

---

## 3. Protocol Relationship Map

| Protocol | Role | Overlap | Genesis Decision | Activation |
|----------|------|---------|-----------------|------------|
| **MCP** | Tool/resource/prompt/sampling protocol | Tools ↔ Genesis tool registry; resources ↔ OpenDots knowledge | ADOPT verbatim | Day-1 of Group 5 (pin spec 2026-07-28 RC, SDK 1.32.1) |
| **AG-UI** | Agent→user event-stream protocol | Agent runtime → UI streaming | ADOPT as event boundary | Day-1 of Group 5 (pin protocol 1.0, @ag-ui/core 1.0.2) |
| **A2A** | External agent-to-agent federation | Genesis federation edge only | ADOPT at federation edge; DEFER internally | Federation milestone (TASK-036+) |
| **CopilotKit Intelligence** | Threads/memory/channels/HITL platform | Overlaps OpenDots memory + OpenMuse threads | ADAPT: ADOPT AG-UI + CopilotKit OSS; DEFER Intelligence as swappable optional backend | Phase-1 OSS; Phase-2 evaluate Intelligence |
| **Jev** | Decision model (bounded-choice, non-hallucinatory) | DecisionProvider contract | ADOPT as optional decision primitive (wrap as MCP tool) | Phase-2 optimization |

### Operational vs. Interoperability Distinction

```
OPERATIONAL INFRASTRUCTURE          INTEROPERABILITY / DECISION

OpenBot   → computer runtime        MCP   → tools/resources/capabilities
OpenDots  → collaborative work      AG-UI → agent ↔ app/UI interaction
OpenMuse  → durable delegation      A2A   → agent/org ↔ agent/org

                                     Jev → DecisionProvider capability
```

---

## 4. Activation Timeline

| Phase | Activate | Why |
|-------|----------|-----|
| Group 5 entry | MCP + AG-UI (pin versions) | Academy needs diverse capabilities (MCP) and UI streaming (AG-UI) |
| Early Group 5 | CopilotKit OSS (React + Channels) | Fast Slack/Teams + reference AG-UI client |
| Mid Group 5 | Jev (as MCP tool) | Optimize bounded-choice decisions (routing, gating) |
| Late Group 5 / Group 6 | A2A (federation edge) | External agent federation when needed |
| Post-Academy | CopilotKit Intelligence (evaluate) | If OpenDots/OpenMuse confirm they won't own those stores |

---

## 5. Protected Future Boundaries

| Boundary | Protected From | Reason |
|----------|---------------|--------|
| MCP transport/session/tool-resource semantics | Genesis reimplementing | Official SDK owns this; Genesis is an MCP client + server host |
| AG-UI event taxonomy (31 types) | Genesis inventing parallel events | AG-UI 1.0 owns this; Genesis emits/consumes AG-UI events |
| A2A AgentCard/discovery/task lifecycle | Genesis building federation protocol | A2A 1.0 owns this; Genesis uses it only at the external edge |
| CopilotKit OSS React/Channels SDK | Genesis rebuilding UI components | CopilotKit OSS provides reference AG-UI client + channel adapters |
| OpenBot computer/container lifecycle | Genesis managing containers | OpenBot owns the supervisor; Genesis uses the adapter |
| OpenDots Spaces/Pages CRUD | Genesis building workspace storage | OpenDots owns the server; Genesis uses the adapter |
| OpenMuse task lifecycle/lease/recovery | Genesis managing durable tasks | OpenMuse owns the worker; Genesis observes results |

---

## 6. CopilotKit Intelligence Decision

**COPILOTKIT_INTELLIGENCE = ADAPT**

- **ADOPT** AG-UI protocol (already decided) + CopilotKit OSS as reference AG-UI client and channel adapter (Slack/Teams)
- **DEFER** CopilotKit Intelligence (managed platform) as an optional, swappable, self-hostable backend behind OpenDots/OpenMuse-owned interfaces
- **Do NOT** make Intelligence the canonical thread/memory/learning store — that creates strategic duplication with Genesis-owned subsystems
- **Reconsider trigger:** when OpenDots/OpenMuse charters are finalized and if either cedes its memory/thread mandate to Intelligence

---

## 7. Jev Decision

**JEV_BOUNDARY = DecisionProvider (optional primitive, not a dependency)**

- Jev is a decision model, NOT a protocol. It turns bounded-choice questions into typed decisions with confidence.
- Jev should be wrapped as an MCP tool so any Genesis agent can invoke it uniformly.
- Jev must remain swappable behind the existing `DecisionProvider` contract (the contract already accommodates it).
- **Benchmark target:** TASK-037 (post-Academy), when Genesis has enough diverse routing decisions to measure improvement.

---

## 8. Explicit Anti-Reimplementation Rules

1. **Never** build a Genesis-specific tool protocol. Use MCP.
2. **Never** invent parallel agent→UI event types. Use AG-UI.
3. **Never** build a federation protocol. Use A2A at the edge.
4. **Never** rebuild computer/container management. Use OpenBot.
5. **Never** rebuild workspace storage. Use OpenDots.
6. **Never** rebuild durable task management. Use OpenMuse.
7. **Never** make CopilotKit Intelligence the canonical memory store unless OpenDots/OpenMuse explicitly cede that mandate.
8. **Never** make Jev a hard dependency. Keep it behind DecisionProvider.
9. **Never** introduce provider-specific worker types (MuseWorker, BotWorker, etc.).
10. **Never** encode provider names in WorkerGenome, operationalNeeds, or MissionObligations.

---

## 9. Phase 4.9 Success Criteria

| Criterion | Status |
|-----------|--------|
| FOUNDATION_BOUNDARIES = CLEAR | PASS |
| MCP_PATH = FROZEN | PASS (ADOPT, Group 5 entry) |
| AG_UI_PATH = FROZEN | PASS (ADOPT, Group 5 entry) |
| A2A_PATH = FROZEN | PASS (ADOPT at federation edge, defer internally) |
| COPILOTKIT_DECISION = MADE | PASS (ADAPT) |
| JEV_BOUNDARY = CLEAR | PASS (optional DecisionProvider, wrap as MCP tool) |
| NO_PROTOCOL_BLOCKER_FOR_GROUP_5 = TRUE | PASS |
