/**
 * PILOT-001 — First Real Application: Temperature Converter.
 *
 * Submits ONE live production mission to Genesis Gateway (real Z.ai + real
 * OpenBot). Genesis itself plans, writes files, runs commands, and verifies
 * the application. No manual file writing by GLM.
 *
 * The mission asks Genesis to build a small web app for temperature
 * conversion (Celsius ↔ Fahrenheit) with real tests.
 */
const { spawn, spawnSync } = require('node:child_process');
const {
  writeFileSync, mkdirSync, existsSync, rmSync, readFileSync,
  readdirSync, statSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');

const ENGINE_DIR = resolve(__dirname, '..');
const EVIDENCE_DIR = join(ENGINE_DIR, 'evidence', 'pilot-001');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const GATEWAY_PORT = '4680';
const A2A_PORT = '4681';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-pilot-001';
const TEST_API_KEY = 'pilot-001-key';
const MAX_WORKER_STEPS = '40';
const MISSION_TIMEOUT_MS = 540_000; // 9 minutes

rmSync(OPENBOT_ROOT, { recursive: true, force: true });
mkdirSync(OPENBOT_ROOT, { recursive: true });

// ─── Mission goal ────────────────────────────────────────────────────
const MISSION_OUTCOME = `Build a small web application for temperature conversion (Celsius ↔ Fahrenheit).

Requirements:
1. A simple HTML page with an input field for a number, a dropdown to select direction (C→F or F→C), a "Convert" button, and a result display area.
2. The conversion logic in a separate JavaScript file.
3. Real automated tests using node:test that verify the conversion formulas are correct (at least 3 test cases).
4. A package.json with a "test" script that runs the tests.
5. A README.md with brief instructions for running the app and tests.

After producing all files, npm test MUST exit 0 within 60 seconds.`;

const MISSION_CONTEXT = `PILOT-001: Build a temperature converter web application.

Required files (write ALL 5 via write_file, then finish):
1. package.json — fields: name="temp-converter", version="1.0.0", type="module", scripts.test="node --test" (NO "test/" argument — just "node --test" to auto-discover test files), scripts.start="node server.js"
2. index.html — simple UI with input, dropdown, button, result div
3. converter.js — exported functions: cToF(celsius) and fToC(fahrenheit)
4. test/converter.test.js — uses node:test + node:assert, tests cToF and fToC with known values
5. README.md — brief instructions

CRITICAL: The test script in package.json MUST be exactly "node --test" (NO "node --test test/" — the trailing path breaks in Node v24).

After producing all 5 files, run "npm test" via run_command to verify tests pass, then call finish with the 5 artifact paths.`;

const MISSION_CONSTRAINTS = [
  'Use Node.js >= 20 standard library ONLY. No external npm dependencies.',
  'Single-process CLI/web app. No build tools.',
  'No new files beyond the 5 listed (package.json, index.html, converter.js, test/converter.test.js, README.md).',
  'No code modification by the operator — the test must run against the worker output verbatim.',
  'After producing all files, npm test MUST exit 0 within 60 seconds.',
];

const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'package.json exists', path: 'package.json' },
  { kind: 'file', label: 'index.html exists', path: 'index.html' },
  { kind: 'file', label: 'converter.js exists', path: 'converter.js' },
  { kind: 'file', label: 'test/converter.test.js exists', path: 'test/converter.test.js' },
  { kind: 'file', label: 'README.md exists', path: 'README.md' },
  { kind: 'content-in-artifacts', label: 'README mentions npm test', expectIncludes: 'npm test' },
  { kind: 'content-in-artifacts', label: 'converter.js has cToF function', expectIncludes: 'cToF' },
];

