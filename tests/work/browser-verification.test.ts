import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
  WorkerGenome,
} from '../../src/contracts/core.js';
import type {
  BrowserSurface,
  WorkerComputer,
} from '../../src/runtime/computer.js';
import { ComputerApiClient } from '../../src/runtime/openbot/computer-api.js';
import { startComputerProcess } from '../../src/runtime/openbot/computer-process.js';
import { WorkerAgent } from '../../src/worker/worker-agent.js';
import { startStubComputer } from '../helpers/stub-computer-server.js';

/**
 * TASK-018 acceptance:
 *
 *   - a UI fixture opens and is actually tested (LIVE: a real agent-computer
 *     with its real Chromium, navigating a real local HTTP server started
 *     inside the same computer);
 *   - a failing browser produces useful evidence (the computer's own error
 *     surfaces as the observation);
 *   - the browser actions are grants-gated like every other worker action.
 */

const OPENBOT_CHECKOUT =
  process.env.GENESIS_OPENBOT_DIR ?? join(process.cwd(), '..', 'OpenBot');
const liveTestsAvailable = existsSync(
  join(OPENBOT_CHECKOUT, 'agent-computer', 'src', 'index.ts'),
);
const maybeLive = liveTestsAvailable ? describe : describe.skip;

/** A reasoning provider that replays a fixed script of model replies. */
class ScriptedReasoning implements ReasoningProvider {
  readonly name = 'scripted';
  readonly seen: ReasoningInput[] = [];
  private replies: readonly string[];

  constructor(replies: readonly string[]) {
    this.replies = replies;
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    const [next, ...rest] = this.replies;
    this.replies = rest;
    this.seen.push(input);
    return { text: next };
  }
}

function browserGenome(overrides: Partial<WorkerGenome> = {}): WorkerGenome {
  return {
    identity: { id: 'browser-worker-1', displayName: 'Verification Engineer' },
    role: 'Verification Engineer',
    objective: 'verify the running application in a real browser',
    model: 'cheap',
    skills: ['browser-verification'],
    tools: [
      'openbot:shell-execution',
      'openbot:workspace-files',
      'openbot:browser-chromium',
    ],
    computer: { required: true, browser: true, shell: true, workspace: true },
    memory: 'none',
    budget: { maxUsd: 1, maxTier: 'default' },
    autonomy: 'autonomous',
    ...overrides,
  };
}

describe('browser surface — wire level against the documented contract', () => {
  it('navigate posts the url and returns the page contract', async () => {
    const stub = await startStubComputer();
    const client = new ComputerApiClient({
      baseUrl: stub.baseUrl,
      token: stub.token,
      botId: 'browser-worker-1',
    });
    stub.setBrowserPage({
      url: 'http://127.0.0.1:4173/',
      title: 'tabloid demo',
      text: 'aligned table renders here',
    });
    const page = await client.navigate('http://127.0.0.1:4173/');
    expect(page.url).toBe('http://127.0.0.1:4173/');
    expect(page.title).toBe('tabloid demo');
    expect(page.text).toContain('aligned table');
    expect(stub.requests.some((r) => r.path === '/navigate' && r.method === 'POST')).toBe(true);
    await stub.stop();
  });

  it('the browser surface summarizes screenshots as evidence, never base64 pixels', async () => {
    const stub = await startStubComputer();
    const client = new ComputerApiClient({
      baseUrl: stub.baseUrl,
      token: stub.token,
      botId: 'browser-worker-1',
    });
    stub.setBrowserPage({
      url: 'http://127.0.0.1:4173/',
      title: 'tabloid demo',
      text: 'content',
    });
    stub.setScreenshot({ width: 800, height: 600 });
    const surface: BrowserSurface = client.browserSurface();
    const shot = await surface.screenshot();
    expect(shot).toMatchObject({ width: 800, height: 600, url: 'http://127.0.0.1:4173/' });
    expect(JSON.stringify(shot)).not.toContain('base64');
    expect(JSON.stringify(shot)).not.toContain('ZmFrZS');
    await stub.stop();
  });

  it('a failing navigation surfaces the computer error as useful evidence', async () => {
    const stub = await startStubComputer();
    const client = new ComputerApiClient({
      baseUrl: stub.baseUrl,
      token: stub.token,
      botId: 'browser-worker-1',
    });
    stub.setBrowserPage(null);
    await expect(client.navigate('http://127.0.0.1:9/')).rejects.toThrow(
      /Navigation failed/,
    );
    await stub.stop();
  });
});

