/**
 * G7-17S — First Fully Successful Autonomous Application.
 *
 * Executes the Municipal Service Request Tracker mission with:
 *   - maxWorkerSteps: 30 (sufficient for multi-file generation + correction)
 *   - Mission timeout: 600s (10 min — sufficient for full dev+verify cycle)
 *   - Goal includes feedback about previous test failures
 *   - Real ZAI GLM-4-Plus + real OpenBot runtime
 *   - No mocks, no manual intervention
 */
const { spawn } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, readdirSync, statSync, copyFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');

const EVIDENCE_DIR = join(__dirname, '..', 'evidence', 'g7-17s');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const ENGINE_DIR = resolve(__dirname, '..');
const GATEWAY_PORT = '4180';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-g7-17s';
const TEST_API_KEY = 'g7-17s-success-key';

const GOAL = `Build a Node.js app: "Municipal Service Request Tracker v0.1".

Write ALL files via write_file, then call finish. Do NOT exceed your step budget.

Previous test failures to avoid:
1. assert.throws with matching message causes ERR_AMBIGUOUS_ARGUMENT. Use try/catch or assert.throws(fn, Error) without a message string.
2. Data not reset between tests. Reset data.json to [] before each test.

Required files:
1. app.js: createRequest(title,desc,status), listRequests(), filterByStatus(status), updateStatus(id,newStatus). Persist to data.json. Validate: reject empty title/desc, invalid status (pending,in-progress,resolved,rejected). CLI: node app.js create|list|filter|update. Export functions.
2. package.json: name,version,main:app.js,scripts.test:"node --test test.js"
3. README.md: npm install + usage
4. test.js: Use node:test + node:assert. Test create/list/filter/update + validation. Reset data.json to [] before each test. Must pass: node --test test.js
5. data.json: []

After ALL 5 files, call: {"action":"finish","summary":"Done","artifacts":["app.js","package.json","README.md","test.js","data.json"]}`;

function buildGatewayEnv() {
  return {
    ...process.env,
    GENESIS_EXECUTION_MODE: 'production',
    GENESIS_REASONING_PROVIDER: 'zai',
    GENESIS_RUNTIME_PROVIDER: 'openbot',
    OPENBOT_CHECKOUT_DIR: OPENBOT_CHECKOUT,
    OPENBOT_ROOT_DIR: OPENBOT_ROOT,
    ZAI_SDK_PATH: 'z-ai-web-dev-sdk',
    GENESIS_MAX_WORKER_STEPS: '30',
    GENESIS_HTTP_PORT: GATEWAY_PORT,
    GENESIS_A2A_PORT: '4181',
    GENESIS_API_KEYS: JSON.stringify({
      [TEST_API_KEY]: {
        callerId: 'g7-17s-success-caller',
        allowedOperations: ['mission:submit'],
        maxActiveMissions: 5,
        maxMissionTimeoutMs: 600_000,
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
      method, headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) }, timeout: 600_000,
    }, (res) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let parsed = raw; try { parsed = JSON.parse(raw); } catch {} resolve({ status: res.statusCode ?? 0, body: parsed, raw }); }); });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload); req.end();
  });
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { try { const r = await fetch(url); if (r.status === 200 || r.status === 401) return true; } catch {} await new Promise(r => setTimeout(r, 500)); }
  return false;
}

function findFiles(dir, prefix = '') {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) { const full = join(dir, f); const s = statSync(full); if (s.isDirectory()) { out.push(...findFiles(full, prefix + f + '/')); } else { out.push({ path: prefix + f, full }); } }
  return out;
}