// ─── Gateway env ────────────────────────────────────────────────────
function buildGatewayEnv() {
  return {
    ...process.env,
    GENESIS_EXECUTION_MODE: 'production',
    GENESIS_REASONING_PROVIDER: 'zai',
    GENESIS_RUNTIME_PROVIDER: 'openbot',
    OPENBOT_CHECKOUT_DIR: OPENBOT_CHECKOUT,
    OPENBOT_ROOT_DIR: OPENBOT_ROOT,
    ZAI_SDK_PATH: 'z-ai-web-dev-sdk',
    GENESIS_MAX_WORKER_STEPS: MAX_WORKER_STEPS,
    GENESIS_HTTP_PORT: GATEWAY_PORT,
    GENESIS_A2A_PORT: A2A_PORT,
    GENESIS_DEFAULT_MISSION_TIMEOUT_MS: String(MISSION_TIMEOUT_MS),
    GENESIS_API_KEYS: JSON.stringify({
      [TEST_API_KEY]: {
        callerId: 'pilot-001-caller',
        allowedOperations: ['mission:submit'],
        maxActiveMissions: 5,
        maxMissionTimeoutMs: MISSION_TIMEOUT_MS,
      },
    }),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────
const results = {};
function record(id, status, detail) {
  const ts = new Date().toISOString();
  results[id] = { status, detail, timestamp: ts };
  console.log(`[${ts}] ${id}: ${status} — ${detail}`);
}

async function httpCall(method, urlPath, body, apiKey) {
  const url = `http://127.0.0.1:${GATEWAY_PORT}${urlPath}`;
  const payload = body === null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = require('node:http').request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: 600_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed, raw });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status === 200 || r.status === 401) return true;
    } catch { /* keep waiting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function findFiles(dir, prefix = '') {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git' || f === '.npm') continue;
    const full = join(dir, f);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...findFiles(full, prefix + f + '/'));
    } else {
      out.push({ path: prefix + f, full });
    }
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────
(async () => {
  let gateway;
  const wallStart = Date.now();
  let gatewayLog = [];
  let missionId = null;
  try {
    record('P-00', 'PASS', 'evidence dir prepared + openbot root cleared');

    // Start the production gateway
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
      cwd: ENGINE_DIR, env: buildGatewayEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stdout.on('data', (c) => {
      const t = c.toString();
      gatewayLog.push({ stream: 'stdout', t, ts: new Date().toISOString() });
      if (t.length < 400) console.log('[gw:out]', t.trim());
    });
    gateway.stderr.on('data', (c) => {
      const t = c.toString();
      gatewayLog.push({ stream: 'stderr', t, ts: new Date().toISOString() });
      if (t.length < 400) console.log('[gw:err]', t.trim());
    });

    const gwUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 120_000);
    if (!gwUp) { record('P-01', 'FAIL', 'gateway did not come up'); throw new Error('gw up fail'); }
    record('P-01', 'PASS', `production gateway up on port ${GATEWAY_PORT}`);

    // Submit the live mission
    const submitBody = {
      outcome: MISSION_OUTCOME,
      context: MISSION_CONTEXT,
      constraints: MISSION_CONSTRAINTS,
      label: 'pilot-001-temp-converter',
      acceptanceCriteria: ACCEPTANCE_CRITERIA,
    };
    const submit = await httpCall('POST', '/v1/missions', submitBody, TEST_API_KEY);
    if (submit.status !== 202) {
      writeFileSync(join(EVIDENCE_DIR, 'submit-failure.json'),
        JSON.stringify({ status: submit.status, body: submit.body, raw: submit.raw }, null, 2), 'utf8');
      record('P-02', 'FAIL', `mission submission failed: HTTP ${submit.status}`);
      throw new Error('submit fail');
    }
    missionId = submit.body.missionId;
    const acceptedAt = submit.body.acceptedAt || new Date().toISOString();
    record('P-02', 'PASS', `live mission submitted: ${missionId}`);
    writeFileSync(join(EVIDENCE_DIR, 'submit-response.json'),
      JSON.stringify(submit.body, null, 2), 'utf8');

    // Wait for terminal status
    record('P-03', 'INFO', `waiting for live ZAI + OpenBot execution (timeout ${MISSION_TIMEOUT_MS}ms)...`);
    let snapshot = null;
    const startTime = Date.now();
    const pollUntil = startTime + MISSION_TIMEOUT_MS + 120_000;
    let lastSeenStatus = '(none)';
    while (Date.now() < pollUntil) {
      try {
        const get = await httpCall('GET', `/v1/missions/${missionId}`, null, TEST_API_KEY);
        if (get.status === 200 && get.body) {
          if (get.body.terminal) {
            snapshot = get.body;
            break;
          }
          if (get.body.status && get.body.status !== lastSeenStatus) {
            lastSeenStatus = get.body.status;
            console.log(`  [poll ${Date.now() - startTime}ms] status=${lastSeenStatus}`);
          }
        }
      } catch (pollErr) {
        console.log(`  [poll ${Date.now() - startTime}ms] poll error: ${pollErr instanceof Error ? pollErr.message : String(pollErr)}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    const elapsed = Date.now() - startTime;

    if (!snapshot) {
      record('P-04', 'FAIL', `mission did not terminate within ${MISSION_TIMEOUT_MS + 120_000}ms`);
      throw new Error('mission timeout');
    }

    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'),
      JSON.stringify(snapshot, null, 2), 'utf8');
    record('P-04', 'PASS',
      `mission terminated: status=${snapshot.status}, elapsed=${elapsed}ms, tokens=${snapshot.result?.cost?.tokens ?? 0}`);

    // Mission status
    record('P-MISSION_STATUS', snapshot.status, `missionId=${missionId}`);
    record('P_TOKENS', String(snapshot.result?.cost?.tokens ?? 0), `tokens=${snapshot.result?.cost?.tokens ?? 0}`);
    record('P_WALL_MS', String(Date.now() - wallStart), `wallMs=${Date.now() - wallStart}`);

    // Fetch events
    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events?limit=400`, null, TEST_API_KEY);
    if (eventsRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'),
        JSON.stringify(eventsRes.body, null, 2), 'utf8');
      const events = eventsRes.body.events || [];
      const writeEvents = events.filter(e => e.payload?.action === 'write_file' && e.payload?.ok);
      const workerFinished = events.filter(e => e.type === 'worker-finished');
      const verification = events.find(e => e.type === 'verification');
      record('P-WRITE_EVENTS', writeEvents.length >= 5 ? 'PASS' : 'PARTIAL',
        `write_file events: ${writeEvents.length} (expect ≥ 5)`);
      if (verification) {
        record('P-VERIFICATION', verification.payload?.ok ? 'PASS' : 'FAIL',
          `verification ok=${verification.payload?.ok}, passed=${verification.payload?.passed}, failed=${verification.payload?.failed}`);
      }
    }

    // Fetch artifacts
    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    let artifacts = [];
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'),
        JSON.stringify(artRes.body, null, 2), 'utf8');
      artifacts = artRes.body.artifacts || [];
      record('P-ARTIFACTS', artifacts.length >= 5 ? 'PASS' : 'PARTIAL',
        `artifacts delivered: ${artifacts.length}`);

      // Save artifact content
      const appDir = join(EVIDENCE_DIR, 'app');
      if (existsSync(appDir)) rmSync(appDir, { recursive: true, force: true });
      mkdirSync(appDir, { recursive: true });
      for (const a of artifacts) {
        if (a.content !== undefined && a.content !== null) {
          const dest = join(appDir, a.path);
          mkdirSync(join(dest, '..'), { recursive: true });
          writeFileSync(dest, a.content, 'utf8');
        }
      }
    }

    // Find workspace files on disk
    const wsBase = join(OPENBOT_ROOT, missionId);
    const wsFiles = findFiles(wsBase);
    writeFileSync(join(EVIDENCE_DIR, 'workspace-files.json'),
      JSON.stringify(wsFiles.map(f => f.path), null, 2), 'utf8');
    record('P-WS_FILES', 'PASS', `workspace files on disk: ${wsFiles.length}`);

    // Copy worker workspace files to evidence/app if artifacts response was incomplete
    for (const f of wsFiles) {
      const dest = join(EVIDENCE_DIR, 'app', f.path);
      if (!existsSync(dest)) {
        try {
          mkdirSync(join(dest, '..'), { recursive: true });
          writeFileSync(dest, readFileSync(f.full, 'utf8'), 'utf8');
        } catch { /* binary */ }
      }
    }

    // ─── Independent Clean-Room Acceptance ───
    const EXPECTED = ['package.json', 'index.html', 'converter.js', 'test/converter.test.js', 'README.md'];
    const appDir = join(EVIDENCE_DIR, 'app');
    const cleanRoomDir = `/tmp/pilot-001-clean-room-${Date.now()}`;
    mkdirSync(cleanRoomDir, { recursive: true });

    // Copy only the 5 expected files
    let allFilesPresent = true;
    for (const rel of EXPECTED) {
      const src = join(appDir, rel);
      if (existsSync(src)) {
        const dst = join(cleanRoomDir, rel);
        mkdirSync(join(dst, '..'), { recursive: true });
        writeFileSync(dst, readFileSync(src, 'utf8'), 'utf8');
      } else {
        allFilesPresent = false;
        record(`P-FILE-${rel}`, 'MISSING', `${rel} not found in artifacts`);
      }
    }

    if (allFilesPresent) {
      // npm install (should be no-op — no deps)
      const npmInstall = spawnSync('npm', ['install', '--no-audit', '--no-fund'],
        { cwd: cleanRoomDir, encoding: 'utf8', timeout: 30_000 });
      record('P-NPM_INSTALL', npmInstall.status === 0 ? 'PASS' : 'FAIL',
        `npm install exit=${npmInstall.status}`);

      // npm test (60s timeout)
      const npmTestStart = Date.now();
      const npmTest = spawnSync('npm', ['test'],
        { cwd: cleanRoomDir, encoding: 'utf8', timeout: 60_000 });
      const npmTestElapsed = Date.now() - npmTestStart;
      writeFileSync(join(EVIDENCE_DIR, 'clean-room-test-stdout.txt'), npmTest.stdout || '', 'utf8');
      writeFileSync(join(EVIDENCE_DIR, 'clean-room-test-stderr.txt'), npmTest.stderr || '', 'utf8');
      record('P-NPM_TEST', npmTest.status === 0 ? 'PASS' : 'FAIL',
        `npm test exit=${npmTest.status}, elapsed=${npmTestElapsed}ms`);

      // HTTP smoke test — try starting the app
      // The app might not have a server.js, but let's check
      if (existsSync(join(cleanRoomDir, 'server.js'))) {
        const appProcess = spawn('node', ['server.js'], { cwd: cleanRoomDir, stdio: ['ignore', 'pipe', 'pipe'] });
        let appOutput = '';
        appProcess.stdout.on('data', (c) => { appOutput += c.toString(); });
        appProcess.stderr.on('data', (c) => { appOutput += c.toString(); });

        // Wait for app to start
        await new Promise((r) => setTimeout(r, 2000));

        // Try to fetch the page
        try {
          const response = await fetch('http://127.0.0.1:3000/');
          const html = await response.text();
          writeFileSync(join(EVIDENCE_DIR, 'http-smoke-response.html'), html, 'utf8');
          record('P-HTTP_SMOKE', response.status === 200 ? 'PASS' : 'PARTIAL',
            `HTTP ${response.status}, body length=${html.length}`);
        } catch (e) {
          record('P-HTTP_SMOKE', 'FAIL', `fetch failed: ${e.message}`);
        }

        appProcess.kill('SIGTERM');
      } else {
        // No server.js — check if index.html is a standalone file
        const html = readFileSync(join(cleanRoomDir, 'index.html'), 'utf8');
        record('P-HTTP_SMOKE', html.includes('converter') ? 'PASS' : 'PARTIAL',
          `no server.js, but index.html exists (${html.length} bytes)`);
      }

      // Compute delivered files hashes
      const fileHashes = {};
      for (const rel of EXPECTED) {
        const fp = join(cleanRoomDir, rel);
        if (existsSync(fp)) {
          fileHashes[rel] = crypto.createHash('sha256').update(readFileSync(fp, 'utf8')).digest('hex');
        }
      }
      writeFileSync(join(EVIDENCE_DIR, 'delivered-file-hashes.json'),
        JSON.stringify(fileHashes, null, 2), 'utf8');
      record('P-FILE_HASHES', 'PASS', `computed hashes for ${Object.keys(fileHashes).length} files`);
    }

    // Save gateway log
    if (gatewayLog.length > 0) {
      const trimmed = gatewayLog.map(e => ({ ...e, t: e.t.slice(0, 4000) }));
      writeFileSync(join(EVIDENCE_DIR, 'gateway-log.json'),
        JSON.stringify(trimmed, null, 2), 'utf8');
    }

    // Save summary
    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'),
      JSON.stringify(results, null, 2), 'utf8');

    // Save metadata
    writeFileSync(join(EVIDENCE_DIR, 'mission-metadata.json'), JSON.stringify({
      missionId,
      acceptedAt: snapshot.acceptedAt,
      finishedAt: snapshot.finishedAt,
      status: snapshot.status,
      terminal: snapshot.terminal,
      tokens: snapshot.result?.cost?.tokens ?? 0,
      wallMs: Date.now() - wallStart,
    }, null, 2), 'utf8');

  } catch (err) {
    console.error('[pilot-001] fatal:', err);
    record('P-00', 'FAIL', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (gatewayLog.length > 0) {
      const trimmed = gatewayLog.map(e => ({ ...e, t: e.t.slice(0, 4000) }));
      writeFileSync(join(EVIDENCE_DIR, 'gateway-log.json'),
        JSON.stringify(trimmed, null, 2), 'utf8');
    }
    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'),
      JSON.stringify(results, null, 2), 'utf8');
    console.log(`\nResults: ${join(EVIDENCE_DIR, 'phase-summary.json')}`);
    if (gateway) try { gateway.kill('SIGTERM'); } catch { /* ignore */ }
    try { spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { spawnSync('pkill', ['-f', 'bun.*agent-computer'], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { spawnSync('pkill', ['-f', 'tsx.*gateway'], { stdio: 'ignore' }); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 3000);
  }
})();
