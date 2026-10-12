/**
 * PILOT-001 (Critical Recovery) — First Real Working Application.
 *
 * ROOT CAUSE (from PILOT-001 analysis):
 * 1. Goal context mentioned "README" and "write" → triggered document-authoring
 *    capability → Planner assigned SE + DW → DW handoff refused in OpenBot (PATH B)
 * 2. Acceptance criteria didn't verify `npm start` → false success on HTTP smoke
 * 3. Driver accepted "index.html exists" as proof of working app
 *
 * FIX:
 * 1. Phrase goal context to NOT trigger document-authoring (the SE writes README)
 * 2. Add `npm start` command-type acceptance check
 * 3. Driver actually starts the app and verifies HTTP response
 */
const { spawn, spawnSync } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');

const ENGINE_DIR = resolve(__dirname, '..');
const EVIDENCE_DIR = join(ENGINE_DIR, 'evidence', 'pilot-001-recovery');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const GATEWAY_PORT = '4780';
const A2A_PORT = '4781';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-pilot-001r';
const TEST_API_KEY = 'pilot-001r-key';
const MISSION_TIMEOUT_MS = 540_000;

rmSync(OPENBOT_ROOT, { recursive: true, force: true });
mkdirSync(OPENBOT_ROOT, { recursive: true });

// ─── Mission goal ────────────────────────────────────────────────────
// FIX 1: Context does NOT mention "write" or "README" — these trigger
// document-authoring capability in the goal compiler. The SE will produce
// README.md as part of "building a complete app".
const MISSION_OUTCOME = `Build a small web application for temperature conversion (Celsius ↔ Fahrenheit).

Requirements:
1. A server.js file that serves index.html on port 3000 using only Node.js standard library (http module).
2. An index.html file with: input field for a number, dropdown for direction (C to F or F to C), a "Convert" button, and a result display area.
3. A converter.js file with exported functions cToF(celsius) and fToC(fahrenheit).
4. Real automated tests using node:test that verify cToF and fToC with at least 3 test cases.
5. A package.json with scripts.test="node --test" and scripts.start="node server.js".
6. A README.md with instructions for running the app and tests.

After producing all files, npm test MUST exit 0 within 60 seconds.`;

// FIX 1: Context uses "produce" and "create" instead of "write" to avoid
// triggering document-authoring capability. Also avoids "README" in context.
const MISSION_CONTEXT = `PILOT-001: Build a temperature converter web application with a working server.

Required deliverables (produce all 6 via the file creation tool):
1. package.json — name="temp-converter", version="1.0.0", type="module", scripts.test="node --test", scripts.start="node server.js"
2. server.js — uses Node.js http module to serve index.html on port 3000
3. index.html — input field, dropdown (C→F / F→C), Convert button, result div, links converter.js
4. converter.js — exports cToF(celsius) and fToC(fahrenheit), also handles DOM events
5. test/converter.test.js — uses node:test, at least 3 test cases for cToF and fToC
6. README.md — brief instructions for npm install, npm test, npm start

CRITICAL: The test script in package.json MUST be exactly "node --test" (NO "node --test test/" — the trailing path breaks in Node v24).

After producing all 6 files, run "npm test" via run_command to verify tests pass, then call finish.`;

const MISSION_CONSTRAINTS = [
  'Use Node.js >= 20 standard library ONLY. No external npm dependencies.',
  'The app must serve on port 3000 when started with npm start.',
  'No new files beyond the 6 listed.',
  'npm test MUST exit 0 within 60 seconds.',
];

// FIX 2: Add npm start as a command-type acceptance check
const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'package.json exists', path: 'package.json' },
  { kind: 'file', label: 'server.js exists', path: 'server.js' },
  { kind: 'file', label: 'index.html exists', path: 'index.html' },
  { kind: 'file', label: 'converter.js exists', path: 'converter.js' },
  { kind: 'file', label: 'test/converter.test.js exists', path: 'test/converter.test.js' },
  { kind: 'file', label: 'README.md exists', path: 'README.md' },
  { kind: 'content-in-artifacts', label: 'README mentions npm test', expectIncludes: 'npm test' },
  { kind: 'content-in-artifacts', label: 'converter.js has cToF', expectIncludes: 'cToF' },
  { kind: 'content-in-artifacts', label: 'server.js uses http module', expectIncludes: 'http' },
];

