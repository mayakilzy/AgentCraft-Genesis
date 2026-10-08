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
| `GENESIS_REASONING_PROVIDER` | `zai` (currently the only supported real provider) |
| `ZAI_API_KEY` or `ZAI_SDK_PATH` | ZAI credentials (one required when provider=zai) |

### Production Mode — Runtime Provider

Required when `GENESIS_EXECUTION_MODE=production`:

| Variable | Description |
|---|---|
| `GENESIS_RUNTIME_PROVIDER` | `openbot` (memory is NOT allowed in production) |
| `OPENBOT_ENDPOINT` | OpenBot server URL (required when provider=openbot) |
| `OPENBOT_TOKEN` | OpenBot auth token (optional) |
| `OPENBOT_CHECKOUT_DIR` | Git checkout directory (default: /tmp/openbot-checkout) |
| `OPENBOT_ROOT_DIR` | OpenBot root directory (default: /tmp/openbot-root) |

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
- Missing `OPENBOT_ENDPOINT` when `GENESIS_RUNTIME_PROVIDER=openbot` → gateway refuses to start.

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
export OPENBOT_ENDPOINT="http://your-openbot-server:port"
export GENESIS_API_KEYS='{"prod-key":{"callerId":"prod-app","allowedOperations":["mission:submit"],"maxActiveMissions":10,"maxMissionTimeoutMs":120000}}'
npx tsx src/gateway/main.ts
```

## Secret Hygiene

- Never commit real credentials to the repository.
- The `secure/` directory is gitignored.
- API keys are never logged (only the first 4 characters appear in demos).
- The `GENESIS_API_KEYS` env var is read at startup and not persisted.
- Remote Git URLs contain no tokens (verified after push).
