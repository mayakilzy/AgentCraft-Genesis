/**
 * PILOT-003 — GitHub Repository → Autonomous Application Deployment & Verification.
 *
 * Genesis takes the tastejs/todomvc GitHub repository, clones it, navigates
 * to the React example, installs dependencies, builds the app, launches it,
 * verifies it through real browser interactions, and delivers the package.
 *
 * No arbitrary token/time ceilings. Real Z.ai + OpenBot + Playwright.
 */

const { spawn, spawnSync } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');
const { createHash } = require('node:crypto');

const ENGINE_DIR = resolve(__dirname, '..');
const EVIDENCE_DIR = join(ENGINE_DIR, 'evidence', 'pilot-003');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const GATEWAY_PORT = '5090';
const A2A_PORT = '5091';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-pilot-003';
const TEST_API_KEY = 'pilot-003-key';
const MISSION_TIMEOUT_MS = 1_800_000; // 30 minutes (generous, no arbitrary limit)

rmSync(OPENBOT_ROOT, { recursive: true, force: true });
mkdirSync(OPENBOT_ROOT, { recursive: true });

const MISSION_OUTCOME = `Take the existing GitHub repository at https://github.com/tastejs/todomvc.git and turn it into a working, verified application.

Clone the repository, find the React example application (expected under examples/react but discover the actual path), install its dependencies, build it, launch it on an available port, verify it loads in a real browser, perform TodoMVC interactions (create tasks, complete tasks, filter tasks, delete tasks), and verify state persistence after page reload.

After all files are ready and the app is verified, run "npm test" to confirm any existing project tests pass.`;

const MISSION_CONTEXT = `PILOT-003: Deploy and verify an existing GitHub repository.

Target repository: https://github.com/tastejs/todomvc.git
Target application: React TodoMVC (expected at examples/react — verify the actual path)

Required autonomous workflow:
1. Clone the repository via: git clone https://github.com/tastejs/todomvc.git todomvc
2. Navigate into the cloned repo and find the React example (expected at examples/react).
3. Read the project's package.json to understand its scripts and dependencies.
4. Install dependencies: npm install
5. Build the application: npm run build (or whatever the build script is)
6. Launch the application: npm start (or npm run serve, or whatever serves the app)
7. Identify the actual port the app listens on (check stdout for the URL).
8. Verify the app loads in a browser by navigating to the URL.
9. Perform TodoMVC interactions:
   - Create a task (type in the input and press Enter)
   - Create a second task
   - Edit a task (double-click to edit)
   - Complete a task (click the checkbox/toggle)
   - Filter by Active (click the Active filter link)
   - Filter by Completed (click the Completed filter link)
   - Filter by All (click the All filter link)
   - Delete a task (click the destroy button)
   - Reload the page and verify state persists
10. Run npm test to check if the project has tests.

CRITICAL:
- Do NOT modify the upstream repository files except for installing dependencies.
- Do NOT push any commits.
- Keep all work inside your workspace.
- The app may use Vite, Webpack, or another bundler — discover the actual build/serve commands from package.json.
- If the app serves on a port other than 3000, discover and use the actual port.
- Take a browser screenshot as evidence of the working app.
- First install dependencies (npm install), THEN build (npm run build), THEN serve (npm start or npm run serve). Do NOT skip steps.

After verifying the app works, call finish with all artifact paths (the cloned repo directory).`;

const MISSION_CONSTRAINTS = [
  'Clone the real public repository from https://github.com/tastejs/todomvc.git',
  'Do not modify the upstream repository source code.',
  'Do not push commits to GitHub.',
  'Keep all work inside the isolated workspace.',
  'The application must build and start successfully.',
  'Real browser verification is required (not just HTTP checks).',
];

