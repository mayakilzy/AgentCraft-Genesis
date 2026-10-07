#!/usr/bin/env bash
# G6-04 — Clean-Room Reproducibility Runner
#
# Performs a single independent clean-room run from the authoritative
# remote repository. Per G6-04 Section 10:
#   - originates from the authoritative remote (not the active dev checkout)
#   - fresh git clone, exact commit, clean install from lockfile
#   - no inherited node_modules / dist / .env / runtime state
#
# Usage:
#   ./experiments/g6-04/clean-room-run.sh <run_id> <repo_url> <commit_sha> <output_dir>
#
# Example:
#   ./experiments/g6-04/clean-room-run.sh 1 \
#     https://github.com/mayakilzy/AgentCraft-Genesis.git \
#     8e76d485af65e18045ceeb7bbbed14d746c13518 \
#     /home/z/my-project/clean-room-1
#
# Output: prints a JSON evidence blob to stdout (captured by the caller).
# Exit code: 0 on PASS, non-zero on FAIL.

set -euo pipefail

RUN_ID="${1:?RUN_ID required}"
REPO_URL="${2:?REPO_URL required}"
COMMIT_SHA="${3:?COMMIT_SHA required}"
OUTPUT_DIR="${4:?OUTPUT_DIR required}"

# Per-repo-directory environment (no inherited env)
ENV_DIR="$(mktemp -d)"
trap "rm -rf '$ENV_DIR' '$OUTPUT_DIR'" EXIT

echo "[g6-04-run-${RUN_ID}] starting clean-room run"
echo "[g6-04-run-${RUN_ID}] repo_url=$REPO_URL"
echo "[g6-04-run-${RUN_ID}] commit=$COMMIT_SHA"
echo "[g6-04-run-${RUN_ID}] output_dir=$OUTPUT_DIR"

# 1. Clone
echo "[g6-04-run-${RUN_ID}] step 1: clone"
git clone --quiet --no-tags "$REPO_URL" "$OUTPUT_DIR"
cd "$OUTPUT_DIR"

# 2. Checkout exact commit
echo "[g6-04-run-${RUN_ID}] step 2: checkout $COMMIT_SHA"
git checkout --quiet "$COMMIT_SHA"
ACTUAL_HEAD=$(git rev-parse HEAD)
if [ "$ACTUAL_HEAD" != "$COMMIT_SHA" ]; then
  echo "[g6-04-run-${RUN_ID}] FAIL: actual HEAD $ACTUAL_HEAD != expected $COMMIT_SHA"
  exit 1
fi
WORKTREE_STATUS=$(git status --short)
if [ -n "$WORKTREE_STATUS" ]; then
  echo "[g6-04-run-${RUN_ID}] FAIL: worktree dirty after clone+checkout"
  echo "$WORKTREE_STATUS"
  exit 1
fi

# 3. Inspect runtime
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
LOCKFILE_SHA256=$(sha256sum package-lock.json | awk '{print $1}')
echo "[g6-04-run-${RUN_ID}] node=$NODE_VERSION npm=$NPM_VERSION lockfile_sha256=$LOCKFILE_SHA256"

# 4. Clean install from lockfile
echo "[g6-04-run-${RUN_ID}] step 4: npm ci"
npm ci --silent --no-fund --no-audit 2>&1 | tail -3

# 5. Typecheck
echo "[g6-04-run-${RUN_ID}] step 5: typecheck"
TYPECHECK_OUTPUT=$(npx tsc --noEmit 2>&1 || true)
if [ -n "$TYPECHECK_OUTPUT" ]; then
  echo "[g6-04-run-${RUN_ID}] TYPECHECK FAIL:"
  echo "$TYPECHECK_OUTPUT"
  TYPECHECK="FAIL"
else
  TYPECHECK="PASS"
fi

# 6. Lint
echo "[g6-04-run-${RUN_ID}] step 6: lint"
LINT_OUTPUT=$(npx eslint . 2>&1 || true)
if [ -n "$LINT_OUTPUT" ]; then
  echo "[g6-04-run-${RUN_ID}] LINT FAIL:"
  echo "$LINT_OUTPUT"
  LINT="FAIL"
else
  LINT="PASS"
fi

