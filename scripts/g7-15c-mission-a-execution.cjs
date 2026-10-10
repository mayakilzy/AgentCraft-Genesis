/**
 * G7-15C — Real Mission A Execution.
 *
 * Runs Mission A through the REAL production Gateway with:
 *   - GENESIS_EXECUTION_MODE=production
 *   - GENESIS_REASONING_PROVIDER=zai (real Z.ai GLM model)
 *   - GENESIS_RUNTIME_PROVIDER=openbot (real OpenBot agent-computer)
 *
 * The mission goal + 8 acceptance criteria are the authoritative Mission A
 * spec from G7-11B (recovered in C1 from evidence/g7-11b/genesis_demo.md).
 *
 * Evidence is captured to evidence/g7-15c/ for the closure report.
 */

const { spawn } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const EVIDENCE_DIR = join(__dirname, '..', 'evidence', 'g7-15c');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const ENGINE_DIR = resolve(__dirname, '..');
const GATEWAY_PORT = '4180';
const OPENBOT_CHECKOUT = '/tmp/openbot-test';
const OPENBOT_ROOT = '/tmp/openbot-workspaces';
const TEST_API_KEY = 'g7-15c-real-execution-key';

// The authoritative Mission A goal (from G7-11B evidence).
const MISSION_A_GOAL = `Create a Markdown file named \`genesis_demo.md\` describing AgentCraft Genesis as an autonomous AI organization platform. Explain its purpose, architecture, worker organization, execution lifecycle, verification approach, risks, and deliverables. The document must contain these eight sections as level-1 headings: Project Overview, Objectives, System Architecture, Agent Organization, Execution Workflow, Verification Strategy, Risks and Mitigations, Expected Deliverables. Each section must contain substantive content.`;

// The 8 acceptance criteria (file checks for each heading).
const ACCEPTANCE_CRITERIA = [
  { kind: 'file', label: 'genesis_demo.md exists', path: 'genesis_demo.md' },
  { kind: 'content-in-artifacts', label: 'has Project Overview', expectIncludes: '# Project Overview' },
  { kind: 'content-in-artifacts', label: 'has Objectives', expectIncludes: '# Objectives' },
  { kind: 'content-in-artifacts', label: 'has System Architecture', expectIncludes: '# System Architecture' },
  { kind: 'content-in-artifacts', label: 'has Agent Organization', expectIncludes: '# Agent Organization' },
  { kind: 'content-in-artifacts', label: 'has Execution Workflow', expectIncludes: '# Execution Workflow' },
  { kind: 'content-in-artifacts', label: 'has Verification Strategy', expectIncludes: '# Verification Strategy' },
  { kind: 'content-in-artifacts', label: 'has Risks and Mitigations', expectIncludes: '# Risks and Mitigations' },
  { kind: 'content-in-artifacts', label: 'has Expected Deliverables', expectIncludes: '# Expected Deliverables' },
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
    // The ZAI SDK is installed as a node_modules dependency. Set
    // ZAI_SDK_PATH so the provider's credential check passes AND the
    // import() resolves to the local package. The SDK reads credentials
    // from /etc/.z-ai-config (the Z.ai platform config file).
    ZAI_SDK_PATH: 'z-ai-web-dev-sdk',
    GENESIS_HTTP_PORT: GATEWAY_PORT,
    GENESIS_A2A_PORT: '4181',
    GENESIS_API_KEYS: JSON.stringify({
      [TEST_API_KEY]: {
        callerId: 'g7-15c-qualifier',
        allowedOperations: ['mission:submit'],
        maxActiveMissions: 5,
        maxMissionTimeoutMs: 300_000,
      },
    }),
    // G7-15B: mission history store (durable restart recovery).
    // The store writes to data/missions/ which is gitignored.
  };
}

