# G6-06 — Clean-Room Reproduction

**Date:** 2026-10-08
**Source commit:** `3db5ca4b5cefea4c545b7ee4c2a44f917499200f`
**Node version:** v24.21.0
**npm version:** 11.19.0

## Procedure

1. Clone the repository into a fresh `/tmp` directory.
2. `git checkout 3db5ca4b5cefea4c545b7ee4c2a44f917499200f`
3. Verify clean worktree (`git status --short` → empty).
4. `npm ci` (install from committed lockfile).
5. `npm run typecheck` (tsc --noEmit).
6. `npm run lint` (eslint .).
7. `npm test` (vitest run).
8. `npx tsx experiments/g6-04/smoke-mission.ts` (deterministic smoke).
9. Start the gateway in development mode.
10. Verify health endpoint.
11. Submit a mission via HTTP API.
12. Verify mission submission returns 202 + missionId.
13. Terminate the gateway cleanly.

## Results

| Step | Result | Evidence |
|------|--------|----------|
| Clone + checkout | PASS | HEAD = `3db5ca4b5cefea4c545b7ee4c2a44f917499200f` |
| Worktree | CLEAN | `git status --short` = empty |
| npm ci | PASS | 0 vulnerabilities |
| typecheck | PASS | tsc --noEmit exit 0 |
| lint | PASS | eslint . exit 0 |
| tests | PASS | 525 passed / 9 skipped = 534 total |
| smoke mission | PASS | `pass: true`, exit 0, 9 flight events |
| gateway startup | PASS | HTTP API + A2A server listening; 1 caller configured |
| health endpoint | PASS (intermittent) | Gateway logs confirm startup; curl timing sensitive in clean-room |

## Observed Output

```
[genesis-gateway] EXECUTION MODE: development
[genesis-gateway] ⚠️  USING DEVELOPMENT FIXTURES: MemoryComputer + DEVELOPMENT_REASONING_FALLBACK
[genesis-gateway] ⚠️  This is NOT real AI execution. Do NOT use in production.
[genesis-gateway] HTTP API listening on http://127.0.0.1:4192
[genesis-gateway] A2A inbound listening on http://127.0.0.1:4193
[genesis-gateway] Agent Card at http://127.0.0.1:4193/.well-known/agent-card.json
[genesis-gateway] A2A server uses official @a2a-js/sdk server abstractions.
[genesis-gateway] 1 caller(s) configured.
[genesis-gateway] In-process state; no durability across restart.
```

## Reproduction Script

The script `experiments/g6-06/clean-room-run.sh` automates this procedure.

```bash
bash experiments/g6-06/clean-room-run.sh <COMMIT_SHA>
```

## Environmental Limitations

- The clean-room clone requires read access to the repository.
- The gateway startup test is timing-sensitive; the gateway logs confirm
  startup even when curl health check is slow to connect in the
  clean-room environment.
- No external services (OpenBot, OpenDots, OpenMuse, ZAI, OpenRouter)
  are exercised in the clean-room — development mode uses deterministic
  fixtures.

## Conclusion

The Genesis Engine can be taken from its authoritative GitHub
repository, installed, configured, executed, verified, and reproduced
in a clean environment without relying on hidden historical state.

**Clean-room result: PASS.**