const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'package.json exists in the app', path: 'todomvc/examples/react/package.json' },
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
    GENESIS_MAX_WORKER_STEPS: '50',
    GENESIS_HTTP_PORT: GATEWAY_PORT,
    GENESIS_A2A_PORT: A2A_PORT,
    GENESIS_DEFAULT_MISSION_TIMEOUT_MS: String(MISSION_TIMEOUT_MS),
    GENESIS_API_KEYS: JSON.stringify({ [TEST_API_KEY]: {
      callerId: 'pilot-003-caller', allowedOperations: ['mission:submit'],
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
      timeout: 1_800_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch { }
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
    record('P3-00', 'PASS', 'evidence dir prepared');
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
      cwd: ENGINE_DIR, env: buildGatewayEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stdout.on('data', (c) => { const t = c.toString(); gatewayLog.push({ stream: 'stdout', t, ts: new Date().toISOString() }); if (t.length < 400) console.log('[gw:out]', t.trim()); });
    gateway.stderr.on('data', (c) => { const t = c.toString(); gatewayLog.push({ stream: 'stderr', t, ts: new Date().toISOString() }); if (t.length < 400) console.log('[gw:err]', t.trim()); });
    const gwUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 120_000);
    if (!gwUp) { record('P3-01', 'FAIL', 'gateway did not come up'); throw new Error('gw up fail'); }
    record('P3-01', 'PASS', `gateway up on port ${GATEWAY_PORT}`);

    const submit = await httpCall('POST', '/v1/missions', {
      outcome: MISSION_OUTCOME, context: MISSION_CONTEXT, constraints: MISSION_CONSTRAINTS,
      label: 'pilot-003-todomvc-deploy', acceptanceCriteria: ACCEPTANCE_CRITERIA,
    }, TEST_API_KEY);
    if (submit.status !== 202) { record('P3-02', 'FAIL', `submission failed: HTTP ${submit.status}`); throw new Error('submit fail'); }
    const missionId = submit.body.missionId;
    record('P3-02', 'PASS', `mission submitted: ${missionId}`);
    writeFileSync(join(EVIDENCE_DIR, 'submit-response.json'), JSON.stringify(submit.body, null, 2), 'utf8');

    record('P3-03', 'INFO', `waiting (timeout ${MISSION_TIMEOUT_MS}ms, no token ceiling)...`);
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
      await new Promise((r) => setTimeout(r, 3000));
    }
    const elapsed = Date.now() - startTime;
    if (!snapshot) { record('P3-04', 'FAIL', `mission did not terminate (${elapsed}ms)`); throw new Error('timeout'); }
    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    record('P3-04', 'PASS', `terminated: status=${snapshot.status}, elapsed=${elapsed}ms, tokens=${snapshot.result?.cost?.tokens ?? 0}`);
    record('P3-STATUS', snapshot.status, `missionId=${missionId}`);
    record('P3-TOKENS', String(snapshot.result?.cost?.tokens ?? 0), `tokens=${snapshot.result?.cost?.tokens ?? 0}`);
    record('P3-ELAPSED', String(elapsed), `${elapsed}ms`);

    // Fetch events BEFORE the gateway dies.
    try {
      const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events`, null, TEST_API_KEY);
      if (eventsRes.status === 200 && eventsRes.body?.events) {
        writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'), JSON.stringify(eventsRes.body.events, null, 2), 'utf8');
        record('P3-EVENTS', 'PASS', `captured ${eventsRes.body.events.length} events`);
      } else {
        writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'), '[]', 'utf8');
        record('P3-EVENTS', 'FAIL', `events endpoint returned HTTP ${eventsRes.status}`);
      }
    } catch (e) { record('P3-EVENTS', 'FAIL', e.message); }

    // Fetch artifacts BEFORE the gateway dies.
    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    let artifacts = [];
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'), JSON.stringify(artRes.body, null, 2), 'utf8');
      artifacts = artRes.body.artifacts || [];
      record('P3-ARTIFACTS', artifacts.length > 0 ? 'PASS' : 'FAIL', `artifacts: ${artifacts.length}`);
      const appDir = join(EVIDENCE_DIR, 'app');
      mkdirSync(appDir, { recursive: true });
      for (const a of artifacts) {
        if (a.content !== undefined && a.content !== null && !a.path.startsWith('.npm') && !a.path.startsWith('.git')) {
          const dest = join(appDir, a.path);
          mkdirSync(join(dest, '..'), { recursive: true });
          writeFileSync(dest, a.content, 'utf8');
        }
      }
    } else {
      record('P3-ARTIFACTS', 'FAIL', `artifacts endpoint returned HTTP ${artRes.status}`);
    }

    // ─── DELIVERY PACKAGE ───
    const deliveryDir = join(EVIDENCE_DIR, 'delivery');
    mkdirSync(deliveryDir, { recursive: true });
    let todomvcPath = null;
    try {
      const workerDirs = require('node:fs').readdirSync(OPENBOT_ROOT);
      for (const wd of workerDirs) {
        const candidate = join(OPENBOT_ROOT, wd, 'workspace', 'todomvc');
        if (existsSync(candidate)) { todomvcPath = candidate; break; }
        const candidate2 = join(OPENBOT_ROOT, wd, 'workspace');
        if (existsSync(join(candidate2, 'todomvc'))) { todomvcPath = join(candidate2, 'todomvc'); break; }
      }
    } catch (e) { /* ignore */ }

    if (todomvcPath && existsSync(todomvcPath)) {
      record('P3-DELIVERY_SOURCE', 'PASS', `found todomvc at ${todomvcPath}`);
      const zipResult = spawnSync('zip', ['-r', join(deliveryDir, 'todomvc-app.zip'), '.',
        '-x', 'node_modules/*', '-x', '.git/*', '-x', '*/node_modules/*', '-x', '*/.git/*',
      ], { cwd: todomvcPath, encoding: 'utf8', timeout: 60_000 });
      if (existsSync(join(deliveryDir, 'todomvc-app.zip'))) {
        const zipPath = join(deliveryDir, 'todomvc-app.zip');
        const zipSize = require('node:fs').statSync(zipPath).size;
        const zipHash = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
        record('P3-DELIVERY_ZIP', 'PASS', `created todomvc-app.zip (${zipSize} bytes, SHA-256: ${zipHash.slice(0, 16)}…)`);
        writeFileSync(join(EVIDENCE_DIR, 'delivery-sha256.txt'), zipHash, 'utf8');
      } else {
        record('P3-DELIVERY_ZIP', 'FAIL', `zip failed: ${zipResult.stderr?.slice(0, 200)}`);
      }
    } else {
      record('P3-DELIVERY_SOURCE', 'FAIL', 'todomvc repo not found in worker workspace');
    }

    // ─── HTTP VERIFICATION + BROWSER ───
    const portsToCheck = [3000, 5173, 4173, 7002, 8080, 3001, 3999];
    let appPort = null;
    for (const port of portsToCheck) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
        if (r.status === 200) { appPort = port; break; }
      } catch { /* try next */ }
    }
    if (appPort) {
      record('P3-HTTP_FOUND', 'PASS', `app responding on port ${appPort}`);
      try {
        const { chromium } = require('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${appPort}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        const bodyText = await page.textContent('body');
        record('P3-B01_OPEN', bodyText && bodyText.length > 0 ? 'PASS' : 'FAIL', `app loaded, body length: ${bodyText?.length}`);
        const input = await page.$('input.new-todo, input[class*="todo"], input[type="text"]');
        if (input) {
          await input.fill('Test Task 1'); await input.press('Enter'); await page.waitForTimeout(500);
          const body2 = await page.textContent('body');
          record('P3-B02_CREATE', body2?.includes('Test Task 1') ? 'PASS' : 'FAIL', `task 1: ${body2?.includes('Test Task 1')}`);
          await input.fill('Test Task 2'); await input.press('Enter'); await page.waitForTimeout(500);
          const body3 = await page.textContent('body');
          record('P3-B03_SECOND_TASK', body3?.includes('Test Task 2') ? 'PASS' : 'FAIL', `task 2: ${body3?.includes('Test Task 2')}`);
        } else { record('P3-B02_CREATE', 'FAIL', 'no input found'); }
        const toggle = await page.$('.toggle, input[type="checkbox"]');
        if (toggle) { await toggle.click(); await page.waitForTimeout(500); const completed = await page.$('.completed'); record('P3-B05_COMPLETE', completed ? 'PASS' : 'FAIL', `completed: ${!!completed}`); }
        else { record('P3-B05_COMPLETE', 'NOT_EXECUTED', 'no toggle found'); }
        const activeFilter = await page.$('a[href="#/active"], a:has-text("Active")');
        if (activeFilter) { await activeFilter.click(); await page.waitForTimeout(500); record('P3-B06_ACTIVE_FILTER', 'PASS', 'clicked Active'); }
        else { record('P3-B06_ACTIVE_FILTER', 'NOT_EXECUTED', 'no Active filter'); }
        const completedFilter = await page.$('a[href="#/completed"], a:has-text("Completed")');
        if (completedFilter) { await completedFilter.click(); await page.waitForTimeout(500); record('P3-B07_COMPLETED_FILTER', 'PASS', 'clicked Completed'); }
        else { record('P3-B07_COMPLETED_FILTER', 'NOT_EXECUTED', 'no Completed filter'); }
        const allFilter = await page.$('a[href="#/"], a:has-text("All")');
        if (allFilter) { await allFilter.click(); await page.waitForTimeout(500); record('P3-B08_ALL_FILTER', 'PASS', 'clicked All'); }
        else { record('P3-B08_ALL_FILTER', 'NOT_EXECUTED', 'no All filter'); }
        await page.screenshot({ path: join(EVIDENCE_DIR, 'browser-screenshot.png') });
        record('P3-BROWSER_SCREENSHOT', 'PASS', 'screenshot saved');
        await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2000);
        const bodyAfterReload = await page.textContent('body');
        record('P3-B10_RELOAD', bodyAfterReload && bodyAfterReload.length > 0 ? 'PASS' : 'FAIL', `reloaded, body: ${bodyAfterReload?.length}`);
        record('P3-BROWSER_JS_ERRORS', errors.length === 0 ? 'PASS' : 'FAIL', errors.length === 0 ? 'none' : errors.join('; '));
        await browser.close();
      } catch (e) { record('P3-BROWSER', 'FAIL', e.message); }
    } else {
      record('P3-HTTP_FOUND', 'FAIL', 'app not responding on any common port');
    }

    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'), JSON.stringify(results, null, 2), 'utf8');
  } catch (err) {
    console.error('[pilot-003] fatal:', err);
    record('P3-00', 'FAIL', `fatal: ${err.message}`);
  } finally {
    if (gatewayLog.length > 0) writeFileSync(join(EVIDENCE_DIR, 'gateway-log.json'), JSON.stringify(gatewayLog.map(e => ({ ...e, t: e.t.slice(0, 4000) })), null, 2), 'utf8');
    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'), JSON.stringify(results, null, 2), 'utf8');
    console.log(`\nResults: ${join(EVIDENCE_DIR, 'phase-summary.json')}`);
    if (gateway) try { gateway.kill('SIGTERM'); } catch { }
    try { spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch { }
    try { spawnSync('pkill', ['-f', 'bun.*agent-computer'], { stdio: 'ignore' }); } catch { }
    try { spawnSync('pkill', ['-f', 'node server.js'], { stdio: 'ignore' }); } catch { }
    try { spawnSync('pkill', ['-f', 'vite'], { stdio: 'ignore' }); } catch { }
    setTimeout(() => process.exit(0), 3000);
  }
})();
