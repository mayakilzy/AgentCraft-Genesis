#!/usr/bin/env python3
"""
G7-08A — Clean-Room Reproduction Runner

Reproduces the AgentCraft Genesis G7 product experience from a fresh clone
of the `fix/g7-08-reproducibility` branch. Runs:
  - Engine: npm ci, tsc --noEmit, eslint ., vitest run
  - Web:    npm ci, tsc --noEmit, eslint ., next build
  - G7 tests: all 7 test families (102 tests total)

The runner is phased to avoid the port-collision issue identified during
G7-08 (multiple test families spawn their own gateway on port 4180):

  Phase 1 — Unit tests (no servers needed):
    g7-02-auth-gate-unit-tests.ts        (20 tests)
    g7-04-artifacts-unit-tests.ts        (20 tests)
    g7-05-studio-unit-tests.ts           (15 tests)

  Phase 2 — BFF only (no gateway):
    g7-01-closure-tests.ts               (12 tests, expects 503 when gateway down)

  Phase 3 — BFF + external gateway:
    g7-02-auth-gate-tests.ts             (14 tests)

  Phase 4 — BFF only (test scripts spawn their own gateway):
    g7-02-e2e-submission.ts              (8 tests)
    g7-04-artifacts-e2e-tests.ts         (13 tests)

Total: 102 tests.

Usage:
    python3 scripts/g7_08_cleanroom_runner.py [--repo <path>] [--logs <dir>]

Defaults:
    --repo : current working directory (must be the repo root)
    --logs : ./g7-08-logs (relative to --repo)

Prerequisites:
    - Node.js >= 24
    - npm >= 11
    - Python 3.9+
    - The repo must be cloned at the desired commit BEFORE running.
    - The runner does NOT modify source files in the clone.

Exit codes:
    0  — all checks passed
    1  — at least one check failed
    2  — runner error (could not start a process, etc.)

Windows equivalent:
    This script is Python and runs on Windows unchanged. The npm/npx/tsx
    commands invoked are the same on Windows (use PowerShell or cmd.exe).
    See G7-08A_Windows_Launch_Guide.md for manual Windows startup steps.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

GATEWAY_API_KEY = "g7-controlled-key-local"

GATEWAY_ENV_OVERLAY = {
    "GENESIS_EXECUTION_MODE": "development",
    "GENESIS_HTTP_HOST": "127.0.0.1",
    "GENESIS_HTTP_PORT": "4180",
    "GENESIS_A2A_HOST": "127.0.0.1",
    "GENESIS_A2A_PORT": "4181",
    "GENESIS_API_KEYS": json.dumps({
        GATEWAY_API_KEY: {
            "callerId": "g7-ui",
            "allowedOperations": [
                "mission:submit", "mission:read", "mission:cancel",
                "mission:result", "mission:artifacts", "mission:events",
            ],
            "maxActiveMissions": 5,
            "maxMissionTimeoutMs": 60000,
        }
    }),
}

WEB_ENV_OVERLAY = {
    "GENESIS_HTTP_URL": "http://127.0.0.1:4180",
    "GENESIS_API_KEY": GATEWAY_API_KEY,
    "GENESIS_OPERATOR_PIN": "dev-local-pin",
    "GENESIS_BFF_SECRET": "dev-bff-secret-for-controlled-environment-only-not-for-production",
    "GENESIS_BFF_TIMEOUT_MS": "30000",
    "NEXT_PUBLIC_GENESIS_MODE": "controlled",
    "NODE_ENV": "development",
}

# (script, expected_count, label, phase)
TEST_FAMILIES = [
    ("g7-02-auth-gate-unit-tests.ts", 20, "G7-02 auth unit", 1),
    ("g7-04-artifacts-unit-tests.ts", 20, "G7-04 artifacts unit", 1),
    ("g7-05-studio-unit-tests.ts", 15, "G7-05 studio unit", 1),
    ("g7-01-closure-tests.ts", 12, "G7-01 closure (no gateway)", 2),
    ("g7-02-auth-gate-tests.ts", 14, "G7-02 auth E2E (BFF+gateway)", 3),
    ("g7-02-e2e-submission.ts", 8, "G7-02 submission E2E (own gateway)", 4),
    ("g7-04-artifacts-e2e-tests.ts", 13, "G7-04 artifacts E2E (own gateway)", 4),
]


def log(msg: str) -> None:
    print(msg, flush=True)


def wait_for_url(url: str, timeout_s: int = 60, label: str = "") -> bool:
    """Return True if the URL responds with any HTTP status < 500."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status < 500:
                    return True
        except urllib.error.HTTPError as e:
            # 401 is "ready" — proves the route handler is loaded.
            if e.code < 500:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    if label:
        log(f"  [FAIL] {label} did not become ready within {timeout_s}s")
    return False


