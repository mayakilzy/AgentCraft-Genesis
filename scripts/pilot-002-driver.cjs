/**
 * PILOT-002 — Full-Stack Task Manager Application.
 *
 * Genesis builds a complete Personal Task Manager with:
 * - Frontend (HTML/CSS/JS)
 * - Backend REST API (Node.js)
 * - SQLite database (persistent storage)
 * - CRUD operations + filtering
 * - Real browser interaction verification
 *
 * Budget: 60,000 tokens max, 10 minutes max.
 */
const { spawn, spawnSync } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');

const ENGINE_DIR = resolve(__dirname, '..');
const EVIDENCE_DIR = join(ENGINE_DIR, 'evidence', 'pilot-002');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const GATEWAY_PORT = '5080';
const A2A_PORT = '5081';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-pilot-002';
const TEST_API_KEY = 'pilot-002-key';
const MISSION_TIMEOUT_MS = 600_000; // 10 minutes max

rmSync(OPENBOT_ROOT, { recursive: true, force: true });
mkdirSync(OPENBOT_ROOT, { recursive: true });

const MISSION_OUTCOME = `Build a complete Personal Task Manager web application with a functional frontend, backend REST API, and SQLite database.

The application must:
1. Create tasks with title and description.
2. Edit existing tasks.
3. Mark tasks as complete.
4. Delete tasks.
5. Filter tasks by status (all, active, completed).
6. Persist data in SQLite across server restarts.
7. Serve a clean responsive web UI.
8. Provide a REST API for all CRUD operations.

After producing all files, npm test MUST exit 0 within 60 seconds.`;

const MISSION_CONTEXT = `PILOT-002: Build a full-stack Personal Task Manager.

Required deliverables (produce all via file creation tool):
1. package.json — name="task-manager", type="module", scripts.test="node --test", scripts.start="node server.js"
2. server.js — Node.js HTTP server using only standard library (http module). Serves API routes AND static files (index.html, app.js, style.css). Uses node:sqlite (Node v24+ built-in) for SQLite persistence. REST API: GET /api/tasks, POST /api/tasks, PUT /api/tasks/:id, DELETE /api/tasks/:id. Serves static files from the same directory.
3. database.js — SQLite helper using node:sqlite. Creates tasks table if not exists. Exports: createTask, getTasks, updateTask, deleteTask, getTaskById. Database file: tasks.db.
4. index.html — responsive UI with: task form (title input, description textarea, add button), task list with edit/complete/delete buttons, filter buttons (All/Active/Completed).
5. app.js — frontend JavaScript: fetch API calls to /api/tasks, render task list, handle CRUD operations, handle filtering.
6. style.css — clean responsive styling.
7. test/app.test.js — node:test tests for the API (at least 3 tests: create, list, complete).
8. README.md — one clear instruction: "npm install && npm start" then open http://localhost:3000.

CRITICAL: 
- Use node:sqlite (NOT node:sqlite3 — the built-in module is "node:sqlite" in Node v24+).
- The test script must be exactly "node --test" (NO "node --test test/").
- Server must serve BOTH API routes (/api/*) AND static files (/, /app.js, /style.css).
- SQLite database file must persist across restarts.

After producing all files, run "npm test" via run_command to confirm tests pass, then call finish with all artifact paths.`;

const MISSION_CONSTRAINTS = [
  'Use Node.js >= 20 standard library ONLY. The SQLite module is "node:sqlite" (built-in, NOT "sqlite3").',
  'No external npm dependencies. No express. No better-sqlite3. Use http + node:sqlite.',
  'Server must serve both API and static files on port 3000.',
  'npm test MUST exit 0 within 60 seconds.',
  'Data must persist in SQLite across server restarts.',
];

