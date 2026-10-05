import { createServer, type Server } from 'node:http';

/**
 * Minimal in-memory double of the OpenBot agent-computer HTTP surface, for
 * unit tests that must not depend on an upstream checkout.
 *
 * It honors the parts of the published contract Genesis relies on: bearer
 * token auth (401 otherwise), the `x-openbot-bot-id` header, and the JSON
 * shapes of /health, /exec, /files/write, /files/read, /files/list and
 * /computers/stop. Command execution is simulated (exit 0 + canned stdout)
 * because unit tests exercise the LOOP, not the shell — real command
 * execution is covered by the gated live tests against the real upstream
 * service.
 */

export interface StubComputerServer {
  readonly port: number;
  readonly baseUrl: string;
  readonly token: string;
  /** Every request the server saw, for wire-level assertions. */
  readonly requests: readonly {
    method: string;
    path: string;
    botId: string | null;
    authorized: boolean;
  }[];
  readonly files: ReadonlyMap<string, string>;
  setExecResult(result: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  }): void;
  /** Browser page served by POST /navigate (null → upstream-style 502). */
  setBrowserPage(page: {
    url: string;
    title: string;
    text: string;
  } | null): void;
  /** Screenshot served by GET /screenshot (null → upstream-style 502). */
  setScreenshot(shot: {
    width?: number;
    height?: number;
  } | null): void;
  stop(): Promise<void>;
}

export async function startStubComputer(
  options: { token?: string } = {},
): Promise<StubComputerServer> {
  const token = options.token ?? 'stub-token';
  const files = new Map<string, string>();
  const requests: {
    method: string;
    path: string;
    botId: string | null;
    authorized: boolean;
  }[] = [];
  let execResult: { exitCode: number; stdout: string; stderr: string } = {
    exitCode: 0,
    stdout: '',
    stderr: '',
  };
  let browserPage: { url: string; title: string; text: string } | null = null;
  let screenshot: { width: number; height: number } | null = null;

  const json = (body: unknown, status = 200): { body: string; status: number } => ({
    body: JSON.stringify(body),
    status,
  });

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const auth = request.headers.authorization ?? '';
    const authorized = auth === `Bearer ${token}`;
    const botId =
      (request.headers['x-openbot-bot-id'] as string | undefined)?.trim() ||
      null;
    requests.push({
      method: request.method ?? 'GET',
      path: url.pathname,
      botId,
      authorized,
    });

    const finish = (payload: { body: string; status: number }): void => {
      response.statusCode = payload.status;
      response.setHeader('content-type', 'application/json');
      response.end(payload.body);
    };

    if (url.pathname === '/health') {
      finish(json({ status: 'ok', browser: false }));
      return;
    }
    if (!authorized) {
      finish(json({ error: 'Not authorised.' }, 401));
      return;
    }

    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += String(chunk);
    });
    request.on('end', () => {
      const parsed = body.length === 0 ? {} : (JSON.parse(body) as Record<string, unknown>);
      switch (url.pathname) {
        case '/exec':
          finish(
            json({
              command: String(parsed.command ?? ''),
              exitCode: execResult.exitCode,
              stdout: execResult.stdout,
              stderr: execResult.stderr,
              truncated: false,
              timedOut: false,
              elapsedMs: 1,
            }),
          );
          break;
        case '/files/write': {
          const path = String(parsed.path ?? '');
          const contents = String(parsed.contents ?? '');
          const append = parsed.append === true;
          files.set(path, append ? `${files.get(path) ?? ''}${contents}` : contents);
          finish(json({ path, bytes: Buffer.byteLength(contents), appended: append }));
          break;
        }
        case '/files/read': {
          const path = String(parsed.path ?? '');
          const text = files.get(path);
          if (text === undefined) {
            finish(json({ error: `There is no file at ${path}.` }, 404));
          } else {
            finish(json({ path, text, bytes: text.length, truncated: false }));
          }
          break;
        }
        case '/files/list': {
          const prefix = typeof parsed.path === 'string' ? parsed.path : '.';
          const entries = [...files.keys()]
            .filter((path) => (prefix === '.' || prefix === '' ? true : path.startsWith(prefix)))
            .map((path) => ({ path, kind: 'file' as const, bytes: files.get(path)?.length }));
          finish(json({ path: prefix, entries, truncated: false }));
          break;
        }
        case '/computers/stop':
          finish(json({ stopped: true, wasRunning: false }));
          break;
        case '/navigate': {
          if (browserPage === null) {
            finish(json({ error: 'Navigation failed: net::ERR_CONNECTION_REFUSED' }, 502));
            break;
          }
          finish(
            json({
              url: browserPage.url,
              title: browserPage.title,
              text: browserPage.text,
              truncated: false,
              elapsedMs: 12,
            }),
          );
          break;
        }
        case '/screenshot': {
          if (screenshot === null) {
            finish(json({ error: 'Screenshot failed: no page open.' }, 502));
            break;
          }
          finish(
            json({
              base64: 'ZmFrZS1zY3JlZW5zaG90',
              width: screenshot.width,
              height: screenshot.height,
              capturedAt: new Date().toISOString(),
              url: browserPage?.url ?? 'about:blank',
            }),
          );
          break;
        }
        default:
          finish(json({ error: 'Not found.' }, 404));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('stub computer failed to listen');
  }

  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
    requests,
    files,
    setExecResult(result) {
      execResult = {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    },
    setBrowserPage(page) {
      browserPage = page;
    },
    setScreenshot(shot) {
      screenshot = shot === null ? null : { width: shot.width ?? 1280, height: shot.height ?? 800 };
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
