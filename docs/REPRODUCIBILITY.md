# Reproducing AgentCraft Genesis

This document describes how a technically competent developer, unfamiliar
with the historical development sessions, can reproduce the AgentCraft
Genesis release-candidate validation from a clean checkout.

## Prerequisites

- **Node.js** ≥ 24 (tested on v24.21.0)
- **npm** ≥ 11 (tested on 11.19.0)
- **Git** (any recent version)
- Internet access for `npm ci` (installs from the public npm registry)
- Read access to the authoritative repository
  `https://github.com/mayakilzy/AgentCraft-Genesis.git` (public)

No external services, no credentials, and no network access beyond
`npm ci` and `git clone` are required for the **deterministic core**
reproducibility proof.

## Supported Runtime

Genesis is an ES module TypeScript engine. The authoritative runtime
is Node.js ≥ 24 with native ESM + `--experimental-strip-types` (or `tsx`
for execution of `.ts` files directly). The `engines` field in
`package.json` enforces `>=24`.

## Clean Checkout

```bash
git clone https://github.com/mayakilzy/AgentCraft-Genesis.git
cd AgentCraft-Genesis
git checkout build/group-06-productionization
git rev-parse HEAD   # record the exact commit
git status          # must be clean
```

## Install

```bash
npm ci
```

`npm ci` installs from the committed `package-lock.json`. Do NOT use
`npm install` — it may mutate the lockfile.

## Configuration

The deterministic core requires **zero** environment variables. The
optional integrations (OpenBot, OpenDots, OpenMuse, GitHub, OpenRouter/Jev,
ZAI SDK) require their respective credentials, but the core Genesis
chain (Goal → Requirements → Organization → Genome → Decision → Worker →
Verification → Outcome) operates without them when given a
`MemoryComputer` and a scripted reasoning provider.

## Validation Commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run
```

Expected output (as of the G6-04 RC candidate commit `cf92318`):
- typecheck: PASS (no output)
- lint: PASS (no output)
- tests: 487 passed, 9 skipped, 496 total

## Core Deterministic Smoke Execution

```bash
npx tsx experiments/g6-04/smoke-mission.ts
```

This runs the smallest meaningful Genesis mission that exercises the
full production causal chain:

```
Goal → GoalCompiler → OrganizationPlanner → GenomeCompiler (with
CognitiveRouter(RuleDecisionProvider) as TierSelector) →
MissionOrchestrator → WorkerAgent (MemoryComputer + scripted
DEVELOPMENT_REASONING_FALLBACK reasoning) → VerificationLoop (clean-room
file check) → MissionResult + MemoryFlightRecorder evidence.
```

The mission writes `hello.md` with content `# Hello from Genesis` to the
in-memory filesystem, then verifies the file exists in the clean-room
copy. Expected output: `pass: true` and exit code 0.

## Clean-Room Reproducibility Run

```bash
# Run #1
bash experiments/g6-04/clean-room-run.sh 1 \
  https://github.com/mayakilzy/AgentCraft-Genesis.git \
  <COMMIT_SHA> \
  /tmp/clean-room-1

# Run #2 (independent — no inherited state from Run #1)
bash experiments/g6-04/clean-room-run.sh 2 \
  https://github.com/mayakilzy/AgentCraft-Genesis.git \
  <COMMIT_SHA> \
  /tmp/clean-room-2
```

Each run:
1. Clones the authoritative repo into a fresh temporary directory
2. Checks out the exact commit
3. Verifies clean worktree
4. Records node/npm/lockfile sha256
5. Runs `npm ci` (clean install from lockfile)
6. Runs typecheck, lint, tests
7. Runs the deterministic smoke mission
8. Emits a JSON evidence blob to stdout
9. Destroys the temporary directory (no inherited state)

The two runs are independent: Run #2 does not see Run #1's `node_modules`,
artifacts, or runtime state.

## Reproducibility Comparison

Compare the two JSON evidence blobs. Semantic dimensions that must match:
- same commit
- same lockfile sha256
- same typecheck/lint/tests status
- same test counts (passed/skipped/total)
- same smoke mission outcome (pass/fail, flight event sequence, verification
  result, mission status, artifact path/content)

Legitimate nondeterminism (does NOT fail reproducibility):
- `probe_at` timestamps (wall-clock time)
- `elapsed_ms` (millisecond-level timing)

## Optional Integrations

The deterministic core does not require these. They are listed for
completeness:

| Integration | Purpose | Credential | Required for Core? |
|-------------|---------|------------|-------------------|
| OpenBot | execution/computer runtime | COMPUTER_TOKEN (per-worker, optional) | NO |
| OpenDots | collaborative workspace | (none) | NO |
| OpenMuse | durable delegated work | (none) | NO |
| GitHub | GitWorkspace operations | GitHub PAT (for push; clone is public) | NO |
| OpenRouter (Decisions API) | Jev Decision Model (optional DecisionProvider) | OPENROUTER_API_KEY (JEV-ONLY scope) | NO |
| ZAI SDK | external LLM reasoning (experiment-001 only) | ZAI_API_KEY or ZAI_SDK_PATH | NO |

## Known Limitations

These are DOCUMENTED_ACCEPTED_LIMITATION, not RC blockers:

- OpenMuse in-flight resume (queued recovery proven; in-flight NOT proven)
- Same-process concurrency (specialists run sequentially in v0.1)
- A2A inbound federation (outbound proven; inbound deferred)
- A2A production authentication (interop evidence uses a local reference agent)
- Jev remains OPTIONAL (production default is RuleDecisionProvider)
- H-07 Runtime unavailable health check (deferred; applies to real OpenBot only)
- H-08 OpenBot disconnect reconnect (deferred; applies to real OpenBot only)

## RC Verification Script

```bash
npm run rc:verify
```

This runs typecheck + lint + tests + the deterministic smoke mission in
the current checkout. It does NOT perform the full clean-room clone
(use `clean-room-run.sh` for that). It is a fast pre-commit sanity check.

## Expected Evidence

The full RC evidence package is at `experiments/g6-04/evidence/`:
- `rc-census.json` — runtime dependency classification
- `clean-room-run-1.json` — Run #1 evidence
- `clean-room-run-2.json` — Run #2 evidence
- `reproducibility-comparison.json` — Run #1 vs Run #2 semantic comparison
- `configuration-matrix.json` — env var audit
- `deferred-hardening-audit.json` — G6-01 deferred P1 items classification
- `failure-probes.json` — failure-behavior probes
- `evidence-consistency-audit.json` — G6-03 evidence reconciliation
- `rc-final-analysis.md` — final analysis

## What This Proves

- The Genesis engine can be taken from its authoritative GitHub
  repository, installed, configured, executed, verified, and reproduced
  in a clean environment without relying on hidden historical state.
- Two independent clean-room runs from the same commit produce
  semantically identical results.
- The deterministic core does not require any external service or
  credential.

## What This Does NOT Prove

- External provider integrations (OpenBot, OpenDots, OpenMuse, real LLM)
  are not exercised by the deterministic smoke mission. Their evidence
  lives in their respective phase-4 experiment packages.
- Jev Decision Model integration is proven in G6-03B but is NOT
  exercised by the deterministic smoke mission (it uses
  RuleDecisionProvider, the production default).
