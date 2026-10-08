# G6-05A — Gateway Public Contract

**Version:** 0.1.0
**Branch:** `build/group-06-productionization`

This document specifies the stable interface external applications use
to invoke Genesis through the Service API and the inbound A2A server.

## 1. Authentication

All mission operations require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <api-key>
```

API keys are configured at gateway startup via the `GENESIS_API_KEYS`
environment variable (a JSON map of key → caller config). There is no
anonymous submission. Deny-by-default. Constant-time comparison.

### Caller Configuration

Each API key maps to a caller identity:

```json
{
  "callerId": "string",
  "allowedOperations": ["mission:submit"],
  "maxActiveMissions": 5,
  "maxMissionTimeoutMs": 60000
}
```

## 2. HTTP Service API

Base URL: `http://<host>:<port>` (default `http://127.0.0.1:4180`)

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | none | Service health + limitations |
| `GET` | `/ready` | none | Readiness probe |
| `POST` | `/v1/missions` | required | Submit a mission |
| `GET` | `/v1/missions/{missionId}` | required | Get mission snapshot |
| `GET` | `/v1/missions/{missionId}/events` | required | Get event stream |
| `GET` | `/v1/missions/{missionId}/result` | required | Get terminal result |
| `GET` | `/v1/missions/{missionId}/artifacts` | required | Get artifacts |
| `POST` | `/v1/missions/{missionId}/cancel` | required | Request cancellation |

### Mission Submission

```http
POST /v1/missions
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "outcome": "Write a markdown file named output.md...",
  "context": "optional background",
  "constraints": ["must contain a single H1 heading"],
  "budget": { "maxUsd": 5, "tier": "default" },
  "idempotencyKey": "optional-caller-supplied-key",
  "label": "optional caller correlation label"
}
```

Response: `202 Accepted`

```json
{
  "missionId": "uuid",
  "status": "RUNNING",
  "accepted": true,
  "links": {
    "self": "/v1/missions/{missionId}",
    "events": "/v1/missions/{missionId}/events",
    "result": "/v1/missions/{missionId}/result",
    "artifacts": "/v1/missions/{missionId}/artifacts",
    "cancel": "/v1/missions/{missionId}/cancel"
  }
}
```

### Mission Status Enum

```text
ACCEPTED               — mission accepted, orchestrator not yet running
RUNNING                — orchestrator in flight
SUCCEEDED              — MissionResult.status='success'
FAILED                 — MissionResult.status='failure'
PARTIAL                — MissionResult.status='partial' (deliverable produced, verification incomplete)
CANCELLATION_REQUESTED — cancel() called; orchestrator unwinding
CANCELLED              — orchestrator returned after cancellation; no deliverable
```

Terminal states: `SUCCEEDED`, `FAILED`, `PARTIAL`, `CANCELLED`.

### Error Format

```json
{
  "error": {
    "code": "UNAUTHENTICATED | FORBIDDEN | ADMISSION_DENIED | MISSION_NOT_FOUND | NOT_FINISHED | INVALID_JSON | INVALID_SUBMISSION | INTERNAL_ERROR | NOT_FOUND",
    "message": "human-readable description",
    "details": {}
  }
}
```

### Idempotency

If `idempotencyKey` is provided, a duplicate submission returns the
existing `missionId` instead of creating new work. Idempotency is
in-memory only; it does NOT survive process restart.

### Timeouts

- Default mission timeout: 60 seconds (configurable).
- Maximum request body size: 1,000,000 bytes (1 MB).
- Maximum events per response: 100.

## 3. A2A Inbound Server

Base URL: `http://<host>:<port>` (default `http://127.0.0.1:4181`)

### Agent Card

```
GET /.well-known/agent-card.json
```

Returns an A2A v1.0 Agent Card declaring:
- `name`: "AgentCraft Genesis Gateway"
- `version`: "1.0.0"
- `capabilities`: `{ streaming: false, pushNotifications: false, extensions: [] }`
- `supportedInterfaces`: `[{ url, protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "" }]`
- `skills`: `[{ id: "genesis-mission", name: "Genesis Mission", ... }]`

### JSON-RPC Endpoint

```
POST /
Content-Type: application/json
Authorization: Bearer <api-key>

{
  "jsonrpc": "2.0",
  "method": "SendMessage | GetTask | CancelTask",
  "params": { ... },
  "id": 1
}
```

### Supported Methods

| Method | Params | Returns |
|--------|--------|---------|
| `SendMessage` | `{ message: { parts: [{ text: "goal" }] } }` | `{ task: { id, status: { state }, ... } }` |
| `GetTask` | `{ id: "taskId" }` | `{ task: { id, status: { state }, artifacts, ... } }` |
| `CancelTask` | `{ id: "taskId" }` | `{ task: { id, status: { state: 5 } } }` |

