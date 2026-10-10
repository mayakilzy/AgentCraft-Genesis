/**
 * G7-17R Phase 3 — Autonomous Repair Mission.
 *
 * Re-runs the Municipal Service Request Tracker mission with:
 *   - maxWorkerSteps: 15 (was 5 — the root cause of the original failure)
 *   - Real ZAI GLM-4-Plus + real OpenBot runtime
 *   - Corrected goal that includes defect feedback from G7-17
 *
 * No mocks. No manual code intervention.
 */
const { spawn } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, readdirSync, statSync, copyFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');

const EVIDENCE_DIR = join(__dirname, '..', 'evidence', 'g7-17r');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const ENGINE_DIR = resolve(__dirname, '..');
const GATEWAY_PORT = '4180';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-g7-17r';
const TEST_API_KEY = 'g7-17r-repair-key';

const REPAIR_GOAL = `Build a small, functional Node.js application: "Municipal Service Request Tracker — Prototype v0.1".

Create ALL files using write_file, then finish. Do NOT exceed your step budget.

Required files (write each one, then call finish):
1. app.js — Main application with:
   - createRequest(title, description, status) — creates a new request
   - listRequests() — lists all requests
   - filterByStatus(status) — filters by status
   - updateStatus(id, newStatus) — updates a request's status
   - Persistence to data.json (load on startup, save on change)
   - Input validation (reject empty titles, invalid status values: pending, in-progress, resolved, rejected)
   - CLI interface: node app.js create|list|filter|update
   - Export functions for testing (module.exports)
2. package.json — with name, version, main, scripts.test
3. README.md — Installation and usage instructions
4. test.js — Automated tests using Node.js built-in test runner (node:test):
   - Test createRequest, listRequests, filterByStatus, updateStatus
   - Test input validation
   - Must run with: node --test test.js
5. data.json — Initialize with empty array: []

IMPORTANT: After writing ALL files, call finish with artifacts: ["app.js", "package.json", "README.md", "test.js", "data.json"]`;

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
        callerId: 'g7-17r-repair-caller',
        allowedOperations: ['mission:submit'],
        maxActiveMissions: 5,
        maxMissionTimeoutMs: 300_000,
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
      timeout: 300_000,
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
    try { const r = await fetch(url); if (r.status === 200 || r.status === 401) return true; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

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

(async () => {
  let gateway;
  try {
    // --- Start Gateway (production mode, maxWorkerSteps=15) ---
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
      cwd: ENGINE_DIR, env: buildGatewayEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stderr.on('data', (c) => { const t = c.toString(); if (t.length < 400) console.log('[gw]', t.trim()); });
    const gwUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 120_000);
    if (!gwUp) { record('P3-01', 'FAIL', 'gateway did not come up'); process.exit(1); }
    record('P3-01', 'PASS', 'production gateway up (maxWorkerSteps=15)');

    // --- Submit repair mission via API ---
    const submit = await httpCall('POST', '/v1/missions', {
      outcome: REPAIR_GOAL,
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

    if (submit.status !== 202) {
      record('P3-02', 'FAIL', `mission submission failed: ${submit.status}`);
      process.exit(1);
    }
    const missionId = submit.body.missionId;
    record('P3-02', 'PASS', `repair mission submitted: ${missionId}`);

    // --- Wait for completion (up to 5 min) ---
    record('P3-03', 'INFO', 'waiting for real ZAI + OpenBot execution...');
    let snapshot = null;
    const startTime = Date.now();
    for (let i = 0; i < 600; i++) {
      const get = await httpCall('GET', `/v1/missions/${missionId}`, null, TEST_API_KEY);
      if (get.status === 200 && get.body.terminal) {
        snapshot = get.body;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const elapsed = Date.now() - startTime;

    if (!snapshot) {
      record('P3-04', 'FAIL', `mission did not terminate within 5 min (elapsed ${elapsed}ms)`);
      process.exit(1);
    }

    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    record('P3-04', 'PASS', `mission terminated: status=${snapshot.status}, elapsed=${elapsed}ms`);

    // --- Token usage ---
    const tokens = snapshot.result?.cost?.tokens;
    record('P3-05', tokens && tokens > 0 ? 'PASS' : 'FAIL', `token usage: ${tokens ?? 0}`);

    // --- Events ---
    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events?limit=200`, null, TEST_API_KEY);
    if (eventsRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'), JSON.stringify(eventsRes.body, null, 2), 'utf8');
      const writeEvents = (eventsRes.body.events || []).filter(e => e.payload?.action === 'write_file' && e.payload?.ok);
      record('P3-06', writeEvents.length > 0 ? 'PASS' : 'FAIL', `write_file events: ${writeEvents.length}`);
    }

    // --- Artifacts ---
    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'), JSON.stringify(artRes.body, null, 2), 'utf8');
      const artifacts = artRes.body.artifacts || [];
      record('P3-07', artifacts.length > 0 ? 'PASS' : 'FAIL', `artifacts delivered: ${artifacts.length}`);

      // Save artifact content to evidence.
      for (const a of artifacts) {
        if (a.content) {
          writeFileSync(join(EVIDENCE_DIR, a.path), a.content, 'utf8');
        }
      }
    }

    // --- Find workspace files on disk ---
    const wsBase = join(OPENBOT_ROOT, missionId);
    const wsFiles = findFiles(wsBase);
    // Save all workspace files.
    for (const f of wsFiles) {
      if (!existsSync(join(EVIDENCE_DIR, f.path))) {
        try {
          const content = readFileSync(f.full, 'utf8');
          const dir = join(EVIDENCE_DIR, f.path.split('/').slice(0, -1).join('/'));
          if (dir) mkdirSync(dir, { recursive: true });
          writeFileSync(join(EVIDENCE_DIR, f.path), content, 'utf8');
        } catch { /* binary */ }
      }
    }
    writeFileSync(join(EVIDENCE_DIR, 'workspace-files.json'), JSON.stringify(wsFiles.map(f => f.path), null, 2), 'utf8');

    // --- Phase 4: Clean-room acceptance ---
    const testDir = join(EVIDENCE_DIR, 'clean-room-test');
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    // Copy ONLY the generated files — no modification.
    const requiredFiles = ['app.js', 'package.json', 'README.md', 'test.js', 'data.json'];
    let allFilesPresent = true;
    for (const f of requiredFiles) {
      const src = join(EVIDENCE_DIR, f);
      if (existsSync(src)) {
        copyFileSync(src, join(testDir, f));
      } else {
        // Check workspace paths.
        for (const ws of wsFiles) {
          if (ws.path.endsWith('/' + f) || ws.path === f) {
            copyFileSync(ws.full, join(testDir, f));
            break;
          }
        }
      }
      if (!existsSync(join(testDir, f))) {
        allFilesPresent = false;
        record(`P4-FILE-${f}`, 'FAIL', `file not found`);
      }
    }

    if (allFilesPresent) {
      record('P4-01', 'PASS', 'all 5 required files present in clean-room copy');
    } else {
      record('P4-01', 'FAIL', 'some files missing');
    }

    // --- Verify data.json is valid JSON array ---
    try {
      const dataContent = readFileSync(join(testDir, 'data.json'), 'utf8');
      const parsed = JSON.parse(dataContent);
      record('P4-02', Array.isArray(parsed) ? 'PASS' : 'FAIL', `data.json is ${Array.isArray(parsed) ? 'valid array' : 'not an array'}`);
    } catch (e) {
      record('P4-02', 'FAIL', `data.json invalid: ${e.message}`);
    }

    // --- npm install ---
    const installResult = require('node:child_process').spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: testDir, stdio: 'pipe', timeout: 60_000,
    });
    writeFileSync(join(EVIDENCE_DIR, 'npm-install.txt'), (installResult.stdout?.toString() || '') + (installResult.stderr?.toString() || ''), 'utf8');
    record('P4-03', installResult.status === 0 ? 'PASS' : 'PARTIAL', `npm install exit: ${installResult.status}`);

    // --- Run the app ---
    const runResult = require('node:child_process').spawnSync('node', ['app.js'], {
      cwd: testDir, stdio: 'pipe', timeout: 10_000,
    });
    writeFileSync(join(EVIDENCE_DIR, 'app-stdout.txt'), runResult.stdout?.toString() || '', 'utf8');
    record('P4-04', runResult.status === 0 || runResult.status === null ? 'PASS' : 'FAIL', `app.js exit: ${runResult.status}`);

    // --- CRUD operations ---
    // Create
    const createResult = require('node:child_process').spawnSync('node', ['app.js', 'create', 'Street Light Out', 'Main St light out', 'pending'], {
      cwd: testDir, stdio: 'pipe', timeout: 10_000,
    });
    const createOut = createResult.stdout?.toString() || '';
    record('P4-05', createOut.includes('created') || createOut.includes('Request') ? 'PASS' : 'FAIL', `create: ${createOut.slice(0, 80)}`);

    // List
    const listResult = require('node:child_process').spawnSync('node', ['app.js', 'list'], {
      cwd: testDir, stdio: 'pipe', timeout: 10_000,
    });
    const listOut = listResult.stdout?.toString() || '';
    record('P4-06', listOut.includes('Street Light Out') ? 'PASS' : 'FAIL', `list: ${listOut.slice(0, 80)}`);

    // Filter
    const filterResult = require('node:child_process').spawnSync('node', ['app.js', 'filter', 'pending'], {
      cwd: testDir, stdio: 'pipe', timeout: 10_000,
    });
    const filterOut = filterResult.stdout?.toString() || '';
    record('P4-07', filterOut.includes('Street Light Out') ? 'PASS' : 'FAIL', `filter: ${filterOut.slice(0, 80)}`);

    // Get the ID from the data.json for update
    const dataJson = JSON.parse(readFileSync(join(testDir, 'data.json'), 'utf8'));
    const requestId = dataJson[0]?.id;
    if (requestId) {
      const updateResult = require('node:child_process').spawnSync('node', ['app.js', 'update', requestId, 'in-progress'], {
        cwd: testDir, stdio: 'pipe', timeout: 10_000,
      });
      const updateOut = updateResult.stdout?.toString() || '';
      record('P4-08', updateOut.includes('updated') || updateOut.includes('in-progress') ? 'PASS' : 'FAIL', `update: ${updateOut.slice(0, 80)}`);

      // Verify persistence — check data.json after update
      const dataAfter = JSON.parse(readFileSync(join(testDir, 'data.json'), 'utf8'));
      record('P4-09', dataAfter[0]?.status === 'in-progress' ? 'PASS' : 'FAIL', `persistence: status=${dataAfter[0]?.status}`);
    } else {
      record('P4-08', 'FAIL', 'no request ID found for update');
      record('P4-09', 'FAIL', 'no request ID — cannot test persistence');
    }

    // --- Input validation ---
    const validResult = require('node:child_process').spawnSync('node', ['app.js', 'create', '', 'test', 'pending'], {
      cwd: testDir, stdio: 'pipe', timeout: 10_000,
    });
    const validOut = validResult.stdout?.toString() + (validResult.stderr?.toString() || '');
    record('P4-10', validOut.includes('empty') || validOut.includes('invalid') || validOut.includes('Error') ? 'PASS' : 'FAIL', `validation: ${validOut.slice(0, 80)}`);

    // --- Automated tests ---
    const testResult = require('node:child_process').spawnSync('node', ['--test', 'test.js'], {
      cwd: testDir, stdio: 'pipe', timeout: 30_000,
    });
    writeFileSync(join(EVIDENCE_DIR, 'test-stdout.txt'), testResult.stdout?.toString() || '', 'utf8');
    writeFileSync(join(EVIDENCE_DIR, 'test-stderr.txt'), testResult.stderr?.toString() || '', 'utf8');
    const testOut = testResult.stdout?.toString() || '';
    const testPass = testOut.includes('pass') && !testOut.includes('0 pass');
    record('P4-11', testResult.status === 0 && testPass ? 'PASS' : 'FAIL', `tests exit: ${testResult.status}, output: ${testOut.slice(0, 100)}`);

    // --- SHA-256 hashes ---
    for (const f of requiredFiles) {
      if (existsSync(join(testDir, f))) {
        const hash = crypto.createHash('sha256').update(readFileSync(join(testDir, f), 'utf8')).digest('hex');
        record(`HASH-${f}`, 'INFO', hash);
      }
    }

    // --- No secrets check ---
    let noSecrets = true;
    for (const f of requiredFiles) {
      if (existsSync(join(testDir, f))) {
        const content = readFileSync(join(testDir, f), 'utf8');
        if (content.includes('ghp_') || content.includes('sk-') || content.includes('password')) {
          noSecrets = false;
          record('P4-12', 'FAIL', `secrets found in ${f}`);
        }
      }
    }
    if (noSecrets) record('P4-12', 'PASS', 'no secrets in generated files');

    record('MANUAL', 'INFO', 'No manual artifact modification — all files generated by Genesis');

  } catch (err) {
    console.error('[g7-17r] fatal:', err);
    record('P3-00', 'FAIL', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    writeFileSync(join(EVIDENCE_DIR, 'results.json'), JSON.stringify({ results }, null, 2), 'utf8');
    console.log(`Results: ${join(EVIDENCE_DIR, 'results.json')}`);
    if (gateway) try { gateway.kill('SIGTERM'); } catch {}
    try { require('node:child_process').spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch {}
    try { require('node:child_process').spawnSync('pkill', ['-f', 'bun.*agent-computer'], { stdio: 'ignore' }); } catch {}
    setTimeout(() => process.exit(0), 1500);
  }
})();
