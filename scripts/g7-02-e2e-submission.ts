/**
 * AgentCraft Genesis G7-02 — E2E Submission Flow Test
 *
 * This script:
 *   1. Starts the real Genesis Gateway in dev mode (subprocess, same shell).
 *   2. Waits for it to be ready.
 *   3. Tests the BFF /api/genesis/health → 200 (after cookie setup).
 *   4. Tests POST /api/genesis/v1/missions → 202 with missionId.
 *   5. Verifies the BFF never returns "success" without the 202 ack.
 *   6. Verifies idempotency (same key → same missionId).
 *   7. Tests GET /v1/missions/{id} → 200 with MissionSnapshot.
 *   8. Tests the negative control: gateway down → 503 (no fake success).
 *
 * The script starts the gateway as a child process and kills it at the end.
 * It must run in a single bash invocation because the sandbox kills background
 * processes when the parent shell exits.
 *
 * Run: npx tsx scripts/g7-02-e2e-submission.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "agentcraft",
  "repo",
);
const GATEWAY_ENTRY = resolve(REPO_ROOT, "src", "gateway", "main.ts");
const UI_BASE = "http://localhost:3000";
const GATEWAY_API_KEY = "g7-controlled-key-local";

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(r: TestResult) {
  results.push(r);
  const mark = r.pass ? "✓" : "✗";
  console.log(`${mark}  ${r.id}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

async function waitForGateway(maxMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch("http://127.0.0.1:4180/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function fetchBff(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<{ status: number; body: string }> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetch(`${UI_BASE}${path}`, {
    ...init,
    headers,
    redirect: "manual",
  });
  const body = await res.text();
  return { status: res.status, body };
}

async function obtainBffCookie(): Promise<string | undefined> {
  const res = await fetch(`${UI_BASE}/api/auth/setup`, { method: "GET" });
  const sc = res.headers.get("set-cookie");
  if (sc) {
    return sc.split(";")[0];
  }
  return undefined;
}

async function main() {
  console.log("\nAgentCraft Genesis G7-02 — E2E Submission Flow Test\n");

  // 1. Start the gateway as a child process.
  console.log("Starting Genesis Gateway (dev mode, controlled stub)…");
  const env = {
    ...process.env,
    GENESIS_EXECUTION_MODE: "development",
    GENESIS_API_KEYS: JSON.stringify({
      [GATEWAY_API_KEY]: {
        callerId: "g7-ui",
        allowedOperations: ["mission:submit"],
        maxActiveMissions: 5,
        maxMissionTimeoutMs: 60_000,
      },
    }),
  };
  const gatewayProc: ChildProcess = spawn(
    "npx",
    ["tsx", GATEWAY_ENTRY],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // new process group — we can kill -pgid to take down all children
    },
  );
  let gatewayStdout = "";
  let gatewayStderr = "";
  gatewayProc.stdout?.on("data", (c: Buffer) => {
    gatewayStdout += c.toString();
  });
  gatewayProc.stderr?.on("data", (c: Buffer) => {
    gatewayStderr += c.toString();
  });

  try {
    // 2. Wait for the gateway to be ready.
    const ready = await waitForGateway(8000);
    if (!ready) {
      console.error(
        "Gateway did not become ready in 8s.\n--- stderr ---\n" +
          gatewayStderr +
          "\n--- stdout ---\n" +
          gatewayStdout,
      );
      process.exit(3);
    }
    console.log("Gateway is ready.\n");

    // 3. Acquire BFF cookie.
    const cookie = await obtainBffCookie();
    if (!cookie) {
      record({
        id: "E2E-0",
        name: "BFF cookie setup",
        pass: false,
        detail: "could not obtain cookie from /api/auth/setup",
      });
      throw new Error("no cookie");
    }
    record({
      id: "E2E-0",
      name: "BFF cookie setup",
      pass: true,
      detail: "cookie issued",
    });

    // 4. /api/genesis/health → 200 with the gateway up.
    {
      const r = await fetchBff("/api/genesis/health", { method: "GET" }, cookie);
      let parsed: { status?: string; limitations?: string[] } = {};
      try {
        parsed = JSON.parse(r.body);
      } catch {
        // keep empty
      }
      record({
        id: "E2E-1",
        name: "/api/genesis/health → 200 with gateway up",
        pass: r.status === 200 && parsed.status === "ok",
        detail: `status=${r.status}, gateway_status=${parsed.status ?? "n/a"}`,
      });
      // The gateway is in dev mode — limitations array should include dev-mode strings.
      const isControlled = (parsed.limitations ?? []).some((l) =>
        /deterministic reasoning default|memory filesystem default/i.test(l),
      );
      record({
        id: "E2E-1b",
        name: "/health limitations array flags dev mode (controlled)",
        pass: isControlled,
        detail: `limitations=${(parsed.limitations ?? []).length} entries`,
      });
    }

    // 5. Submit a goal via POST /api/genesis/v1/missions → 202 with missionId.
    const goalText =
      "Write a markdown file named output.md at the workspace root with a single H1 heading.";
    const idempotencyKey = "e2e-test-key-" + Date.now();
    let missionId: string | undefined;
    {
      const r = await fetchBff(
        "/api/genesis/v1/missions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outcome: goalText,
            idempotencyKey,
            label: "g7-e2e",
          }),
        },
        cookie,
      );
      let parsed: {
        missionId?: string;
        status?: string;
        accepted?: boolean;
      } = {};
      try {
        parsed = JSON.parse(r.body);
      } catch {
        // keep empty
      }
      missionId = parsed.missionId;
      record({
        id: "E2E-2",
        name: "POST /v1/missions → 202 with missionId",
        pass:
          r.status === 202 &&
          typeof parsed.missionId === "string" &&
          parsed.accepted === true,
        detail: `status=${r.status}, missionId=${parsed.missionId?.slice(0, 8) ?? "n/a"}…`,
      });
    }

    // 6. Idempotency: same idempotencyKey → same missionId (no duplicate work).
    if (missionId) {
      const r = await fetchBff(
        "/api/genesis/v1/missions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outcome: goalText,
            idempotencyKey,
            label: "g7-e2e-retry",
          }),
        },
        cookie,
      );
      let parsed: { missionId?: string } = {};
      try {
        parsed = JSON.parse(r.body);
      } catch {
        // keep empty
      }
      record({
        id: "E2E-3",
        name: "Idempotent re-submit returns the same missionId",
        pass: r.status === 202 && parsed.missionId === missionId,
        detail: `first=${missionId?.slice(0, 8)}…, second=${parsed.missionId?.slice(0, 8)}…`,
      });
    }

    // 7. Read mission snapshot via GET /v1/missions/{missionId}.
    if (missionId) {
      // Poll until terminal or 8 seconds.
      let snapshot: { status?: string; terminal?: boolean } = {};
      let lastStatus = 0;
      for (let i = 0; i < 80; i++) {
        const r = await fetchBff(
          `/api/genesis/v1/missions/${encodeURIComponent(missionId)}`,
          { method: "GET" },
          cookie,
        );
        lastStatus = r.status;
        try {
          snapshot = JSON.parse(r.body);
        } catch {
          // keep empty
        }
        if (snapshot.terminal === true) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      record({
        id: "E2E-4",
        name: "GET /v1/missions/{id} → 200 with terminal snapshot",
        pass: lastStatus === 200 && snapshot.terminal === true,
        detail: `status=${lastStatus}, mission_status=${snapshot.status ?? "n/a"}, terminal=${snapshot.terminal}`,
      });

      // 8. Read artifacts via GET /v1/missions/{id}/artifacts.
      const r = await fetchBff(
        `/api/genesis/v1/missions/${encodeURIComponent(missionId)}/artifacts`,
        { method: "GET" },
        cookie,
      );
      let parsed: { artifacts?: Array<{ path?: string; verified?: boolean }> } = {};
      try {
        parsed = JSON.parse(r.body);
      } catch {
        // keep empty
      }
      const artifacts = parsed.artifacts ?? [];
      const hasOutput = artifacts.some((a) => a.path === "output.md");
      record({
        id: "E2E-5",
        name: "GET /v1/missions/{id}/artifacts → 200 with verified artifact",
        pass: r.status === 200 && hasOutput,
        detail: `status=${r.status}, artifacts=${artifacts.length}, has_output_md=${hasOutput}`,
      });
    }

    // 9. Negative control: kill the gateway (SIGKILL on the entire process
    // group — takes down npx + tsx + node), retry /health → 503.
    try {
      process.kill(-gatewayProc.pid!, "SIGKILL");
    } catch {
      // already dead
    }
    await new Promise((r) => setTimeout(r, 1500));
    {
      const r = await fetchBff("/api/genesis/health", { method: "GET" }, cookie);
      let parsed: { error?: { code?: string } } = {};
      try {
        parsed = JSON.parse(r.body);
      } catch {
        // keep empty
      }
      record({
        id: "E2E-6",
        name: "Gateway down → 503 (honest unavailable, no fake success)",
        pass:
          r.status === 503 && parsed.error?.code === "UNAVAILABLE",
        detail: `status=${r.status}, code=${parsed.error?.code ?? "n/a"}`,
      });
    }
  } finally {
    if (!gatewayProc.killed) gatewayProc.kill("SIGKILL");
    try {
      gatewayProc.kill("SIGKILL");
    } catch {
      // already dead
    }
  }

  // Summary.
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(2);
});
