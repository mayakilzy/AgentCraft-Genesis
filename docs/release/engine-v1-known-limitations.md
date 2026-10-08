# Genesis Engine v1 — Known Limitations

**Version:** 0.1.0 (Release Candidate)

## Critical Limitations (affect release boundary)

### 1. In-Process State Only (RESTART_RECOVERY = UNSUPPORTED)

The gateway maintains mission state in in-process Maps. On process
restart, ALL in-flight missions, events, artifacts, and idempotency
keys are lost. There is no persisted mission registry, no event log,
no artifact store.

**Impact:** No durability. A gateway crash loses all active work.
**Mitigation:** Document as release limitation. Do NOT advertise restart
recovery. G6-07 may evaluate a small persistence reuse (JSONL/SQLite)
if safe.

### 2. Development Mode Defaults (DEVELOPMENT_FIXTURES)

The default `GENESIS_EXECUTION_MODE=development` uses:
- `MemoryComputer` (in-memory filesystem, NOT real OpenBot)
- `DEVELOPMENT_REASONING_FALLBACK` (scripted reasoning, NOT real LLM)

These are development fixtures. They produce deterministic output that
looks like mission results but is NOT real AI execution.

**Impact:** An operator who runs the gateway without setting
`GENESIS_EXECUTION_MODE=production` gets dev fixtures, not real work.
**Mitigation:** The gateway logs a loud banner in development mode.
Production mode fails closed if real providers are missing. The
`/health` endpoint reports the limitation.

### 3. API-Key Authentication Only (A2A_AUTHENTICATION = LIMITED)

Authentication uses opaque API keys with constant-time comparison. No
mTLS, no OAuth, no signed Agent Cards, no JWT.

**Impact:** Suitable for server-to-server; not for browser-facing or
untrusted networks. API keys must be distributed securely out-of-band.
**Mitigation:** Document as release limitation. Do NOT expose the
gateway to untrusted networks without additional transport security.

## Protocol Integration Limitations

### 4. A2A Streaming Not Supported

The A2A AgentCard declares `streaming: false`. The gateway supports
blocking `SendMessage` (returns when the mission completes) and
polling `GetTask`. No SSE streaming of task events.

### 5. A2A Push Notifications Not Supported

The A2A AgentCard declares `pushNotifications: false`. No push
notification configuration is supported.

### 6. MCP — Local Reference Server Only

MCP integration is proven with a local reference MCP server
(`experiments/g5-01-mcp-probe/server.ts`). No real third-party MCP
server has been tested. No universal MCP compatibility claim.

### 7. AG-UI — In-Process Consumer Only

AG-UI event emission is proven with an in-process EventEmitter
consumer. No real third-party AG-UI application has been tested.

## Execution Limitations

### 8. No Real-LLM Learning Evidence

Academy cohorts (G5-04 through G5-08) used `SCRIPTED_REASONING`
(provenance.source=synthetic) throughout. The bounded organizational
learning loop is proven under controlled conditions, NOT with real-LLM
behavioral evidence.

### 9. No In-Flight Recovery (OpenMuse H-22)

OpenMuse durable delegation is proven (Phase 4.8E), but in-flight job
recovery (H-22) is NOT proven. If a durable job fails mid-execution,
recovery is not guaranteed.

### 10. No OpenBot Runtime Health Check (H-07) / Reconnect (H-08)

OpenBot runtime health check and disconnect-reconnect are deferred.
These apply only to real OpenBot, not to the default MemoryComputer.

## Security Limitations

### 11. No Cross-Mission Concurrency Isolation

Specialists run sequentially in v0.1. No parallel execution, no
concurrent mission isolation testing.

### 12. No Production Authentication Beyond API Keys

See limitation #3. The gateway does not verify the identity of the
calling system beyond API-key possession.

## Scalability Limitations

### 13. Single-Process

The gateway runs in a single Node.js process. No horizontal scaling,
no load balancing, no multi-instance coordination.

### 14. Bounded Registry (maxActiveMissionsGlobal = 50)

The in-process registry caps concurrent active missions at 50
(configurable). Terminal missions are evicted from the admission count
but remain in memory until process exit (no LRU eviction in v1).

## What This Release Does NOT Claim

- NOT generally production-certified.
- NOT an enterprise IAM system.
- NOT a multi-region distributed system.
- NOT a replacement for OpenBot/OpenDots/OpenMuse.
- NOT proven to outperform fixed multi-agent systems.
- NOT proven to reduce API costs by a generalizable percentage.
- NOT proven to autonomously build any requested application.

## G6-07 Decision Items

The following are deferred to G6-07 (Deep Hardening):

- Complex restart recovery (persisted mission registry)
- Distributed concurrency and race condition hardening
- Large-scale load testing
- Multi-provider compatibility campaigns
- Extended fault injection
- Major upstream adapter changes
- In-flight recovery (H-22)
- Runtime health checks (H-07, H-08)
- A2A streaming support
- A2A push notification support
- LRU eviction for terminal missions
- Per-artifact verification outcome tracking (partially fixed in G6-06)

**Truth before elegance. Evidence before promotion.**