# 7. Tests
echo "[g6-04-run-${RUN_ID}] step 7: tests"
TEST_OUTPUT=$(npx vitest run 2>&1 || true)
TEST_SUMMARY=$(echo "$TEST_OUTPUT" | grep -E "Test Files|Tests " | head -2)
TEST_FILES_LINE=$(echo "$TEST_SUMMARY" | grep "Test Files" || echo "Test Files 0 passed (0)")
TESTS_LINE=$(echo "$TEST_SUMMARY" | grep "Tests " || echo "Tests 0 passed | 0 skipped (0)")
TESTS_PASSED=$(echo "$TESTS_LINE" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+' || echo "0")
TESTS_SKIPPED=$(echo "$TESTS_LINE" | grep -oE '[0-9]+ skipped' | head -1 | grep -oE '[0-9]+' || echo "0")
TESTS_TOTAL=$(echo "$TESTS_LINE" | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' || echo "0")
if [ "$TESTS_PASSED" -gt 0 ] && ! echo "$TEST_OUTPUT" | grep -q "FAIL"; then
  TESTS="PASS"
else
  TESTS="FAIL"
fi
echo "[g6-04-run-${RUN_ID}] tests: $TESTS_PASSED passed, $TESTS_SKIPPED skipped, $TESTS_TOTAL total -> $TESTS"

# 8. Smoke mission (deterministic)
echo "[g6-04-run-${RUN_ID}] step 8: smoke mission"
SMOKE_OUTPUT=$(npx tsx experiments/g6-04/smoke-mission.ts 2>&1 || true)
SMOKE_EVIDENCE=$(echo "$SMOKE_OUTPUT" | sed -n '/--- G6-04 SMOKE MISSION EVIDENCE ---/,/--- END EVIDENCE ---/p' | sed '1d;$d')
if [ -z "$SMOKE_EVIDENCE" ]; then
  echo "[g6-04-run-${RUN_ID}] SMOKE FAIL: no evidence blob emitted"
  SMOKE="FAIL"
  SMOKE_PASS=false
else
  SMOKE_PASS=$(echo "$SMOKE_EVIDENCE" | python3 -c "import json,sys; print(str(json.load(sys.stdin).get('pass', False)).lower())" 2>/dev/null || echo "false")
  if [ "$SMOKE_PASS" = "true" ]; then
    SMOKE="PASS"
  else
    SMOKE="FAIL"
  fi
fi
echo "[g6-04-run-${RUN_ID}] smoke: $SMOKE (pass=$SMOKE_PASS)"

# 9. Compute overall result
OVERALL="PASS"
[ "$TYPECHECK" = "PASS" ] || OVERALL="FAIL"
[ "$LINT" = "PASS" ] || OVERALL="FAIL"
[ "$TESTS" = "PASS" ] || OVERALL="FAIL"
[ "$SMOKE" = "PASS" ] || OVERALL="FAIL"

# 10. Emit JSON evidence
cat <<EOF
--- G6-04 CLEAN-ROOM RUN ${RUN_ID} EVIDENCE ---
{
  "run_id": "${RUN_ID}",
  "run_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo_url": "${REPO_URL}",
  "expected_commit": "${COMMIT_SHA}",
  "actual_head": "${ACTUAL_HEAD}",
  "head_match": $([ "$ACTUAL_HEAD" = "$COMMIT_SHA" ] && echo true || echo false),
  "worktree_clean": true,
  "node_version": "${NODE_VERSION}",
  "npm_version": "${NPM_VERSION}",
  "lockfile_sha256": "${LOCKFILE_SHA256}",
  "install_command": "npm ci",
  "typecheck": "${TYPECHECK}",
  "lint": "${LINT}",
  "tests": "${TESTS}",
  "tests_passed": ${TESTS_PASSED},
  "tests_skipped": ${TESTS_SKIPPED},
  "tests_total": ${TESTS_TOTAL},
  "smoke": "${SMOKE}",
  "smoke_evidence": ${SMOKE_EVIDENCE:-null},
  "overall": "${OVERALL}"
}
--- END EVIDENCE ---
EOF

echo "[g6-04-run-${RUN_ID}] overall: $OVERALL"

# Don't exit with the trap'd EXIT removing OUTPUT_DIR until we've printed
trap - EXIT
rm -rf "$ENV_DIR" "$OUTPUT_DIR"
exit $([ "$OVERALL" = "PASS" ] && echo 0 || echo 1)
