# GENESIS_ARCHITECTURE_MAP_v1

**Version:** v1 (frozen for Group 5)
**Date:** 2026-10-07

---

## Architecture Overview

```
                         USER GOAL
                            │
                            ▼
                    AGENTCRAFT GENESIS
                            │
                   GoalCompiler → GoalRequirements
                            │
                   OrganizationPlanner → OrganizationPlan
                   (+ learned patterns from Phase 4.10)
                            │
                   GenomeCompiler → WorkerGenome[]
                   (+ operationalNeeds + tool grants)
                            │
                   MissionOrchestrator
                   (+ missionInputs + missionObligations + patterns)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
           OpenBot       OpenDots      OpenMuse
           (computer)    (workspace)  (durable)
              │             │             │
              └─────────────┼─────────────┘
                            │
                   CompositeRuntime
                   → WorkerSurfaces
                            │
                   WorkerAgent
                   (action loop: run_command, read_file,
                    write_file, read_shared_workspace,
                    append_shared_workspace, check_durable_status,
                    get_durable_result, finish)
                            │
                   VerificationLoop
                   (AcceptanceCheck: command, file, evidence,
                    mission-input, flight-action, content-in-artifacts)
                            │
                   Experience → Learning → Patterns
                            │
                   (feeds back to OrganizationPlanner)
```

---

## Core Contracts (src/contracts/core.ts)

| Contract | Purpose |
|----------|---------|
| Goal | The user's outcome + context + constraints + budget |
| GoalRequirements | Compiled: domain, capabilityNeeds, successCriteria, hardConstraints, budget |
| OrganizationPlan | Workers + collaboration edges + capabilityNeeds + learned influence |
| WorkerGenome | 10 fields + operationalNeeds (provider-neutral) |
| OperationalNeed | 5 kinds: shell-execution, browser, workspace-files, collaborative-workspace, durable-delegation |
| MissionObligation | 3 kinds: delegated-result, shared-publication, computer-execution |
| MissionResult | status + summary + evidence + cost |
| RuntimeAdapter / WorkerRuntime | Lifecycle + surfaces |

---

## Worker Action Vocabulary (provider-neutral)

| Action | Surface | Obligation |
|--------|---------|------------|
| run_command | Computer | computer-execution |
| write_file | Computer | — |
| read_file | Computer | — |
| list_files | Computer | — |
| browser_navigate | Computer (browser) | — |
| browser_screenshot | Computer (browser) | — |
| ask_worker | Handoff | — |
| read_shared_workspace | Workspace | — |
| append_shared_workspace | Workspace | shared-publication |
| check_durable_status | Job | — |
| get_durable_result | Job | delegated-result |
| finish | — | — |

**No provider names in actions.** The worker reasons about capabilities, not providers.

---

## Verification Check Kinds

| Kind | Purpose |
|------|---------|
| command | Run a command, assert exit code + output |
| file | Assert a named file exists in clean room + content |
| evidence | Assert evidence kind present |
| mission-input | Assert authoritative input preserved in workspace (fail-closed) |
| flight-action | Assert a provider-neutral action was invoked with ok=true (obligation enforcement) |
| content-in-artifacts | Scan ALL artifacts for expected content (name-agnostic) |

---

## Learning Loop

```
Experience (schemaVersion 2)
    ↓ resolvedNeeds, providerInvocations, verification outcome
StatisticalCandidateGenerator
    ↓ groups by domain, identifies redundant/valuable roles
RuleCandidateEvaluator
    ↓ promotes if ≥2 supporting + no contradictions + verification success
OrganizationalPattern
    ↓ avoid-role, prefer-role, prefer-shape, avoid-shape
RulePatternRetriever (in OrganizationPlanner)
    ↓ matches domain + capabilityNeeds
OrganizationPlanner (via orchestrator patterns option)
    ↓ applies advisory patterns, records learned field
GenomeCompiler
    ↓ different real organization
```

---

## Production LOC Summary

| Module | LOC | Files |
|--------|-----|-------|
| contracts/ | ~470 | 1 |
| goal/ | ~380 | 2 |
| genome/ | ~330 | 1 |
| organization/ | ~570 | 1 |
| routing/ | ~150 | 2 |
| mission/ | ~1100 | 4 |
| worker/ | ~700 | 2 |
| runtime/ | ~1100 | 7 |
| learning/ | ~900 | 8 |
| providers/ | ~80 | 1 |
| work/ | ~1800 | 4 |
| index.ts | ~20 | 1 |
| **Total src/** | **~9797** | **35** |

**Dependencies:** 1 runtime (yaml), 6 dev (vitest, typescript, eslint, typescript-eslint, zod, + @types/node, @ag-ui/core, @modelcontextprotocol/sdk, @a2a-js/sdk — dev only for type definitions)
