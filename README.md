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
| GROUP 2 | Genesis Born Runtime (`TASK-010…015`) | in progress — real workers on the real OpenBot runtime |

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
src/runtime/       execution surface port + OpenBot runtime adapter (thin boundary)
src/worker/        the Genesis worker — genome + brain + hands acting loop
data/              machine-readable baselines (dependencies, census, ownership)
docs/              architecture baseline, protocol probe results
tests/             unit + integration tests
```

## The OpenBot runtime boundary

Workers execute inside [OpenBot](https://github.com/CopilotKit/OpenBot) (v0.1.0), the
canonical computer/container/browser baseline. Genesis never imports or vendors upstream
source: the adapter speaks the documented agent-computer HTTP API (`/exec`, `/files/*`,
`/computers/*`) with bearer auth and per-worker bot ids.

The canonical deployment gives every worker its own computer **container** through the
upstream supervisor (Docker). Where no container runtime exists (this development
sandbox), the same unmodified upstream service runs as one process per worker with
per-worker `WORKSPACE_DIR`, `PROFILES_DIR`, port and token — the isolation the container
would provide, expressed through the service's own configuration. On Docker-capable
infrastructure the supervisor takes that role behind the same adapter boundary.

Live integration tests are skipped automatically unless an OpenBot checkout is found at
`$GENESIS_OPENBOT_DIR` (default `../OpenBot`, tag `v0.1.0`).

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run lint        # eslint
```

Requires Node.js 24+.