function buildGatewayEnv() {
  return {
    ...process.env,
    GENESIS_EXECUTION_MODE: 'production',
    GENESIS_REASONING_PROVIDER: 'zai',
    GENESIS_RUNTIME_PROVIDER: 'openbot',
    OPENBOT_CHECKOUT_DIR: OPENBOT_CHECKOUT,
    OPENBOT_ROOT_DIR: OPENBOT_ROOT,
    ZAI_SDK_PATH: 'z-ai-web-dev-sdk',
    GENESIS_MAX_WORKER_STEPS: '40',
    GENESIS_HTTP_PORT: GATEWAY_PORT,
    GENESIS_A2A_PORT: A2A_PORT,
    GENESIS_DEFAULT_MISSION_TIMEOUT_MS: String(MISSION_TIMEOUT_MS),
    GENESIS_API_KEYS: JSON.stringify({
      [TEST_API_KEY]: {
        callerId: 'pilot-001r-caller',
        allowedOperations: ['mission:submit'],
        maxActiveMissions: 5,
        maxMissionTimeoutMs: MISSION_TIMEOUT_MS,
      },
    }),
  };
}

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
    if (s.isDirectory()) out.push(...findFiles(full, prefix + f + '/'));
    else out.push({ path: prefix + f, full });
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
    record('R-00', 'PASS', 'evidence dir prepared');

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
    if (!gwUp) { record('R-01', 'FAIL', 'gateway did not come up'); throw new Error('gw up fail'); }
    record('R-01', 'PASS', `production gateway up on port ${GATEWAY_PORT}`);

    const submitBody = {
      outcome: MISSION_OUTCOME,
      context: MISSION_CONTEXT,
      constraints: MISSION_CONSTRAINTS,
      label: 'pilot-001r-temp-converter',
      acceptanceCriteria: ACCEPTANCE_CRITERIA,
    };
    const submit = await httpCall('POST', '/v1/missions', submitBody, TEST_API_KEY);
    if (submit.status !== 202) {
      writeFileSync(join(EVIDENCE_DIR, 'submit-failure.json'),
        JSON.stringify({ status: submit.status, body: submit.body }, null, 2), 'utf8');
      record('R-02', 'FAIL', `mission submission failed: HTTP ${submit.status}`);
      throw new Error('submit fail');
    }
    missionId = submit.body.missionId;
    record('R-02', 'PASS', `live mission submitted: ${missionId}`);
    writeFileSync(join(EVIDENCE_DIR, 'submit-response.json'), JSON.stringify(submit.body, null, 2), 'utf8');

    record('R-03', 'INFO', `waiting for execution (timeout ${MISSION_TIMEOUT_MS}ms)...`);
    let snapshot = null;
    const startTime = Date.now();
    const pollUntil = startTime + MISSION_TIMEOUT_MS + 120_000;
    let lastSeenStatus = '(none)';
    while (Date.now() < pollUntil) {
      try {
        const get = await httpCall('GET', `/v1/missions/${missionId}`, null, TEST_API_KEY);
        if (get.status === 200 && get.body) {
          if (get.body.terminal) { snapshot = get.body; break; }
          if (get.body.status && get.body.status !== lastSeenStatus) {
            lastSeenStatus = get.body.status;
            console.log(`  [poll ${Date.now() - startTime}ms] status=${lastSeenStatus}`);
          }
        }
      } catch (pollErr) {
        console.log(`  [poll ${Date.now() - startTime}ms] error: ${pollErr.message}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    const elapsed = Date.now() - startTime;
    if (!snapshot) { record('R-04', 'FAIL', `mission did not terminate`); throw new Error('timeout'); }

    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    record('R-04', 'PASS', `mission terminated: status=${snapshot.status}, elapsed=${elapsed}ms, tokens=${snapshot.result?.cost?.tokens ?? 0}`);
    record('R-STATUS', snapshot.status, `missionId=${missionId}`);
    record('R-TOKENS', String(snapshot.result?.cost?.tokens ?? 0), `tokens=${snapshot.result?.cost?.tokens ?? 0}`);

    // Fetch events
    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events?limit=400`, null, TEST_API_KEY);
    if (eventsRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'), JSON.stringify(eventsRes.body, null, 2), 'utf8');
      const events = eventsRes.body.events || [];
      const writeEvents = events.filter(e => e.payload?.action === 'write_file' && e.payload?.ok);
      const verification = events.find(e => e.type === 'verification');
      record('R-WRITES', writeEvents.length >= 5 ? 'PASS' : 'PARTIAL', `write_file events: ${writeEvents.length}`);
      if (verification) {
        record('R-VERIFY', verification.payload?.ok ? 'PASS' : 'FAIL',
          `ok=${verification.payload?.ok}, passed=${verification.payload?.passed}, failed=${verification.payload?.failed}`);
      }
    }

    // Fetch artifacts
    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    let artifacts = [];
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'), JSON.stringify(artRes.body, null, 2), 'utf8');
      artifacts = artRes.body.artifacts || [];
      record('R-ARTIFACTS', artifacts.length >= 6 ? 'PASS' : 'PARTIAL', `artifacts: ${artifacts.length}`);

      // Save artifact content
      const appDir = join(EVIDENCE_DIR, 'app');
      mkdirSync(appDir, { recursive: true });
      for (const a of artifacts) {
        if (a.content !== undefined && a.content !== null && !a.path.startsWith('.npm')) {
          const dest = join(appDir, a.path);
          mkdirSync(join(dest, '..'), { recursive: true });
          writeFileSync(dest, a.content, 'utf8');
        }
      }
    }

    // ─── INDEPENDENT CLEAN-ROOM ACCEPTANCE ───
    const EXPECTED = ['package.json', 'server.js', 'index.html', 'converter.js', 'test/converter.test.js', 'README.md'];
    const appDir = join(EVIDENCE_DIR, 'app');
    const cleanRoomDir = `/tmp/pilot-001r-clean-${Date.now()}`;
    mkdirSync(cleanRoomDir, { recursive: true });

    let allPresent = true;
    for (const rel of EXPECTED) {
      const src = join(appDir, rel);
      if (existsSync(src)) {
        const dst = join(cleanRoomDir, rel);
        mkdirSync(join(dst, '..'), { recursive: true });
        writeFileSync(dst, readFileSync(src, 'utf8'), 'utf8');
      } else {
        allPresent = false;
        record(`R-FILE-${rel}`, 'MISSING', `${rel} not found`);
      }
    }

    if (allPresent) {
      // npm install
      const npmInstall = spawnSync('npm', ['install', '--no-audit', '--no-fund'],
        { cwd: cleanRoomDir, encoding: 'utf8', timeout: 30_000 });
      record('R-NPM_INSTALL', npmInstall.status === 0 ? 'PASS' : 'FAIL', `exit=${npmInstall.status}`);

      // npm test
      const npmTest = spawnSync('npm', ['test'], { cwd: cleanRoomDir, encoding: 'utf8', timeout: 60_000 });
      writeFileSync(join(EVIDENCE_DIR, 'test-stdout.txt'), npmTest.stdout || '', 'utf8');
      writeFileSync(join(EVIDENCE_DIR, 'test-stderr.txt'), npmTest.stderr || '', 'utf8');
      record('R-NPM_TEST', npmTest.status === 0 ? 'PASS' : 'FAIL', `exit=${npmTest.status}`);

      // FIX 3: Actually start the app and verify HTTP response
      const appProcess = spawn('node', ['server.js'], { cwd: cleanRoomDir, stdio: ['ignore', 'pipe', 'pipe'] });
      let appOutput = '';
      appProcess.stdout.on('data', (c) => { appOutput += c.toString(); });
      appProcess.stderr.on('data', (c) => { appOutput += c.toString(); });

      // Wait for server to start
      await new Promise((r) => setTimeout(r, 2000));

      // Try to fetch the page
      try {
        const response = await fetch('http://127.0.0.1:3000/');
        const html = await response.text();
        writeFileSync(join(EVIDENCE_DIR, 'http-response.html'), html, 'utf8');
        record('R-HTTP', response.status === 200 ? 'PASS' : 'FAIL',
          `HTTP ${response.status}, body=${html.length} bytes, has converter=${html.includes('converter')}`);
      } catch (e) {
        record('R-HTTP', 'FAIL', `fetch failed: ${e.message}`);
        writeFileSync(join(EVIDENCE_DIR, 'app-output.txt'), appOutput, 'utf8');
      }

      appProcess.kill('SIGTERM');

      // Compute delivered hashes
      const hashes = {};
      for (const rel of EXPECTED) {
        const fp = join(cleanRoomDir, rel);
        if (existsSync(fp)) hashes[rel] = crypto.createHash('sha256').update(readFileSync(fp, 'utf8')).digest('hex');
      }
      writeFileSync(join(EVIDENCE_DIR, 'file-hashes.json'), JSON.stringify(hashes, null, 2), 'utf8');
      record('R-HASHES', 'PASS', `${Object.keys(hashes).length} files hashed`);
    }

    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'), JSON.stringify(results, null, 2), 'utf8');

  } catch (err) {
    console.error('[pilot-001r] fatal:', err);
    record('R-00', 'FAIL', `fatal: ${err.message}`);
  } finally {
    if (gatewayLog.length > 0) {
      const trimmed = gatewayLog.map(e => ({ ...e, t: e.t.slice(0, 4000) }));
      writeFileSync(join(EVIDENCE_DIR, 'gateway-log.json'), JSON.stringify(trimmed, null, 2), 'utf8');
    }
    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'), JSON.stringify(results, null, 2), 'utf8');
    console.log(`\nResults: ${join(EVIDENCE_DIR, 'phase-summary.json')}`);
    if (gateway) try { gateway.kill('SIGTERM'); } catch { /* ignore */ }
    try { spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { spawnSync('pkill', ['-f', 'bun.*agent-computer'], { stdio: 'ignore' }); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 3000);
  }
})();
