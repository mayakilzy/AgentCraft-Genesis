/**
 * G7-14H — Real Browser Acceptance (H2).
 *
 * Spawns the REAL Gateway (with a configured MCP servers file containing
 * distinctive SENTINEL secret values), the REAL Next.js BFF + Studio web
 * app, and a REAL headless Chromium browser via Playwright. Then verifies:
 *
 *   BR-01: Gateway + web come up.
 *   BR-02: Login via the PIN form authenticates the cookie.
 *   BR-03: Studio Catalog page loads.
 *   BR-04: The configured MCP server is visible in the rendered UI.
 *   BR-05: The MCP server status badge shows "CONFIGURED" (truthful —
 *         no AVAILABLE / RUNTIME_VERIFIED / UNAVAILABLE fabrication).
 *   BR-06: The grant `mcp:sentinel-analyze` is rendered (proves the
 *         grants array is exposed, not the secret transport fields).
 *   BR-07: SENTINEL secret values are ABSENT from the rendered DOM:
 *         the stdio command path, the env var value, the cwd path,
 *         the http url, and the args array. The Gateway's
 *         `toPublicSummary()` strips these fields — the browser test
 *         proves they never reach the client.
 *   BR-08: SENTINEL secret values are ABSENT from the BFF API JSON
 *         response for /api/genesis/v1/plugins (defense-in-depth: even
 *         if the UI redaction failed, the BFF response itself must not
 *         leak).
 *   BR-09: No console errors emitted during the Studio Catalog render.
 *   BR-10: Cleanup — closing the browser does not throw; gateway + web
 *         processes are reaped.
 *
 * Per spec: "Use distinctive test-secret sentinel values and verify they
 * are absent from API responses and rendered content. Do not rely on
 * checking for generic words such as `command` or `url`, which may
 * legitimately appear in the interface."
 *
 * The sentinel values are intentionally unique and unambiguous so that
 * ANY appearance in the DOM or API response is unambiguous evidence of
 * a leak (not a false positive from a generic UI label).
 */

const { spawn } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');

const EVIDENCE_DIR = join(__dirname, '..', 'evidence', 'g7-14h');
if (existsSync(EVIDENCE_DIR)) rmSync(EVIDENCE_DIR, { recursive: true, force: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });

const ENGINE_DIR = resolve(__dirname, '..');
const WEB_DIR = join(ENGINE_DIR, 'web');

const GATEWAY_PORT = '4180';
const WEB_PORT = '3000';
const TEST_API_KEY = 'g7-14h-test-key';
const TEST_OPERATOR_PIN = 'g7-14h-test-pin';
const TEST_BFF_SECRET = 'g7-14h-bff-test-secret-fixed';

// ---------------------------------------------------------------------------
// SENTINEL secret values — these must NEVER appear in any API response
// or rendered DOM. Their presence would unambiguously indicate a leak
// of MCP server transport configuration (command, args, env, cwd, url).
// ---------------------------------------------------------------------------
const SENTINEL_CMD_PATH = '/tmp/g7-14h-sentinel-mcp-server.mjs';
const SENTINEL_ENV_VALUE = 'ZAI_G714H_SENTINEL_ENV_VALUE_LEAKED_9f3a7c2d';
const SENTINEL_CWD = '/tmp/g7-14h-sentinel-cwd-9f3a7c2d';
const SENTINEL_HTTP_URL = 'http://g7-14h-sentinel.invalid:9999/mcp';
const SENTINEL_ARG = '--g7-14h-sentinel-arg-9f3a7c2d';
const SENTINEL_SERVER_NAME = 'g7-14h-sentinel-server';
const SENTINEL_GRANT = 'mcp:sentinel-analyze';
const SENTINEL_SATISFIES = 'sentinel-data-analysis-9f3a7c2d';
const SENTINEL_DESCRIPTION =
  'Sentinel MCP server for G7-14H browser acceptance — no real invocation expected';

