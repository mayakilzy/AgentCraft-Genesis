#!/bin/bash
# G6-06 — Clean-room reproduction script.
#
# Clones the repository into a fresh /tmp directory, installs dependencies
# from the lockfile, and runs typecheck + lint + tests + smoke mission +
# gateway startup. Verifies the engine is reproducible from clean source.
#
# Usage:
#   bash experiments/g6-06/clean-room-run.sh <COMMIT_SHA> [OUTPUT_DIR]
#
# If OUTPUT_DIR is not provided, defaults to /tmp/g6-06-cleanroom-<PID>.

set -euo pipefail

COMMIT="${1:-HEAD}"
OUTPUT_DIR="${2:-/tmp/g6-06-cleanroom-$$}"

REPO_URL="https://github.com/mayakilzy/AgentCraft-Genesis.git"

echo "=== G6-06 Clean-Room Reproduction ==="
echo "Commit: $COMMIT"
echo "Output: $OUTPUT_DIR"
echo ""

# Clean up any previous run.
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Step 1: Clone the repository.
echo "=== Step 1: Clone ==="
git clone --quiet "$REPO_URL" "$OUTPUT_DIR/repo"
cd "$OUTPUT_DIR/repo"
git checkout --quiet "$COMMIT"
ACTUAL_HEAD=$(git rev-parse HEAD)
echo "Cloned. HEAD=$ACTUAL_HEAD"

# Step 2: Verify clean worktree.
echo "=== Step 2: Worktree status ==="
WORKTREE_STATUS=$(git status --short)
if [ -z "$WORKTREE_STATUS" ]; then
  echo "Worktree: CLEAN"
else
  echo "Worktree: DIRTY"
  echo "$WORKTREE_STATUS"
  exit 1
fi

# Step 3: Record environment.
echo "=== Step 3: Environment ==="
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
LOCKFILE_HASH=$(sha256sum package-lock.json | awk '{print $1}')
echo "Node: $NODE_VERSION"
echo "npm:  $NPM_VERSION"
echo "Lockfile SHA256: $LOCKFILE_HASH"

# Step 4: Install dependencies.
echo "=== Step 4: Install (npm ci) ==="
npm ci 2>&1 | tail -5

# Step 5: Typecheck.
echo "=== Step 5: Typecheck ==="
npm run typecheck 2>&1 | tail -3
TYPECHECK_EXIT=$?
echo "Typecheck exit: $TYPECHECK_EXIT"

# Step 6: Lint.
echo "=== Step 6: Lint ==="
npm run lint 2>&1 | tail -3
LINT_EXIT=$?
echo "Lint exit: $LINT_EXIT"

# Step 7: Tests.
echo "=== Step 7: Tests ==="
npm test 2>&1 | grep -E "Test Files|Tests " | tail -2
TESTS_EXIT=$?
echo "Tests exit: $TESTS_EXIT"

# Step 8: Smoke mission (G6-04 deterministic).
echo "=== Step 8: Smoke mission ==="
npx tsx experiments/g6-04/smoke-mission.ts 2>&1 | tail -5
SMOKE_EXIT=$?
echo "Smoke exit: $SMOKE_EXIT"

# Step 9: Gateway startup (development mode).
echo "=== Step 9: Gateway startup ==="
# Get free ports.
HTTP_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()")
A2A_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()")

# G6-08 (RB-3): spawn the gateway in its own process group with setsid so
# SIGTERM reaches the actual gateway process (and any descendants like the
# bun processes spawned by OpenBot workers), not just the npx parent.
# Without this, `kill $GATEWAY_PID` kills only the npx parent and leaves
# the gateway grandchild orphaned on the listening port — a false-positive
# clean-room PASS that masks real regressions.
GENESIS_EXECUTION_MODE=development \
GENESIS_HTTP_HOST=127.0.0.1 \
GENESIS_HTTP_PORT=$HTTP_PORT \
GENESIS_A2A_HOST=127.0.0.1 \
GENESIS_A2A_PORT=$A2A_PORT \
GENESIS_A2A_BASE_URL=http://127.0.0.1:$A2A_PORT \
GENESIS_API_KEYS='{"cleanroom-key":{"callerId":"cleanroom-caller","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}' \
setsid npx tsx src/gateway/main.ts &
GATEWAY_PID=$!