const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'package.json exists', path: 'package.json' },
  { kind: 'file', label: 'server.js exists', path: 'server.js' },
  { kind: 'file', label: 'database.js exists', path: 'database.js' },
  { kind: 'file', label: 'index.html exists', path: 'index.html' },
  { kind: 'file', label: 'app.js exists', path: 'app.js' },
  { kind: 'file', label: 'style.css exists', path: 'style.css' },
  { kind: 'file', label: 'test/app.test.js exists', path: 'test/app.test.js' },
  { kind: 'file', label: 'README.md exists', path: 'README.md' },
  { kind: 'content-in-artifacts', label: 'server.js uses node:sqlite', expectIncludes: 'node:sqlite' },
  { kind: 'content-in-artifacts', label: 'server.js serves API', expectIncludes: '/api/' },
  { kind: 'content-in-artifacts', label: 'index.html has task form', expectIncludes: 'task' },
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
    GENESIS_MAX_TOTAL_TOKENS: '60000',
    GENESIS_HTTP_PORT: GATEWAY_PORT,
    GENESIS_A2A_PORT: A2A_PORT,
    GENESIS_DEFAULT_MISSION_TIMEOUT_MS: String(MISSION_TIMEOUT_MS),
    GENESIS_API_KEYS: JSON.stringify({ [TEST_API_KEY]: {
      callerId: 'pilot-002-caller', allowedOperations: ['mission:submit'],
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
    record('P2-00', 'PASS', 'evidence dir prepared');
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
      cwd: ENGINE_DIR, env: buildGatewayEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stdout.on('data', (c) => { const t = c.toString(); gatewayLog.push({ stream: 'stdout', t, ts: new Date().toISOString() }); if (t.length < 400) console.log('[gw:out]', t.trim()); });
    gateway.stderr.on('data', (c) => { const t = c.toString(); gatewayLog.push({ stream: 'stderr', t, ts: new Date().toISOString() }); if (t.length < 400) console.log('[gw:err]', t.trim()); });
    const gwUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 120_000);
    if (!gwUp) { record('P2-01', 'FAIL', 'gateway did not come up'); throw new Error('gw up fail'); }
    record('P2-01', 'PASS', `gateway up on port ${GATEWAY_PORT}`);

    const submit = await httpCall('POST', '/v1/missions', {
      outcome: MISSION_OUTCOME, context: MISSION_CONTEXT, constraints: MISSION_CONSTRAINTS,
      label: 'pilot-002-task-manager', acceptanceCriteria: ACCEPTANCE_CRITERIA,
    }, TEST_API_KEY);
    if (submit.status !== 202) { record('P2-02', 'FAIL', `submission failed: HTTP ${submit.status}`); throw new Error('submit fail'); }
    const missionId = submit.body.missionId;
    record('P2-02', 'PASS', `mission submitted: ${missionId}`);
    writeFileSync(join(EVIDENCE_DIR, 'submit-response.json'), JSON.stringify(submit.body, null, 2), 'utf8');

    record('P2-03', 'INFO', `waiting (timeout ${MISSION_TIMEOUT_MS}ms, budget 60K tokens)...`);
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
          // Check token budget
          const tokens = get.body.result?.cost?.tokens ?? 0;
          if (tokens > 60000) {
            record('P2-BUDGET', 'FAIL', `token budget exceeded: ${tokens} > 60000`);
            break;
          }
        }
      } catch (e) { console.log(`  [poll ${Date.now() - startTime}ms] error: ${e.message}`); }
      await new Promise((r) => setTimeout(r, 2000));
    }
    const elapsed = Date.now() - startTime;
    if (!snapshot) { record('P2-04', 'FAIL', `mission did not terminate (${elapsed}ms)`); throw new Error('timeout'); }
    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    record('P2-04', 'PASS', `terminated: status=${snapshot.status}, elapsed=${elapsed}ms, tokens=${snapshot.result?.cost?.tokens ?? 0}`);
    record('P2-STATUS', snapshot.status, `missionId=${missionId}`);
    record('P2-TOKENS', String(snapshot.result?.cost?.tokens ?? 0), `tokens=${snapshot.result?.cost?.tokens ?? 0}`);
    record('P2-ELAPSED', String(elapsed), `${elapsed}ms`);

    // PILOT-002 R3: fetch mission events for definitive worker-step diagnosis.
    // This captures the in-process flight recorder before the gateway dies.
    try {
      const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events`, null, TEST_API_KEY);
      if (eventsRes.status === 200 && eventsRes.body?.events) {
        writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'), JSON.stringify(eventsRes.body.events, null, 2), 'utf8');
        record('P2-EVENTS', 'PASS', `captured ${eventsRes.body.events.length} events`);
      } else {
        record('P2-EVENTS', 'FAIL', `events endpoint returned HTTP ${eventsRes.status}`);
      }
    } catch (e) { record('P2-EVENTS', 'FAIL', e.message); }

    // Fetch artifacts
    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    let artifacts = [];
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'), JSON.stringify(artRes.body, null, 2), 'utf8');
      artifacts = artRes.body.artifacts || [];
      record('P2-ARTIFACTS', artifacts.length >= 8 ? 'PASS' : 'PARTIAL', `artifacts: ${artifacts.length}`);
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

    // ─── INDEPENDENT VERIFICATION ───
    const EXPECTED = ['package.json', 'server.js', 'database.js', 'index.html', 'app.js', 'style.css', 'test/app.test.js', 'README.md'];
    const appDir = join(EVIDENCE_DIR, 'app');
    const cleanRoomDir = `/tmp/pilot-002-clean-${Date.now()}`;
    mkdirSync(cleanRoomDir, { recursive: true });
    let allPresent = true;
    for (const rel of EXPECTED) {
      const src = join(appDir, rel);
      if (existsSync(src)) {
        const dst = join(cleanRoomDir, rel);
        mkdirSync(join(dst, '..'), { recursive: true });
        writeFileSync(dst, readFileSync(src, 'utf8'), 'utf8');
      } else { allPresent = false; record(`P2-FILE-${rel}`, 'MISSING', rel); }
    }

    if (allPresent) {
      // npm test
      const npmTest = spawnSync('npm', ['test'], { cwd: cleanRoomDir, encoding: 'utf8', timeout: 60_000 });
      writeFileSync(join(EVIDENCE_DIR, 'test-stdout.txt'), npmTest.stdout || '', 'utf8');
      writeFileSync(join(EVIDENCE_DIR, 'test-stderr.txt'), npmTest.stderr || '', 'utf8');
      record('P2-NPM_TEST', npmTest.status === 0 ? 'PASS' : 'FAIL', `exit=${npmTest.status}`);

      // Start server
      const appProcess = spawn('node', ['server.js'], { cwd: cleanRoomDir, stdio: ['ignore', 'pipe', 'pipe'] });
      let appOutput = '';
      appProcess.stdout.on('data', (c) => { appOutput += c.toString(); });
      appProcess.stderr.on('data', (c) => { appOutput += c.toString(); });
      await new Promise((r) => setTimeout(r, 2000));

      // HTTP tests
      try {
        const r0 = await fetch('http://127.0.0.1:3000/');
        const html = await r0.text();
        writeFileSync(join(EVIDENCE_DIR, 'http-root.html'), html, 'utf8');
        record('P2-HTTP_ROOT', r0.status === 200 ? 'PASS' : 'FAIL', `HTTP ${r0.status}, ${html.length} bytes`);
      } catch (e) { record('P2-HTTP_ROOT', 'FAIL', e.message); }

      // API: Create task
      let taskId = null;
      try {
        const r1 = await fetch('http://127.0.0.1:3000/api/tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test Task', description: 'A test task' }),
        });
        const task = await r1.json();
        taskId = task.id || task.insertId;
        writeFileSync(join(EVIDENCE_DIR, 'api-create.json'), JSON.stringify(task, null, 2), 'utf8');
        record('P2-API_CREATE', r1.status === 200 || r1.status === 201 ? 'PASS' : 'FAIL', `HTTP ${r1.status}, taskId=${taskId}`);
      } catch (e) { record('P2-API_CREATE', 'FAIL', e.message); }

      // API: List tasks
      try {
        const r2 = await fetch('http://127.0.0.1:3000/api/tasks');
        const tasks = await r2.json();
        writeFileSync(join(EVIDENCE_DIR, 'api-list.json'), JSON.stringify(tasks, null, 2), 'utf8');
        const hasTask = Array.isArray(tasks) ? tasks.some(t => t.title === 'Test Task') : true;
        record('P2-API_LIST', r2.status === 200 && hasTask ? 'PASS' : 'FAIL', `HTTP ${r2.status}, tasks=${Array.isArray(tasks) ? tasks.length : '?'}`);
      } catch (e) { record('P2-API_LIST', 'FAIL', e.message); }

      // API: Complete task
      if (taskId) {
        try {
          const r3 = await fetch(`http://127.0.0.1:3000/api/tasks/${taskId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' }),
          });
          record('P2-API_COMPLETE', r3.status === 200 ? 'PASS' : 'FAIL', `HTTP ${r3.status}`);
        } catch (e) { record('P2-API_COMPLETE', 'FAIL', e.message); }
      }

      // Browser interaction
      try {
        const { chromium } = require('/tmp/openbot-test/agent-computer/node_modules/playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));

        await page.goto('http://127.0.0.1:3000/');
        await page.waitForTimeout(1000);

        // Create task via UI
        await page.fill('input[type="text"], input#title', 'Browser Task');
        const desc = await page.$('textarea, input#description');
        if (desc) await desc.fill('Created via browser');
        const btn = await page.$('button[type="submit"], button#add, button:has-text("Add")');
        if (btn) await btn.click();
        await page.waitForTimeout(1000);

        // Check task appeared
        const body1 = await page.textContent('body');
        record('P2-BROWSER_CREATE', body1 && body1.includes('Browser Task') ? 'PASS' : 'FAIL', `task in list: ${body1?.includes('Browser Task')}`);

        // Screenshot
        await page.screenshot({ path: join(EVIDENCE_DIR, 'browser-screenshot.png') });

        // Check JS errors
        record('P2-BROWSER_JS_ERRORS', errors.length === 0 ? 'PASS' : 'FAIL', errors.length === 0 ? 'none' : errors.join('; '));

        await browser.close();
      } catch (e) { record('P2-BROWSER', 'FAIL', e.message); }

      // Kill server for restart test
      appProcess.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1000));

      // Restart server — verify data persisted in SQLite
      const appProcess2 = spawn('node', ['server.js'], { cwd: cleanRoomDir, stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise((r) => setTimeout(r, 2000));

      try {
        const r4 = await fetch('http://127.0.0.1:3000/api/tasks');
        const tasks = await r4.json();
        writeFileSync(join(EVIDENCE_DIR, 'api-list-after-restart.json'), JSON.stringify(tasks, null, 2), 'utf8');
        const persisted = Array.isArray(tasks) ? tasks.some(t => t.title === 'Test Task' || t.title === 'Browser Task') : true;
        record('P2-PERSISTENCE', r4.status === 200 && persisted ? 'PASS' : 'FAIL', `HTTP ${r4.status}, persisted: ${persisted}`);
      } catch (e) { record('P2-PERSISTENCE', 'FAIL', e.message); }

      appProcess2.kill('SIGTERM');

      // Compute hashes
      const hashes = {};
      for (const rel of EXPECTED) {
        const fp = join(cleanRoomDir, rel);
        if (existsSync(fp)) hashes[rel] = crypto.createHash('sha256').update(readFileSync(fp, 'utf8')).digest('hex');
      }
      writeFileSync(join(EVIDENCE_DIR, 'file-hashes.json'), JSON.stringify(hashes, null, 2), 'utf8');
    }

    writeFileSync(join(EVIDENCE_DIR, 'phase-summary.json'), JSON.stringify(results, null, 2), 'utf8');
  } catch (err) {
    console.error('[pilot-002] fatal:', err);
    record('P2-00', 'FAIL', `fatal: ${err.message}`);
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
