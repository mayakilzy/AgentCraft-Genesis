# Genesis — Project Context and Architecture (Safe)

This document gives a fresh session everything it needs to understand
what AgentCraft Genesis is and how it is built. It contains no benchmark
secrets. It is background knowledge: read it once, then work from the
source code (all of `src/` is safe to inspect — see
`SAFE-CONTEXT-MAP.md`).

## 1. The core thesis

> **Give Genesis a goal. It builds the AI organization needed to achieve
> it.**

Genesis is not a chatbot framework and not a fixed multi-agent pipeline.
It is a **Goal-to-Organization Runtime**: a compiler chain that turns a
single natural-language goal into a purpose-built, mission-scoped
organization of workers, runs that organization on real execution
infrastructure, verifies the outcome, and dissolves the organization when
the mission ends. The scientific bet being tested is that *adaptive
organization* — deriving the team from the mission instead of configuring
it by hand — is measurably better than static alternatives. That bet is
exactly what TASK-023 measures (see `BENCHMARK-EXECUTION-PROTOCOL.md`).

The compile chain:

```text
Goal
→ Goal Compiler          (understands the goal, derives requirements)
→ Organization Planner   (derives the org plan from the requirements)
→ Genome Compiler        (compiles each plan role into a Worker Genome)
→ Workers                (real agents executing on real computers)
→ Runtime                (orchestration, handoffs, integration, retry)
→ Verification           (deterministic acceptance gates, clean room)
→ Outcome                (mission result + flight record + evidence)
```

Guiding principles, in the project's own words:

- *"The team doesn't exist until the mission does."* Organizations are
  mission-scoped and dissolved at mission end; nothing persists between
  missions unless explicitly designed to.
- *"Agents are compiled."* Workers are not hand-written classes; they are
  compiled from genomes derived from the goal's requirements.
- *"Genesis should be large in capability, small in code."* Capability
  comes from reusing mature upstream primitives, not from growing the
  codebase.
- *"Reuse primitives. Standardize protocols. Invent orchestration.
  Minimize code."*
- *"Working behavior before architectural ceremony."* Every accepted
  feature was pulled in by an observed need, an experiment, or a review
  finding — never pushed in speculatively.

## 2. The minimal Worker Genome

Every worker in Genesis — regardless of role — is compiled from the same
ten-field genome (frozen in `src/contracts/core.ts`):

```text
identity     who this worker is (mission-scoped id)
role         what part of the mission it owns
objective    its concrete objective
model        reasoning tier / model policy
skills       declared skills
tools        granted tools (MCP-style grants)
computer     its execution computer (OpenBot container)
memory       its permitted memory
budget       cost/time/step budgets
autonomy     what it may do without asking
```

Muse, Bot and Dot are **patterns or presets under the unified Worker
Genome**, not hardcoded separate agent classes. A "Muse" is a genome
tuned for durable delegated work, a "Bot" for computer-bound execution, a
"Dot" for specialist collaboration — all through the same compiler, the
same contracts, the same runtime.

## 3. Ownership map — who owns what

Genesis deliberately owns as little as possible. Each area has exactly
one owner (enforced by the ownership gate in `data/ownership.yaml` and
`tests/ownership-gate.test.ts`):

**Genesis owns:**

```text
Goal Compiler
Organization Planner
Genome Compiler
Cognitive / Resource Router
Mission orchestration
Organization runtime control
Flight Recorder
Verification coordination
Organizational learning later
Evolution later
```

**OpenBot owns / provides (reused, canonical):**

```text
computer (per-worker containerized execution)
shell
browser
workspace isolation
human takeover
MCP grants
credentials
basic runtime policy / audit
```

**OpenMuse is primarily reference/reuse for:** durable delegated work,
plans, checkpoints, leases, external-write review patterns.

**OpenDots is primarily reference/adaptation for:** specialist
collaboration, Spaces/Pages patterns.

**CopilotKit Intelligence is reused for:** threads, memory, channels,
basic automatic learning.

The build order for any need is the anti-bloat ladder in §8 — Genesis
code is the last resort, not the first.

## 4. Protocol architecture

Three adopted standard protocols cover all communication planes:

```text
AG-UI = agent ↔ UI/application
MCP   = agent ↔ tools/data/context
A2A   = independent agent/organization ↔ independent agent/organization
```

Standing rule: **do not invent a Genesis contract if an adopted standard
already expresses it.** The protocol probe evidence lives in
`docs/protocol-probe.md` (safe). A2A for internal Genesis use remains
deferred unless a concrete requirement justifies it.

## 5. Decision architecture

Three planes, kept separate:

