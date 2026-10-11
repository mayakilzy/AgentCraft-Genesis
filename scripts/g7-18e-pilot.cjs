/**
 * G7-18E Phase 2 — Focused Autonomous Repair Mission.
 *
 * Submits the 9 existing Community Project Hub files via the real
 * `missionInputs` bridge to a production Genesis gateway (real ZAI
 * GLM-4-Plus + real OpenBot runtime). The mission goal is a focused
 * instruction to repair only `test/api.test.js` so that:
 *
 *   1. The "should filter tasks by status" test verifies the documented
 *      cross-project filtering semantics instead of assuming isolation
 *      that doesn't exist.
 *   2. The spawned test server is properly stopped in `test.after` so
 *      `npm test` terminates cleanly.
 *   3. All other tests and files are preserved unchanged.
 *
 * No mocks. No manual code intervention. One controlled live attempt.
 */
const { spawn, spawnSync } = require('node:child_process');
const {
  writeFileSync, mkdirSync, existsSync, rmSync, readFileSync,
  readdirSync, statSync, copyFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');

// ─── Configuration ────────────────────────────────────────────────────
const ENGINE_DIR = resolve(__dirname, '..');
const EVIDENCE_DIR = join(ENGINE_DIR, 'evidence', 'g7-18e');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const CLEAN_ROOM_SRC = join(ENGINE_DIR, 'evidence', 'g7-18d', 'clean-room-app');
const GATEWAY_PORT = '4280';
const A2A_PORT = '4281';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-g7-18e';
const TEST_API_KEY = 'g7-18e-final-key';
const MAX_WORKER_STEPS = '40';
const MISSION_TIMEOUT_MS = 420_000;

// ─── Mission Inputs (9 source files) ──────────────────────────────────
const MISSION_INPUT_FILES = [
  'README.md',
  'package.json',
  'public/app.js',
  'public/index.html',
  'public/styles.css',
  'server.js',
  'test/api.test.js',
  'test/db.test.js',
  'test/integration.test.js',
];

function loadMissionInputs() {
  const inputs = [];
  const startingHashes = {};
  for (const rel of MISSION_INPUT_FILES) {
    const full = join(CLEAN_ROOM_SRC, rel);
    if (!existsSync(full)) {
      throw new Error(`missing mission input file: ${rel}`);
    }
    const contents = readFileSync(full, 'utf8');
    const hash = crypto.createHash('sha256').update(contents).digest('hex');
    startingHashes[rel] = hash;
    inputs.push({ path: rel, contents });
  }
  writeFileSync(join(EVIDENCE_DIR, 'starting-hashes.json'),
    JSON.stringify(startingHashes, null, 2), 'utf8');
  return inputs;
}

// ─── Repair goal (Phase 2 contract) ──────────────────────────────────
// NOTE: outcome is hard-capped at 2000 chars by MAX_OUTCOME_LENGTH.
// Move diagnostic detail into `context` (no cap) and `constraints` (array).
const REPAIR_GOAL = `Repair the Community Project Hub automated tests so they accurately verify the documented cross-project status-filtering behavior, and so the test process terminates cleanly.

You have been given 9 files as missionInputs. Reproduce ALL 9 (apply the repair only to test/api.test.js). Do NOT add new files. Do NOT weaken or skip any existing test. Do NOT change the test framework (still node:test).

Two defects live in test/api.test.js ONLY:
1. The test "should filter tasks by status" asserts length===1 for status=todo/in-progress/done, but earlier tests in the same file share the same test DB and mutate it. Actual returned counts at assertion time: 4 (todo), 2 (in-progress), 1 (done). The application is correct — the test wrongly assumed isolation. Fix it to verify documented cross-project semantics: GET /api/tasks?status=<s> returns ALL matching tasks across ALL projects; GET /api/projects/:id/tasks returns ONLY the specified project's tasks. Acceptable fix: either (a) reset the test DB between tests via test.beforeEach, or (b) rewrite assertions to confirm the response contains exactly one task belonging to this test's own project with the expected title, while other entries belong to other projects. Do NOT replace with assert.ok(true) or skip it.
2. The spawned server from test.before is never stopped — test.after only calls cleanupDb(). Mirror the pattern in test/integration.test.js: store the spawn handle in a module-level variable (e.g. global.testServer) in test.before, and call stopTestServer(global.testServer) in test.after so the process can exit.

After repair, ALL tests in test/api.test.js MUST pass, AND test/db.test.js and test/integration.test.js MUST continue to pass unchanged, AND 'npm test' MUST exit 0 within 60 seconds.

Write ALL 9 files using write_file, then call finish with artifacts: ["README.md","package.json","public/app.js","public/index.html","public/styles.css","server.js","test/api.test.js","test/db.test.js","test/integration.test.js"].`;

const REPAIR_CONTEXT = `G7-18E Phase 2 — Focused Autonomous Repair. Real ZAI GLM-4-Plus + real OpenBot runtime. The 9 source files are staged as missionInputs — read them, reproduce them, apply the repair ONLY to test/api.test.js, then finish.

DIAGNOSIS SUMMARY (independently reproduced before this mission):
- The application server.js is correct. GET /api/tasks?status=<status> is documented to return ALL matching tasks across ALL projects (cross-project filter). GET /api/projects/:id/tasks is documented to return ONLY the specified project's tasks (project-scoped retrieval).
- The failing test "should filter tasks by status" in test/api.test.js assumes its data is isolated, but the entire file runs against a single shared test DB (hub.test.api.db on port 3001). Earlier tests in the same file mutate that DB:
  • "should create a new task for existing project" inserts 'Test Task' (status=todo) for Project 3.
  • "should update task status with valid value" inserts 'Test Task to Update' for Project 5 and PATCHes it to in-progress.
  • "should reject invalid task status" inserts 'Test Task to Update' for Project 6 (PATCH rejected, stays todo).
  • "should reject update without status" inserts 'Test Task to Update' for Project 7 (PATCH rejected, stays todo).
- At the moment the failing test asserts length===1, the actual returned counts are: todo=4, in-progress=2, done=1. The first assertion fails with 4 !== 1.
- Hang cause: test.before spawns a server via startTestServer() but DISCARDS the returned spawn handle. test.after calls only cleanupDb() and never stopTestServer(). The orphaned server keeps port 3001 open; node:test cannot exit. This is why 'npm test' hangs indefinitely after the assertion failure — even with a correct assertion, the hang would still occur.
- The other two test files are fine:
  • test/db.test.js uses its own DB (hub.test.db.db) and direct DatabaseSync — no server, no hang.
  • test/integration.test.js uses its own DB (hub.test.integration.db) on port 3002, stores global.testServer, and properly calls stopTestServer(global.testServer) in test.after. Mirror this pattern.

ACCEPTABLE REPAIR STRATEGIES (Genesis may choose either):
- Strategy A — per-test reset: add test.beforeEach that deletes the test DB and restarts the server, and update test.after to stop the server. Each test runs in isolation; the existing assertions still hold.
- Strategy B — cross-project-aware assertions: keep the single shared DB, but rewrite the filter test to assert that the response contains exactly one task that belongs to Project 8 and has the expected title, while the other entries belong to other projects. This verifies cross-project semantics without weakening coverage.

Either strategy is acceptable provided:
- All 16 tests in test/api.test.js still pass.
- The filter test still verifies cross-project status filtering (no assert.ok(true), no skip).
- npm test exits 0 within 60 seconds in a clean room.
- No new files are created.
- No other file is modified.`;

// ─── Acceptance criteria (caller-supplied) ───────────────────────────
const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'README.md exists', path: 'README.md' },
  { kind: 'file', label: 'package.json exists', path: 'package.json' },
  { kind: 'file', label: 'public/app.js exists', path: 'public/app.js' },
  { kind: 'file', label: 'public/index.html exists', path: 'public/index.html' },
  { kind: 'file', label: 'public/styles.css exists', path: 'public/styles.css' },
  { kind: 'file', label: 'server.js exists', path: 'server.js' },
  { kind: 'file', label: 'test/api.test.js exists', path: 'test/api.test.js' },
  { kind: 'file', label: 'test/db.test.js exists', path: 'test/db.test.js' },
  { kind: 'file', label: 'test/integration.test.js exists', path: 'test/integration.test.js' },
  // The repair must terminate the spawned server in test.after.
  { kind: 'content-in-artifacts', label: 'api.test.js calls stopTestServer in test.after',
    expectIncludes: 'stopTestServer' },
  // The repair must NOT weaken the filter assertion to a no-op.
  { kind: 'content-in-artifacts', label: 'api.test.js still asserts status filtering',
    expectIncludes: 'status=todo' },
];