describe('browser actions in the worker loop — grants-gated like all actions', () => {
  function browserComputer(
    page: { url: string; title: string; text: string } | null,
  ): WorkerComputer {
    const files = new Map<string, string>();
    const surface: BrowserSurface = {
      navigate: async (url) =>
        page === null
          ? Promise.reject(new Error('OpenBot computer /navigate failed (502): Navigation failed: net::ERR_CONNECTION_REFUSED'))
          : Promise.resolve({
              url,
              title: page.title,
              text: page.text,
              truncated: false,
              elapsedMs: 9,
            }),
      screenshot: async () => ({
        bytes: 54_321,
        width: 1280,
        height: 800,
        url: page?.url ?? 'about:blank',
        capturedAt: new Date().toISOString(),
      }),
    };
    return {
      browser: page === null ? surface : surface,
      async exec(command) {
        return { command, exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, elapsedMs: 1 };
      },
      async writeFile(path, contents) {
        files.set(path, contents);
        return { path, bytes: contents.length, appended: false };
      },
      async readFile(path) {
        const text = files.get(path);
        if (text === undefined) throw new Error(`no file at ${path}`);
        return { path, text, bytes: text.length, truncated: false };
      },
      async listFiles() {
        return [...files.keys()].map((path) => ({ path, kind: 'file' as const }));
      },
    };
  }

  it('a browser-granted worker navigates and sees title + readable page text', async () => {
    const computer = browserComputer({
      url: 'http://127.0.0.1:4173/',
      title: 'tabloid demo',
      text: 'the aligned table renders correctly',
    });
    const reasoning = new ScriptedReasoning([
      '{"action":"browser_navigate","url":"http://127.0.0.1:4173/"}',
      '{"action":"browser_screenshot"}',
      '{"action":"finish","summary":"demo verified in browser","artifacts":[]}',
    ]);
    const agent = new WorkerAgent({
      genome: browserGenome(),
      reasoning,
      computer,
      taskBrief: 'Verify the demo page in a real browser.',
    });
    const result = await agent.run();
    expect(result.status).toBe('success');
    expect(result.summary).toBe('demo verified in browser');
    // The navigation observation (title + text) reached the worker's prompt.
    expect(reasoning.seen[1]?.prompt).toContain('tabloid demo');
    expect(reasoning.seen[1]?.prompt).toContain('the aligned table renders correctly');
    // The screenshot evidence reached it summarized, not as pixels.
    expect(reasoning.seen[2]?.prompt).toContain('"bytes":54321');
    expect(reasoning.seen[2]?.prompt).not.toContain('base64');
    // The system prompt advertised the granted browser actions.
    expect(reasoning.seen[0]?.system).toContain('browser_navigate');
  });

  it('a worker WITHOUT the browser grant is refused, loudly and structurally', async () => {
    const computer = browserComputer(null);
    const reasoning = new ScriptedReasoning([
      '{"action":"browser_navigate","url":"http://127.0.0.1:4173/"}',
      '{"action":"finish","summary":"blocked: no browser","artifacts":[]}',
    ]);
    const agent = new WorkerAgent({
      genome: browserGenome({
        tools: ['openbot:shell-execution', 'openbot:workspace-files'],
        computer: { required: true, browser: false, shell: true, workspace: true },
      }),
      reasoning,
      computer,
      taskBrief: 'Verify the demo page.',
    });
    const result = await agent.run();
    expect(result.status).toBe('success');
    expect(result.refusals.length).toBe(1);
    expect(result.refusals[0]).toContain('openbot:browser-chromium');
    expect(reasoning.seen[0]?.system).not.toContain('browser_navigate');
  });

  it('a navigation failure is delivered to the worker as evidence it can act on', async () => {
    const computer = browserComputer(null);
    const reasoning = new ScriptedReasoning([
      '{"action":"browser_navigate","url":"http://127.0.0.1:9/"}',
      '{"action":"finish","summary":"server not running yet","artifacts":[]}',
    ]);
    const agent = new WorkerAgent({
      genome: browserGenome(),
      reasoning,
      computer,
      taskBrief: 'Verify the demo page.',
    });
    const result = await agent.run();
    expect(result.status).toBe('success');
    expect(reasoning.seen[1]?.prompt).toContain('navigation failed');
    expect(reasoning.seen[1]?.prompt).toContain('ERR_CONNECTION_REFUSED');
  });
});

