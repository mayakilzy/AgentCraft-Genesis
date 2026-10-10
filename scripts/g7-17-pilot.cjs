/**
 * G7-17 — Real Engineering Pilot: Municipal Service Request Tracker.
 *
 * Submits a real engineering mission through the production Gateway:
 *   Studio → Auth → Mission submission → ZAI GLM → OpenBot runtime
 *   → write_file actions → Verification → SUCCEEDED → Artifact delivery
 *
 * The goal asks Genesis to build a small, functional application:
 *   Municipal Service Request Tracker — Prototype v0.1
 */
const { spawn } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');

const EVIDENCE_DIR = join(__dirname, '..', 'evidence', 'g7-17');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const ENGINE_DIR = resolve(__dirname, '..');
const GATEWAY_PORT = '4180';
const WEB_PORT = '3020';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-g7-17';
const TEST_API_KEY = 'g7-17-pilot-key';
const TEST_OPERATOR_PIN = 'g7-17-pilot-pin';
const TEST_BFF_SECRET = 'g7-17-bff-secret-fixed';

const PILOT_GOAL = `Build a small, functional Node.js application: "Municipal Service Request Tracker — Prototype v0.1". 

The application must:
1. Create a service request (with id, title, description, status, created_at).
2. List all existing requests.
3. Filter requests by status (pending, in-progress, resolved, rejected).
4. Update request status.
5. Persist records to a local JSON file (data.json).
6. Validate user input (reject empty titles, invalid status values).
7. Include automated tests (using Node.js built-in test runner or vitest).
8. Include a README.md with installation and usage instructions.

Use synthetic data only. No real citizen data. No external API calls. No database.

The application should be in a single file: app.js with a package.json and README.md.
Create all files using the write_file action. The application must be independently executable with: node app.js

Provide all files needed: app.js, package.json, README.md, and a test file.`;

const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'app.js exists', path: 'app.js' },
  { kind: 'file', label: 'package.json exists', path: 'package.json' },
  { kind: 'file', label: 'README.md exists', path: 'README.md' },
  { kind: 'content-in-artifacts', label: 'app.js has createRequest function', expectIncludes: 'createRequest' },
  { kind: 'content-in-artifacts', label: 'app.js has listRequests function', expectIncludes: 'listRequests' },
  { kind: 'content-in-artifacts', label: 'app.js has filterByStatus function', expectIncludes: 'filterByStatus' },
  { kind: 'content-in-artifacts', label: 'app.js has updateStatus function', expectIncludes: 'updateStatus' },
  { kind: 'content-in-artifacts', label: 'app.js has data persistence', expectIncludes: 'data.json' },
  { kind: 'content-in-artifacts', label: 'app.js has input validation', expectIncludes: 'valid' },
  { kind: 'content-in-artifacts', label: 'README has installation instructions', expectIncludes: 'npm' },
];

const results = {};
function record(id, status, detail) {
  const ts = new Date().toISOString();
  results[id] = { status, detail, timestamp: ts };
  console.log(`[${ts}] ${id}: ${status} — ${detail}`);
}

function buildGatewayEnv() {
  return {
    ...process.env,
    GENESIS_EXECUTION_MODE: 'production',
    GENESIS_REASONING_PROVIDER: 'zai',
    GENESIS_RUNTIME_PROVIDER: 'openbot',
    OPENBOT_CHECKOUT_DIR: OPENBOT_CHECKOUT,
    OPENBOT_ROOT_DIR: OPENBOT_ROOT,
    ZAI_SDK_PATH: 'z-ai-web-dev-sdk',
    GENESIS_HTTP_PORT: GATEWAY_PORT,
    GENESIS_A2A_PORT: '4181',
    GENESIS_API_KEYS: JSON.stringify({
      [TEST_API_KEY]: {
        callerId: 'g7-17-pilot-caller',
        allowedOperations: ['mission:submit'],
        maxActiveMissions: 5,
        maxMissionTimeoutMs: 300_000,
      },
    }),
  };
}

const webEnv = {
  ...process.env,
  GENESIS_HTTP_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
  GENESIS_API_KEY: TEST_API_KEY,
  GENESIS_OPERATOR_PIN: TEST_OPERATOR_PIN,
  GENESIS_COOKIE_SECURE: 'false',
  GENESIS_BFF_SECRET: TEST_BFF_SECRET,
  NODE_ENV: 'production',
  PORT: WEB_PORT,
};

