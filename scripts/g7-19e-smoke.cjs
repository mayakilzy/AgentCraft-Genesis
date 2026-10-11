/**
 * G7-19E — Live Production Smoke Test Driver.
 *
 * Submits ONE greenfield mission ("Service Request Tracker — Smoke v0.1")
 * through the production Genesis Gateway, real Z.ai GLM-4-Plus reasoning,
 * and real OpenBot runtime. NO scripted reasoning. NO missionInputs
 * (greenfield — the worker must design + produce the entire app).
 *
 * Captures all required evidence (mission ID, workers, tokens, artifacts,
 * verification checks, package selection, gateway response).
 *
 * Resource discipline: ONE live mission only. No retries. If it fails,
 * collect diagnostics and stop.
 */
const { spawn, spawnSync } = require('node:child_process');
const {
  writeFileSync, mkdirSync, existsSync, rmSync, readFileSync,
  readdirSync, statSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const crypto = require('node:crypto');

// ─── Configuration ────────────────────────────────────────────────────
const ENGINE_DIR = resolve(__dirname, '..');
const EVIDENCE_DIR = join(ENGINE_DIR, 'evidence', 'g7-19e');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const GATEWAY_PORT = '4380';
const A2A_PORT = '4381';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces-g7-19e';
const TEST_API_KEY = 'g7-19e-smoke-key';
const MAX_WORKER_STEPS = '40';
const MISSION_TIMEOUT_MS = 540_000; // 9 minutes — within safety limits

rmSync(OPENBOT_ROOT, { recursive: true, force: true });
mkdirSync(OPENBOT_ROOT, { recursive: true });

// ─── Mission goal (≤2000 chars outcome) ──────────────────────────────
const MISSION_OUTCOME = `Build "Service Request Tracker — Smoke v0.1": a minimal Node.js CLI app.

Capabilities (each MUST be implemented and verified):
1. Create a service request: "node src/index.js create \\"<title>\\" \\"<description>\\"" writes a new request with status="open" and a generated id, then prints the id to stdout.
2. List all requests: "node src/index.js list" prints all requests as a JSON array to stdout.
3. Update a request status: "node src/index.js update <id> <new-status>" transitions status; valid transitions: open→in_progress, in_progress→resolved only (forward-only; reject same-status or backward).
4. Persist records locally: store all requests in "data/requests.json" (create the dir if absent, create the file if absent).
5. Reject invalid inputs: empty title, unknown id, unknown new-status, invalid transition — each prints a clear error to stderr and exits with code 1.
6. Include automated tests using node:test (built-in): at least 6 test cases covering (a) create, (b) list, (c) update, (d) persistence across restart (new store instance reads the same file), (e) invalid input rejection, (f) one negative test.
7. Include README.md with: app description, install instructions (npm install — should be a no-op since no deps), run tests (npm test), CLI usage examples for create/list/update, valid status transitions table.

After producing all 5 files, finish with artifacts: ["package.json","README.md","src/index.js","src/store.js","test/app.test.js"].`;

const MISSION_CONTEXT = `G7-19E — Live Production Smoke Test. Real Z.ai GLM-4-Plus + real OpenBot runtime. Greenfield mission — NO missionInputs staged. The worker must design and produce the entire Service Request Tracker — Smoke v0.1 from scratch using only the Node.js >= 20 standard library.

REQUIRED FILE STRUCTURE (write ALL 5 files via write_file, then finish):
1. package.json — fields: name="service-request-tracker", version="0.1.0", type="module", scripts.test="node --test test/", scripts.start="node src/index.js". NO dependencies field (or empty). NO devDependencies unless strictly necessary (none should be needed — node:test + node:assert are built-in).
2. README.md — sections: # Service Request Tracker — Smoke v0.1, ## What it does, ## Install (npm install — no deps), ## Run tests (npm test), ## CLI usage (create/list/update examples), ## Valid status transitions (open→in_progress→resolved, forward-only).
3. src/store.js — exported functions: loadRequests() reads data/requests.json (returns [] if absent, creates the dir + file if missing); saveRequests(arr) writes data/requests.json atomically; createRequest(title, description) returns a new {id,title,description,status:"open",createdAt} and persists it; listRequests() returns the array; updateStatus(id, newStatus) — validates id exists, validates new-status is a known value, validates the transition is forward-only, throws on invalid input.
4. src/index.js — CLI entrypoint: parses process.argv, dispatches to src/store.js functions. Exit codes: 0 on success, 1 on user input error (empty title, unknown id, invalid status, invalid transition, wrong arg count), 2 on internal error.
5. test/app.test.js — uses node:test + node:assert. Tests: (a) "create adds a request to the store" — createRequest returns an object with status="open", listRequests() now includes it. (b) "list returns all stored requests" — after 2 creates, list().length===2. (c) "update transitions status" — create with status="open"; updateStatus(id,"in_progress"); the request now has status="in_progress". (d) "persistence survives restart" — create a request; construct a new store instance (re-read from disk); the new instance's list() includes the request. (e) "empty title is rejected" — createRequest("","desc") throws. (f) "invalid transition is rejected" — createRequest then updateStatus(id,"resolved") (skipping in_progress) throws.

STATUS TRANSITIONS:
- open → in_progress (allowed)
- in_progress → resolved (allowed)
- open → resolved (FORBIDDEN — must go through in_progress first; throw)
- Any backward (resolved → in_progress, etc.) — REJECT (throw)
- Same-status (open → open) — REJECT (throw)
- Unknown new-status string — REJECT (throw)

ACCEPTANCE: write_file 5 times (one per file), then finish with the 5 artifact paths. NO external dependencies. NO new files beyond the 5 listed. NO test framework other than node:test.

CLEAN ROOM GUARANTEE: after the mission, an independent clean-room run will: (1) cd into the produced package, (2) npm install (must be a no-op), (3) npm test (must exit 0 within 60s), (4) run the CLI: create, list, update, list — verifying CRUD + persistence + invalid-input rejection. If npm install pulls ANY package from registry, the mission FAILS.`;

const MISSION_CONSTRAINTS = [
  'Use Node.js >= 20 standard library ONLY. No external npm runtime dependencies.',
  'Single-process CLI app. No HTTP server. No background daemon.',
  'No new files beyond the 5 listed (package.json, README.md, src/index.js, src/store.js, test/app.test.js).',
  'No code modification by the operator — the test must run against the worker\'s own output.',
  'After producing all files, npm test MUST exit 0 within 60 seconds in a clean room.',
];

const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'package.json exists', path: 'package.json' },
  { kind: 'file', label: 'README.md exists', path: 'README.md' },
  { kind: 'file', label: 'src/index.js exists', path: 'src/index.js' },
  { kind: 'file', label: 'src/store.js exists', path: 'src/store.js' },
  { kind: 'file', label: 'test/app.test.js exists', path: 'test/app.test.js' },
  { kind: 'content-in-artifacts', label: 'README mentions npm test',
    expectIncludes: 'npm test' },
  { kind: 'content-in-artifacts', label: 'store.js uses JSON persistence',
    expectIncludes: 'requests.json' },
];