def run_command(
    cmd: list[str],
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: int = 300,
    log_path: Path | None = None,
) -> tuple[int, str]:
    """Run a command, capture output, return (exit_code, combined_output)."""
    full_env = {**os.environ, **(env or {})}
    if log_path:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(log_path, "w", encoding="utf-8")
        try:
            proc = subprocess.run(
                cmd, cwd=str(cwd), env=full_env,
                stdout=fh, stderr=subprocess.STDOUT,
                timeout=timeout,
            )
            fh.flush()
            output = log_path.read_text(encoding="utf-8", errors="replace")
            return proc.returncode, output
        except subprocess.TimeoutExpired:
            fh.flush()
            output = log_path.read_text(encoding="utf-8", errors="replace")
            return 124, output + "\n[TIMEOUT]"
        finally:
            fh.close()
    else:
        proc = subprocess.run(
            cmd, cwd=str(cwd), env=full_env,
            capture_output=True, text=True, timeout=timeout,
        )
        return proc.returncode, proc.stdout + proc.stderr


def start_process(
    cmd: list[str],
    cwd: Path,
    env: dict[str, str] | None,
    log_path: Path,
) -> subprocess.Popen:
    """Start a long-running process in a new session."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(log_path, "w", encoding="utf-8")
    full_env = {**os.environ, **(env or {})}
    proc = subprocess.Popen(
        cmd, cwd=str(cwd), env=full_env,
        stdout=fh, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    proc._log_fh = fh  # type: ignore[attr-defined]
    return proc


def stop_process(proc: subprocess.Popen, timeout: int = 10) -> None:
    """Stop a process started by start_process (kills the whole session)."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=timeout)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    try:
        proc._log_fh.close()  # type: ignore[attr-defined]
    except Exception:
        pass


def parse_test_summary(output: str) -> tuple[int, int]:
    """Extract (passed, failed) from a G7 test script's output."""
    for line in output.splitlines():
        line = line.strip()
        if "passed" in line and "failed" in line:
            m = re.search(r"(\d+)\s*/\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?", line)
            if m:
                passed = int(m.group(1))
                failed = int(m.group(3)) if m.group(3) else (int(m.group(2)) - int(m.group(1)))
                return passed, max(0, failed)
    return 0, 0


