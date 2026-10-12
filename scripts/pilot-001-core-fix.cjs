/**
 * PILOT-001 CORE FIX — Genesis self-repairs server.js with ORIGINAL goal text.
 *
 * ROOT CAUSES FIXED:
 * 1. Planner merges browser-verification + document-authoring into code-execution
 *    for non-complex SE goals → single worker (no VE/DW → no handoff failure)
 * 2. missionInputs now supports `modifiable: true` → hash check relaxed for
 *    files the worker is told to fix (no false "fabrication" rejection)
 * 3. Driver actually tests npm start + HTTP + browser interaction
 *
 * The goal text CONTAINS "verify" and "browser" — no word games.
 */
const { spawn, spawnSync } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');

const ENGINE_DIR = resolve(__dirname, '..');
const EVIDENCE_DIR = join(ENGINE_DIR, 'evidence', 'pilot-001-core-fix');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const GATEWAY_PORT = '4980';
const A2A_PORT = '4981';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-pilot-001cf';
const TEST_API_KEY = 'pilot-001cf-key';
const MISSION_TIMEOUT_MS = 540_000;

rmSync(OPENBOT_ROOT, { recursive: true, force: true });
mkdirSync(OPENBOT_ROOT, { recursive: true });

const APP_SOURCE = join(ENGINE_DIR, 'evidence', 'pilot-001-recovery', 'app');
function readAppFile(rel) {
  const fp = join(APP_SOURCE, rel);
  return existsSync(fp) ? readFileSync(fp, 'utf8') : null;
}

// FIX 2: server.js is marked `modifiable: true` — hash check won't fail
const MISSION_INPUTS = [
  { path: 'package.json', contents: readAppFile('package.json') },
  { path: 'server.js', contents: readAppFile('server.js'), modifiable: true },
  { path: 'index.html', contents: readAppFile('index.html') },
  { path: 'converter.js', contents: readAppFile('converter.js') },
  { path: 'test/converter.test.js', contents: readAppFile('test/converter.test.js') },
  { path: 'README.md', contents: readAppFile('README.md') },
].filter(i => i.contents !== null);

const MISSION_OUTCOME = `Fix a bug in an existing temperature converter web application.

The app runs on Node.js with a server.js that serves index.html on port 3000.
The index.html references converter.js via a script tag: <script src="converter.js"></script>.

BUG: The server returns HTTP 404 for /converter.js because server.js only handles "/" and "/index.html" routes. All other requests return 404. The browser cannot load the JavaScript file.

REQUIRED FIX: Modify server.js to serve ALL static files (converter.js, index.html, and any other files in the app directory) with the correct Content-Type headers.

After fixing, verify by running npm test (must exit 0) and checking that GET /converter.js returns HTTP 200 with JavaScript content.`;

const MISSION_CONTEXT = `PILOT-001 CORE FIX: Repair the temperature converter's server.js.

The app files are already in your workspace (staged as mission inputs):
- package.json (test script: "node --test", start script: "node server.js")
- server.js (BUGGY: only serves / and /index.html, returns 404 for /converter.js)
- index.html (references converter.js via <script src="converter.js">)
- converter.js (exports cToF and fToC functions + DOM event handlers)
- test/converter.test.js (tests for cToF and fToC)
- README.md

THE BUG: server.js uses if/else to route only "/" and "/index.html" to readFile.
All other paths get 404. This means the browser cannot load converter.js.

THE FIX: Modify server.js to serve any file from the app directory.
Read the requested path from the filesystem. Set Content-Type based on file extension.
Return 404 only if the file doesn't exist.

After fixing server.js:
1. Run "npm test" via run_command (must exit 0)
2. Run "node server.js" in background, fetch http://127.0.0.1:3000/converter.js to confirm it returns JavaScript
3. Kill the server
4. Call finish with artifacts: ["package.json","server.js","index.html","converter.js","test/converter.test.js","README.md"]

Only modify server.js. Do not change other files.`;

const MISSION_CONSTRAINTS = [
  'Use Node.js >= 20 standard library ONLY.',
  'Only modify server.js.',
  'npm test must exit 0.',
  'GET /converter.js must return HTTP 200 with JavaScript content.',
];