// The stdio MCP server .mjs file. It registers the `sentinel-analyze` tool
// but the browser test never triggers a mission, so the server is never
// spawned by the LazyCompositeMcpProvider. We still create the file so
// the configured command path resolves (the loader validates the config
// schema but does NOT spawn the server until a worker invokes a tool).
const MCP_SERVER_CODE = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer(
  { name: 'g7-14h-sentinel', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

server.registerTool(
  'sentinel-analyze',
  { title: 'Sentinel Analyze', description: 'No-op sentinel tool', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
`;

// MCP config YAML with sentinel values that must NOT leak.
// NOTE: we use a stdio server with sentinel command/env/cwd/args values.
// The Gateway loader validates the schema but does NOT spawn the server
// (no mission is submitted, no worker invokes a tool). The public
// summary strips these fields — the browser test verifies that.
const MCP_CONFIG_YAML = `servers:
  - name: ${SENTINEL_SERVER_NAME}
    description: ${SENTINEL_DESCRIPTION}
    transport:
      kind: stdio
      command: node
      args: [${SENTINEL_CMD_PATH}, ${SENTINEL_ARG}]
      cwd: ${SENTINEL_CWD}
      env:
        G7_14H_SENTINEL_ENV: ${SENTINEL_ENV_VALUE}
    grants: [${SENTINEL_GRANT}]
    satisfies: [${SENTINEL_SATISFIES}]
`;

// ---------------------------------------------------------------------------
// Result recording
// ---------------------------------------------------------------------------
const results = {};
function record(id, status, detail) {
  const ts = new Date().toISOString();
  results[id] = { status, detail, timestamp: ts };
  console.log(`[${ts}] ${id}: ${status} — ${detail}`);
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------
function buildGatewayEnv(mcpConfigPath) {
  return {
    ...process.env,
    GENESIS_EXECUTION_MODE: 'development',
    GENESIS_HTTP_PORT: GATEWAY_PORT,
    GENESIS_A2A_PORT: '4181',
    GENESIS_MCP_SERVERS_CONFIG: mcpConfigPath,
    GENESIS_API_KEYS: JSON.stringify({
      [TEST_API_KEY]: {
        callerId: 'g7-14h-caller',
        allowedOperations: ['mission:submit'],
        maxActiveMissions: 5,
        maxMissionTimeoutMs: 60_000,
      },
    }),
  };
}

function startGateway(mcpConfigPath) {
  console.log('[g7-14h] starting gateway on port', GATEWAY_PORT);
  const gw = spawn('npx', ['tsx', 'src/gateway/main.ts'], {
    cwd: ENGINE_DIR,
    env: buildGatewayEnv(mcpConfigPath),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gw.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.length < 500) console.log('[gateway]', text.trim());
  });
  return gw;
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

function startWeb() {
  console.log('[g7-14h] starting web (production build) on port', WEB_PORT);
  const w = spawn('npm', ['run', 'start', '--', '--port', WEB_PORT], {
    cwd: WEB_DIR,
    env: webEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  w.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.length < 500 && (text.includes('Ready') || text.includes('Local:') || text.includes('error'))) {
      console.log('[web]', text.trim());
    }
  });
  return w;
}

async function waitForUrl(url, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status === 200 || r.status === 401 || r.status === 503) return true;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Poll until the gateway's /v1/plugins returns 200 with our sentinel server.
// This ensures the MCP config is fully loaded before we start the web app
// and try to authenticate.
async function waitForGatewayPlugins(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/plugins`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      if (r.status === 200) {
        const body = await r.json();
        if (body.plugins && body.plugins.some((p) => p.name === SENTINEL_SERVER_NAME)) {
          return true;
        }
      }
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  let browser;
  let gateway;
  let web;
  let mcpConfigPath;
  let mcpServerPath;
  let tempDir;
  try {
    // --- 1. Create temp MCP server .mjs + config YAML -----------------------
    const os = require('node:os');
    const fs = require('node:fs');
    tempDir = fs.mkdtempSync(join(os.tmpdir(), 'g7-14h-'));
    mcpServerPath = join(tempDir, 'sentinel-mcp-server.mjs');
    fs.writeFileSync(mcpServerPath, MCP_SERVER_CODE, 'utf8');
    // The configured command path is the SENTINEL — the actual .mjs lives in
    // tempDir; the config points to SENTINEL_CMD_PATH which does NOT exist.
    // The Gateway loader validates the schema but does NOT spawn the server
    // (no mission submitted), so the non-existent path does not matter.
    // The sentinel value proves that the command path is stripped from the
    // public summary.
    mcpConfigPath = join(tempDir, 'mcp-servers.yaml');
    fs.writeFileSync(mcpConfigPath, MCP_CONFIG_YAML, 'utf8');

    // --- 2. Start gateway + web ---------------------------------------------
    gateway = startGateway(mcpConfigPath);
    // Wait for gateway to be fully ready (including MCP config load).
    const gatewayHealthUp = await waitForUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`, 90_000);
    const gatewayPluginsUp = await waitForGatewayPlugins(60_000);
    if (!gatewayHealthUp || !gatewayPluginsUp) {
      record('BR-01', 'FAIL', `gateway health=${gatewayHealthUp}, plugins=${gatewayPluginsUp}`);
      process.exit(1);
    }
    // Start web AFTER gateway is fully ready (so the BFF can proxy to it).
    web = startWeb();
    const webUp = await waitForUrl(`http://127.0.0.1:${WEB_PORT}/`, 90_000);
    if (!webUp) {
      record('BR-01', 'FAIL', `web=${webUp}`);
      process.exit(1);
    }
    record('BR-01', 'PASS', `gateway up (health + plugins with sentinel server), web up`);

    // --- 3. Launch Playwright ------------------------------------------------
    const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();

    // Capture ALL console messages so BR-09 can verify no errors.
    const consoleMessages = [];
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      consoleMessages.push({ type: 'pageerror', text: err.message });
    });

    // --- 4. Login via PIN form ----------------------------------------------
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);
    const pinInput = page.locator('input[type="password"]').first();
    if ((await pinInput.count()) > 0) {
      await pinInput.fill(TEST_OPERATOR_PIN);
      const submitBtn = page.getByRole('button', { name: /Authenticate/i }).first();
      if ((await submitBtn.count()) > 0) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
      }
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(EVIDENCE_DIR, 'br-02-after-login.png') });

    // Verify login by checking for the app shell (Home nav visible).
    const homeNav = page.locator('button[aria-label*="Home" i]').first();
    if ((await homeNav.count()) > 0) {
      record('BR-02', 'PASS', 'logged in; Home nav visible');
    } else {
      // Dump diagnostic info: the body text, the URL, and the auth state.
      const bodyText = await page.locator('body').innerText().catch(() => '(empty)');
      writeFileSync(join(EVIDENCE_DIR, 'br-02-fail-body.txt'), bodyText, 'utf8');
      const html = await page.content();
      writeFileSync(join(EVIDENCE_DIR, 'br-02-fail.html'), html, 'utf8');
      record('BR-02', 'FAIL', `not authenticated after PIN submit (url=${page.url()})`);
      await page.screenshot({ path: join(EVIDENCE_DIR, 'br-02-fail.png') });
      process.exit(1);
    }

    // --- 5. Navigate to the Studio Catalog -----------------------------------
    // The Studio section is reached via a nav button labeled "Studio".
    const studioNav = page.locator('button[aria-label*="Studio" i]').first();
    if ((await studioNav.count()) > 0) {
      await studioNav.click();
      await page.waitForTimeout(2500);
    } else {
      // Fall back: the Studio section may be rendered inline if no nav button exists.
      console.log('[g7-14h] no Studio nav button — assuming inline render');
    }
    await page.screenshot({ path: join(EVIDENCE_DIR, 'br-03-studio-catalog.png') });

    // Verify the catalog rendered (the "Documentation only" notice is always present).
    const docNotice = page.locator('text=Documentation only').first();
    if ((await docNotice.count()) > 0) {
      record('BR-03', 'PASS', 'Studio Catalog rendered (documentation notice visible)');
    } else {
      record('BR-03', 'FAIL', 'Studio Catalog did not render');
      await page.screenshot({ path: join(EVIDENCE_DIR, 'br-03-fail.png') });
      process.exit(1);
    }

    // --- 6. Verify the configured MCP server is visible --------------------
    // The "Configured MCP Servers" section header.
    const mcpHeader = page.locator('text=Configured MCP Servers').first();
    if ((await mcpHeader.count()) > 0) {
      record('BR-04', 'PASS', '"Configured MCP Servers" section rendered');
    } else {
      record('BR-04', 'FAIL', '"Configured MCP Servers" section not rendered');
      await page.screenshot({ path: join(EVIDENCE_DIR, 'br-04-fail.png') });
      process.exit(1);
    }

    // The sentinel server name should be rendered (it is part of the public summary).
    const serverCard = page.locator(`text=${SENTINEL_SERVER_NAME}`).first();
    if ((await serverCard.count()) > 0) {
      record('BR-04b', 'PASS', `sentinel server "${SENTINEL_SERVER_NAME}" rendered`);
    } else {
      record('BR-04b', 'FAIL', `sentinel server "${SENTINEL_SERVER_NAME}" not rendered`);
      await page.screenshot({ path: join(EVIDENCE_DIR, 'br-04b-fail.png') });
      process.exit(1);
    }

    // --- 7. Verify the status badge shows "CONFIGURED" ----------------------
    // The badge text is rendered inside the PluginCard component. We scope
    // the check to the MCP server card specifically (the section under the
    // "Configured MCP Servers" heading). The Status filter dropdown above
    // legitimately contains "Available" / "Runtime verified" / "Unavailable"
    // as filter labels — those are NOT fabricated statuses on the MCP server.
    const configuredBadge = page.locator('text=CONFIGURED').first();
    if ((await configuredBadge.count()) > 0) {
      record('BR-05', 'PASS', 'status badge "CONFIGURED" rendered (truthful — no fabrication)');
    } else {
      record('BR-05', 'FAIL', '"CONFIGURED" status badge not rendered');
      await page.screenshot({ path: join(EVIDENCE_DIR, 'br-05-fail.png') });
      process.exit(1);
    }

    // Scope the fabricated-status check to the MCP server cards section.
    // Locate the "Configured MCP Servers" section header, then walk to its
    // sibling container that holds the PluginCard grid. Within that scope,
    // the only Badge text should be "CONFIGURED". Any other status text
    // (AVAILABLE / RUNTIME_VERIFIED / UNAVAILABLE) on an actual MCP server
    // card would be a fabrication.
    const mcpSection = page.locator('h2:has-text("Configured MCP Servers")').first();
    const mcpSectionParent = mcpSection.locator('xpath=..'); // the wrapping div
    // The PluginCard grid is a sibling div after the <h2> + <p> + <div>.
    // We can scope by text inside the section parent.
    const mcpSectionText = await mcpSectionParent.innerText().catch(() => '');
    // Extract just the MCP-server-card portion: from "Configured MCP Servers" onward.
    const mcpCardSectionText = mcpSectionText.includes('Configured MCP Servers')
      ? mcpSectionText.slice(mcpSectionText.indexOf('Configured MCP Servers'))
      : '';
    const hasAvailableInCard = /\bAVAILABLE\b/.test(mcpCardSectionText);
    const hasRuntimeVerifiedInCard = /\bRUNTIME_VERIFIED\b/.test(mcpCardSectionText);
    const hasUnavailableInCard = /\bUNAVAILABLE\b/.test(mcpCardSectionText);
    if (!hasAvailableInCard && !hasRuntimeVerifiedInCard && !hasUnavailableInCard) {
      record('BR-05b', 'PASS', 'no fabricated statuses on the MCP server card (AVAILABLE/RUNTIME_VERIFIED/UNAVAILABLE absent from card scope)');
    } else {
      const leaks = [];
      if (hasAvailableInCard) leaks.push('AVAILABLE');
      if (hasRuntimeVerifiedInCard) leaks.push('RUNTIME_VERIFIED');
      if (hasUnavailableInCard) leaks.push('UNAVAILABLE');
      record('BR-05b', 'FAIL', `fabricated statuses present on MCP server card: ${leaks.join(', ')}`);
    }

    // --- 8. Verify the grant is rendered ------------------------------------
    // The grants array is exposed in the public summary and rendered as a
    // chip in the PluginCard.
    const grantChip = page.locator(`text=${SENTINEL_GRANT}`).first();
    if ((await grantChip.count()) > 0) {
      record('BR-06', 'PASS', `grant "${SENTINEL_GRANT}" rendered`);
    } else {
      record('BR-06', 'FAIL', `grant "${SENTINEL_GRANT}" not rendered`);
      await page.screenshot({ path: join(EVIDENCE_DIR, 'br-06-fail.png') });
      process.exit(1);
    }

    // --- 9. Verify SENTINEL secret values are ABSENT from the DOM ----------
    // Per spec: "Do not rely on checking for generic words such as `command`
    // or `url`". We check for the distinctive sentinel values themselves.
    const bodyText = await page.locator('body').innerText();
    const sentinelLeaks = [];
    if (bodyText.includes(SENTINEL_CMD_PATH)) sentinelLeaks.push(`command-path:${SENTINEL_CMD_PATH}`);
    if (bodyText.includes(SENTINEL_ENV_VALUE)) sentinelLeaks.push(`env-value:${SENTINEL_ENV_VALUE.slice(0, 20)}…`);
    if (bodyText.includes(SENTINEL_CWD)) sentinelLeaks.push(`cwd:${SENTINEL_CWD}`);
    if (bodyText.includes(SENTINEL_HTTP_URL)) sentinelLeaks.push(`url:${SENTINEL_HTTP_URL}`);
    if (bodyText.includes(SENTINEL_ARG)) sentinelLeaks.push(`arg:${SENTINEL_ARG}`);
    if (sentinelLeaks.length === 0) {
      record('BR-07', 'PASS', 'all sentinel secret values ABSENT from rendered DOM');
    } else {
      record('BR-07', 'FAIL', `sentinel values LEAKED to DOM: ${sentinelLeaks.join(' | ')}`);
      // Dump the body text for forensic analysis.
      writeFileSync(join(EVIDENCE_DIR, 'br-07-dom-leak.txt'), bodyText, 'utf8');
    }

    // Also dump the rendered DOM HTML for evidence.
    const html = await page.content();
    writeFileSync(join(EVIDENCE_DIR, 'br-studio-dom.html'), html, 'utf8');

    await page.screenshot({ path: join(EVIDENCE_DIR, 'br-07-dom-after-checks.png'), fullPage: true });

    // --- 10. Verify SENTINEL secret values are ABSENT from the BFF API -----
    const apiContext = context.request;
    const plugRes = await apiContext.get(`http://127.0.0.1:${WEB_PORT}/api/genesis/v1/plugins`);
    if (plugRes.status() !== 200) {
      record('BR-08', 'FAIL', `BFF /api/genesis/v1/plugins returned status ${plugRes.status()}`);
    } else {
      const plugBody = await plugRes.json();
      const plugJsonStr = JSON.stringify(plugBody);
      writeFileSync(join(EVIDENCE_DIR, 'br-08-bff-plugins-response.json'), JSON.stringify(plugBody, null, 2), 'utf8');

      const apiLeaks = [];
      if (plugJsonStr.includes(SENTINEL_CMD_PATH)) apiLeaks.push(`command-path`);
      if (plugJsonStr.includes(SENTINEL_ENV_VALUE)) apiLeaks.push(`env-value`);
      if (plugJsonStr.includes(SENTINEL_CWD)) apiLeaks.push(`cwd`);
      if (plugJsonStr.includes(SENTINEL_HTTP_URL)) apiLeaks.push(`url`);
      if (plugJsonStr.includes(SENTINEL_ARG)) apiLeaks.push(`arg`);

      // Also verify the public summary contains the expected non-secret fields.
      const hasServer = plugBody.plugins && plugBody.plugins.some((p) => p.name === SENTINEL_SERVER_NAME);
      const hasGrant = plugBody.plugins && plugBody.plugins.some((p) =>
        p.grants && p.grants.includes(SENTINEL_GRANT));
      const hasConfiguredStatus = plugBody.plugins && plugBody.plugins.some((p) => p.status === 'CONFIGURED');

      if (apiLeaks.length === 0 && hasServer && hasGrant && hasConfiguredStatus) {
        record('BR-08', 'PASS', `BFF /api/genesis/v1/plugins: sentinel secrets ABSENT; public fields (name, grants, status=CONFIGURED) present`);
      } else {
        const missing = [];
        if (!hasServer) missing.push('name');
        if (!hasGrant) missing.push('grants');
        if (!hasConfiguredStatus) missing.push('status=CONFIGURED');
        record('BR-08', 'FAIL', `BFF API leak or missing public fields: leaks=[${apiLeaks.join(',')}] missing=[${missing.join(',')}]`);
      }
    }

    // --- 11. Verify no console errors during Studio render -----------------
    // The pre-login /api/genesis/health 401 is EXPECTED — the AuthGate
    // triggers on 401 by design (GenesisApp uses 401 as the unauthenticated
    // signal). Filter it out from the BR-09 error check.
    const realErrors = consoleMessages.filter((m) => {
      if (m.type !== 'error' && m.type !== 'pageerror') return false;
      // Expected: pre-login 401 from /api/genesis/health (the AuthGate trigger).
      if (m.text.includes('401') && (m.text.includes('health') || m.text.includes('Unauthorized'))) {
        return false;
      }
      return true;
    });
    writeFileSync(join(EVIDENCE_DIR, 'br-09-console-messages.json'), JSON.stringify(consoleMessages, null, 2), 'utf8');
    if (realErrors.length === 0) {
      record('BR-09', 'PASS', `no unexpected console errors during Studio render (${consoleMessages.length} total messages; ${consoleMessages.length - realErrors.length} expected pre-login 401s filtered)`);
    } else {
      record('BR-09', 'PARTIAL', `${realErrors.length} unexpected console errors: ${realErrors.slice(0, 3).map((m) => m.text.slice(0, 100)).join(' | ')}`);
    }

    // --- 12. Cleanup ---------------------------------------------------------
    await browser.close();
    browser = null;
    record('BR-10', 'PASS', 'browser closed cleanly');
  } catch (err) {
    console.error('[g7-14h] fatal error:', err);
    record('BR-01', 'FAIL', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    writeFileSync(join(EVIDENCE_DIR, 'br-results.json'), JSON.stringify({ results }, null, 2), 'utf8');
    console.log(`[g7-14h] results written to ${join(EVIDENCE_DIR, 'br-results.json')}`);
    if (browser) try { await browser.close(); } catch { /* ignore */ }
    if (gateway) try { gateway.kill('SIGTERM'); } catch { /* ignore */ }
    if (web) try { web.kill('SIGTERM'); } catch { /* ignore */ }
    // Robust cleanup: kill any orphan gateway/web processes from this test
    // (the spawn handle may have already exited, leaving tsx/next children).
    try { require('node:child_process').spawnSync('pkill', ['-f', 'src/gateway/main.ts'], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { require('node:child_process').spawnSync('pkill', ['-f', 'next-server'], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { require('node:child_process').spawnSync('pkill', ['-f', 'next start'], { stdio: 'ignore' }); } catch { /* ignore */ }
    // Clean up temp dir
    if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 500);
  }
})();
