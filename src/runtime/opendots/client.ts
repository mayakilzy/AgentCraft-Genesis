/**
 * PHASE 4.6 — OpenDots HTTP API client.
 *
 * A thin HTTP client for the OpenDots server's Spaces/Pages CRUD API.
 * No upstream imports — speaks plain JSON REST to the documented endpoints.
 * The adapter owns this client; Genesis core never imports it.
 *
 * API surface (verified against OpenDots source, commit 625452e, 2026-10-07):
 *   POST /api/spaces                              → create Space
 *   POST /api/spaces/:spaceId/pages               → create Page
 *   GET  /api/spaces/:spaceId/pages/:id           → read Page
 *   PATCH /api/spaces/:spaceId/pages/:id          → update Page (expectedRevision)
 *   GET  /api/spaces/:spaceId/pages               → list Pages
 *
 * Auth: on localhost (127.0.0.1/::1/localhost), no token required.
 * On external hosts, `Authorization: Bearer <OWNER_TOKEN>` (≥24 chars) is required.
 *
 * No CopilotKit Intelligence dependency — Spaces/Pages CRUD works standalone.
 */

/** OpenDots Space (from upstream src/shared/types.ts). */
export interface OpenDotsSpace {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: number;
}

/** OpenDots Page (from upstream src/shared/types.ts). */
export interface OpenDotsPage {
  readonly id: string;
  readonly spaceId: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly content: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sourceThreadId: string | null;
}

export interface OpenDotsClientOptions {
  /** Base URL of the OpenDots server (default: http://127.0.0.1:4310). */
  readonly baseUrl: string;
  /** Bearer token (required for non-localhost hosts; ≥24 chars). */
  readonly token?: string;
  /** Per-request timeout (default 10s). */
  readonly timeoutMs?: number;
}

/** Thrown when the OpenDots server returns a conflict (revision mismatch). */
export class OpenDotsRevisionConflict extends Error {
  constructor(
    message: string,
    readonly currentRevision: number,
  ) {
    super(message);
    this.name = 'OpenDotsRevisionConflict';
  }
}

/** Thrown when the OpenDots server is unreachable or returns a non-2xx. */
export class OpenDotsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'OpenDotsRequestError';
  }
}

/**
 * Minimal HTTP client for the OpenDots Spaces/Pages API. No upstream imports,
 * no vendored code — just `fetch` calls to the documented REST endpoints.
 */
export class OpenDotsClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: OpenDotsClientOptions) {
    // Normalize: strip trailing slash.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Create a Space. */
  async createSpace(name: string, description = ''): Promise<OpenDotsSpace> {
    return this.request<OpenDotsSpace>('POST', '/api/spaces', { name, description });
  }

  /** Create a Page in a Space. */
  async createPage(
    spaceId: string,
    title: string,
    content: string,
    parentId: string | null = null,
  ): Promise<OpenDotsPage> {
    return this.request<OpenDotsPage>('POST', `/api/spaces/${spaceId}/pages`, {
      title,
      content,
      parentId,
    });
  }

  /** Read a Page. */
  async getPage(spaceId: string, pageId: string): Promise<OpenDotsPage> {
    return this.request<OpenDotsPage>('GET', `/api/spaces/${spaceId}/pages/${pageId}`);
  }

  /**
   * Update a Page. Uses optimistic concurrency: `expectedRevision` must match
   * the server's current revision. Throws {@link OpenDotsRevisionConflict} on
   * mismatch (HTTP 409).
   */
  async updatePage(
    spaceId: string,
    pageId: string,
    content: string,
    expectedRevision: number,
  ): Promise<OpenDotsPage> {
    return this.request<OpenDotsPage>(
      'PATCH',
      `/api/spaces/${spaceId}/pages/${pageId}`,
      { content, expectedRevision },
    );
  }

  /** List Pages in a Space. */
  async listPages(spaceId: string): Promise<readonly OpenDotsPage[]> {
    return this.request<readonly OpenDotsPage[]>('GET', `/api/spaces/${spaceId}/pages`);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      };
      if (this.token !== undefined) {
        headers.Authorization = `Bearer ${this.token}`;
      }
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        // Detect revision conflict (OpenDots returns 409 on expectedRevision mismatch).
        if (response.status === 409) {
          let currentRevision = 0;
          try {
            const parsed = JSON.parse(text) as { currentRevision?: unknown };
            if (typeof parsed.currentRevision === 'number') {
              currentRevision = parsed.currentRevision;
            }
          } catch {
            // Body wasn't JSON; currentRevision stays 0.
          }
          throw new OpenDotsRevisionConflict(
            `revision conflict on ${method} ${path}: expected revision mismatch (current: ${currentRevision})`,
            currentRevision,
          );
        }
        throw new OpenDotsRequestError(
          `OpenDots ${method} ${path} failed: ${response.status} ${response.statusText}`,
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