def run_test_family(
    script: str, expected: int, label: str, repo: Path, logs: Path
) -> dict:
    log_path = logs / f"{script.replace('.ts', '.log')}"
    env = {"GENESIS_API_KEY": GATEWAY_API_KEY}
    exit_code, output = run_command(
        ["npx", "tsx", f"scripts/{script}"],
        cwd=repo, env=env, timeout=300, log_path=log_path,
    )
    passed, failed = parse_test_summary(output)
    status = "PASS" if failed == 0 and passed == expected else "FAIL"
    log(f"  [{status}] {label}: {passed}/{expected} passed, {failed} failed (exit {exit_code})")
    return {
        "script": script,
        "label": label,
        "expected": expected,
        "passed": passed,
        "failed": failed,
        "status": status,
        "exit_code": exit_code,
        "log": log_path.name,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="G7-08A clean-room reproduction runner")
    ap.add_argument("--repo", default=".", help="Path to the repo root (default: cwd)")
    ap.add_argument("--logs", default="g7-08-logs", help="Directory for log files (default: ./g7-08-logs)")
    ap.add_argument("--skip-engine", action="store_true", help="Skip engine install/typecheck/lint/vitest")
    ap.add_argument("--skip-build", action="store_true", help="Skip web production build")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    logs = (repo / args.logs).resolve() if not Path(args.logs).is_absolute() else Path(args.logs).resolve()
    logs.mkdir(parents=True, exist_ok=True)
    web = repo / "web"

    if not (repo / "package.json").exists():
        log(f"[FAIL] {repo}/package.json not found. Is this the repo root?")
        return 2
    if not (web / "package.json").exists():
        log(f"[FAIL] {web}/package.json not found. Was G7-08 applied?")
        return 2

    head_sha = run_command(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        cwd=repo, timeout=10,
    )[1].strip()
    log(f"=== G7-08A Clean-Room Reproduction ===")
    log(f"Repo:  {repo}")
    log(f"Logs:  {logs}")
    log(f"HEAD:  {head_sha}")
    log("")

    results: dict[str, list] = {
        "engine": [],
        "web": [],
        "tests": [],
    }

    # --- Engine checks ---
    if not args.skip_engine:
        log("=" * 60)
        log("ENGINE CHECKS")
        log("=" * 60)

        log("\n[engine] npm ci ...")
        ec, out = run_command(["npm", "ci", "--no-audit", "--no-fund"], cwd=repo, timeout=180)
        (logs / "engine-npm-ci.log").write_text(out, encoding="utf-8")
        results["engine"].append({"step": "npm_ci", "exit": ec, "log": "engine-npm-ci.log"})
        log(f"  [{'PASS' if ec == 0 else 'FAIL'}] exit {ec}")

        log("\n[engine] tsc --noEmit ...")
        ec, out = run_command(["npx", "tsc", "--noEmit"], cwd=repo, timeout=120)
        (logs / "engine-tsc.log").write_text(out, encoding="utf-8")
        results["engine"].append({"step": "typecheck", "exit": ec, "log": "engine-tsc.log"})
        log(f"  [{'PASS' if ec == 0 else 'FAIL'}] exit {ec}")

        log("\n[engine] eslint . ...")
        ec, out = run_command(["npx", "eslint", "."], cwd=repo, timeout=120)
        (logs / "engine-eslint.log").write_text(out, encoding="utf-8")
        results["engine"].append({"step": "lint", "exit": ec, "log": "engine-eslint.log"})
        log(f"  [{'PASS' if ec == 0 else 'FAIL'}] exit {ec}")

        log("\n[engine] vitest run ...")
        ec, out = run_command(["npx", "vitest", "run"], cwd=repo, timeout=300)
        (logs / "engine-vitest.log").write_text(out, encoding="utf-8")
        results["engine"].append({"step": "vitest", "exit": ec, "log": "engine-vitest.log"})
        log(f"  [{'PASS' if ec == 0 else 'FAIL'}] exit {ec}")

    # --- Web checks ---
    log("\n" + "=" * 60)
    log("WEB CHECKS")
    log("=" * 60)

    log("\n[web] npm ci ...")
    ec, out = run_command(["npm", "ci", "--no-audit", "--no-fund"], cwd=web, timeout=300)
    (logs / "web-npm-ci.log").write_text(out, encoding="utf-8")
    results["web"].append({"step": "npm_ci", "exit": ec, "log": "web-npm-ci.log"})
    log(f"  [{'PASS' if ec == 0 else 'FAIL'}] exit {ec}")

    log("\n[web] tsc --noEmit ...")
    ec, out = run_command(["npx", "tsc", "--noEmit"], cwd=web, timeout=120)
    (logs / "web-tsc.log").write_text(out, encoding="utf-8")
    results["web"].append({"step": "typecheck", "exit": ec, "log": "web-tsc.log"})
    log(f"  [{'PASS' if ec == 0 else 'FAIL'}] exit {ec}")

    log("\n[web] eslint . (npm run lint) ...")
    ec, out = run_command(["npm", "run", "lint"], cwd=web, timeout=120)
    (logs / "web-eslint.log").write_text(out, encoding="utf-8")
    results["web"].append({"step": "lint", "exit": ec, "log": "web-eslint.log"})
    log(f"  [{'PASS' if ec == 0 else 'FAIL'}] exit {ec}")

    if not args.skip_build:
        log("\n[web] next build (npm run build) ...")
        ec, out = run_command(["npm", "run", "build"], cwd=web, timeout=300)
        (logs / "web-build.log").write_text(out, encoding="utf-8")
        results["web"].append({"step": "build", "exit": ec, "log": "web-build.log"})
        log(f"  [{'PASS' if ec == 0 else 'FAIL'}] exit {ec}")

    # --- G7 test families (phased) ---
    log("\n" + "=" * 60)
    log("G7 TEST FAMILIES (102 total, phased to avoid port collisions)")
    log("=" * 60)

    # Phase 1: unit tests (no servers)
    log("\n--- Phase 1: unit tests (no servers) ---")
    for script, expected, label, phase in TEST_FAMILIES:
        if phase != 1:
            continue
        results["tests"].append(run_test_family(script, expected, label, repo, logs))

    # Phase 2: BFF only (no gateway) — G7-01 closure expects gateway DOWN
    log("\n--- Phase 2: BFF only (no gateway) ---")
    web_proc = start_process(
        ["npm", "run", "dev"], cwd=web, env=WEB_ENV_OVERLAY,
        log_path=logs / "web-dev-phase2.log",
    )
    try:
        if not wait_for_url("http://localhost:3000/api/genesis/health", 90, "BFF (phase 2)"):
            log("  [FAIL] BFF did not start for phase 2")
            return 1
        log("  BFF ready (no gateway running)")
        for script, expected, label, phase in TEST_FAMILIES:
            if phase == 2:
                results["tests"].append(run_test_family(script, expected, label, repo, logs))
    finally:
        stop_process(web_proc)
        time.sleep(2)

    # Phase 3: BFF + external gateway
    log("\n--- Phase 3: BFF + external gateway ---")
    gw_proc = start_process(
        ["npx", "tsx", "src/gateway/main.ts"], cwd=repo, env=GATEWAY_ENV_OVERLAY,
        log_path=logs / "gateway-phase3.log",
    )
    web_proc = start_process(
        ["npm", "run", "dev"], cwd=web, env=WEB_ENV_OVERLAY,
        log_path=logs / "web-dev-phase3.log",
    )
    try:
        if not wait_for_url("http://127.0.0.1:4180/health", 30, "Gateway (phase 3)"):
            return 1
        if not wait_for_url("http://localhost:3000/api/genesis/health", 90, "BFF (phase 3)"):
            return 1
        log("  Gateway + BFF ready")
        for script, expected, label, phase in TEST_FAMILIES:
            if phase == 3:
                results["tests"].append(run_test_family(script, expected, label, repo, logs))
    finally:
        stop_process(web_proc)
        stop_process(gw_proc)
        time.sleep(2)

    # Phase 4: BFF only (test scripts spawn their own gateway)
    log("\n--- Phase 4: BFF only (test scripts spawn their own gateway) ---")
    web_proc = start_process(
        ["npm", "run", "dev"], cwd=web, env=WEB_ENV_OVERLAY,
        log_path=logs / "web-dev-phase4.log",
    )
    try:
        if not wait_for_url("http://localhost:3000/api/genesis/health", 90, "BFF (phase 4)"):
            return 1
        log("  BFF ready (no external gateway)")
        for script, expected, label, phase in TEST_FAMILIES:
            if phase == 4:
                results["tests"].append(run_test_family(script, expected, label, repo, logs))
    finally:
        stop_process(web_proc)
        time.sleep(2)

    # --- Summary ---
    log("\n" + "=" * 60)
    log("SUMMARY")
    log("=" * 60)

    engine_fail = sum(1 for r in results["engine"] if r["exit"] != 0)
    web_fail = sum(1 for r in results["web"] if r["exit"] != 0)
    tests_pass = sum(r["passed"] for r in results["tests"])
    tests_fail = sum(r["failed"] for r in results["tests"])
    tests_expected = sum(r["expected"] for r in results["tests"])

    log(f"\nEngine: {len(results['engine']) - engine_fail}/{len(results['engine'])} steps passed")
    log(f"Web:    {len(results['web']) - web_fail}/{len(results['web'])} steps passed")
    log(f"Tests:  {tests_pass}/{tests_expected} passed, {tests_fail} failed")

    log(f"\n{'Script':<40} {'Expected':>10} {'Passed':>10} {'Failed':>10} {'Status':>8}")
    log("-" * 80)
    for r in results["tests"]:
        log(f"{r['script']:<40} {r['expected']:>10} {r['passed']:>10} {r['failed']:>10} {r['status']:>8}")
    log("-" * 80)
    log(f"{'TOTAL':<40} {tests_expected:>10} {tests_pass:>10} {tests_fail:>10}")

    summary = {
        "head_sha": head_sha,
        "repo": str(repo),
        "engine": results["engine"],
        "web": results["web"],
        "tests": results["tests"],
        "totals": {
            "engine_steps_passed": len(results["engine"]) - engine_fail,
            "engine_steps_total": len(results["engine"]),
            "web_steps_passed": len(results["web"]) - web_fail,
            "web_steps_total": len(results["web"]),
            "tests_passed": tests_pass,
            "tests_failed": tests_fail,
            "tests_expected": tests_expected,
        },
    }
    (logs / "G7-08A_Test_Results.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    log(f"\nResults saved to {logs / 'G7-08A_Test_Results.json'}")

    overall_pass = (engine_fail == 0 and web_fail == 0 and tests_fail == 0 and tests_pass == tests_expected)
    log(f"\nOVERALL: {'PASS' if overall_pass else 'FAIL'}")
    return 0 if overall_pass else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("\n[INTERRUPTED]")
        sys.exit(130)