// ─── Gateway env (production mode, real ZAI + OpenBot) ───────────────
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
        callerId: 'g7-18e-final-caller',
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
    if (f === 'node_modules' || f === '.git') continue;
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
  try {
    // Load mission inputs (9 files) and record starting hashes
    const missionInputs = loadMissionInputs();
    record('P2-00', 'PASS', `loaded ${missionInputs.length} mission input files`);

    // Start the production gateway
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
      cwd: ENGINE_DIR, env: buildGatewayEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stderr.on('data', (c) => {
      const t = c.toString();
      if (t.length < 400) console.log('[gw]', t.trim());
    });
    const gwUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 120_000);
    if (!gwUp) { record('P2-01', 'FAIL', 'gateway did not come up'); throw new Error('gw up fail'); }
    record('P2-01', 'PASS', `production gateway up on port ${GATEWAY_PORT} (maxWorkerSteps=${MAX_WORKER_STEPS})`);

    // Submit the repair mission via missionInputs bridge
    const submitBody = {
      outcome: REPAIR_GOAL,
      context: REPAIR_CONTEXT,
      constraints: [
        'Do NOT modify server.js, public/app.js, public/index.html, public/styles.css, test/db.test.js, test/integration.test.js, package.json, or README.md.',
        'Do NOT add new files.',
        'Do NOT weaken or skip any existing test (no assert.ok(true), no test.skip).',
        'Do NOT change the test framework (still node:test).',
        'After repair, npm test MUST exit 0 within 60 seconds.',
      ],
      label: 'g7-18e-final-repair',
      acceptanceCriteria: ACCEPTANCE_CRITERIA,
      missionInputs,
    };
    const submit = await httpCall('POST', '/v1/missions', submitBody, TEST_API_KEY);
    if (submit.status !== 202) {
      writeFileSync(join(EVIDENCE_DIR, 'submit-failure.json'),
        JSON.stringify({ status: submit.status, body: submit.body, raw: submit.raw }, null, 2), 'utf8');
      record('P2-02', 'FAIL', `mission submission failed: HTTP ${submit.status}`);
      throw new Error('submit fail');
    }
    const missionId = submit.body.missionId;
    record('P2-02', 'PASS', `repair mission submitted via missionInputs: ${missionId}`);
    writeFileSync(join(EVIDENCE_DIR, 'submit-response.json'),
      JSON.stringify(submit.body, null, 2), 'utf8');

    // Wait for terminal status
    record('P2-03', 'INFO', 'waiting for real ZAI + OpenBot execution (timeout 420s)...');
    let snapshot = null;
    const startTime = Date.now();
    const pollUntil = startTime + MISSION_TIMEOUT_MS + 60_000; // +60s grace
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
        // Never let a transient poll error kill the pilot — just log and continue.
        console.log(`  [poll ${Date.now() - startTime}ms] poll error: ${pollErr instanceof Error ? pollErr.message : String(pollErr)}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    const elapsed = Date.now() - startTime;

    if (!snapshot) {
      record('P2-04', 'FAIL', `mission did not terminate within ${MISSION_TIMEOUT_MS + 60_000}ms (last seen: ${lastSeenStatus})`);
      throw new Error('mission timeout');
    }

    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'),
      JSON.stringify(snapshot, null, 2), 'utf8');
    record('P2-04', 'PASS',
      `mission terminated: status=${snapshot.status}, elapsed=${elapsed}ms, tokens=${snapshot.result?.cost?.tokens ?? 0}`);

    // Token usage
    const tokens = snapshot.result?.cost?.tokens;
    record('P2-05', tokens && tokens > 0 ? 'PASS' : 'FAIL', `token usage: ${tokens ?? 0}`);

    // Events
    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events?limit=400`, null, TEST_API_KEY);
    if (eventsRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'),
        JSON.stringify(eventsRes.body, null, 2), 'utf8');
      const writeEvents = (eventsRes.body.events || []).filter(
        e => e.payload?.action === 'write_file' && e.payload?.ok);
      record('P2-06', writeEvents.length >= 9 ? 'PASS' : 'PARTIAL',
        `write_file events: ${writeEvents.length} (expect ≥ 9)`);
    }

    // Artifacts
    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'),
        JSON.stringify(artRes.body, null, 2), 'utf8');
      const artifacts = artRes.body.artifacts || [];
      record('P2-07', artifacts.length >= 9 ? 'PASS' : 'PARTIAL',
        `artifacts delivered: ${artifacts.length}`);

      // Save artifact content to evidence/clean-room-app
      const crDir = join(EVIDENCE_DIR, 'clean-room-app');
      if (existsSync(crDir)) rmSync(crDir, { recursive: true, force: true });
      mkdirSync(crDir, { recursive: true });
      for (const a of artifacts) {
        if (a.content) {
          const dest = join(crDir, a.path);
          const dir = join(dest, '..');
          mkdirSync(dir, { recursive: true });
          writeFileSync(dest, a.content, 'utf8');
        }
      }
    }

    // Find workspace files on disk (fallback if artifacts response was incomplete)
    const wsBase = join(OPENBOT_ROOT, missionId);
    const wsFiles = findFiles(wsBase);
    for (const f of wsFiles) {
      const dest = join(EVIDENCE_DIR, 'clean-room-app', f.path);
      if (!existsSync(dest)) {
        try {
          const content = readFileSync(f.full, 'utf8');
          mkdirSync(join(dest, '..'), { recursive: true });
          writeFileSync(dest, content, 'utf8');
        } catch { /* binary */ }
      }
    }
    writeFileSync(join(EVIDENCE_DIR, 'workspace-files.json'),
      JSON.stringify(wsFiles.map(f => f.path), null, 2), 'utf8');

    // Compute repaired hashes for all 9 files
    const repairedHashes = {};
    for (const rel of MISSION_INPUT_FILES) {
      const fp = join(EVIDENCE_DIR, 'clean-room-app', rel);
      if (existsSync(fp)) {
        const h = crypto.createHash('sha256').update(readFileSync(fp, 'utf8')).digest('hex');
        repairedHashes[rel] = h;
      } else {
        repairedHashes[rel] = 'MISSING';
      }
    }
    writeFileSync(join(EVIDENCE_DIR, 'repaired-hashes.json'),
      JSON.stringify(repairedHashes, null, 2), 'utf8');

    // Diff against starting hashes — which files changed?
    const startingHashes = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'starting-hashes.json'), 'utf8'));
    const changedFiles = [];
    const unchangedFiles = [];
    for (const rel of MISSION_INPUT_FILES) {
      if (startingHashes[rel] !== repairedHashes[rel]) {
        changedFiles.push(rel);
      } else {
        unchangedFiles.push(rel);
      }
    }
    writeFileSync(join(EVIDENCE_DIR, 'changed-files.json'),
      JSON.stringify({ changed: changedFiles, unchanged: unchangedFiles, count: changedFiles.length }, null, 2), 'utf8');
    record('P2-08', 'PASS',
      `changed=${changedFiles.length} unchanged=${unchangedFiles.length} — changed: ${JSON.stringify(changedFiles)}`);

    // Verify server.js and public/* and other test files unchanged
    const expectedUnchanged = ['README.md','package.json','public/app.js','public/index.html','public/styles.css','server.js','test/db.test.js','test/integration.test.js'];
    const unintendedChanges = expectedUnchanged.filter(f => changedFiles.includes(f));
    if (unintendedChanges.length === 0) {
      record('P2-09', 'PASS', 'no unintended changes to application/other-test files');
    } else {
      record('P2-09', 'FAIL', `unintended changes: ${JSON.stringify(unintendedChanges)}`);
    }
    if (changedFiles.includes('test/api.test.js')) {
      record('P2-10', 'PASS', 'test/api.test.js was modified (expected)');
    } else {
      record('P2-10', 'FAIL', 'test/api.test.js was NOT modified (expected to be the only changed file)');
    }

    // Mission status summary
    record('P2-MISSION_STATUS', snapshot.status, `missionId=${missionId}`);
    record('P2_TERMINAL', snapshot.terminal ? 'YES' : 'NO', `terminal=${snapshot.terminal}`);
    record('P2_VERIFICATION', snapshot.result?.verification?.status || 'UNKNOWN',
      `verification=${snapshot.result?.verification?.status || 'n/a'}`);
    record('P2_TOKENS', String(tokens ?? 0), `tokens=${tokens ?? 0}`);
    record('P2_WALL_MS', String(Date.now() - wallStart), `wallMs=${Date.now() - wallStart}`);

  } catch (err) {
    console.error('[g7-18e] fatal:', err);
    record('P2-00', 'FAIL', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    writeFileSync(join(EVIDENCE_DIR, 'phase-2-summary.json'),
      JSON.stringify(results, null, 2), 'utf8');
    console.log(`Phase 2 results: ${join(EVIDENCE_DIR, 'phase-2-summary.json')}`);
    if (gateway) try { gateway.kill('SIGTERM'); } catch { /* ignore */ }
    try { spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { spawnSync('pkill', ['-f', 'bun.*agent-computer'], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { spawnSync('pkill', ['-f', 'tsx.*gateway'], { stdio: 'ignore' }); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 2000);
  }
})();