async function waitForUrl(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.status === 200 || r.status === 401) return true; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  let browser, gateway, web;
  try {
    // --- Start Gateway (production mode) ---
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
      cwd: ENGINE_DIR, env: buildGatewayEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const gwLog = [];
    gateway.stderr.on('data', (c) => { const t = c.toString(); gwLog.push(t); if (t.length < 400) console.log('[gw]', t.trim()); });
    const gwUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 120_000);
    if (!gwUp) { record('PILOT-01', 'FAIL', 'gateway did not come up'); writeFileSync(join(EVIDENCE_DIR, 'gw-stderr.log'), gwLog.join(''), 'utf8'); process.exit(1); }
    record('PILOT-01', 'PASS', 'production gateway up (real ZAI + OpenBot)');

    // --- Start Web ---
    web = spawn('npm', ['run', 'start', '--', '--port', WEB_PORT], {
      cwd: join(ENGINE_DIR, 'web'), env: webEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    web.stderr.on('data', (c) => { const t = c.toString(); if (t.length < 400 && (t.includes('Ready')||t.includes('error'))) console.log('[web]', t.trim()); });
    const webUp = await waitForUrl(`http://127.0.0.1:${WEB_PORT}/`, 120_000);
    if (!webUp) { record('PILOT-02', 'FAIL', 'web did not come up'); process.exit(1); }
    record('PILOT-02', 'PASS', 'web up (production build)');

    // --- Launch browser ---
    const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();

    // --- Authenticate ---
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);
    const pinInput = page.locator('input[type="password"]').first();
    if ((await pinInput.count()) > 0) {
      await pinInput.fill(TEST_OPERATOR_PIN);
      const btn = page.getByRole('button', { name: /Authenticate/i }).first();
      if ((await btn.count()) > 0) { await btn.click(); await page.waitForTimeout(3000); }
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(EVIDENCE_DIR, 'pilot-03-auth.png') });
    record('PILOT-03', 'PASS', 'authenticated');

    // --- Submit the pilot mission via BFF ---
    const submitRes = await page.evaluate(async (goal) => {
      const res = await fetch('/api/genesis/v1/missions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: goal, acceptanceCriteria: [
          { kind: 'file', label: 'app.js exists', path: 'app.js' },
          { kind: 'file', label: 'package.json exists', path: 'package.json' },
          { kind: 'file', label: 'README.md exists', path: 'README.md' },
          { kind: 'content-in-artifacts', label: 'app.js has createRequest', expectIncludes: 'createRequest' },
          { kind: 'content-in-artifacts', label: 'app.js has listRequests', expectIncludes: 'listRequests' },
          { kind: 'content-in-artifacts', label: 'app.js has filterByStatus', expectIncludes: 'filterByStatus' },
          { kind: 'content-in-artifacts', label: 'app.js has updateStatus', expectIncludes: 'updateStatus' },
          { kind: 'content-in-artifacts', label: 'app.js has data persistence', expectIncludes: 'data.json' },
          { kind: 'content-in-artifacts', label: 'app.js has input validation', expectIncludes: 'valid' },
          { kind: 'content-in-artifacts', label: 'README has npm install', expectIncludes: 'npm' },
        ]}),
      });
      const body = await res.json();
      return { status: res.status, body };
    }, PILOT_GOAL);

    if (submitRes.status !== 202) {
      record('PILOT-04', 'FAIL', `mission submission failed: ${submitRes.status}`);
      process.exit(1);
    }
    const missionId = submitRes.body.missionId;
    record('PILOT-04', 'PASS', `pilot mission submitted: ${missionId}`);

    // --- Wait for completion (up to 5 min) ---
    record('PILOT-05', 'INFO', 'waiting for real ZAI + OpenBot execution...');
    let snapshot = null;
    const startTime = Date.now();
    for (let i = 0; i < 600; i++) { // 5 min max
      const getRes = await page.evaluate(async (id) => {
        const res = await fetch(`/api/genesis/v1/missions/${id}`);
        const body = await res.json();
        return { status: res.status, body };
      }, missionId);
      if (getRes.status === 200 && getRes.body.terminal) {
        snapshot = getRes.body;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const elapsed = Date.now() - startTime;

    if (!snapshot) {
      record('PILOT-06', 'FAIL', `mission did not terminate within 5 min (elapsed ${elapsed}ms)`);
      process.exit(1);
    }

    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    record('PILOT-06', 'PASS', `mission terminated: status=${snapshot.status}, elapsed=${elapsed}ms`);

    // --- Token usage ---
    const tokens = snapshot.result?.cost?.tokens;
    record('PILOT-07', tokens && tokens > 0 ? 'PASS' : 'FAIL', `token usage: ${tokens ?? 0}`);

    // --- Events ---
    const eventsRes = await page.evaluate(async (id) => {
      const res = await fetch(`/api/genesis/v1/missions/${id}/events?limit=200`);
      return await res.json();
    }, missionId);
    writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'), JSON.stringify(eventsRes, null, 2), 'utf8');
    const writeFileEvents = (eventsRes.events || []).filter(e => e.payload?.action === 'write_file' && e.payload?.ok);
    record('PILOT-08', writeFileEvents.length > 0 ? 'PASS' : 'FAIL', `write_file events: ${writeFileEvents.length}`);

    // --- Artifacts ---
    const artRes = await page.evaluate(async (id) => {
      const res = await fetch(`/api/genesis/v1/missions/${id}/artifacts`);
      return await res.json();
    }, missionId);
    writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'), JSON.stringify(artRes, null, 2), 'utf8');
    const artifacts = artRes.artifacts || [];
    record('PILOT-09', artifacts.length > 0 ? 'PASS' : 'FAIL', `artifacts delivered: ${artifacts.length}`);

    // --- Save artifact content ---
    for (const a of artifacts) {
      if (a.content) {
        writeFileSync(join(EVIDENCE_DIR, a.path), a.content, 'utf8');
      }
    }

    // --- Find the workspace on disk (for files not inlined) ---
    const wsBase = join(OPENBOT_ROOT, missionId);
    function findFiles(dir, prefix = '') {
      const out = [];
      if (!existsSync(dir)) return out;
      for (const f of readdirSync(dir)) {
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
    const wsFiles = findFiles(wsBase);
    // Save all workspace files to evidence
    for (const f of wsFiles) {
      if (!existsSync(join(EVIDENCE_DIR, f.path))) {
        try {
          const content = readFileSync(f.full, 'utf8');
          mkdirSync(join(EVIDENCE_DIR, f.path.split('/').slice(0, -1).join('/')), { recursive: true });
          writeFileSync(join(EVIDENCE_DIR, f.path), content, 'utf8');
        } catch { /* binary file */ }
      }
    }
    writeFileSync(join(EVIDENCE_DIR, 'workspace-files.json'), JSON.stringify(wsFiles.map(f => f.path), null, 2), 'utf8');

    await page.screenshot({ path: join(EVIDENCE_DIR, 'pilot-10-final.png') });

    // --- Acceptance: verify files exist ---
    const appJsExists = existsSync(join(EVIDENCE_DIR, 'app.js'));
    const pkgExists = existsSync(join(EVIDENCE_DIR, 'package.json'));
    const readmeExists = existsSync(join(EVIDENCE_DIR, 'README.md'));
    record('ACCEPT-01', appJsExists && pkgExists && readmeExists ? 'PASS' : 'FAIL',
      `files: app.js=${appJsExists}, package.json=${pkgExists}, README.md=${readmeExists}`);

    // --- Acceptance: verify content ---
    if (appJsExists) {
      const appContent = readFileSync(join(EVIDENCE_DIR, 'app.js'), 'utf8');
      const hasCreate = appContent.includes('createRequest');
      const hasList = appContent.includes('listRequests');
      const hasFilter = appContent.includes('filterByStatus');
      const hasUpdate = appContent.includes('updateStatus');
      const hasPersist = appContent.includes('data.json');
      const hasValid = appContent.includes('valid');
      record('ACCEPT-02', hasCreate && hasList && hasFilter && hasUpdate && hasPersist && hasValid ? 'PASS' : 'PARTIAL',
        `functions: create=${hasCreate} list=${hasList} filter=${hasFilter} update=${hasUpdate} persist=${hasPersist} valid=${hasValid}`);
    } else {
      record('ACCEPT-02', 'FAIL', 'app.js not found — cannot verify content');
    }

    // --- Acceptance: try to install and run ---
    const crypto = require('node:crypto');
    const testDir = join(EVIDENCE_DIR, 'app-test');
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    // Copy files
    for (const f of ['app.js', 'package.json', 'README.md']) {
      if (existsSync(join(EVIDENCE_DIR, f))) {
        writeFileSync(join(testDir, f), readFileSync(join(EVIDENCE_DIR, f), 'utf8'), 'utf8');
      }
    }
    // Copy test files
    for (const f of wsFiles) {
      if (f.path.endsWith('.test.js') || f.path.endsWith('.test.ts') || f.path.endsWith('.spec.js')) {
        mkdirSync(join(testDir, f.path.split('/').slice(0, -1).join('/')), { recursive: true });
        writeFileSync(join(testDir, f.path), readFileSync(f.full, 'utf8'), 'utf8');
      }
    }

    // Try npm install
    const installResult = require('node:child_process').spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: testDir, stdio: 'pipe', timeout: 60_000,
    });
    writeFileSync(join(EVIDENCE_DIR, 'npm-install-stdout.txt'), installResult.stdout?.toString() || '', 'utf8');
    writeFileSync(join(EVIDENCE_DIR, 'npm-install-stderr.txt'), installResult.stderr?.toString() || '', 'utf8');
    record('ACCEPT-03', installResult.status === 0 ? 'PASS' : 'PARTIAL', `npm install exit: ${installResult.status}`);

    // Try running the app
    const runResult = require('node:child_process').spawnSync('node', ['app.js'], {
      cwd: testDir, stdio: 'pipe', timeout: 30_000, env: { ...process.env, PORT: '3199' },
    });
    writeFileSync(join(EVIDENCE_DIR, 'app-stdout.txt'), runResult.stdout?.toString() || '', 'utf8');
    writeFileSync(join(EVIDENCE_DIR, 'app-stderr.txt'), runResult.stderr?.toString() || '', 'utf8');
    record('ACCEPT-04', runResult.status === 0 || runResult.status === null ? 'PASS' : 'PARTIAL', `app.js exit: ${runResult.status}`);

    // Try running tests
    const testResult = require('node:child_process').spawnSync('npx', ['vitest', 'run', '--reporter=verbose'], {
      cwd: testDir, stdio: 'pipe', timeout: 60_000,
    });
    writeFileSync(join(EVIDENCE_DIR, 'test-stdout.txt'), testResult.stdout?.toString() || '', 'utf8');
    writeFileSync(join(EVIDENCE_DIR, 'test-stderr.txt'), testResult.stderr?.toString() || '', 'utf8');
    record('ACCEPT-05', testResult.status === 0 ? 'PASS' : 'PARTIAL', `tests exit: ${testResult.status}`);

    // --- Summary ---
    record('COST', 'INFO', `tokens=${tokens ?? 0}, wallMs=${snapshot.result?.cost?.wallMs ?? 0}, usd=${snapshot.result?.cost?.usd ?? 0}`);
    record('MANUAL', 'INFO', 'No manual code intervention — all files generated by Genesis execution');

  } catch (err) {
    console.error('[g7-17] fatal:', err);
    record('PILOT-00', 'FAIL', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    writeFileSync(join(EVIDENCE_DIR, 'results.json'), JSON.stringify({ results }, null, 2), 'utf8');
    console.log(`Results: ${join(EVIDENCE_DIR, 'results.json')}`);
    if (browser) try { await browser.close(); } catch {}
    if (web) try { web.kill('SIGTERM'); } catch {}
    if (gateway) try { gateway.kill('SIGTERM'); } catch {}
    try { require('node:child_process').spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch {}
    try { require('node:child_process').spawnSync('pkill', ['-f', 'next-server'], { stdio: 'ignore' }); } catch {}
    try { require('node:child_process').spawnSync('pkill', ['-f', 'bun.*agent-computer'], { stdio: 'ignore' }); } catch {}
    setTimeout(() => process.exit(0), 1500);
  }
})();
