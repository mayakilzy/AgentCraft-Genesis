/**
 * G7-12 — Gateway Conversation Routes.
 *
 * HTTP handlers for conversation CRUD + messages + mission links.
 * All routes require authentication (Bearer token) and enforce caller ownership.
 *
 * Routes:
 *   POST   /v1/conversations                          — create conversation
 *   GET    /v1/conversations                          — list caller conversations
 *   GET    /v1/conversations/{id}                     — get conversation metadata
 *   PATCH  /v1/conversations/{id}                     — update title
 *   POST   /v1/conversations/{id}/messages            — append message
 *   GET    /v1/conversations/{id}/messages            — get paginated messages
 *   POST   /v1/conversations/{id}/missions            — link a mission to the conversation
 *
 * Reuses the existing authenticate() + CallerIdentity pattern from http-server.ts.
 * No second API gateway — these routes are registered in the same HTTP server.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileConversationStore } from '../conversation/conversation-store.js';
import {
  ConversationNotFoundError,
  ConversationOwnershipError,
  MessageValidationError,
} from '../conversation/conversation-store.js';
import type { CallerIdentity } from './types.js';

// ---------------------------------------------------------------------------
// Response helpers (mirror http-server.ts conventions)
// ---------------------------------------------------------------------------

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
  sendJson(res, status, { error: { code, message } });
}

async function readJsonBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleConversationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  store: FileConversationStore,
  caller: CallerIdentity,
  path: string,
): Promise<boolean> {
  // POST /v1/conversations — create
  if (path === '/v1/conversations' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (body === null) {
      sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
      return true;
    }
    const obj = body as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title : undefined;
    const firstMessage = typeof obj.firstMessage === 'string' ? obj.firstMessage : undefined;
    try {
      const record = store.createConversation(caller.callerId, { title, firstMessage });
      sendJson(res, 201, record);
    } catch (e) {
      sendError(res, 400, 'INVALID_CONVERSATION', e instanceof Error ? e.message : String(e));
    }
    return true;
  }

  // GET /v1/conversations — list
  if (path === '/v1/conversations' && req.method === 'GET') {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const limitParam = url.searchParams.get('limit');
    const cursor = url.searchParams.get('cursor') ?? undefined;
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = Number.parseInt(limitParam, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
        sendError(res, 400, 'INVALID_LIMIT', `limit must be 1-100 (got: ${limitParam})`);
        return true;
      }
      limit = parsed;
    }
    const result = store.listConversations(caller.callerId, { limit, cursor });
    sendJson(res, 200, result);
    return true;
  }

  // /v1/conversations/{id}[/subresource]
  const match = /^\/v1\/conversations\/([^/]+)(?:\/(messages|missions))?$/.exec(path);
  if (match) {
    const conversationId = decodeURIComponent(match[1]);
    const subresource = match[2];

    // GET /v1/conversations/{id} — get metadata
    if (req.method === 'GET' && (subresource === undefined || subresource === '')) {
      try {
        const record = store.getConversation(conversationId, caller.callerId);
        sendJson(res, 200, record);
      } catch (e) {
        if (e instanceof ConversationNotFoundError) {
          sendError(res, 404, 'CONVERSATION_NOT_FOUND', e.message);
        } else if (e instanceof ConversationOwnershipError) {
          // 404 (not 403) to avoid leaking existence — same pattern as missions.
          sendError(res, 404, 'CONVERSATION_NOT_FOUND', e.message);
        } else {
          sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
        }
      }
      return true;
    }

    // PATCH /v1/conversations/{id} — update title
    if (req.method === 'PATCH' && (subresource === undefined || subresource === '')) {
      const body = await readJsonBody(req);
      if (body === null) {
        sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
        return true;
      }
      const obj = body as Record<string, unknown>;
      if (typeof obj.title !== 'string') {
        sendError(res, 400, 'INVALID_TITLE', 'title must be a string');
        return true;
      }
      try {
        const record = store.updateConversationTitle(conversationId, caller.callerId, obj.title);
        sendJson(res, 200, record);
      } catch (e) {
        if (e instanceof ConversationNotFoundError || e instanceof ConversationOwnershipError) {
          sendError(res, 404, 'CONVERSATION_NOT_FOUND', e.message);
        } else {
          sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
        }
      }
      return true;
    }

    // POST /v1/conversations/{id}/messages — append message
    if (req.method === 'POST' && subresource === 'messages') {
      const body = await readJsonBody(req);
      if (body === null) {
        sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
        return true;
      }
      const obj = body as Record<string, unknown>;
      const role = obj.role;
      const content = obj.content;
      const missionId = typeof obj.missionId === 'string' ? obj.missionId : undefined;
      const idempotencyKey = typeof obj.idempotencyKey === 'string' ? obj.idempotencyKey : undefined;
      if (role !== 'user' && role !== 'assistant') {
        sendError(res, 400, 'INVALID_ROLE', 'role must be "user" or "assistant"');
        return true;
      }
      if (typeof content !== 'string') {
        sendError(res, 400, 'INVALID_CONTENT', 'content must be a string');
        return true;
      }
      try {
        const message = store.appendMessage(conversationId, caller.callerId, {
          role,
          content,
          missionId,
          idempotencyKey,
        });
        sendJson(res, 201, message);
      } catch (e) {
        if (e instanceof ConversationNotFoundError || e instanceof ConversationOwnershipError) {
          sendError(res, 404, 'CONVERSATION_NOT_FOUND', e.message);
        } else if (e instanceof MessageValidationError) {
          sendError(res, 400, 'INVALID_MESSAGE', e.message);
        } else {
          sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
        }
      }
      return true;
    }

    // GET /v1/conversations/{id}/messages — paginated messages
    if (req.method === 'GET' && subresource === 'messages') {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const limitParam = url.searchParams.get('limit');
      const cursor = url.searchParams.get('cursor') ?? undefined;
      let limit: number | undefined;
      if (limitParam !== null) {
        const parsed = Number.parseInt(limitParam, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
          sendError(res, 400, 'INVALID_LIMIT', `limit must be 1-100 (got: ${limitParam})`);
          return true;
        }
        limit = parsed;
      }
      try {
        const result = store.getMessages(conversationId, caller.callerId, { limit, cursor });
        sendJson(res, 200, result);
      } catch (e) {
        if (e instanceof ConversationNotFoundError || e instanceof ConversationOwnershipError) {
          sendError(res, 404, 'CONVERSATION_NOT_FOUND', e.message);
        } else {
          sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
        }
      }
      return true;
    }

    // POST /v1/conversations/{id}/missions — link a mission
    if (req.method === 'POST' && subresource === 'missions') {
      const body = await readJsonBody(req);
      if (body === null) {
        sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
        return true;
      }
      const obj = body as Record<string, unknown>;
      if (typeof obj.missionId !== 'string') {
        sendError(res, 400, 'INVALID_MISSION_ID', 'missionId must be a string');
        return true;
      }
      try {
        const record = store.linkMission(conversationId, caller.callerId, obj.missionId);
        sendJson(res, 200, record);
      } catch (e) {
        if (e instanceof ConversationNotFoundError || e instanceof ConversationOwnershipError) {
          sendError(res, 404, 'CONVERSATION_NOT_FOUND', e.message);
        } else {
          sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
        }
      }
      return true;
    }
  }

  return false;
}
