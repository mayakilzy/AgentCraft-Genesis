/**
 * G6-05A — Genesis Service API (HTTP/JSON).
 *
 * A stable HTTP/JSON interface suitable for ordinary applications.
 * Uses native node:http (no express, no new runtime dependencies).
 *
 * Routes:
 *   GET    /v1/missions                    — list caller's missions (G7-10, auth + ownership)
 *   POST   /v1/missions                    — submit a mission (auth required)
 *   GET    /v1/missions/{missionId}         — get mission snapshot (auth + ownership)
 *   GET    /v1/missions/{missionId}/events  — get event stream (auth + ownership)
 *   GET    /v1/missions/{missionId}/result  — get terminal result (auth + ownership)
 *   GET    /v1/missions/{missionId}/artifacts — get artifacts (auth + ownership)
 *   POST   /v1/missions/{missionId}/cancel — request cancellation (auth + ownership)
 *   GET    /health                          — public health (no auth)
 *   GET    /ready                           — public readiness (no auth)
 *
 * Authentication: Bearer token (API key) in the Authorization header.
 *   Authorization: Bearer <api-key>
 *
 * The API key is mapped to a CallerIdentity by the gateway's apiKeys map.
 * Constant-time comparison is used to avoid timing attacks.
 *
 * Per Section 7: POST /v1/missions returns 202 Accepted with a missionId;
 * the caller polls GET /v1/missions/{id} for status.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import type { MissionService } from './mission-service.js';
import type {
  CallerIdentity,
  GatewayErrorBody,
  GatewayConfig,
  HealthResponse,
  MissionSubmission,
} from './types.js';
import {
  MissionAdmissionError,
  MissionNotFoundError,
  GatewayAuthorizationError,
} from './types.js';

/**
 * Start the HTTP Service API server.
 */
export function startHttpServer(
  service: MissionService,
  config: GatewayConfig,
): { server: Server; url: string } {
  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, service, config);
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', `internal error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const url = `http://${config.httpHost}:${config.httpPort}`;
  server.listen(config.httpPort, config.httpHost);
  return { server, url };
}

/**
 * Stop the HTTP Service API server. Returns a promise that resolves
 * when the server has closed all connections.
 */
export function stopHttpServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  service: MissionService,
  config: GatewayConfig,
): Promise<void> {
  // CORS (harmless for localhost; useful for browser-based dashboards).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // Public health routes.
  if (path === '/health' && req.method === 'GET') {
    const health = service.health();
    const body: HealthResponse = {
      status: 'ok',
      version: '0.1.0',
      uptimeMs: process.uptime() * 1000,
      activeMissions: health.activeMissions,
      limitations: [
        'in-process state only; no durability across process restart',
        'deterministic reasoning default; real LLM requires provider configuration',
        'memory filesystem default; real OpenBot requires runtime configuration',
      ],
    };
    sendJson(res, 200, body);
    return;
  }
  if (path === '/ready' && req.method === 'GET') {
    sendJson(res, 200, { ready: true });
    return;
  }

  // Mission routes require authentication.
  if (path.startsWith('/v1/missions')) {
    const caller = authenticate(req, config);
    if (caller === null) {
      sendError(res, 401, 'UNAUTHENTICATED', 'missing or invalid API key');
      return;
    }

    // GET /v1/missions — list caller's missions (G7-10).
    // MUST be matched BEFORE the {missionId} regex, because /v1/missions
    // (no trailing segment) would otherwise fall through to 404.
    if (path === '/v1/missions' && req.method === 'GET') {
      await handleList(req, res, service, caller);
      return;
    }

    // POST /v1/missions — submit a new mission.
    if (path === '/v1/missions' && req.method === 'POST') {
      await handleSubmit(req, res, service, config, caller);
      return;
    }

    // /v1/missions/{missionId}[/subresource]
    const match = /^\/v1\/missions\/([^/]+)(?:\/(events|result|artifacts|cancel))?$/.exec(path);
    if (match) {
      const missionId = decodeURIComponent(match[1]);
      const subresource = match[2];
      await handleMissionResource(req, res, service, caller, missionId, subresource);
      return;
    }

    sendError(res, 404, 'NOT_FOUND', `route not found: ${req.method} ${path}`);
    return;
  }

  sendError(res, 404, 'NOT_FOUND', `route not found: ${req.method} ${path}`);
}