const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'server.js exists', path: 'server.js' },
  { kind: 'file', label: 'converter.js exists', path: 'converter.js' },
  { kind: 'content-in-artifacts', label: 'server.js serves static files', expectIncludes: 'readFile' },
  { kind: 'content-in-artifacts', label: 'server.js handles .js content-type', expectIncludes: 'javascript' },
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
    GENESIS_API_KEYS: JSON.stringify({ [TEST_API_KEY]: {
      callerId: 'pilot-001cf-caller', allowedOperations: ['mission:submit'],
      maxActiveMissions: 5, maxMissionTimeoutMs: MISSION_TIMEOUT_MS,
    }}),
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
      headers: { 'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
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
    try { const r = await fetch(url); if (r.status === 200 || r.status === 401) return true; }
    catch { }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  let gateway;
  const wallStart = Date.now();
  let gatewayLog = [];
  try {
    record('C-00', 'PASS', 'evidence dir prepared');
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
      cwd: ENGINE_DIR, env: buildGatewayEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stdout.on('data', (c) => { const t = c.toString(); gatewayLog.push({ stream: 'stdout', t, ts: new Date().toISOString() }); if (t.length < 400) console.log('[gw:out]', t.trim()); });
    gateway.stderr.on('data', (c) => { const t = c.toString(); gatewayLog.push({ stream: 'stderr', t, ts: new Date().toISOString() }); if (t.length < 400) console.log('[gw:err]', t.trim()); });
    const gwUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 120_000);
    if (!gwUp) { record('C-01', 'FAIL', 'gateway did not come up'); throw new Error('gw up fail'); }
    record('C-01', 'PASS', `gateway up on port ${GATEWAY_PORT}`);

    const submit = await httpCall('POST', '/v1/missions', {
      outcome: MISSION_OUTCOME, context: MISSION_CONTEXT, constraints: MISSION_CONSTRAINTS,
      label: 'pilot-001-core-fix', acceptanceCriteria: ACCEPTANCE_CRITERIA, missionInputs: MISSION_INPUTS,
    }, TEST_API_KEY);
    if (submit.status !== 202) { record('C-02', 'FAIL', `submission failed: HTTP ${submit.status}`); throw new Error('submit fail'); }
    const missionId = submit.body.missionId;
    record('C-02', 'PASS', `mission submitted: ${missionId}`);
    writeFileSync(join(EVIDENCE_DIR, 'submit-response.json'), JSON.stringify(submit.body, null, 2), 'utf8');

    record('C-03', 'INFO', `waiting (timeout ${MISSION_TIMEOUT_MS}ms)...`);
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
      } catch (e) { console.log(`  [poll ${Date.now() - startTime}ms] error: ${e.message}`); }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!snapshot) { record('C-04', 'FAIL', 'mission did not terminate'); throw new Error('timeout'); }
    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    record('C-04', 'PASS', `terminated: status=${snapshot.status}, elapsed=${Date.now() - startTime}ms, tokens=${snapshot.result?.cost?.tokens ?? 0}`);
    record('C-STATUS', snapshot.status, `missionId=${missionId}`);
    record('C-TOKENS', String(snapshot.result?.cost?.tokens ?? 0), `tokens=${snapshot.result?.cost?.tokens ?? 0}`);

    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    let artifacts = [];
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'), JSON.stringify(artRes.body, null, 2), 'utf8');
      artifacts = artRes.body.artifacts || [];
      record('C-ARTIFACTS', artifacts.length >= 6 ? 'PASS' : 'PARTIAL', `artifacts: ${artifacts.length}`);
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

    // Independent verification
    const EXPECTED = ['package.json', 'server.js', 'index.html', 'converter.js', 'test/converter.test.js', 'README.md'];
    const appDir = join(EVIDENCE_DIR, 'app');
    const cleanRoomDir = `/tmp/pilot-001cf-clean-${Date.now()}`;
    mkdirSync(cleanRoomDir, { recursive: true });
    let allPresent = true;
    for (const rel of EXPECTED) {
      const src = join(appDir, rel);
      if (existsSync(src)) {
        const dst = join(cleanRoomDir, rel);
        mkdirSync(join(dst, '..'), { recursive: true });
        writeFileSync(dst, readFileSync(src, 'utf8'), 'utf8');
      } else { allPresent = false; record(`C-FILE-${rel}`, 'MISSING', rel); }
    }

    if (allPresent) {
      const npmTest = spawnSync('npm', ['test'], { cwd: cleanRoomDir, encoding: 'utf8', timeout: 60_000 });
      writeFileSync(join(EVIDENCE_DIR, 'test-stdout.txt'), npmTest.stdout || '', 'utf8');
      record('C-NPM_TEST', npmTest.status === 0 ? 'PASS' : 'FAIL', `exit=${npmTest.status}`);

      const appProcess = spawn('node', ['server.js'], { cwd: cleanRoomDir, stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise((r) => setTimeout(r, 2000));

      try {
        const r1 = await fetch('http://127.0.0.1:3000/');
        const html = await r1.text();
        writeFileSync(join(EVIDENCE_DIR, 'http-root.html'), html, 'utf8');
        record('C-HTTP_ROOT', r1.status === 200 ? 'PASS' : 'FAIL', `HTTP ${r1.status}, ${html.length} bytes`);
      } catch (e) { record('C-HTTP_ROOT', 'FAIL', e.message); }

      try {
        const r2 = await fetch('http://127.0.0.1:3000/converter.js');
        const js = await r2.text();
        writeFileSync(join(EVIDENCE_DIR, 'http-converter.js'), js, 'utf8');
        record('C-HTTP_CONVERTER', r2.status === 200 ? 'PASS' : 'FAIL', `HTTP ${r2.status}, ${js.length} bytes, has cToF=${js.includes('cToF')}`);
      } catch (e) { record('C-HTTP_CONVERTER', 'FAIL', e.message); }

      // Browser interaction
      try {
        const { chromium } = require('/tmp/openbot-test/agent-computer/node_modules/playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto('http://127.0.0.1:3000/');
        await page.fill('input', '100');
        await page.click('button');
        await page.waitForTimeout(500);
        const r1 = await page.textContent('#result, .result, [id*=result]') || await page.textContent('body');
        record('C-BROWSER_100C', r1 && r1.includes('212') ? 'PASS' : 'FAIL', `result: "${r1}"`);
        await page.fill('input', '32');
        const sel = await page.$('select');
        if (sel) { const opts = await sel.$$('option'); if (opts.length > 1) await sel.selectOption({ index: 1 }); }
        await page.click('button');
        await page.waitForTimeout(500);
        const r2 = await page.textContent('#result, .result, [id*=result]') || await page.textContent('body');
        record('C-BROWSER_32F', r2 && r2.includes('0') ? 'PASS' : 'FAIL', `result: "${r2}"`);
        record('C-BROWSER_JS_ERRORS', errors.length === 0 ? 'PASS' : 'FAIL', errors.length === 0 ? 'none' : errors.join('; '));
        await page.screenshot({ path: join(EVIDENCE_DIR, 'browser-screenshot.png') });
        await browser.close();
      } catch (e) { record('C-BROWSER', 'FAIL', e.message); }

      appProcess.kill('SIGTERM');

      const hashes = {};
      for (const rel of EXPECTED) {
        const fp = join(cleanRoomDir, rel);
        if (existsSync(fp)) hashes[rel] = crypto.createHash('sha256').update(readFileSync(fp, 'utf8')).digest('hex');
      }
      writeFileSync(join(EVIDENCE_DIR, 'file-hashes.json'), JSON.stringify(hashes, null, 2), 'utf8');
    }

    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'), JSON.stringify(results, null, 2), 'utf8');
  } catch (err) {
    console.error('[pilot-001cf] fatal:', err);
    record('C-00', 'FAIL', `fatal: ${err.message}`);
  } finally {
    if (gatewayLog.length > 0) writeFileSync(join(EVIDENCE_DIR, 'gateway-log.json'), JSON.stringify(gatewayLog.map(e => ({ ...e, t: e.t.slice(0, 4000) })), null, 2), 'utf8');
    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'), JSON.stringify(results, null, 2), 'utf8');
    console.log(`\nResults: ${join(EVIDENCE_DIR, 'phase-summary.json')}`);
    if (gateway) try { gateway.kill('SIGTERM'); } catch { }
    try { spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch { }
    try { spawnSync('pkill', ['-f', 'bun.*agent-computer'], { stdio: 'ignore' }); } catch { }
    setTimeout(() => process.exit(0), 3000);
  }
})();