maybeLive('TASK-018 LIVE — a UI fixture opens and is tested in the real browser', () => {
  const computerRoot = mkdtempSync(join(tmpdir(), 'g3-browser-live-'));

  afterAll(async () => {
    const { rmSync } = await import('node:fs');
    rmSync(computerRoot, { recursive: true, force: true });
  });

  it(
    'real Chromium navigates a real local server started inside the same computer',
    { timeout: 120_000 },
    async () => {
      const computer = await startComputerProcess(
        { checkoutDir: OPENBOT_CHECKOUT, rootDir: computerRoot },
        'g3-browser-worker',
      );
      try {
        // A real UI fixture served by a real node http server, both inside
        // the computer's own workspace.
        const write = async (path: string, contents: string): Promise<void> => {
          await fetch(`${computer.baseUrl}/files/write`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${computer.token}`,
              'x-openbot-bot-id': computer.botId,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ path, contents }),
          });
        };
        await write(
          'demo/index.html',
          [
            '<!doctype html>',
            '<html><head><title>tabloid demo</title></head>',
            '<body><h1>aligned markdown tables</h1>',
            '<table><tr><td align="center">centered</td></tr></table>',
            '</body></html>',
          ].join('\n'),
        );
        await write(
          'demo/serve.mjs',
          [
            "import { createServer } from 'node:http';",
            "import { readFileSync } from 'node:fs';",
            'const port = Number(process.argv[2] ?? 4173);',
            'createServer((req, res) => {',
            "  res.setHeader('content-type', 'text/html');",
            "  res.end(readFileSync('demo/index.html'));",
            '}).listen(port, "127.0.0.1");',
            'console.log("serving on " + port);',
          ].join('\n'),
        );
        const exec = async (command: string): Promise<{ exitCode: number; stdout: string }> => {
          const response = await fetch(`${computer.baseUrl}/exec`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${computer.token}`,
              'x-openbot-bot-id': computer.botId,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ command, timeoutMs: 30_000 }),
          });
          const body = (await response.json()) as { exitCode: number; stdout: string };
          return body;
        };
        const start = await exec(
          'nohup node demo/serve.mjs 4173 > demo/server.log 2>&1 & sleep 1 && echo started',
        );
        expect(start.exitCode).toBe(0);

        const client = new ComputerApiClient({
          baseUrl: computer.baseUrl,
          token: computer.token,
          botId: computer.botId,
        });
        const browser = client.browserSurface();

        // THE acceptance: the page actually opens and is actually read.
        const page = await browser.navigate('http://127.0.0.1:4173/');
        expect(page.title).toBe('tabloid demo');
        expect(page.text).toContain('aligned markdown tables');

        // Screenshot evidence: a real PNG was really captured.
        const shot = await browser.screenshot();
        expect(shot.url).toBe('http://127.0.0.1:4173/');
        expect(shot.bytes).toBeGreaterThan(1_000);
        expect(shot.width).toBeGreaterThan(0);

        // Failure evidence: a dead port produces the computer's own error.
        await expect(browser.navigate('http://127.0.0.1:9/')).rejects.toThrow(
          /Navigation failed|ERR_CONNECTION_REFUSED|502/i,
        );

        // And the deterministic HTTP probe agrees with the browser.
        const probe = await exec(
          "node -e 'fetch(\"http://127.0.0.1:4173/\").then(r=>r.text()).then(t=>{if(!t.includes(\"aligned markdown tables\"))process.exit(1);console.log(\"probe: ok\")})'",
        );
        expect(probe.exitCode).toBe(0);
        expect(probe.stdout).toContain('probe: ok');
      } finally {
        await computer.stop();
      }
    },
  );
});
