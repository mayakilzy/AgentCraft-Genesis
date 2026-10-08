# Genesis Engine v1 — Configuration

**Version:** 0.1.0 (Release Candidate)

## Environment Variables

### Required (all modes)

| Variable | Description | Default |
|---|---|---|
| `GENESIS_API_KEYS` | JSON map of API key → caller config. **REQUIRED.** Fail-closed if missing. | none |

### Execution Mode

| Variable | Description | Default |
|---|---|---|
| `GENESIS_EXECUTION_MODE` | `development` or `production`. In production, real providers are required and fail-closed. | `development` |

### Network

| Variable | Description | Default |
|---|---|---|
| `GENESIS_HTTP_HOST` | HTTP API listen host | `127.0.0.1` |
| `GENESIS_HTTP_PORT` | HTTP API listen port | `4180` |
| `GENESIS_A2A_HOST` | A2A server listen host | `127.0.0.1` |
| `GENESIS_A2A_PORT` | A2A server listen port | `4181` |
| `GENESIS_A2A_BASE_URL` | Public base URL for A2A AgentCard | `http://127.0.0.1:4181` |

### Production Mode — Reasoning Provider

Required when `GENESIS_EXECUTION_MODE=production`:

| Variable | Description |
|---|---|
| `GENESIS_REASONING_PROVIDER` | `zai` (real LLM) or `stub` (controlled-stub, test-only — see below) |
| `ZAI_API_KEY` or `ZAI_SDK_PATH` | ZAI credentials (one required when provider=zai) |

### Production Mode — Runtime Provider

Required when `GENESIS_EXECUTION_MODE=production`:

| Variable | Description |
|---|---|
| `GENESIS_RUNTIME_PROVIDER` | `openbot` (real worker runtime) or `stub` (controlled-stub, test-only — see below). `memory` is NOT allowed in production. |
| `OPENBOT_CHECKOUT_DIR` | Path to the local OpenBot git checkout (required when provider=openbot) |
| `OPENBOT_ROOT_DIR` | Directory for per-worker workspaces (required when provider=openbot) |
| `OPENBOT_TOKEN` | OpenBot auth token (optional) |

### Controlled-Stub Providers (G6-08 Phase 2 — Test Only)

For production-mode positive-path integration tests, two controlled-stub
providers are registered in the production code path:

| Variable | Value | Description |
|---|---|---|
| `GENESIS_REASONING_PROVIDER` | `stub` | Writes one deterministic artifact. NOT a real LLM. Clearly labeled in startup logs. |
| `GENESIS_RUNTIME_PROVIDER` | `stub` | Constructs a fresh `MemoryRuntime` per mission (satisfies `ArtifactsProvider`). NOT real OpenBot. Clearly labeled in startup logs. |

These stub providers exercise the actual Gateway → MissionService →
Orchestrator → Runtime → Verification → Artifact production wiring
without real external services. They exist for integration tests and
are explicitly labeled as `⚠️ USING CONTROLLED-STUB ... PROVIDER` in
startup logs. They are NOT a substitute for real ZAI/OpenBot.

### Optional — Agent Card

| Variable | Description | Default |
|---|---|---|
| `GENESIS_AGENT_NAME` | A2A AgentCard name | `AgentCraft Genesis Gateway` |
| `GENESIS_AGENT_DESCRIPTION` | A2A AgentCard description | (auto-generated) |

## API Key Configuration

`GENESIS_API_KEYS` is a JSON object mapping API keys to caller configs:

```json
{
  "my-api-key": {
    "callerId": "my-application",
    "allowedOperations": ["mission:submit"],
    "maxActiveMissions": 5,
    "maxMissionTimeoutMs": 60000
  }
}
```

- `callerId`: Stable identifier for the caller (used for isolation).
- `allowedOperations`: Operations this caller may invoke. `mission:submit` is required to submit missions.
- `maxActiveMissions`: Maximum concurrent active missions for this caller.
- `maxMissionTimeoutMs`: Maximum mission timeout this caller can request.

## Fail-Closed Behavior

- Missing `GENESIS_API_KEYS` → gateway refuses to start.
- `GENESIS_EXECUTION_MODE=production` without `GENESIS_REASONING_PROVIDER` → gateway refuses to start.
- `GENESIS_EXECUTION_MODE=production` without `GENESIS_RUNTIME_PROVIDER` → gateway refuses to start.
- `GENESIS_RUNTIME_PROVIDER=memory` in production → gateway refuses to start.
- Missing ZAI credentials when `GENESIS_REASONING_PROVIDER=zai` → gateway refuses to start.
- Missing `OPENBOT_CHECKOUT_DIR` when `GENESIS_RUNTIME_PROVIDER=openbot` → gateway refuses to start.
- Missing `OPENBOT_ROOT_DIR` when `GENESIS_RUNTIME_PROVIDER=openbot` → gateway refuses to start.

## Safe Example Configuration

```bash
# Development mode (safe for local testing)
export GENESIS_EXECUTION_MODE=development
export GENESIS_API_KEYS='{"dev-key":{"callerId":"dev","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}'
npx tsx src/gateway/main.ts

# Production mode (requires real providers)
export GENESIS_EXECUTION_MODE=production
export GENESIS_REASONING_PROVIDER=zai
export ZAI_API_KEY="your-real-api-key"
export GENESIS_RUNTIME_PROVIDER=openbot
export OPENBOT_CHECKOUT_DIR="/path/to/openbot-checkout"
export OPENBOT_ROOT_DIR="/path/to/per-worker-workspaces"
export GENESIS_API_KEYS='{"prod-key":{"callerId":"prod-app","allowedOperations":["mission:submit"],"maxActiveMissions":10,"maxMissionTimeoutMs":120000}}'
npx tsx src/gateway/main.ts

# Production mode with controlled-stub providers (TEST ONLY — not for real production)
export GENESIS_EXECUTION_MODE=production
export GENESIS_REASONING_PROVIDER=stub
export GENESIS_RUNTIME_PROVIDER=stub
export GENESIS_API_KEYS='{"test-key":{"callerId":"test","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}'
npx tsx src/gateway/main.ts
```

## Secret Hygiene

- Never commit real credentials to the repository.
- The `.secure/` directory is gitignored (see `.gitignore`).
- API keys are never logged (only the first 4 characters appear in demos).
- The `GENESIS_API_KEYS` env var is read at startup and not persisted.
- Remote Git URLs contain no tokens (verified after push).
- Token files (`*.token`) and local env overrides (`*.env.local`) are gitignored.