# Wait for readiness.
READY=0
for i in $(seq 1 20); do
  if curl -s "http://127.0.0.1:$HTTP_PORT/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" = "1" ]; then
  echo "Gateway: READY (health check passed)"
  # Quick mission submission test.
  MISSION_RES=$(curl -s -X POST "http://127.0.0.1:$HTTP_PORT/v1/missions" \
    -H "Authorization: Bearer cleanroom-key" \
    -H "Content-Type: application/json" \
    -d '{"outcome":"Write a markdown file named output.md at the workspace root with the content # Genesis gateway output as the sole body."}')
  MISSION_ID=$(echo "$MISSION_RES" | python3 -c "import json,sys; print(json.load(sys.stdin).get('missionId','NONE'))" 2>/dev/null || echo "NONE")
  echo "Mission submitted: $MISSION_ID"
  GATEWAY_EXIT=0
else
  echo "Gateway: FAILED to start"
  GATEWAY_EXIT=1
fi

# G6-08 (RB-3): kill the entire process GROUP (negative PID = process group),
# not just the parent. This terminates the gateway grandchild, the npx parent,
# and any descendant processes (bun, Chromium for browser surface, etc.) that
# were spawned with the same session ID via setsid.
# Grace period: SIGTERM, wait up to 3s for clean exit, then SIGKILL.
kill -TERM -$GATEWAY_PID 2>/dev/null || kill -TERM $GATEWAY_PID 2>/dev/null || true
for i in $(seq 1 30); do
  if ! kill -0 -$GATEWAY_PID 2>/dev/null && ! kill -0 $GATEWAY_PID 2>/dev/null; then
    break
  fi
  sleep 0.1
done
kill -KILL -$GATEWAY_PID 2>/dev/null || kill -KILL $GATEWAY_PID 2>/dev/null || true
wait $GATEWAY_PID 2>/dev/null || true

# G6-08 (RB-3): assert no orphan gateway processes remain.
ORPHANS=$(pgrep -f "src/gateway/main.ts" 2>/dev/null || true)
if [ -n "$ORPHANS" ]; then
  echo "WARN: orphaned gateway processes detected (PIDs: $ORPHANS)"
  # Best-effort cleanup.
  for orphan in $ORPHANS; do
    kill -KILL "$orphan" 2>/dev/null || true
  done
  GATEWAY_EXIT=2  # signal that orphans were detected
fi

# Step 10: Summary.
echo ""
echo "=== Summary ==="
cat <<EOF
{
  "commit": "$ACTUAL_HEAD",
  "node_version": "$NODE_VERSION",
  "npm_version": "$NPM_VERSION",
  "lockfile_sha256": "$LOCKFILE_HASH",
  "typecheck": "$([ $TYPECHECK_EXIT -eq 0 ] && echo PASS || echo FAIL)",
  "lint": "$([ $LINT_EXIT -eq 0 ] && echo PASS || echo FAIL)",
  "tests": "$([ $TESTS_EXIT -eq 0 ] && echo PASS || echo FAIL)",
  "smoke": "$([ $SMOKE_EXIT -eq 0 ] && echo PASS || echo FAIL)",
  "gateway_startup": "$([ $GATEWAY_EXIT -eq 0 ] && echo PASS || echo FAIL)",
  "overall": "$([ $TYPECHECK_EXIT -eq 0 ] && [ $LINT_EXIT -eq 0 ] && [ $TESTS_EXIT -eq 0 ] && [ $SMOKE_EXIT -eq 0 ] && [ $GATEWAY_EXIT -eq 0 ] && echo PASS || echo FAIL)"
}
EOF

# Clean up.
cd /
rm -rf "$OUTPUT_DIR"
echo "Clean-room directory removed."
