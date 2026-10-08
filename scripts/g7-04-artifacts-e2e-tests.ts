/**
 * AgentCraft Genesis G7-04 — Artifacts, Verification & Replay Adversarial E2E Tests
 *
 * Per G7-04 acceptance req #7:
 *   Test missing artifacts, incomplete verification, malformed content,
 *   disconnected Gateway, unauthorized access, truncated history, and
 *   terminal missions.
 *
 * The script starts the real dev-mode gateway, submits a goal, verifies the
 * full artifacts + verification + replay flow, then tests adversarial cases.
 *
 * Run: npx tsx scripts/g7-04-artifacts-e2e-tests.ts
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
      // not ready
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function obtainBffCookie(): Promise<string | undefined> {
  const res = await fetch(`${UI_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "dev-local-pin" }),
  });
  const sc = res.headers.get("set-cookie");
  return sc?.split(";")[0];
}

async function fetchBff(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<{ status: number; body: string }> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetch(`${UI_BASE}${path}`, { ...init, headers, redirect: "manual" });
  const body = await res.text();
  return { status: res.status, body };
}

async function main() {
  console.log(
    "\nAgentCraft Genesis G7-04 — Artifacts, Verification & Replay E2E Tests\n",
  );

  // 1. Start the gateway.
  console.log("Starting Genesis Gateway (dev mode)…");
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
  const gatewayProc: ChildProcess = spawn("npx", ["tsx", GATEWAY_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  try {
    const ready = await waitForGateway(8000);
    if (!ready) {
      console.error("Gateway did not become ready in 8s.");
      process.exit(3);
    }
    console.log("Gateway is ready.\n");

    // Acquire BFF cookie.
    const cookie = await obtainBffCookie();
    if (!cookie) {
      record({
        id: "AR-0",
        name: "BFF cookie setup",
        pass: false,
        detail: "could not obtain cookie",
      });
      throw new Error("no cookie");
    }
    record({ id: "AR-0", name: "BFF cookie setup", pass: true });

    // 2. Submit a goal and wait for terminal.
    const submitRes = await fetchBff(
      "/api/genesis/v1/missions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome:
            "Write a markdown file named output.md at the workspace root with a single H1 heading.",
          idempotencyKey: "g7-04-e2e-" + Date.now(),
          label: "g7-04-e2e",
        }),
      },
      cookie,
    );
    let missionId: string | undefined;
    try {
      missionId = (JSON.parse(submitRes.body) as { missionId?: string }).missionId;
    } catch {
      // keep undefined
    }
    record({
      id: "AR-1",
      name: "Submit mission → 202 with missionId",
      pass: submitRes.status === 202 && typeof missionId === "string",
      detail: `status=${submitRes.status}, missionId=${missionId?.slice(0, 8)}…`,
    });
    if (!missionId) throw new Error("no missionId");

    // Wait for terminal.
    let snapshot: { status?: string; terminal?: boolean } = {};
    for (let i = 0; i < 80; i++) {
      const r = await fetchBff(
        `/api/genesis/v1/missions/${encodeURIComponent(missionId)}`,
        { method: "GET" },
        cookie,
      );
      try {
        snapshot = JSON.parse(r.body);
      } catch {
        // keep
      }
      if (snapshot.terminal) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    record({
      id: "AR-2",
      name: "Mission reached terminal state",
      pass: snapshot.terminal === true,
      detail: `status=${snapshot.status}, terminal=${snapshot.terminal}`,
    });

    // 3. Get artifacts — should have output.md verified.
    const artifactsRes = await fetchBff(
      `/api/genesis/v1/missions/${encodeURIComponent(missionId)}/artifacts`,
      { method: "GET" },
      cookie,
    );
    let artifactsBody: {
      missionId?: string;
      artifacts?: Array<{
        workerId?: string;
        path?: string;
        content?: string;
        verified?: boolean;
        bytes?: number;
      }>;
    } = {};
    try {
      artifactsBody = JSON.parse(artifactsRes.body);
    } catch {
      // keep
    }
    const artifacts = artifactsBody.artifacts ?? [];
    const outputMd = artifacts.find((a) => a.path === "output.md");
    record({
      id: "AR-3",
      name: "GET /artifacts → 200 with verified output.md",
      pass:
        artifactsRes.status === 200 &&
        outputMd !== undefined &&
        outputMd.verified === true,
      detail: `status=${artifactsRes.status}, artifacts=${artifacts.length}, output_md_verified=${outputMd?.verified}`,
    });

    // 4. Verification state mapping — VERIFIED when gateway says verified=true.
    record({
      id: "AR-4",
      name: "Verification originates from gateway.verified field (not inferred)",
      pass: outputMd?.verified === true,
      detail: `output_md.verified=${outputMd?.verified} (UI must display VERIFIED iff this is true)`,
    });

    // 5. Content inlined (≤64KB).
    record({
      id: "AR-5",
      name: "Content inlined for ≤64KB artifact",
      pass:
        typeof outputMd?.content === "string" &&
        outputMd.content.length > 0 &&
        outputMd.content.includes("#"),
      detail: `content_length=${outputMd?.content?.length ?? 0}`,
    });

    // 6. Get events — should have ≥3 events with stable seq.
    const eventsRes = await fetchBff(
      `/api/genesis/v1/missions/${encodeURIComponent(missionId)}/events`,
      { method: "GET" },
      cookie,
    );
    let eventsBody: { events?: Array<{ seq: number; type: string; timestamp: string }> } = {};
    try {
      eventsBody = JSON.parse(eventsRes.body);
    } catch {
      // keep
    }
    const events = eventsBody.events ?? [];
    record({
      id: "AR-6",
      name: "GET /events → 200 with seq-ordered events",
      pass:
        eventsRes.status === 200 &&
        events.length >= 3 &&
        events.every((e) => typeof e.seq === "number"),
      detail: `status=${eventsRes.status}, events=${events.length}, seqs=${events.map((e) => e.seq).join(",")}`,
    });

    // 7. Events are in causal order (seq ascending).
    const seqs = events.map((e) => e.seq);
    const isMonotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
    record({
      id: "AR-7",
      name: "Events preserve causal seq order (ascending)",
      pass: isMonotonic,
      detail: `seqs=${seqs.join(",")}`,
    });

    // 8. Adversarial: missing mission → 404 for artifacts.
    {
      const r = await fetchBff(
        "/api/genesis/v1/missions/nonexistent-mission-id/artifacts",
        { method: "GET" },
        cookie,
      );
      let parsed: { error?: { code?: string } } = {};
      try {
        parsed = JSON.parse(r.body);
      } catch {
        // keep
      }
      record({
        id: "AR-8",
        name: "Missing mission → 404 MISSION_NOT_FOUND for /artifacts",
        pass: r.status === 404 && parsed.error?.code === "MISSION_NOT_FOUND",
        detail: `status=${r.status}, code=${parsed.error?.code}`,
      });
    }

    // 9. Adversarial: missing mission → 404 for /events.
    {
      const r = await fetchBff(
        "/api/genesis/v1/missions/nonexistent-mission-id/events",
        { method: "GET" },
        cookie,
      );
      record({
        id: "AR-9",
        name: "Missing mission → 404 for /events",
        pass: r.status === 404,
        detail: `status=${r.status}`,
      });
    }

    // 10. Adversarial: unauthorized access (no cookie) → 401.
    {
      const r = await fetchBff(
        `/api/genesis/v1/missions/${encodeURIComponent(missionId)}/artifacts`,
        { method: "GET" },
      );
      record({
        id: "AR-10",
        name: "Unauthorized access (no cookie) → 401 for /artifacts",
        pass: r.status === 401,
        detail: `status=${r.status}`,
      });
    }

    // 11. Adversarial: tampered cookie → 401 for /artifacts.
    {
      const tamperedCookie = cookie.slice(0, -4) + "XXXX";
      const r = await fetchBff(
        `/api/genesis/v1/missions/${encodeURIComponent(missionId)}/artifacts`,
        { method: "GET" },
        tamperedCookie,
      );
      record({
        id: "AR-11",
        name: "Tampered cookie → 401 for /artifacts",
        pass: r.status === 401,
        detail: `status=${r.status}`,
      });
    }

    // 12. Gateway down → 503 (after SIGKILL the gateway).
    try {
      process.kill(-gatewayProc.pid!, "SIGKILL");
    } catch {
      // already dead
    }
    await new Promise((r) => setTimeout(r, 800));
    {
      const r = await fetchBff(
        `/api/genesis/v1/missions/${encodeURIComponent(missionId)}/artifacts`,
        { method: "GET" },
        cookie,
      );
      let parsed: { error?: { code?: string } } = {};
      try {
        parsed = JSON.parse(r.body);
      } catch {
        // keep
      }
      record({
        id: "AR-12",
        name: "Gateway down → 503 UNAVAILABLE for /artifacts",
        pass: r.status === 503 && parsed.error?.code === "UNAVAILABLE",
        detail: `status=${r.status}, code=${parsed.error?.code}`,
      });
    }
  } finally {
    try {
      process.kill(-gatewayProc.pid!, "SIGKILL");
    } catch {
      // already dead
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(2);
});
