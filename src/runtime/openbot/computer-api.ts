import type {
  BrowserSurface,
  ExecOptions,
  ExecResult,
  NavigateResult,
  ReadResult,
  ScreenshotEvidence,
  WorkspaceEntry,
  WriteResult,
} from '../computer.js';

/**
 * Thin HTTP client for the documented OpenBot agent-computer API (TASK-010).
 *
 * Boundary facts (verified live against OpenBot v0.1.0, 2026-10-05):
 *   - auth: `Authorization: Bearer <COMPUTER_TOKEN>` on every route except
 *     `GET /health`; a missing token is answered 401;
 *   - worker identity: the `x-openbot-bot-id` header names the Bot whose
 *     computer this call addresses;
 *   - `POST /exec`            { command, timeoutMs? } → exec contract;
 *   - `POST /files/write`     { path, contents, append? };
 *   - `POST /files/read`      { path };
 *   - `POST /files/list`      { path? };
 *   - `POST /navigate`        { url } → { url, title, text, truncated, ... };
 *     http(s) only (TASK-018 verified: file:// is refused by design);
 *   - `GET  /screenshot`      { base64, width, height, url, capturedAt };
 *   - `POST /computers/stop`  stop the browser, keep profile and workspace;
 *   - `POST /computers/reset` forget everything (deletes the profile);
 *   - `GET  /health`          liveness, no token needed.
 *
 * This file adds no policy, no retry loop, no caching: it is the wire client
 * only. Genesis never imports agent-computer source; it speaks HTTP.
 */

/** Error carrying the upstream HTTP status and body of a refused call. */
export class OpenBotComputerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly route: string,
  ) {
    super(message);
    this.name = 'OpenBotComputerError';
  }
}

export interface ComputerApiConfig {
  /** Base URL of one worker's computer service. */
  readonly baseUrl: string;
  /** The shared secret this computer was started with. */
  readonly token: string;
  /** The Bot id this client acts as. */
  readonly botId: string;
  /** Per-request timeout (default 60s). */
  readonly timeoutMs?: number;
}

function assertOk(route: string, status: number, body: string): void {
  if (status >= 200 && status < 300) return;
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') detail = parsed.error;
  } catch {
    // keep raw body
  }
  throw new OpenBotComputerError(
    `OpenBot computer ${route} failed (${status}): ${detail}`,
    status,
    body,
    route,
  );
}

/** A bound HTTP client for exactly one worker's computer. */
export class ComputerApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly botId: string;
  private readonly timeoutMs: number;

  constructor(config: ComputerApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.botId = config.botId;
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  private async call(
    route: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${route}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'x-openbot-bot-id': this.botId,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      const text = await response.text();
      assertOk(route, response.status, text);
      return text.length === 0 ? {} : (JSON.parse(text) as unknown);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Liveness probe — the single route that needs no token. */
  async health(): Promise<{ status: string; browser: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      const text = await response.text();
      assertOk('/health', response.status, text);
      return JSON.parse(text) as { status: string; browser: boolean };
    } finally {
      clearTimeout(timer);
    }
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return (await this.call('/exec', {
      method: 'POST',
      body: {
        command,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
    })) as ExecResult;
  }

  async writeFile(
    path: string,
    contents: string,
    append = false,
  ): Promise<WriteResult> {
    return (await this.call('/files/write', {
      method: 'POST',
      body: { path, contents, append },
    })) as WriteResult;
  }

  async readFile(path: string): Promise<ReadResult> {
    return (await this.call('/files/read', {
      method: 'POST',
      body: { path },
    })) as ReadResult;
  }

  async listFiles(path?: string): Promise<readonly WorkspaceEntry[]> {
    const result = (await this.call('/files/list', {
      method: 'POST',
      body: path === undefined ? {} : { path },
    })) as { entries?: unknown };
    if (!Array.isArray(result.entries)) {
      throw new OpenBotComputerError(
        'OpenBot computer /files/list returned no entries array',
        200,
        JSON.stringify(result),
        '/files/list',
      );
    }
    return result.entries as readonly WorkspaceEntry[];
  }

  /** Stop this Bot's browser, keeping profile and workspace (upstream semantics). */
  async stopBrowser(): Promise<{ stopped: boolean; wasRunning: boolean }> {
    return (await this.call('/computers/stop', { method: 'POST' })) as {
      stopped: boolean;
      wasRunning: boolean;
    };
  }

  /** Navigate this computer's browser (TASK-018; upstream `/navigate`). */
  async navigate(url: string): Promise<NavigateResult> {
    return (await this.call('/navigate', {
      method: 'POST',
      body: { url },
    })) as NavigateResult;
  }

  /** Screenshot the current page (TASK-018; upstream `/screenshot`). */
  async screenshotRaw(): Promise<{
    base64: string;
    width: number;
    height: number;
    capturedAt: string;
    url: string;
  }> {
    return (await this.call('/screenshot', { method: 'GET' })) as {
      base64: string;
      width: number;
      height: number;
      capturedAt: string;
      url: string;
    };
  }

  /**
   * The browser surface for a worker computer: navigate + screenshot,
   * with screenshot pixels summarized as evidence instead of shipped as
   * a base64 blob (the pixel data has no consumer in a text worker loop).
   */
  browserSurface(): BrowserSurface {
    return {
      navigate: (url: string) => this.navigate(url),
      screenshot: async (): Promise<ScreenshotEvidence> => {
        const raw = await this.screenshotRaw();
        return {
          bytes: raw.base64.length,
          width: raw.width,
          height: raw.height,
          url: raw.url,
          capturedAt: raw.capturedAt,
        };
      },
    };
  }
}