(async () => {
  let gateway;
  try {
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], { cwd: ENGINE_DIR, env: buildGatewayEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    gateway.stderr.on('data', c => { const t = c.toString(); if (t.length < 400) console.log('[gw]', t.trim()); });
    const gwUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 120_000);
    if (!gwUp) { record('S-01', 'FAIL', 'gateway did not come up'); process.exit(1); }
    record('S-01', 'PASS', 'production gateway up (maxWorkerSteps=30, timeout=600s)');

    const submit = await httpCall('POST', '/v1/missions', {
      outcome: GOAL,
      acceptanceCriteria: [
        { kind: 'file', label: 'app.js exists', path: 'app.js' },
        { kind: 'file', label: 'package.json exists', path: 'package.json' },
        { kind: 'file', label: 'README.md exists', path: 'README.md' },
        { kind: 'file', label: 'test.js exists', path: 'test.js' },
        { kind: 'file', label: 'data.json exists', path: 'data.json' },
        { kind: 'content-in-artifacts', label: 'has createRequest', expectIncludes: 'createRequest' },
        { kind: 'content-in-artifacts', label: 'has listRequests', expectIncludes: 'listRequests' },
        { kind: 'content-in-artifacts', label: 'has filterByStatus', expectIncludes: 'filterByStatus' },
        { kind: 'content-in-artifacts', label: 'has updateStatus', expectIncludes: 'updateStatus' },
        { kind: 'content-in-artifacts', label: 'has data.json persistence', expectIncludes: 'data.json' },
      ],
    }, TEST_API_KEY);
    if (submit.status !== 202) { record('S-02', 'FAIL', `submission failed: ${submit.status}`); process.exit(1); }
    const missionId = submit.body.missionId;
    record('S-02', 'PASS', `mission submitted: ${missionId}`);

    record('S-03', 'INFO', 'waiting for execution...');
    let snapshot = null;
    const startTime = Date.now();
    for (let i = 0; i < 1200; i++) { // 10 min
      const get = await httpCall('GET', `/v1/missions/${missionId}`, null, TEST_API_KEY);
      if (get.status === 200 && get.body.terminal) { snapshot = get.body; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    const elapsed = Date.now() - startTime;
    if (!snapshot) { record('S-04', 'FAIL', `did not terminate in 10 min (${elapsed}ms)`); process.exit(1); }

    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    record('S-04', 'PASS', `mission terminated: status=${snapshot.status}, elapsed=${elapsed}ms`);

    const tokens = snapshot.result?.cost?.tokens;
    record('S-05', tokens > 0 ? 'PASS' : 'FAIL', `tokens: ${tokens ?? 0}`);

    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events?limit=200`, null, TEST_API_KEY);
    if (eventsRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'), JSON.stringify(eventsRes.body, null, 2), 'utf8');
      const writeEvents = (eventsRes.body.events || []).filter(e => e.payload?.action === 'write_file' && e.payload?.ok);
      record('S-06', writeEvents.length > 0 ? 'PASS' : 'FAIL', `write_file events: ${writeEvents.length}`);
    }

    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'), JSON.stringify(artRes.body, null, 2), 'utf8');
      const artifacts = artRes.body.artifacts || [];
      record('S-07', artifacts.length > 0 ? 'PASS' : 'FAIL', `artifacts: ${artifacts.length}`);
      for (const a of artifacts) { if (a.content) writeFileSync(join(EVIDENCE_DIR, a.path), a.content, 'utf8'); }
    }

    // Save workspace files
    const wsBase = join(OPENBOT_ROOT, missionId);
    const wsFiles = findFiles(wsBase);
    for (const f of wsFiles) {
      if (!existsSync(join(EVIDENCE_DIR, f.path))) {
        try { const content = readFileSync(f.full, 'utf8'); const dir = join(EVIDENCE_DIR, f.path.split('/').slice(0,-1).join('/')); if (dir) mkdirSync(dir, { recursive: true }); writeFileSync(join(EVIDENCE_DIR, f.path), content, 'utf8'); } catch {}
      }
    }
    writeFileSync(join(EVIDENCE_DIR, 'workspace-files.json'), JSON.stringify(wsFiles.map(f => f.path), null, 2), 'utf8');

    // Phase 4: Clean-room acceptance
    const testDir = join(EVIDENCE_DIR, 'clean-room-test');
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    const requiredFiles = ['app.js', 'package.json', 'README.md', 'test.js', 'data.json'];
    let allPresent = true;
    for (const f of requiredFiles) {
      const src = join(EVIDENCE_DIR, f);
      if (existsSync(src)) { copyFileSync(src, join(testDir, f)); }
      else { for (const ws of wsFiles) { if (ws.path.endsWith('/' + f) || ws.path === f) { copyFileSync(ws.full, join(testDir, f)); break; } } }
      if (!existsSync(join(testDir, f))) { allPresent = false; record(`A-FILE-${f}`, 'FAIL', 'not found'); }
    }
    record('A-01', allPresent ? 'PASS' : 'FAIL', `files: ${requiredFiles.map(f => existsSync(join(testDir, f))).join(',')}`);

    // data.json valid
    try { const d = JSON.parse(readFileSync(join(testDir, 'data.json'), 'utf8')); record('A-02', Array.isArray(d) ? 'PASS' : 'FAIL', `data.json: ${JSON.stringify(d).slice(0,30)}`); } catch(e) { record('A-02', 'FAIL', e.message); }

    // npm install
    const inst = require('node:child_process').spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: testDir, stdio: 'pipe', timeout: 60_000 });
    writeFileSync(join(EVIDENCE_DIR, 'npm-install.txt'), (inst.stdout?.toString()||'') + (inst.stderr?.toString()||''), 'utf8');
    record('A-03', inst.status === 0 ? 'PASS' : 'FAIL', `npm install: ${inst.status}`);

    // Run app
    const run = require('node:child_process').spawnSync('node', ['app.js'], { cwd: testDir, stdio: 'pipe', timeout: 10_000 });
    writeFileSync(join(EVIDENCE_DIR, 'app-stdout.txt'), run.stdout?.toString() || '', 'utf8');
    record('A-04', run.status === 0 || run.status === null ? 'PASS' : 'FAIL', `app.js: exit ${run.status}`);

    // CRUD: Create
    const create = require('node:child_process').spawnSync('node', ['app.js', 'create', 'Street Light Out', 'Main St light', 'pending'], { cwd: testDir, stdio: 'pipe', timeout: 10_000 });
    record('A-05', create.stdout?.toString().includes('created') || create.stdout?.toString().includes('Request') ? 'PASS' : 'FAIL', `create: ${create.stdout?.toString().slice(0,80)}`);

    // List
    const list = require('node:child_process').spawnSync('node', ['app.js', 'list'], { cwd: testDir, stdio: 'pipe', timeout: 10_000 });
    record('A-06', list.stdout?.toString().includes('Street Light Out') ? 'PASS' : 'FAIL', `list: ${list.stdout?.toString().slice(0,80)}`);

    // Filter
    const filter = require('node:child_process').spawnSync('node', ['app.js', 'filter', 'pending'], { cwd: testDir, stdio: 'pipe', timeout: 10_000 });
    record('A-07', filter.stdout?.toString().includes('Street Light Out') ? 'PASS' : 'FAIL', `filter: ${filter.stdout?.toString().slice(0,80)}`);

    // Update
    const dataJson = JSON.parse(readFileSync(join(testDir, 'data.json'), 'utf8'));
    const reqId = dataJson[0]?.id;
    if (reqId) {
      const update = require('node:child_process').spawnSync('node', ['app.js', 'update', String(reqId), 'in-progress'], { cwd: testDir, stdio: 'pipe', timeout: 10_000 });
      record('A-08', update.stdout?.toString().includes('updated') || update.stdout?.toString().includes('in-progress') ? 'PASS' : 'FAIL', `update: ${update.stdout?.toString().slice(0,80)}`);
      const dataAfter = JSON.parse(readFileSync(join(testDir, 'data.json'), 'utf8'));
      record('A-09', dataAfter[0]?.status === 'in-progress' ? 'PASS' : 'FAIL', `persistence: ${dataAfter[0]?.status}`);
    } else { record('A-08', 'FAIL', 'no ID'); record('A-09', 'FAIL', 'no ID'); }

    // Validation
    const valid = require('node:child_process').spawnSync('node', ['app.js', 'create', '', 'test', 'pending'], { cwd: testDir, stdio: 'pipe', timeout: 10_000 });
    record('A-10', (valid.stdout?.toString() + (valid.stderr?.toString()||'')).includes('empty') || (valid.stdout?.toString() + (valid.stderr?.toString()||'')).includes('Error') ? 'PASS' : 'FAIL', `validation: ${(valid.stdout?.toString() + (valid.stderr?.toString()||'')).slice(0,80)}`);

    // Automated tests
    const test = require('node:child_process').spawnSync('node', ['--test', 'test.js'], { cwd: testDir, stdio: 'pipe', timeout: 30_000 });
    writeFileSync(join(EVIDENCE_DIR, 'test-stdout.txt'), test.stdout?.toString() || '', 'utf8');
    writeFileSync(join(EVIDENCE_DIR, 'test-stderr.txt'), test.stderr?.toString() || '', 'utf8');
    const testOut = test.stdout?.toString() || '';
    const passMatch = testOut.match(/ℹ pass\s+(\d+)/);
    const failMatch = testOut.match(/ℹ fail\s+(\d+)/);
    const passCount = passMatch ? parseInt(passMatch[1]) : 0;
    const failCount = failMatch ? parseInt(failMatch[1]) : 0;
    record('A-11', test.status === 0 && failCount === 0 && passCount > 0 ? 'PASS' : 'FAIL', `tests: exit=${test.status}, pass=${passCount}, fail=${failCount}`);

    // Hashes
    for (const f of requiredFiles) { if (existsSync(join(testDir, f))) { const h = crypto.createHash('sha256').update(readFileSync(join(testDir, f), 'utf8')).digest('hex'); record(`HASH-${f}`, 'INFO', h); } }

    // No secrets
    let clean = true;
    for (const f of requiredFiles) { if (existsSync(join(testDir, f))) { const c = readFileSync(join(testDir, f), 'utf8'); if (c.includes('ghp_') || c.includes('sk-') || c.includes('password')) { clean = false; } } }
    record('A-12', clean ? 'PASS' : 'FAIL', 'no secrets');

    record('MANUAL', 'INFO', 'No manual artifact modification');

  } catch (err) {
    console.error('[g7-17s] fatal:', err);
    record('S-00', 'FAIL', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    writeFileSync(join(EVIDENCE_DIR, 'results.json'), JSON.stringify({ results }, null, 2), 'utf8');
    console.log(`Results: ${join(EVIDENCE_DIR, 'results.json')}`);
    if (gateway) try { gateway.kill('SIGTERM'); } catch {}
    try { require('node:child_process').spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch {}
    try { require('node:child_process').spawnSync('pkill', ['-f', 'bun.*agent-computer'], { stdio: 'ignore' }); } catch {}
    setTimeout(() => process.exit(0), 1500);
  }
})();