async function waitForUrl(url, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status === 200 || r.status === 401) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
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
        try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed, raw });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  let gateway;
  try {
    // --- 1. Start the Gateway in production mode ---
    console.log('[g7-15c] starting gateway (production mode, real ZAI + OpenBot)...');
    gateway = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
      cwd: ENGINE_DIR,
      env: buildGatewayEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderrChunks = [];
    gateway.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrChunks.push(text);
      if (text.length < 500) console.log('[gateway]', text.trim());
    });

    const gatewayUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 90_000);
    if (!gatewayUp) {
      record('C4-01', 'FAIL', 'gateway did not come up in production mode');
      writeFileSync(join(EVIDENCE_DIR, 'gateway-stderr.log'), stderrChunks.join(''), 'utf8');
      process.exit(1);
    }
    record('C4-01', 'PASS', 'gateway up (production mode, real ZAI + OpenBot)');

    // --- 2. Submit Mission A ---
    const submit = await httpCall('POST', '/v1/missions', {
      outcome: MISSION_A_GOAL,
      acceptanceCriteria: ACCEPTANCE_CRITERIA,
    }, TEST_API_KEY);
    if (submit.status !== 202) {
      record('C4-02', 'FAIL', `mission submit failed (status ${submit.status}): ${JSON.stringify(submit.body).slice(0, 200)}`);
      process.exit(1);
    }
    const missionId = submit.body.missionId;
    record('C4-02', 'PASS', `mission A submitted: ${missionId}`);

    // --- 3. Poll for completion (up to 3 min) ---
    let snapshot = null;
    const startedAt = Date.now();
    for (let i = 0; i < 360; i++) {  // 360 × 500ms = 3 min
      const get = await httpCall('GET', `/v1/missions/${missionId}`, null, TEST_API_KEY);
      if (get.status !== 200) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      snapshot = get.body;
      if (snapshot.terminal) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const elapsedMs = Date.now() - startedAt;
    if (snapshot === null || !snapshot.terminal) {
      record('C4-03', 'FAIL', `mission did not terminate within 3 min (elapsed ${elapsedMs}ms)`);
      process.exit(1);
    }
    record('C4-03', 'PASS', `mission terminated: status=${snapshot.status}, elapsed=${elapsedMs}ms`);

    // --- 4. Capture the full snapshot ---
    writeFileSync(join(EVIDENCE_DIR, 'mission-snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');

    // --- 5. Capture events ---
    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events?limit=100`, null, TEST_API_KEY);
    if (eventsRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-events.json'), JSON.stringify(eventsRes.body, null, 2), 'utf8');
      record('C4-04', 'PASS', `captured ${eventsRes.body.events?.length ?? 0} flight events`);
    }

    // --- 6. Capture artifacts ---
    const artifactsRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, TEST_API_KEY);
    if (artifactsRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-artifacts.json'), JSON.stringify(artifactsRes.body, null, 2), 'utf8');
      const artifacts = artifactsRes.body.artifacts || [];
      const demo = artifacts.find((a) => a.path === 'genesis_demo.md');
      if (demo) {
        record('C4-05', 'PASS', `genesis_demo.md artifact: ${demo.bytes} bytes, verified=${demo.verified}`);
        // Save the artifact content.
        if (demo.content) {
          writeFileSync(join(EVIDENCE_DIR, 'genesis_demo.md'), demo.content, 'utf8');
          record('C4-06', 'PASS', `artifact content saved (${demo.content.length} chars)`);
        }
      } else {
        record('C4-05', 'FAIL', `genesis_demo.md not found in artifacts (${artifacts.length} artifacts total)`);
      }
    }

    // --- 7. Capture the result ---
    const resultRes = await httpCall('GET', `/v1/missions/${missionId}/result`, null, TEST_API_KEY);
    if (resultRes.status === 200) {
      writeFileSync(join(EVIDENCE_DIR, 'mission-result.json'), JSON.stringify(resultRes.body, null, 2), 'utf8');
      record('C4-07', 'PASS', `result captured: ${resultRes.body.result?.status}`);
    }

    // --- 8. Final status ---
    if (snapshot.status === 'SUCCEEDED') {
      record('C4-08', 'PASS', `MISSION A SUCCEEDED — real ZAI + OpenBot execution produced verified genesis_demo.md`);
    } else {
      record('C4-08', 'FAIL', `MISSION A status: ${snapshot.status} (expected SUCCEEDED)`);
    }

    // --- 9. Cost / token usage ---
    const cost = snapshot.result?.cost;
    if (cost) {
      record('C4-09', 'PASS', `cost: usd=${cost.usd}, tokens=${cost.tokens}, wallMs=${cost.wallMs}`);
    }

  } catch (err) {
    console.error('[g7-15c] fatal error:', err);
    record('C4-00', 'FAIL', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    writeFileSync(join(EVIDENCE_DIR, 'execution-results.json'), JSON.stringify({ results }, null, 2), 'utf8');
    console.log(`[g7-15c] results written to ${join(EVIDENCE_DIR, 'execution-results.json')}`);
    if (gateway) try { gateway.kill('SIGTERM'); } catch { /* ignore */ }
    try { require('node:child_process').spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 1000);
  }
})();
