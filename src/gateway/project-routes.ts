/**
 * G7-13 — Gateway Project Routes.
 *
 * HTTP handlers for project endpoints. All routes require authentication
 * (Bearer token) and enforce caller ownership. The ownerId is derived from
 * the authenticated CallerIdentity — clients cannot supply their own.
 *
 * Routes:
 *   POST   /v1/projects                              — create project
 *   GET    /v1/projects                              — list caller projects (cursor pagination)
 *   GET    /v1/projects/{projectId}                  — get project metadata
 *   PATCH  /v1/projects/{projectId}                  — update name/description/status
 *   GET    /v1/projects/{projectId}/brief            — get Project Brief
 *   PUT    /v1/projects/{projectId}/brief            — update Project Brief (revision-controlled)
 *   GET    /v1/projects/{projectId}/overview         — derived overview from authoritative sources
 *   POST   /v1/projects/{projectId}/conversations    — link a conversation (after ownership verification)
 *   POST   /v1/projects/{projectId}/missions         — link a mission (after ownership verification)
 *   POST   /v1/projects/{projectId}/artifacts        — link an artifact reference (after ownership + existence verification)
 *
 * Reuses the existing authenticate() + CallerIdentity pattern from
 * http-server.ts. No second API gateway — these routes are registered in
 * the same HTTP server alongside /v1/missions and /v1/conversations.
 *
 * Critical ownership rule: a missionId or conversationId alone is NOT proof
 * of ownership. The handler verifies ownership via the existing authoritative
 * mechanism (MissionService.get() / FileConversationStore.getConversation())
 * BEFORE calling linkMission/linkConversation on the project store.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileProjectStore, ProjectRecord, ProjectSummary, ProjectBrief, BriefEntry, BriefProvenance, ProjectStatus } from '../project/project-store.js';
import {
  ProjectNotFoundError,
  ProjectOwnershipError,
  ProjectValidationError,
  BriefRevisionConflictError,
  IdempotencyConflictError,
  ConversationAlreadyLinkedError,
} from '../project/project-store.js';
import type { FileConversationStore } from '../conversation/conversation-store.js';
import {
  ConversationNotFoundError,
  ConversationOwnershipError,
} from '../conversation/conversation-store.js';
import type { MissionService } from './mission-service.js';
import type { CallerIdentity } from './types.js';
import { MissionNotFoundError } from './types.js';

// ---------------------------------------------------------------------------
// Response helpers (mirror http-server.ts / conversation-routes.ts conventions)
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
// Overview derivation
// ---------------------------------------------------------------------------

export interface ProjectOverviewConversation {
  conversationId: string;
  linkedAt: string;
  /** True when the conversation store can retrieve the conversation (verifies ownership + existence). */
  available: boolean;
  /** Present when the conversation metadata is retrievable; absent when unavailable. */
  title?: string;
  updatedAt?: string;
  messageCount?: number;
}

export interface ProjectOverviewMission {
  missionId: string;
  linkedAt: string;
  verifiedAt: string;
  /** "live" when the in-process registry still has the mission; "unavailable" after restart. */
  availability: 'live' | 'unavailable';
  /** Present when live; absent when unavailable. UI shows "UNAVAILABLE" honestly. */
  status?: string;
  terminal?: boolean;
  acceptedAt?: string;
  finishedAt?: string;
}

export interface ProjectOverviewArtifact {
  missionId: string;
  path: string;
  workerId?: string;
  linkedAt: string;
  verifiedAt: string;
  /**
   * "available" — the mission is live AND the artifact path exists in its
   *   current artifact list (re-verified at overview time).
   * "missing" — the mission is live but the path is no longer in the
   *   artifact list (e.g., the worker overwrote it or the verifier cleared it).
   * "unavailable" — the mission is no longer in the in-process registry
   *   (gateway restarted). Cannot re-verify; the reference remains durable.
   */
  availability: 'available' | 'missing' | 'unavailable';
  /** Present when available. */
  verified?: boolean;
  bytes?: number;
}