```text
Reasoning Plane   (providers that think: LLMs, fallback actors)
Decision Plane    (deterministic choosing between known options)
Governance Plane  (policy, budget, audit boundaries)
```

The Decision Plane is a small provider interface:

```text
DecisionProvider.decide(context, choices, constraints)
```

Possible providers: `RuleDecisionProvider` (deterministic, budget-aware),
`StatisticalDecisionProvider`, `LLMDecisionProvider`, and `JevProvider`
(experimental). **Jev is a provider, not an architecture dependency** —
the decision plane works fully without it.

## 6. The development fallback rule

The configured external LLM provider was unstable during GROUP 3
(rate-limit storms, proven by probe evidence). The review-authorized
rule that kept development velocity without faking anything:

```text
External provider unavailable
→ DEVELOPMENT_REASONING_FALLBACK may replace reasoning during development.
```

With two hard invariants:

```text
Development fallback ≠ production evidence.
Replace reasoning, never fake execution.
```

Real execution always remains real — OpenBot computers, filesystem,
shell, git, worktrees, commits, tests, browser where relevant,
integration, clean-room verification, and the Flight Recorder all run
exactly as with a live provider. Only the reasoning boundary is
substituted, and every substituted call is announced in the flight record
as `reasoning_source = DEVELOPMENT_REASONING_FALLBACK`, so a
fallback-served run can never be confused with a real-provider run.

## 7. The TASK-022A worker-instance isolation rule

Early fallback serving had one hidden-memory channel: a single shared
journal across logically isolated worker instances. That was remediated
and the fix accepted (TASK-022A). The accepted rule:

```text
same worker instance     → continuity allowed
different worker instance → hidden continuity forbidden
explicit Genesis communication → allowed
```

The isolation identity is **mission + logical worker instance**: every
`WorkerAgent` construction (a specialist's main run, its bounded retry,
the coordinator, a handoff-served invocation) is a distinct logical
instance with its own fallback journal directory, so the actor serving
one instance can never read another instance's private reasoning. The
architectural lesson (no hidden channels between logically isolated
contexts; explicit communication is the only legitimate channel) is the
whole story — the historical diagnostic details of how it was discovered
are not needed and are not included.

## 8. The anti-bloat constitution

This project actively resists becoming a framework. The build order for
any need:

```text
CONFIGURE  →  REUSE  →  WRAP  →  ADAPT  →  EXTEND  →  BUILD
```

`BUILD` is the last resort. And:

> *Complexity belongs in capabilities, not in the Genesis codebase.*

> *A constraint must solve an observed problem, concrete safety risk, or
> known interoperability requirement. Otherwise, it waits.*

No speculative: provider framework, session manager, policy DSL, generic
benchmark platform, workflow engine, memory service, orchestration
framework. When in doubt, solve the problem with execution discipline
and boundaries — not with a new subsystem.

## 9. Source map (all safe to inspect)

```text
src/contracts/core.ts            frozen minimal contracts (Goal, Plan, Genome, providers)
src/goal/goal-compiler.ts        Goal → GoalRequirements
src/goal/llm-understanding.ts    LLM goal understanding (with deterministic fallback)
src/organization/organization-planner.ts   requirements → OrganizationPlan
src/genome/genome-compiler.ts    plan roles → Worker Genomes
src/routing/cognitive-router.ts tier/model routing (no provider-name leakage)
src/routing/decision-provider.ts Rule + LLM decision providers
src/providers/zai-reasoning.ts  external reasoning provider adapter
src/worker/worker-agent.ts      the worker loop (real tool execution)
src/worker/handoff.ts           explicit inter-worker communication envelopes
src/mission/orchestrator.ts     Goal → Result mission loop
src/mission/verification.ts     deterministic acceptance checks, clean room, bounded retry
src/mission/flight-recorder.ts  JSONL flight record + raw log, secret sanitization
src/runtime/computer.ts         WorkerComputer port
src/runtime/openbot/adapter.ts        OpenBotRuntimeAdapter
src/runtime/openbot/computer-api.ts   agent-computer HTTP client
src/runtime/openbot/computer-process.ts  per-worker agent-computer process
src/work/git-workspace.ts       git worktrees, clone, commit (host git CLI)
src/work/dev-runtime.ts         development runtime (computers + workspaces)
src/work/integration-manager.ts integration branch management
src/work/repo-mission.ts        repository-mission assembly (the real SE loop)
```

Read `docs/architecture-baseline.md` and the repository `README.md` for
the original architectural charter; read `docs/protocol-probe.md` for the
live protocol verification evidence. All three are safe.