/**
 * G7-10 — Handle GET /v1/missions (list caller's missions).
 *
 * Query parameters:
 *   limit  — page size (1-100, default 10). Invalid (NaN, <1, >100) → 400.
 *   cursor — opaque pagination cursor (missionId of the last item on the
 *            previous page). If the cursor mission was evicted, returns an
 *            empty page so the caller can restart.
 *
 * Returns 200 with { missions: [...], nextCursor: string | null }.
 * The missions array is filtered to the caller's ownership — a caller
 * cannot enumerate another caller's missions.
 */
async function handleList(
  req: IncomingMessage,
  res: ServerResponse,
  service: MissionService,
  caller: CallerIdentity,
): Promise<void> {
  // Parse query parameters from the URL.
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const limitParam = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor') ?? undefined;

  // Validate limit if provided.
  let limit: number | undefined;
  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
      sendError(
        res,
        400,
        'INVALID_LIMIT',
        `limit must be an integer between 1 and 100 (got: ${limitParam})`,
      );
      return;
    }
    limit = parsed;
  }

  // Cursor is opaque — no validation beyond type (string). An evicted or
  // invalid cursor returns an empty page (handled by MissionService.listMissions).
  try {
    const result = service.listMissions(caller, { limit, cursor });
    sendJson(res, 200, result);
  } catch (error) {
    sendError(
      res,
      500,
      'INTERNAL_ERROR',
      `list failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function handleSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  service: MissionService,
  config: GatewayConfig,
  caller: CallerIdentity,
): Promise<void> {
  const body = await readJsonBody(req, config.maxRequestBodyBytes);
  if (body === null) {
    sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
    return;
  }

  // Validate submission.
  const submission = parseSubmission(body);
  if (submission === null) {
    sendError(res, 400, 'INVALID_SUBMISSION', 'submission must include a non-empty "outcome" string');
    return;
  }

  try {
    const { missionId, status } = service.start(submission, caller);
    sendJson(res, 202, {
      missionId,
      status,
      accepted: true,
      links: {
        self: `/v1/missions/${missionId}`,
        events: `/v1/missions/${missionId}/events`,
        result: `/v1/missions/${missionId}/result`,
        artifacts: `/v1/missions/${missionId}/artifacts`,
        cancel: `/v1/missions/${missionId}/cancel`,
      },
    });
  } catch (error) {
    if (error instanceof MissionAdmissionError) {
      sendError(res, 429, 'ADMISSION_DENIED', error.message);
      return;
    }
    if (error instanceof GatewayAuthorizationError) {
      sendError(res, 403, 'FORBIDDEN', error.message);
      return;
    }
    throw error;
  }
}

async function handleMissionResource(
  req: IncomingMessage,
  res: ServerResponse,
  service: MissionService,
  caller: CallerIdentity,
  missionId: string,
  subresource: string | undefined,
): Promise<void> {
  try {
    if (req.method === 'GET' && (subresource === undefined || subresource === '')) {
      const snapshot = service.get(missionId, caller);
      sendJson(res, 200, snapshot);
      return;
    }
    if (req.method === 'GET' && subresource === 'events') {
      const events = service.getEvents(missionId, caller, 0, 100);
      sendJson(res, 200, { missionId, events });
      return;
    }
    if (req.method === 'GET' && subresource === 'result') {
      const snapshot = service.get(missionId, caller);
      if (!snapshot.terminal) {
        sendError(res, 409, 'NOT_FINISHED', 'mission has not reached a terminal state');
        return;
      }
      sendJson(res, 200, {
        missionId,
        status: snapshot.status,
        result: snapshot.result,
        failureClass: snapshot.failureClass,
        failureMessage: snapshot.failureMessage,
      });
      return;
    }
    if (req.method === 'GET' && subresource === 'artifacts') {
      const artifacts = await service.getArtifacts(missionId, caller);
      sendJson(res, 200, { missionId, artifacts });
      return;
    }
    if (req.method === 'POST' && subresource === 'cancel') {
      const status = service.cancel(missionId, caller);
      sendJson(res, 202, { missionId, status, cancelRequested: true });
      return;
    }
    sendError(res, 404, 'NOT_FOUND', `route not found: ${req.method} ${req.url}`);
  } catch (error) {
    if (error instanceof MissionNotFoundError) {
      // Per Section 11: cross-caller access returns 404 (not 403) to avoid
      // leaking the existence of another caller's mission.
      sendError(res, 404, 'MISSION_NOT_FOUND', error.message);
      return;
    }
    if (error instanceof GatewayAuthorizationError) {
      sendError(res, 403, 'FORBIDDEN', error.message);
      return;
    }
    throw error;
  }
}

/**
 * Authenticate the caller via the Authorization: Bearer <api-key> header.
 * Returns null if authentication fails.
 *
 * Per Section 10:
 *   - Deny by default.
 *   - No anonymous mission submission.
 *   - Constant-time secret comparison where applicable.
 *   - No credentials in logs.
 */
function authenticate(req: IncomingMessage, config: GatewayConfig): CallerIdentity | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const providedKey = authHeader.slice('Bearer '.length);
  if (providedKey.length === 0) {
    return null;
  }

  // Constant-time comparison: iterate ALL keys, compare each, return the
  // matching identity only if exactly one matches.
  let matched: CallerIdentity | null = null;
  let matchedCount = 0;
  for (const [validKey, identity] of config.apiKeys) {
    if (constantTimeEquals(providedKey, validKey)) {
      matched = identity;
      matchedCount += 1;
    }
  }
  // If multiple keys matched (impossible for distinct keys, but defensive),
  // deny.
  if (matchedCount !== 1) {
    return null;
  }
  return matched;
}

/**
 * Constant-time string comparison. Returns true iff the strings are
 * equal in length and content. Compares all bytes (does not short-circuit).
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid leaking length via timing.
    timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Parse and validate a mission submission from a JSON body.
 * Returns null if the body is not a valid submission.
 */
function parseSubmission(body: unknown): MissionSubmission | null {
  if (body === null || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const outcome = obj.outcome;
  if (typeof outcome !== 'string' || outcome.trim().length === 0) {
    return null;
  }
  // Build the submission as a mutable object, then return it as the readonly type.
  const submission: {
    outcome: string;
    context?: string;
    constraints?: readonly string[];
    budget?: { maxUsd?: number; tier?: 'cheap' | 'default' | 'frontier' };
    idempotencyKey?: string;
    label?: string;
  } = { outcome };
  if (typeof obj.context === 'string') submission.context = obj.context;
  if (Array.isArray(obj.constraints)) {
    submission.constraints = obj.constraints.filter((c): c is string => typeof c === 'string');
  }
  if (obj.budget !== null && typeof obj.budget === 'object') {
    const b = obj.budget as Record<string, unknown>;
    const budget: { maxUsd?: number; tier?: 'cheap' | 'default' | 'frontier' } = {};
    if (typeof b.maxUsd === 'number') budget.maxUsd = b.maxUsd;
    if (b.tier === 'cheap' || b.tier === 'default' || b.tier === 'frontier') {
      budget.tier = b.tier;
    }
    if (budget.maxUsd !== undefined || budget.tier !== undefined) {
      submission.budget = budget;
    }
  }
  if (typeof obj.idempotencyKey === 'string') submission.idempotencyKey = obj.idempotencyKey;
  if (typeof obj.label === 'string') submission.label = obj.label;
  return submission;
}

/**
 * Read and parse a JSON request body. Returns null on parse failure
 * or if the body exceeds the size limit.
 */
async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        aborted = true;
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });

    req.on('error', () => resolve(null));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  const body: GatewayErrorBody = {
    error: { code, message },
  };
  sendJson(res, status, body);
}
