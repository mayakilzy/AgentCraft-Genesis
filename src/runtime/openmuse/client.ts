/**
 * PHASE 4.7 — OpenMuse HTTP API client.
 *
 * A thin HTTP client for the OpenMuse server's durable task API. No upstream
 * imports — speaks plain JSON REST to the documented endpoints.
 *
 * API surface (verified against OpenMuse source, 2026-10-07):
 *   POST /api/session                    → get bearer token (sample mode: no key)
 *   POST /api/agent/tasks                → create durable task
 *   GET  /api/agent/tasks/:id            → get task detail (status, result, events)
 *   POST /api/agent/tasks/:id/control    → pause/resume/cancel/retry
 *
 * Auth: bearer token from POST /api/session. In sample mode (localhost), no
 * access key is required. Token expires in 24h.
 *
 * No CopilotKit Intelligence dependency for the task API — the durable task
 * machinery runs independently of the chat/conversation layer.
 */

/** OpenMuse task status (from packages/domain/src/agent.ts). */
export type OpenMuseTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_input'
  | 'scheduled'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** OpenMuse AgentTask (subset — only fields Genesis needs). */
export interface OpenMuseTask {
  readonly id: string;
  readonly status: OpenMuseTaskStatus;
  readonly result?: string;
  readonly error?: string | null;
  readonly attempts: number;
  readonly prompt: string;
  readonly kind: string;
}

/** Task detail response from GET /api/agent/tasks/:id. */
export interface OpenMuseTaskDetail {
  readonly task: OpenMuseTask;
  readonly events?: readonly unknown[];
  readonly artifacts?: readonly unknown[];
}

export interface OpenMuseClientOptions {
  /** Base URL of the OpenMuse server (default: http://127.0.0.1:8787). */
  readonly baseUrl: string;
  /** Per-request timeout (default 15s). */
  readonly timeoutMs?: number;
}

/** Thrown when the OpenMuse server returns a non-2xx. */
export class OpenMuseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'OpenMuseRequestError';
  }
}

/**
 * Minimal HTTP client for the OpenMuse durable task API. Handles session
 * creation and bearer token management automatically.
 */
export class OpenMuseClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private token: string | undefined;
  private tokenExpiresAt = 0;

  constructor(options: OpenMuseClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Ensure a valid session token exists; refresh if expired. */
  private async ensureToken(): Promise<string> {
    if (this.token !== undefined && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }
    // POST /api/session — in sample mode, empty body gives a token.
    const response = await this.rawRequest<{ token: string }>('POST', '/api/session', {});
    this.token = response.token;
    // Token expires in 24h; refresh 1h before.
    this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
    return this.token;
  }

  /** Create a durable task. */
  async createTask(
    prompt: string,
    kind = 'finance',
    input: Record<string, unknown> = {},
  ): Promise<OpenMuseTask> {
    const token = await this.ensureToken();
    return this.authedRequest<OpenMuseTask>('POST', '/api/agent/tasks', token, {
      prompt,
      kind,
      input,
    });
  }

  /** Get task detail (status, result, events, artifacts). */
  async getTask(taskId: string): Promise<OpenMuseTaskDetail> {
    const token = await this.ensureToken();
    return this.authedRequest<OpenMuseTaskDetail>(
      'GET',
      `/api/agent/tasks/${taskId}`,
      token,
    );
  }

  /** Control a task (pause, resume, cancel, retry). */
  async controlTask(
    taskId: string,
    action: 'pause' | 'resume' | 'cancel' | 'retry',
  ): Promise<OpenMuseTask> {
    const token = await this.ensureToken();
    return this.authedRequest<OpenMuseTask>(
      'POST',
      `/api/agent/tasks/${taskId}/control`,
      token,
      { action },
    );
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async rawRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.doRequest<T>(method, path, undefined, body);
  }

  private async authedRequest<T>(
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<T> {
    return this.doRequest<T>(method, path, token, body);
  }

  private async doRequest<T>(
    method: string,
    path: string,
    token: string | undefined,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token !== undefined) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new OpenMuseRequestError(
          `OpenMuse ${method} ${path} failed: ${response.status} ${response.statusText}`,
          response.status,
          text.slice(0, 500),
        );
      }
      if (text.length === 0) return undefined as T;
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
