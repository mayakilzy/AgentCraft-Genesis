# AgentCraft Genesis

> **Give Genesis a goal. It builds the AI organization needed to achieve it.**

Genesis is a Goal-to-Organization runtime. It compiles a human goal into structured
requirements, designs an organization for the work, compiles worker genomes, routes
cognitive resources, and runs real work on real computers — then records the experience.

**Philosophy:** large in capability, small in code.
**Engineering rule:** `CONFIGURE → REUSE → WRAP → ADAPT → EXTEND → BUILD` — `BUILD` is the last resort, not the first.

Genesis does not rebuild computers, browsers, memory, Git, containers, tool protocols or
chat infrastructure. It reuses mature upstream layers (OpenBot, OpenMuse, OpenDots,
CopilotKit Intelligence, AG-UI, MCP, A2A) and invents only what they do not provide:
**goal-to-organization orchestration and organizational learning.**

## Status

| Group | Scope | State |
| --- | --- | --- |
| GROUP 1 | Foundation + Genesis Born Core (`TASK-001…009`) | **done** — Goal → Requirements → Plan → Genomes → Provider Decisions |

The locked source-of-truth for versions, links and decisions is
[docs/architecture-baseline.md](docs/architecture-baseline.md) with its machine-readable
companion `data/dependency-baseline.json`.

## Layout

```
src/contracts/     frozen minimal contracts (Goal, OrganizationPlan, WorkerGenome, …)
src/goal/          Goal Compiler — human goal → structured requirements
src/organization/  Organization Planner — requirements → logical organization
src/genome/        Genome Compiler — planned roles → runnable worker genomes
src/routing/       Cognitive Router & decision providers
data/              machine-readable baselines (dependencies, census, ownership)
docs/              architecture baseline, protocol probe results
tests/             unit + integration tests
```

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run lint        # eslint
```

Requires Node.js 24+.