### TaskState Mapping

| MissionStatus | A2A TaskState | Numeric |
|---------------|---------------|---------|
| `ACCEPTED` | SUBMITTED | 1 |
| `RUNNING` | WORKING | 2 |
| `SUCCEEDED` | COMPLETED | 3 |
| `FAILED` | FAILED | 4 |
| `CANCELLED` | CANCELED | 5 |
| `PARTIAL` | COMPLETED | 3 (with artifact metadata noting partial) |
| `CANCELLATION_REQUESTED` | WORKING | 2 (still unwinding) |

### JSON-RPC Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error (invalid JSON) |
| -32600 | Invalid request (unauthorized) |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |

## 4. Artifacts

Artifacts are the files produced by workers during a mission. They are
retrievable via `GET /v1/missions/{missionId}/artifacts`:

```json
{
  "missionId": "uuid",
  "artifacts": [
    {
      "workerId": "sole-operator-1",
      "path": "output.md",
      "content": "# Genesis gateway output\n...",
      "verified": true,
      "bytes": 42
    }
  ]
}
```

- `content` is inlined when ≤ 64KB; otherwise omitted (caller can
  request a streaming endpoint in a future version).
- `verified` is true when the verification loop ran on the clean-room
  copy. A missing artifact cannot be reported as completed output.
- Path traversal protection: paths containing `..` or starting with `/`
  are rejected.

## 5. Security

### Authentication
- Bearer token (API key) in the `Authorization` header.
- Constant-time comparison via `timingSafeEqual`.
- Deny-by-default; no anonymous submission.
- Fail-closed on missing `GENESIS_API_KEYS` configuration.

### Authorization
- Every mission carries the submitting caller's `callerId`.
- Cross-caller access returns 404 (not 403) to avoid leaking existence.
- `allowedOperations` controls which operations a caller may invoke.
- `maxActiveMissions` enforces per-caller admission control.
- `maxMissionTimeoutMs` caps the timeout a caller can request.

### Threat Model (Section 14)
- Unauthorized submission → 401.
- Cross-caller data access → 404.
- Cross-caller cancellation → 404.
- Path traversal → rejected (paths with `..` or `/` filtered).
- Oversized payloads → connection reset or 400.
- Malformed JSON → 400.
- Replay/duplicate → idempotency key returns existing missionId.
- Unbounded mission creation → `maxActiveMissions` + global cap.
- Unauthorized tool requests → not applicable (gateway exposes only
  the goal; tools are configured at the gateway level, not per-request).
- Prompt injection → goals are passed to the orchestrator as Goal.outcome;
  the orchestrator's governance (not the gateway) handles prompt safety.
- Secret leakage → flight events are redacted (no `text`, `contents`,
  `prompt`, `response` fields exposed in the public event stream).
- Incorrect A2A task status mapping → tested in `a2a-inbound.test.ts`.
- False-success propagation → tested in `e2e.test.ts` (FAIL-01).
- Service restart → in-process state lost; documented as LIMITED.

## 6. Known Limitations

1. **In-process state only.** No durability across process restart.
   Active missions are lost on restart. (RESTART_RECOVERY = LIMITED)
2. **MemoryComputer default runtime.** Real OpenBot requires `runtimeFactory` injection.
3. **DEVELOPMENT_REASONING_FALLBACK default reasoning.** Real LLM requires `reasoningFactory` injection.
4. **API-key authentication only.** No mTLS, no OAuth, no signed Agent Cards.
5. **Polling only.** No SSE/WebSocket streaming for events.
6. **Single-process.** No horizontal scaling.
7. **No inbound federation auth beyond API key.** A2A signed cards not verified.

## 7. Capability Documentation (Section 28)

```text
SERVICE_API = SUPPORTED
A2A_OUTBOUND = SUPPORTED (existing, unchanged)
A2A_INBOUND = SUPPORTED
A2A_AUTHENTICATION = LIMITED (API key only; no mTLS/OAuth/signed cards)
CROSS_CALLER_ISOLATION = VERIFIED
CANCELLATION = VERIFIED (via AbortController; in-flight external actions may not stop)
RESTART_RECOVERY = UNSUPPORTED (in-process state only)
```

## 8. Independent Application Usage

See `experiments/g6-05a/independent-client.ts` for a complete example.
An independent application:

1. Authenticates with an API key.
2. `POST /v1/missions` with a goal.
3. Polls `GET /v1/missions/{id}` until `terminal: true`.
4. Retrieves `GET /v1/missions/{id}/result`.
5. Retrieves `GET /v1/missions/{id}/artifacts`.
6. Verifies the artifact content matches the expected output.

The application uses ONLY the published HTTP contract — no internal
Genesis module imports.

END OF PUBLIC CONTRACT.
