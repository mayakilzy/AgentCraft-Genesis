# Genesis Engine v1 — Install and Run

**Version:** 0.1.0 (Release Candidate)

## Prerequisites

- **Node.js** ≥ 24 (tested on v24.21.0)
- **npm** ≥ 11 (tested on 11.19.0)
- **Git** (any recent version)
- Internet access for `npm ci` (installs from the public npm registry)

No external services, no credentials, and no network access beyond
`npm ci` and `git clone` are required for the deterministic core.

## Installation

```bash
git clone https://github.com/mayakilzy/AgentCraft-Genesis.git
cd AgentCraft-Genesis
git checkout build/group-06-productionization
git rev-parse HEAD   # record the exact commit
git status           # must be clean
npm ci               # install from lockfile (do NOT use npm install)
```

## Verification

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm test             # vitest run
```

Expected results:
- typecheck: PASS (no output)
- lint: PASS (no output)
- tests: 527 passed, 9 skipped, 536 total

## Smoke Mission

```bash
npx tsx experiments/g6-04/smoke-mission.ts
```

This runs the deterministic smoke mission: Goal → GoalCompiler →
OrganizationPlanner → GenomeCompiler → MissionOrchestrator → WorkerAgent
→ VerificationLoop → MissionResult. Expected: `pass: true`, exit 0.

## Start the Gateway (Development Mode)

```bash
export GENESIS_EXECUTION_MODE=development
export GENESIS_API_KEYS='{"dev-key":{"callerId":"dev","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}'
npx tsx src/gateway/main.ts
```

The gateway logs a banner:
```
[genesis-gateway] EXECUTION MODE: development
[genesis-gateway] ⚠️  USING DEVELOPMENT FIXTURES: MemoryComputer + DEVELOPMENT_REASONING_FALLBACK
[genesis-gateway] ⚠️  This is NOT real AI execution. Do NOT use in production.
[genesis-gateway] HTTP API listening on http://127.0.0.1:4180
[genesis-gateway] A2A inbound listening on http://127.0.0.1:4181
```

## Invoke the Service API

```bash
# Health check
curl http://127.0.0.1:4180/health

# Submit a mission
curl -X POST http://127.0.0.1:4180/v1/missions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"outcome":"Write a markdown file named output.md with the content # Hello"}'

# Poll status (replace MISSION_ID)
curl http://127.0.0.1:4180/v1/missions/MISSION_ID -H "Authorization: Bearer dev-key"

# Get result
curl http://127.0.0.1:4180/v1/missions/MISSION_ID/result -H "Authorization: Bearer dev-key"

# Get artifacts
curl http://127.0.0.1:4180/v1/missions/MISSION_ID/artifacts -H "Authorization: Bearer dev-key"
```

## Start the Gateway (Production Mode)

Production mode requires real reasoning and runtime providers. It fails
closed if they are missing.

```bash
export GENESIS_EXECUTION_MODE=production
export GENESIS_REASONING_PROVIDER=zai
export ZAI_API_KEY="your-real-api-key"
export GENESIS_RUNTIME_PROVIDER=openbot
export OPENBOT_ENDPOINT="http://your-openbot-server:port"
export GENESIS_API_KEYS='{"prod-key":{"callerId":"prod-app","allowedOperations":["mission:submit"],"maxActiveMissions":10,"maxMissionTimeoutMs":120000}}'
npx tsx src/gateway/main.ts
```

If any required provider is missing, the gateway refuses to start:
```
FATAL: GENESIS_EXECUTION_MODE=production requires GENESIS_REASONING_PROVIDER to be set.
```

## Independent Client

```bash
GENESIS_HTTP_URL=http://127.0.0.1:4180 GENESIS_API_KEY=dev-key \
  npx tsx experiments/g6-05a/independent-client.ts
```

## Clean-Room Reproduction

```bash
bash experiments/g6-06/clean-room-run.sh <COMMIT_SHA>
```

This clones the repo into a fresh `/tmp` directory, runs `npm ci`,
typecheck, lint, tests, smoke mission, and gateway startup. Verifies
the engine is reproducible from clean source.

## Known Limitations

- In-process state only; no durability across restart.
- API-key authentication only; no mTLS/OAuth/signed cards.
- Development mode uses MemoryComputer + scripted reasoning (not real AI).
- Polling only; no SSE/WebSocket streaming.
- Single-process; no horizontal scaling.

See `docs/release/engine-v1-known-limitations.md` for the full list.