export interface ProjectOverview {
  project: {
    projectId: string;
    ownerId: string;
    name: string;
    description: string;
    status: ProjectStatus;
    createdAt: string;
    updatedAt: string;
  };
  brief: ProjectBrief;
  conversations: ProjectOverviewConversation[];
  missions: ProjectOverviewMission[];
  artifacts: ProjectOverviewArtifact[];
  latestActivityAt: string;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export interface ProjectRouteDeps {
  readonly projectStore: FileProjectStore;
  readonly conversationStore: FileConversationStore;
  readonly missionService: MissionService;
}

export async function handleProjectRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProjectRouteDeps,
  caller: CallerIdentity,
  path: string,
): Promise<boolean> {
  if (!path.startsWith('/v1/projects')) return false;

  // POST /v1/projects — create
  if (path === '/v1/projects' && req.method === 'POST') {
    return handleCreate(req, res, deps, caller);
  }

  // GET /v1/projects — list
  if (path === '/v1/projects' && req.method === 'GET') {
    return handleList(req, res, deps, caller);
  }

  // /v1/projects/{projectId}[/subresource]
  const match = /^\/v1\/projects\/([^/]+)(?:\/(brief|overview|conversations|missions|artifacts))?$/.exec(path);
  if (match) {
    const projectId = decodeURIComponent(match[1]);
    const subresource = match[2];
    return handleProjectResource(req, res, deps, caller, projectId, subresource);
  }

  return false; // not a project route
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

async function handleCreate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProjectRouteDeps,
  caller: CallerIdentity,
): Promise<boolean> {
  const body = await readJsonBody(req);
  if (body === null) {
    sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
    return true;
  }
  const obj = body as Record<string, unknown>;
  const input: {
    name?: string;
    description?: string;
    idempotencyKey?: string;
    brief?: {
      objective?: string;
      requirements?: string[];
      constraints?: string[];
      nextSteps?: string[];
    };
  } = {};
  if (typeof obj.name === 'string') input.name = obj.name;
  if (typeof obj.description === 'string') input.description = obj.description;
  if (typeof obj.idempotencyKey === 'string') input.idempotencyKey = obj.idempotencyKey;
  // Critical: ownerId is NEVER accepted from the client. It is derived from
  // the authenticated CallerIdentity.
  if (typeof obj.ownerId === 'string') {
    sendError(res, 400, 'OWNER_ID_NOT_ALLOWED', 'ownerId cannot be supplied by the client');
    return true;
  }
  if (obj.brief !== undefined && obj.brief !== null && typeof obj.brief === 'object') {
    const b = obj.brief as Record<string, unknown>;
    const brief: NonNullable<typeof input.brief> = {};
    if (typeof b.objective === 'string') brief.objective = b.objective;
    if (Array.isArray(b.requirements)) {
      brief.requirements = b.requirements.filter((r): r is string => typeof r === 'string');
    }
    if (Array.isArray(b.constraints)) {
      brief.constraints = b.constraints.filter((r): r is string => typeof r === 'string');
    }
    if (Array.isArray(b.nextSteps)) {
      brief.nextSteps = b.nextSteps.filter((r): r is string => typeof r === 'string');
    }
    // approvedDecisions/completedMilestones cannot be set at create time —
    // the project has no approved decisions or completed milestones yet.
    if (Object.keys(brief).length > 0) input.brief = brief;
  }

  try {
    const record = deps.projectStore.createProject(caller.callerId, input);
    sendJson(res, 201, withLinks(record));
  } catch (e) {
    if (e instanceof ProjectValidationError) {
      sendError(res, 400, 'INVALID_PROJECT', e.message);
    } else if (e instanceof IdempotencyConflictError) {
      sendError(res, 409, 'IDEMPOTENCY_CONFLICT', e.message);
    } else {
      sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function handleList(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProjectRouteDeps,
  caller: CallerIdentity,
): Promise<boolean> {
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
  const result = deps.projectStore.listProjects(caller.callerId, { limit, cursor });
  const body: { projects: ProjectSummary[]; nextCursor: string | null } = result;
  sendJson(res, 200, body);
  return true;
}

// ---------------------------------------------------------------------------
// Resource handlers (project ID in path)
// ---------------------------------------------------------------------------

async function handleProjectResource(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProjectRouteDeps,
  caller: CallerIdentity,
  projectId: string,
  subresource: string | undefined,
): Promise<boolean> {
  // GET /v1/projects/{id} — get metadata
  if (req.method === 'GET' && (subresource === undefined || subresource === '')) {
    try {
      const record = deps.projectStore.getProject(projectId, caller.callerId);
      sendJson(res, 200, withLinks(record));
    } catch (e) {
      handleProjectStoreError(res, e);
    }
    return true;
  }

  // PATCH /v1/projects/{id} — update metadata
  if (req.method === 'PATCH' && (subresource === undefined || subresource === '')) {
    const body = await readJsonBody(req);
    if (body === null) {
      sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
      return true;
    }
    const obj = body as Record<string, unknown>;
    if (typeof obj.ownerId === 'string') {
      sendError(res, 400, 'OWNER_ID_NOT_ALLOWED', 'ownerId cannot be supplied by the client');
      return true;
    }
    const input: { name?: string; description?: string; status?: ProjectStatus } = {};
    if (typeof obj.name === 'string') input.name = obj.name;
    if (typeof obj.description === 'string') input.description = obj.description;
    if (obj.status !== undefined) {
      if (obj.status !== 'active' && obj.status !== 'archived') {
        sendError(res, 400, 'INVALID_STATUS', `status must be 'active' or 'archived' (got: ${String(obj.status)})`);
        return true;
      }
      input.status = obj.status;
    }
    try {
      const record = deps.projectStore.updateProject(projectId, caller.callerId, input);
      sendJson(res, 200, withLinks(record));
    } catch (e) {
      handleProjectStoreError(res, e);
    }
    return true;
  }

  // GET /v1/projects/{id}/brief
  if (req.method === 'GET' && subresource === 'brief') {
    try {
      const brief = deps.projectStore.getBrief(projectId, caller.callerId);
      sendJson(res, 200, { projectId, brief });
    } catch (e) {
      handleProjectStoreError(res, e);
    }
    return true;
  }

  // PUT /v1/projects/{id}/brief — update Brief (revision-controlled)
  if (req.method === 'PUT' && subresource === 'brief') {
    const body = await readJsonBody(req);
    if (body === null) {
      sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
      return true;
    }
    const obj = body as Record<string, unknown>;
    if (typeof obj.revision !== 'number') {
      sendError(res, 400, 'INVALID_REVISION', 'revision (number) is required for Brief updates');
      return true;
    }
    const update: {
      revision: number;
      objective?: string;
      requirements?: string[];
      constraints?: string[];
      approvedDecisions?: BriefEntry[];
      completedMilestones?: BriefEntry[];
      nextSteps?: string[];
    } = { revision: obj.revision };
    if (typeof obj.objective === 'string') update.objective = obj.objective;
    if (Array.isArray(obj.requirements)) {
      update.requirements = obj.requirements.filter((r): r is string => typeof r === 'string');
    }
    if (Array.isArray(obj.constraints)) {
      update.constraints = obj.constraints.filter((r): r is string => typeof r === 'string');
    }
    if (Array.isArray(obj.nextSteps)) {
      update.nextSteps = obj.nextSteps.filter((r): r is string => typeof r === 'string');
    }
    if (Array.isArray(obj.approvedDecisions)) {
      update.approvedDecisions = filterBriefEntries(obj.approvedDecisions);
    }
    if (Array.isArray(obj.completedMilestones)) {
      update.completedMilestones = filterBriefEntries(obj.completedMilestones);
    }
    try {
      const record = deps.projectStore.updateBrief(projectId, caller.callerId, update);
      sendJson(res, 200, { projectId, brief: record.brief });
    } catch (e) {
      if (e instanceof BriefRevisionConflictError) {
        sendError(res, 409, 'BRIEF_REVISION_CONFLICT', e.message);
      } else {
        handleProjectStoreError(res, e);
      }
    }
    return true;
  }

  // GET /v1/projects/{id}/overview — derived from authoritative sources
  if (req.method === 'GET' && subresource === 'overview') {
    try {
      const overview = await buildOverview(deps, caller, projectId);
      sendJson(res, 200, overview);
    } catch (e) {
      handleProjectStoreError(res, e);
    }
    return true;
  }

  // POST /v1/projects/{id}/conversations — link a conversation
  if (req.method === 'POST' && subresource === 'conversations') {
    const body = await readJsonBody(req);
    if (body === null) {
      sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
      return true;
    }
    const obj = body as Record<string, unknown>;
    if (typeof obj.conversationId !== 'string' || obj.conversationId.length === 0) {
      sendError(res, 400, 'INVALID_CONVERSATION_ID', 'conversationId must be a non-empty string');
      return true;
    }
    const conversationId = obj.conversationId;
    const idempotencyKey = typeof obj.idempotencyKey === 'string' ? obj.idempotencyKey : undefined;

    // CRITICAL: verify conversation ownership BEFORE linking. A conversationId
    // alone is not proof of ownership — the caller must actually be able to
    // retrieve the conversation under their own callerId.
    try {
      deps.conversationStore.getConversation(conversationId, caller.callerId);
    } catch (e) {
      if (e instanceof ConversationNotFoundError || e instanceof ConversationOwnershipError) {
        // 404 (not 403) to avoid leaking existence — same pattern as missions.
        sendError(res, 404, 'CONVERSATION_NOT_FOUND', `conversation not found: ${conversationId}`);
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
      }
      return true;
    }

    try {
      const record = deps.projectStore.linkConversation(
        projectId,
        caller.callerId,
        conversationId,
        {
          idempotencyKey,
          verifyOwnership: () => {
            try {
              deps.conversationStore.getConversation(conversationId, caller.callerId);
              return true;
            } catch {
              return false;
            }
          },
        },
      );
      sendJson(res, 200, withLinks(record));
    } catch (e) {
      if (e instanceof ConversationAlreadyLinkedError) {
        sendError(res, 409, 'CONVERSATION_ALREADY_LINKED', e.message);
      } else if (e instanceof IdempotencyConflictError) {
        sendError(res, 409, 'IDEMPOTENCY_CONFLICT', e.message);
      } else {
        handleProjectStoreError(res, e);
      }
    }
    return true;
  }

  // POST /v1/projects/{id}/missions — link a mission
  if (req.method === 'POST' && subresource === 'missions') {
    const body = await readJsonBody(req);
    if (body === null) {
      sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
      return true;
    }
    const obj = body as Record<string, unknown>;
    if (typeof obj.missionId !== 'string' || obj.missionId.length === 0) {
      sendError(res, 400, 'INVALID_MISSION_ID', 'missionId must be a non-empty string');
      return true;
    }
    const missionId = obj.missionId;
    const idempotencyKey = typeof obj.idempotencyKey === 'string' ? obj.idempotencyKey : undefined;

    // CRITICAL: verify mission ownership via MissionService BEFORE linking.
    // A missionId alone is NOT proof of ownership. MissionService.get()
    // throws MissionNotFoundError if the mission does not exist OR if it is
    // owned by a different caller (intentional ambiguity to avoid leaking
    // existence). If the mission is unavailable after restart, we cannot
    // verify ownership — reject the link rather than trusting a caller-supplied ID.
    let verifiedAt: string;
    try {
      deps.missionService.get(missionId, caller);
      verifiedAt = new Date().toISOString();
    } catch (e) {
      if (e instanceof MissionNotFoundError) {
        // The mission is either not owned by this caller OR no longer in
        // the in-process registry (gateway restarted). Either way, we cannot
        // verify ownership — reject the link honestly.
        sendError(res, 404, 'MISSION_NOT_FOUND', `mission not found or not owned by caller: ${missionId}`);
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
      }
      return true;
    }

    try {
      const record = deps.projectStore.linkMission(
        projectId,
        caller.callerId,
        missionId,
        { idempotencyKey, verifiedAt },
      );
      sendJson(res, 200, withLinks(record));
    } catch (e) {
      if (e instanceof IdempotencyConflictError) {
        sendError(res, 409, 'IDEMPOTENCY_CONFLICT', e.message);
      } else {
        handleProjectStoreError(res, e);
      }
    }
    return true;
  }

  // POST /v1/projects/{id}/artifacts — link an artifact reference
  if (req.method === 'POST' && subresource === 'artifacts') {
    const body = await readJsonBody(req);
    if (body === null) {
      sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
      return true;
    }
    const obj = body as Record<string, unknown>;
    if (typeof obj.missionId !== 'string' || obj.missionId.length === 0) {
      sendError(res, 400, 'INVALID_MISSION_ID', 'missionId must be a non-empty string');
      return true;
    }
    if (typeof obj.path !== 'string' || obj.path.length === 0) {
      sendError(res, 400, 'INVALID_ARTIFACT_PATH', 'path must be a non-empty string');
      return true;
    }
    // Defense-in-depth: reject traversal/absolute/control-char paths at the
    // gateway before calling MissionService. The store ALSO rejects them,
    // but doing it here gives a cleaner 400 (vs a 404 ARTIFACT_NOT_FOUND
    // that might mislead the caller into thinking the path just isn't in
    // the mission's list).
    if (
      obj.path.includes('..') ||
      obj.path.startsWith('/') ||
      obj.path.includes('\0')
    ) {
      sendError(res, 400, 'INVALID_ARTIFACT_PATH', 'path rejected by safety filter (traversal or absolute)');
      return true;
    }
    const missionId = obj.missionId;
    const path = obj.path;
    const workerId = typeof obj.workerId === 'string' ? obj.workerId : undefined;
    const idempotencyKey = typeof obj.idempotencyKey === 'string' ? obj.idempotencyKey : undefined;

    // CRITICAL: verify mission ownership AND that the path actually exists
    // in the mission's artifact list. Reject arbitrary caller-supplied paths
    // that don't appear in the verified artifact list.
    let verifiedAt: string;
    try {
      deps.missionService.get(missionId, caller);
      const artifacts = await deps.missionService.getArtifacts(missionId, caller);
      const found = artifacts.find(
        (a) => a.path === path && (workerId === undefined || a.workerId === workerId),
      );
      if (found === undefined) {
        sendError(
          res,
          404,
          'ARTIFACT_NOT_FOUND',
          `artifact path "${path}" not found in mission ${missionId}'s artifact list`,
        );
        return true;
      }
      verifiedAt = new Date().toISOString();
    } catch (e) {
      if (e instanceof MissionNotFoundError) {
        sendError(res, 404, 'MISSION_NOT_FOUND', `mission not found or not owned by caller: ${missionId}`);
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
      }
      return true;
    }

    try {
      const record = deps.projectStore.linkArtifact(
        projectId,
        caller.callerId,
        { missionId, path, workerId },
        { idempotencyKey, verifiedAt },
      );
      sendJson(res, 200, withLinks(record));
    } catch (e) {
      if (e instanceof IdempotencyConflictError) {
        sendError(res, 409, 'IDEMPOTENCY_CONFLICT', e.message);
      } else {
        handleProjectStoreError(res, e);
      }
    }
    return true;
  }

  // Method not allowed on this path.
  sendError(res, 405, 'METHOD_NOT_ALLOWED', `method ${req.method} not allowed on this path`);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withLinks(record: ProjectRecord): ProjectRecord & {
  links: { self: string; brief: string; overview: string };
} {
  return {
    ...record,
    links: {
      self: `/v1/projects/${record.projectId}`,
      brief: `/v1/projects/${record.projectId}/brief`,
      overview: `/v1/projects/${record.projectId}/overview`,
    },
  };
}

function filterBriefEntries(arr: readonly unknown[]): BriefEntry[] {
  const out: BriefEntry[] = [];
  for (const item of arr) {
    if (item === null || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id.length === 0) continue;
    if (typeof e.text !== 'string' || e.text.length === 0) continue;
    if (
      e.provenance !== 'USER_APPROVED' &&
      e.provenance !== 'SOURCE_VERIFIED' &&
      e.provenance !== 'DRAFT'
    ) {
      continue;
    }
    const entry: {
      id: string;
      text: string;
      provenance: BriefProvenance;
      source?: string;
      approvedAt?: string;
    } = {
      id: e.id,
      text: e.text,
      provenance: e.provenance as BriefProvenance,
    };
    if (typeof e.source === 'string') entry.source = e.source;
    if (typeof e.approvedAt === 'string') entry.approvedAt = e.approvedAt;
    out.push(entry);
  }
  return out;
}

function handleProjectStoreError(res: ServerResponse, e: unknown): void {
  if (e instanceof ProjectNotFoundError || e instanceof ProjectOwnershipError) {
    // 404 (not 403) to avoid leaking existence — same pattern as missions + conversations.
    sendError(res, 404, 'PROJECT_NOT_FOUND', e.message);
  } else if (e instanceof ProjectValidationError) {
    sendError(res, 400, 'INVALID_PROJECT', e.message);
  } else if (e instanceof IdempotencyConflictError) {
    sendError(res, 409, 'IDEMPOTENCY_CONFLICT', e.message);
  } else {
    sendError(res, 500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Build the Project Overview from authoritative sources:
 *   - Project metadata + Brief: from FileProjectStore (durable).
 *   - Conversation availability: from FileConversationStore (verifies ownership).
 *   - Mission availability + status: from MissionService (in-process registry).
 *   - Artifact availability: from MissionService.getArtifacts (re-verifies the
 *     path against the mission's CURRENT artifact list).
 *
 * The overview never fabricates. If a mission is no longer in the in-process
 * registry (gateway restarted), the overview shows "unavailable" honestly.
 * If an artifact path is no longer in the mission's artifact list (worker
 * overwrote it, verifier cleared it), the overview shows "missing" honestly.
 */
async function buildOverview(
  deps: ProjectRouteDeps,
  caller: CallerIdentity,
  projectId: string,
): Promise<ProjectOverview> {
  const record = deps.projectStore.getProject(projectId, caller.callerId);

  const conversations: ProjectOverviewConversation[] = [];
  for (const link of record.conversationLinks) {
    try {
      const conv = deps.conversationStore.getConversation(link.conversationId, caller.callerId);
      const messages = deps.conversationStore.getMessages(link.conversationId, caller.callerId);
      conversations.push({
        conversationId: link.conversationId,
        linkedAt: link.linkedAt,
        available: true,
        title: conv.title,
        updatedAt: conv.updatedAt,
        messageCount: messages.messages.length,
      });
    } catch {
      conversations.push({
        conversationId: link.conversationId,
        linkedAt: link.linkedAt,
        available: false,
      });
    }
  }

  const missions: ProjectOverviewMission[] = [];
  for (const link of record.missionLinks) {
    try {
      const snap = deps.missionService.get(link.missionId, caller);
      missions.push({
        missionId: link.missionId,
        linkedAt: link.linkedAt,
        verifiedAt: link.verifiedAt,
        availability: 'live',
        status: snap.status,
        terminal: snap.terminal,
        acceptedAt: snap.acceptedAt,
        finishedAt: snap.finishedAt,
      });
    } catch {
      missions.push({
        missionId: link.missionId,
        linkedAt: link.linkedAt,
        verifiedAt: link.verifiedAt,
        availability: 'unavailable',
      });
    }
  }

  const artifacts: ProjectOverviewArtifact[] = [];
  for (const ref of record.artifactRefs) {
    try {
      const snapshot = deps.missionService.get(ref.missionId, caller);
      const list = await deps.missionService.getArtifacts(ref.missionId, caller);
      const found = list.find(
        (a) => a.path === ref.path && (ref.workerId === undefined || a.workerId === ref.workerId),
      );
      if (found === undefined) {
        artifacts.push({
          missionId: ref.missionId,
          path: ref.path,
          workerId: ref.workerId,
          linkedAt: ref.linkedAt,
          verifiedAt: ref.verifiedAt,
          availability: 'missing',
        });
      } else {
        artifacts.push({
          missionId: ref.missionId,
          path: ref.path,
          workerId: ref.workerId,
          linkedAt: ref.linkedAt,
          verifiedAt: ref.verifiedAt,
          availability: 'available',
          verified: found.verified,
          bytes: found.bytes,
        });
      }
      // silence unused-variable warning for snapshot (kept for the catch
      // semantics: get() throws on missing; we don't actually need the snapshot
      // data here — getArtifacts() also re-verifies ownership).
      void snapshot;
    } catch {
      artifacts.push({
        missionId: ref.missionId,
        path: ref.path,
        workerId: ref.workerId,
        linkedAt: ref.linkedAt,
        verifiedAt: ref.verifiedAt,
        availability: 'unavailable',
      });
    }
  }

  // latestActivityAt = max of: project.updatedAt, latest linkedAt across all
  // relationship types, latest mission finishedAt.
  const candidates: string[] = [record.updatedAt];
  for (const c of conversations) {
    if (c.updatedAt !== undefined) candidates.push(c.updatedAt);
  }
  for (const m of missions) {
    if (m.finishedAt !== undefined) candidates.push(m.finishedAt);
  }
  for (const a of artifacts) {
    candidates.push(a.linkedAt);
  }
  const latestActivityAt = candidates.reduce((max, v) => (v > max ? v : max));

  return {
    project: {
      projectId: record.projectId,
      ownerId: record.ownerId,
      name: record.name,
      description: record.description,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    brief: record.brief,
    conversations,
    missions,
    artifacts,
    latestActivityAt,
  };
}