// ─── Gateway env ─────────────────────────────────────────────────────
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
        callerId: 'g7-19e-smoke-caller',
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
  let gatewayLog = [];
  try {
    record('E-00', 'PASS', 'evidence dir prepared + openbot root cleared');

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
    if (!gwUp) { record('E-01', 'FAIL', 'gateway did not come up'); throw new Error('gw up fail'); }
    record('E-01', 'PASS', `production gateway up on port ${GATEWAY_PORT}`);

    // Submit the live mission
    const submitBody = {
      outcome: MISSION_OUTCOME,
      context: MISSION_CONTEXT,
      constraints: MISSION_CONSTRAINTS,
      label: 'g7-19e-live-smoke',
      acceptanceCriteria: ACCEPTANCE_CRITERIA,
      // NO missionInputs — greenfield mission
    };
    const submit = await httpCall('POST', '/v1/missions', submitBody, TEST_API_KEY);
    if (submit.status !== 202) {
      writeFileSync(join(EVIDENCE_DIR, 'submit-failure.json'),
        JSON.stringify({ status: submit.status, body: submit.body, raw: submit.raw }, null, 2), 'utf8');
      record('E-02', 'FAIL', `mission submission failed: HTTP ${submit.status}`);
      throw new Error('submit fail');
    }
    const missionId = submit.body.missionId;
    const acceptedAt = submit.body.acceptedAt || new Date().toISOString();
    record('E-02', 'PASS', `live mission submitted: ${missionId}`);
    writeFileSync(join(EVIDENCE_DIR, 'submit-response.json'),
      JSON.stringify(submit.body, null, 2), 'utf8');

    // Wait for terminal status
    record('E-03', 'INFO', `waiting for live ZAI + OpenBot execution (timeout ${MISSION_TIMEOUT_MS}ms)...`);
    let snapshot = null;
    const startTime = Date.now();
    const pollUntil = startTime + MISSION_TIMEOUT_MS + 120_000; // +120s grace
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
      record('E-04', 'FAIL', `mission did not terminate within ${MISSION_TIMEOUT_MS + 120_000}ms (last seen: ${lastSeenStatus})`);
      throw new Error('mission timeout');
    }

    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'),
      JSON.stringify(snapshot, null, 2), 'utf8');
    record('E-04', 'PASS',
      `mission terminated: status=${snapshot.status}, elapsed=${elapsed}ms, tokens=${snapshot.result?.cost?.tokens ?? 0}`);

    // Token usage
    const tokens = snapshot.result?.cost?.tokens;
    record('E-05', tokens && tokens > 0 ? 'PASS' : 'FAIL', `token usage: ${tokens ?? 0}`);

    // Events — capture worker IDs, roles, model/provider, completion outcomes
    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events?limit=400`, null, TEST_API_KEY);
    let events = [];
    if (eventsRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'),
        JSON.stringify(eventsRes.body, null, 2), 'utf8');
      events = eventsRes.body.events || [];
      const writeEvents = events.filter(
        e => e.payload?.action === 'write_file' && e.payload?.ok);
      const workerFinishedEvents = events.filter(e => e.type === 'worker-finished');
      const workerStartedEvents = events.filter(e => e.type === 'worker-step' || e.type === 'worker-started');
      const workerIds = new Set();
      for (const e of [...workerStartedEvents, ...workerFinishedEvents, ...writeEvents]) {
        if (e.payload?.workerId) workerIds.add(e.payload.workerId);
        else if (e.workerId) workerIds.add(e.workerId);
      }
      record('E-06', writeEvents.length >= 5 ? 'PASS' : 'PARTIAL',
        `write_file events: ${writeEvents.length} (expect ≥ 5), workers: ${[...workerIds].join(',')}`);
      // Provider/model — check flight events for reasoning calls
      const reasoningEvents = events.filter(e => e.type === 'reasoning-call' || e.payload?.action?.includes('reasoning') || e.payload?.model);
      const models = new Set();
      for (const e of reasoningEvents) {
        if (e.payload?.model) models.add(e.payload.model);
      }
      record('E-06-MODEL', models.size > 0 ? 'PASS' : 'INFO',
        `models observed: ${[...models].join(',') || '(no model field — verify via gateway logs)'}`);
    }

    // Artifacts — the heart of the smoke test
    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    let artifacts = [];
    let verifiedPackageSelection = null;
    let artifactsWithConflictResolution = [];
    if (artRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'artifacts-response.json'),
        JSON.stringify(artRes.body, null, 2), 'utf8');
      artifacts = artRes.body.artifacts || [];
      verifiedPackageSelection = artRes.body.verifiedPackageSelection || null;
      artifactsWithConflictResolution = artifacts.filter(a => a.conflictResolution);
      record('E-07', artifacts.length >= 5 ? 'PASS' : 'PARTIAL',
        `artifacts delivered: ${artifacts.length} (expect ≥ 5)`);

      // Save artifact content to evidence/clean-room-app
      const crDir = join(EVIDENCE_DIR, 'clean-room-app');
      if (existsSync(crDir)) rmSync(crDir, { recursive: true, force: true });
      mkdirSync(crDir, { recursive: true });
      for (const a of artifacts) {
        if (a.content !== undefined && a.content !== null) {
          const dest = join(crDir, a.path);
          mkdirSync(join(dest, '..'), { recursive: true });
          writeFileSync(dest, a.content, 'utf8');
        }
      }
    } else {
      record('E-07', 'FAIL', `artifacts fetch failed: HTTP ${artRes.status}`);
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
    record('E-08', 'PASS', `workspace files on disk: ${wsFiles.length}`);

    // Compute content hashes for all 5 expected files
    const EXPECTED = ['package.json', 'README.md', 'src/index.js', 'src/store.js', 'test/app.test.js'];
    const fileHashes = {};
    for (const rel of EXPECTED) {
      const fp = join(EVIDENCE_DIR, 'clean-room-app', rel);
      if (existsSync(fp)) {
        const h = crypto.createHash('sha256').update(readFileSync(fp, 'utf8')).digest('hex');
        fileHashes[rel] = h;
      } else {
        fileHashes[rel] = 'MISSING';
      }
    }
    writeFileSync(join(EVIDENCE_DIR, 'file-hashes.json'),
      JSON.stringify(fileHashes, null, 2), 'utf8');

    // Manifest completeness
    const presentCount = EXPECTED.filter(f => fileHashes[f] !== 'MISSING').length;
    record('E-09', presentCount === 5 ? 'PASS' : 'PARTIAL',
      `manifest completeness: ${presentCount}/5 files present`);

    // Package selection summary
    if (verifiedPackageSelection) {
      record('E-10', 'PASS',
        `verifiedPackageSelection: state=${verifiedPackageSelection.packageState}, policy=${verifiedPackageSelection.policy}, worker=${verifiedPackageSelection.selectedWorkerId || '(none)'}, identity=${verifiedPackageSelection.packageIdentity?.slice(0, 16) || '(none)'}…`);
    } else {
      record('E-10', 'INFO', `no verifiedPackageSelection field in response`);
    }

    // Heuristic conflict resolution safety
    const allHeuristicSafe = artifactsWithConflictResolution.every(a => a.conflictResolution.isHeuristicUnverified === true);
    record('E-11', allHeuristicSafe ? 'PASS' : 'FAIL',
      `heuristic authority safety: ${artifactsWithConflictResolution.length} records with conflictResolution, all isHeuristicUnverified=true: ${allHeuristicSafe}`);

    // Mission status summary
    record('E-MISSION_STATUS', snapshot.status, `missionId=${missionId}`);
    record('E_TERMINAL', snapshot.terminal ? 'YES' : 'NO', `terminal=${snapshot.terminal}`);
    record('E_VERIFICATION', snapshot.result?.verification?.status || 'UNKNOWN',
      `verification=${snapshot.result?.verification?.status || 'n/a'} summary=${(snapshot.result?.verification?.summary || '').slice(0, 80)}`);
    record('E_TOKENS', String(tokens ?? 0), `tokens=${tokens ?? 0}`);
    record('E_WALL_MS', String(Date.now() - wallStart), `wallMs=${Date.now() - wallStart}`);
    record('E_ACCEPTED_AT', 'INFO', acceptedAt);
    record('E_FINISHED_AT', 'INFO', snapshot.finishedAt || '(unknown)');

    // Save a metadata file with the key fields
    writeFileSync(join(EVIDENCE_DIR, 'mission-metadata.json'), JSON.stringify({
      missionId,
      acceptedAt,
      finishedAt: snapshot.finishedAt,
      status: snapshot.status,
      terminal: snapshot.terminal,
      tokens: tokens ?? 0,
      wallMs: Date.now() - wallStart,
      verificationStatus: snapshot.result?.verification?.status,
      verificationSummary: snapshot.result?.verification?.summary,
      artifactsCount: artifacts.length,
      manifestPresent: presentCount,
      manifestExpected: 5,
      verifiedPackageSelection,
      artifactsWithConflictResolution: artifactsWithConflictResolution.length,
      heuristicAuthoritySafe: allHeuristicSafe,
    }, null, 2), 'utf8');

  } catch (err) {
    console.error('[g7-19e] fatal:', err);
    record('E-00', 'FAIL', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Save gateway log (truncated if huge)
    if (gatewayLog.length > 0) {
      // Limit each entry to 4000 chars
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
