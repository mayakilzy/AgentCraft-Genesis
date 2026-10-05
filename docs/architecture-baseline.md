# AgentCraft Genesis — Architecture Baseline (Locked)

Baseline date: **2026-10-05** · Machine-readable companion: [`data/dependency-baseline.json`](../data/dependency-baseline.json)
Derived from the *Founding Architecture & Research Thesis v0.1 (REISSUED)* — the highest
architectural authority of the project. At any conflict, this file defers to it.

## Verdict

Genesis is a **Goal-to-Organization runtime**: it compiles a human goal into requirements,
designs an organization, compiles worker genomes, routes cognitive resources, runs real
work on real computers, verifies the outcome, and records structured experience.

> Give Genesis a goal. It builds the AI organization needed to achieve it.

Everything else — computers, browsers, shells, memory, Git, tool protocols, UI streaming —
is reused from upstream. **Working behavior before architectural ceremony.**

## Canonical ownership (one owner per domain)

| Domain | Canonical owner | Decision |
| --- | --- | --- |
| Computer / container / browser / shell / workspace / supervisor / basic policy & credentials | **OpenBot** | REUSE (drop duplicates) |
| Durable jobs / plans / checkpoints / leases / retries / receipts | **OpenMuse** (patterns) | REUSE / ADAPT |
| Specialist workspaces (Spaces / Pages) | **OpenDots** | DEFER |
| Threads / memory / channels / basic learning | **CopilotKit Intelligence** | REUSE |
| Agent ↔ UI lifecycle events | **AG-UI 1.0** | REUSE |
| Worker ↔ tools / resources | **MCP (2026-07-28 final)** | REUSE |
| Independent agent ↔ independent agent | **A2A 1.0.0** | DEFER internal use |
| Goal compiler · organization planner · genome compiler · cognitive router | **Genesis** | BUILD |
| Organizational learning | **Genesis** | BUILD LATER |
| Software-engineering coordination | **Genesis** | BUILD THIN LAYER |

## Verified upstream state (2026-10-05)

| Upstream | State | Verified observation |
| --- | --- | --- |
| OpenBot | alpha | latest release **v0.1.0** (2026-10-03, GitHub API); founding doc baseline observed v0.0.15 / Bun 1.3.14 / Playwright Core 1.62.1 |
| OpenMuse | alpha / template | no published releases (GitHub API) |
| OpenDots | template | no published releases (GitHub API); Node 24 |
| CopilotKit Intelligence | production | docs live (overview, automatic learning) |

All 22 canonical links listed in the machine-readable baseline returned HTTP 200 on
2026-10-05.

## Protocol baselines

| Protocol | Version | SDK (npm, verified 2026-10-05) | Probe |
| --- | --- | --- | --- |
| AG-UI | 1.0 | `@ag-ui/core@1.0.1` | **PASS** — [protocol-probe.md](protocol-probe.md) |
| MCP | 2026-07-28 final | `@modelcontextprotocol/sdk@1.32.1` | **PASS** — [protocol-probe.md](protocol-probe.md) |
| A2A | 1.0.0 | `@a2a-js/sdk@1.3.0` | **PASS** (integration deferred) — [protocol-probe.md](protocol-probe.md) |
| Jev | — | none (experimental, unverified access) | deferred |

## Toolchain baseline

Node.js ≥ 24 · TypeScript 5.9.3 · vitest 5.0.3 · ESLint 10.12.0 · typescript-eslint
8.71.0 · yaml 2.9.1. TypeScript 7.0.2 exists on npm but is **not** adopted: typescript-eslint
currently caps at `<6.1.0` (watch item).

## Build boundary (red lines)

First-party code is allowed **only** for: goal-to-organization logic, worker genome
compilation, cognitive/resource routing, thin adapters to upstream capabilities, minimal
runtime coordination not covered upstream, verification/integration glue needed to prove
real work, and structured mission/organization telemetry.

Forbidden by default: rebuilding containers/VM runtimes, browser engines, Git, package
managers, thread stores, memory engines, chat infrastructure, tool/agent/UI protocols,
credential vaults, general-purpose policy engines, audit platforms, vector databases.

## Upgrade policy

No upgrades for novelty. Every upstream upgrade passes adapter/contract tests first.
Alpha upstream stays behind stronger adapter boundaries than stable standards. Roadmap
items and draft SEPs are never treated as shipped capabilities.
