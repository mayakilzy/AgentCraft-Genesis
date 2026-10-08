# Genesis Engine v1 — Security Boundaries

**Version:** 0.1.0 (Release Candidate)

## Authentication

**Mechanism:** Bearer API key in the `Authorization` header.

```
Authorization: Bearer <api-key>
```

- API keys are configured at startup via `GENESIS_API_KEYS` (JSON map).
- Comparison uses `timingSafeEqual` (constant-time).
- Deny-by-default: no anonymous submission.
- Fail-closed: gateway refuses to start without `GENESIS_API_KEYS`.
- No credentials in URLs, logs, or error messages.

**Limitation:** API-key only. No mTLS, no OAuth, no signed Agent Cards.

## Authorization

**Mechanism:** Caller-scoped mission access.

Every mission carries the submitting caller's `callerId`. All
operations enforce caller ownership:

- **Mission access:** `requireMission(missionId, caller)` checks `callerId` match. Cross-caller → 404 (not 403, to avoid leaking existence).
- **Event access:** Caller-scoped. Cross-caller → 404.
- **Artifact access:** Caller-scoped. Cross-caller → 404.
- **Cancellation:** Caller-scoped. Cross-caller → 404 (HTTP) or task-state-without-cancel (A2A).
- **A2A CancelTask:** P1-A2A-CANCELTASK-NO-CALLER-AUTHZ fixed in G6-06 — the executor verifies `currentRequestCaller.callerId` matches `binding.callerId` before cancelling.

**Resource limits:**
- `maxActiveMissions` per caller (default 5).
- `maxMissionTimeoutMs` per caller (default 60,000ms).
- Global cap: 50 active missions (configurable).

## Isolation

### Cross-Caller Isolation

- Mission registry keyed by `missionId` + `callerId`.
- No caller can read, cancel, or retrieve artifacts from another caller's mission.
- Cross-caller access returns 404 (MissionNotFoundError) — not 403 — to avoid leaking mission existence.

### Path Traversal Protection

- `getArtifacts()` filters paths containing `..` or starting with `/`.
- Mission IDs from URL paths are used only as Map keys, never as filesystem paths.
- The regex `[^/]+` for missionId segments structurally prevents `/` in the path segment.

## Secret Hygiene

### Flight Recorder Secret Redaction

`SECRET_PATTERNS` in `src/mission/flight-recorder.ts` covers:
- Bearer headers
- GitHub PATs (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`)
- OpenAI keys (`sk-`, `sk-proj-`)
- Anthropic keys (`sk-ant-`)
- AWS access key IDs (`AKIA...`)
- Generic env-var patterns (`TOKEN=`, `SECRET=`, `PASSWORD=`, `API_KEY=`)

### No Secrets in Public Responses

- API keys are never logged (only first 4 chars in demo scripts).
- Error messages carry variable NAMES, never VALUES.
- Flight events are redacted: `text`, `contents`, `prompt`, `response` fields are stripped from the public event stream.

### No Secrets Committed

- The `secure/` directory is gitignored.
- No test fixtures contain real credentials.
- Remote Git URLs contain no tokens (verified after push).

## Threat Model (G6-06 Section 14)

| Threat | Mitigation |
|--------|------------|
| Unauthorized submission | 401 (API key required) |
| Cross-caller data access | 404 (callerId scoping) |
| Cross-caller cancellation | 404 (HTTP) / task-state-without-cancel (A2A, fixed in G6-06) |
| Path traversal | Filtered (`..`, `/`); regex `[^/]+` |
| Oversized payloads | Connection reset or 400 (1MB limit) |
| Malformed JSON | 400 |
| Replay/duplicate | Idempotency key returns existing missionId |
| Unbounded mission creation | `maxActiveMissions` + global cap (50) |
| Unauthorized tool requests | N/A (gateway exposes only the goal) |
| Prompt injection | Goals passed as `Goal.outcome`; orchestrator governance handles safety |
| Secret leakage | Flight events redacted; error messages carry names not values |
| Incorrect A2A status mapping | Tested in `a2a-inbound.test.ts`; PARTIAL → FAILED (not COMPLETED) |
| False-success propagation | Tested in `e2e.test.ts` (FAIL-01); `verified` flag based on actual VerificationResult |
| Service restart | In-process state lost; documented as UNSUPPORTED |

## Remaining Security Limitations

1. **API-key only** — no mTLS, OAuth, signed cards, or JWT.
2. **Single-process** — no inter-process isolation.
3. **No rate limiting** — admission control is count-based, not rate-based.
4. **No audit log** — flight events are per-mission, not a global audit trail.
5. **No secret rotation** — API keys are static; rotation requires restart.

These are documented release limitations, not G6-06 defects.
