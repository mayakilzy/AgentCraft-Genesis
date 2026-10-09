/**
 * AgentCraft Genesis G7 — Typed UI Adapter (verified operations only)
 *
 * Per 04_GATEWAY_DISCOVERY_AND_ADAPTER_CONTRACT.md, this adapter defines ONLY
 * the operations actually supported by source. Square-bracket operations are
 * NOT synthesized without evidence.
 *
 * Browser auth strategy: the UI NEVER calls the gateway directly. All calls go
 * through the Next.js Route Handler at /api/genesis/[...path] which keeps the
 * Bearer API key server-side (R02 CRITICAL).
 *
 * The adapter returns discriminated results: ok | unsupported | unauthorized |
 * unavailable | uncertain | error. It never maps all errors to 500 or 200,
 * and never claims success before a server acknowledgement.
 */

import type {
  AdapterResult,
  GatewayErrorBody,
  HealthResponse,
  MissionArtifactRecord,
  MissionCancelAck,
  MissionEventRecord,
  MissionListResult,
  MissionSnapshot,
  MissionSubmission,
  MissionSubmissionAck,
} from "./types";

// ---------------------------------------------------------------------------
// Connection state (04_GATEWAY_DISCOVERY_AND_ADAPTER_CONTRACT.md §Event contract)
// Separate from mission status.
// ---------------------------------------------------------------------------

export type ConnectionState =
  | "connecting"
  | "live"
  | "stale"
  | "disconnected"
  | "failed";

// ---------------------------------------------------------------------------
// Abortable fetch helper with timeout
// ---------------------------------------------------------------------------

interface FetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function fetchGenesis(
  path: string,
  opts: FetchOptions = {},
): Promise<{
  status: number;
  body: unknown;
}> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Chain the caller's signal if provided (e.g., navigation abort).
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  try {
    const init: RequestInit = {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      // Include the BFF cookie (SameSite=Strict + HttpOnly). The cookie is
      // auto-issued by /api/auth/setup on AppShell mount. Without this,
      // the BFF returns 401 for every call.
      credentials: "include",
    };
    if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`/api/genesis${path}`, init);
    const raw = await res.text();
    let parsed: unknown = raw;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // keep raw text — used for malformed-response testing (UI-001)
      }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Discriminator
// ---------------------------------------------------------------------------

function toResult<T>(
  status: number,
  body: unknown,
  okStatus: number,
  okKind: "ok",
): AdapterResult<T> {
  const receivedAt = new Date().toISOString();
  if (status === okStatus) {
    return { kind: okKind, data: body as T, status, receivedAt };
  }
  if (status === 401) {
    return {
      kind: "unauthorized",
      status,
      code: (body as GatewayErrorBody | null)?.error?.code ?? "UNAUTHENTICATED",
      message: (body as GatewayErrorBody | null)?.error?.message,
      raw: body,
      receivedAt,
    };
  }
  if (status === 403) {
    return {
      kind: "unauthorized",
      status,
      code: "FORBIDDEN",
      message: (body as GatewayErrorBody | null)?.error?.message,
      raw: body,
      receivedAt,
    };
  }
  if (status === 404) {
    return {
      kind: "error",
      status,
      code: "MISSION_NOT_FOUND",
      message: (body as GatewayErrorBody | null)?.error?.message ?? "mission not found",
      raw: body,
      receivedAt,
    };
  }
  if (status === 409) {
    return {
      kind: "error",
      status,
      code: "NOT_FINISHED",
      message: (body as GatewayErrorBody | null)?.error?.message ?? "mission not finished",
      raw: body,
      receivedAt,
    };
  }
  if (status === 429) {
    return {
      kind: "error",
      status,
      code: "ADMISSION_DENIED",
      message: (body as GatewayErrorBody | null)?.error?.message ?? "admission denied",
      raw: body,
      receivedAt,
    };
  }
  if (status >= 500) {
    return {
      kind: "error",
      status,
      code: "INTERNAL_ERROR",
      message: (body as GatewayErrorBody | null)?.error?.message ?? "internal error",
      raw: body,
      receivedAt,
    };
  }
  return {
    kind: "error",
    status,
    message: `unexpected status ${status}`,
    raw: body,
    receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Public adapter operations (only verified-supported operations)
// ---------------------------------------------------------------------------

export const genesisApi = {
  /**
   * GET /health — public, no auth. Used by ConnectionStatus.
   * Source: src/gateway/http-server.ts:93-108
   */
  async health(signal?: AbortSignal): Promise<AdapterResult<HealthResponse>> {
    try {
      const { status, body } = await fetchGenesis("/health", { signal });
      return toResult<HealthResponse>(status, body, 200, "ok");
    } catch (e) {
      return {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * GET /ready — public, no auth. Liveness probe.
   * Source: src/gateway/http-server.ts:109-112
   */
  async ready(signal?: AbortSignal): Promise<AdapterResult<{ ready: boolean }>> {
    try {
      const { status, body } = await fetchGenesis("/ready", { signal });
      return toResult<{ ready: boolean }>(status, body, 200, "ok");
    } catch (e) {
      return {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * POST /v1/missions — submit a mission.
   * Source: src/gateway/http-server.ts:123-188. Returns 202 on success.
   * On network failure after submit (no 202 received), UI MUST show UNCERTAIN,
   * not auto-retry. Caller may resubmit with the same idempotencyKey if the
   * gateway exposes that capability (it does — http-server.ts handles it
   * in MissionService.start()).
   */
  async submitMission(
    submission: MissionSubmission,
    signal?: AbortSignal,
  ): Promise<AdapterResult<MissionSubmissionAck>> {
    try {
      const { status, body } = await fetchGenesis("/v1/missions", {
        method: "POST",
        body: submission,
        signal,
      });
      return toResult<MissionSubmissionAck>(status, body, 202, "ok");
    } catch (e) {
      // Network failure: never claim success. Return uncertain if it could
      // have reached the gateway (POST is non-idempotent without key).
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      return {
        kind: isAbort ? "unavailable" : "uncertain",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * GET /v1/missions/{missionId} — read mission snapshot.
   * Source: src/gateway/http-server.ts:200-204 + handleMissionResource.
   * 404 if not found OR not owned by caller (intentional ambiguity).
   */
  async getMission(
    missionId: string,
    signal?: AbortSignal,
  ): Promise<AdapterResult<MissionSnapshot>> {
    try {
      const { status, body } = await fetchGenesis(
        `/v1/missions/${encodeURIComponent(missionId)}`,
        { signal },
      );
      return toResult<MissionSnapshot>(status, body, 200, "ok");
    } catch (e) {
      return {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * GET /v1/missions/{missionId}/events — event stream (polling, max 100).
   * Source: src/gateway/http-server.ts:205-208.
   * G7-01-F-001: offset is hardcoded to 0, limit to 100. UI labels truncation.
   */
  async getEvents(
    missionId: string,
    signal?: AbortSignal,
  ): Promise<AdapterResult<{ missionId: string; events: MissionEventRecord[] }>> {
    try {
      const { status, body } = await fetchGenesis(
        `/v1/missions/${encodeURIComponent(missionId)}/events`,
        { signal },
      );
      return toResult<{ missionId: string; events: MissionEventRecord[] }>(
        status,
        body,
        200,
        "ok",
      );
    } catch (e) {
      return {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * GET /v1/missions/{missionId}/result — terminal result (409 if !terminal).
   * Source: src/gateway/http-server.ts:210-224.
   */
  async getResult(
    missionId: string,
    signal?: AbortSignal,
  ): Promise<
    AdapterResult<{
      missionId: string;
      status: string;
      result: import("./types").MissionResult;
      failureClass?: string;
      failureMessage?: string;
    }>
  > {
    try {
      const { status, body } = await fetchGenesis(
        `/v1/missions/${encodeURIComponent(missionId)}/result`,
        { signal },
      );
      return toResult(status, body, 200, "ok");
    } catch (e) {
      return {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * GET /v1/missions/{missionId}/artifacts — artifact list with content ≤64KB.
   * Source: src/gateway/http-server.ts:225-228.
   */
  async getArtifacts(
    missionId: string,
    signal?: AbortSignal,
  ): Promise<AdapterResult<{ missionId: string; artifacts: MissionArtifactRecord[] }>> {
    try {
      const { status, body } = await fetchGenesis(
        `/v1/missions/${encodeURIComponent(missionId)}/artifacts`,
        { signal },
      );
      return toResult<{ missionId: string; artifacts: MissionArtifactRecord[] }>(
        status,
        body,
        200,
        "ok",
      );
    } catch (e) {
      return {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * POST /v1/missions/{missionId}/cancel — request cancellation.
   * Source: src/gateway/http-server.ts:230-233. Returns 202 with cancelRequested:true.
   * Cancellation REQUEST != COMPLETE. UI must poll until status=CANCELLED or race.
   */
  async cancelMission(
    missionId: string,
    signal?: AbortSignal,
  ): Promise<AdapterResult<MissionCancelAck>> {
    try {
      const { status, body } = await fetchGenesis(
        `/v1/missions/${encodeURIComponent(missionId)}/cancel`,
        { method: "POST", signal },
      );
      return toResult<MissionCancelAck>(status, body, 202, "ok");
    } catch (e) {
      return {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * GET /v1/missions — list the caller's missions (G7-10).
   *
   * Server-authoritative listing of the in-process mission registry, filtered
   * to the caller's ownership. NOT restart-durable — terminal missions are
   * evicted after the retention window (default 5 min), and the entire
   * registry is lost on process restart.
   *
   * Pagination is cursor-based: pass nextCursor from the previous response
   * to fetch the next page. Pass undefined/null cursor for the first page.
   *
   * Source: src/gateway/http-server.ts handleList() + MissionService.listMissions().
   *
   * @param opts.limit - page size (1-100, default 10)
   * @param opts.cursor - pagination cursor (missionId from previous page)
   * @param signal - abort signal
   * @returns discriminated result; ok.data is MissionListResult
   */
  async listMissions(
    opts: { limit?: number; cursor?: string | null } = {},
    signal?: AbortSignal,
  ): Promise<AdapterResult<MissionListResult>> {
    try {
      const params = new URLSearchParams();
      if (opts.limit !== undefined) params.set("limit", String(opts.limit));
      if (opts.cursor) params.set("cursor", opts.cursor);
      const query = params.toString();
      const path = query ? `/v1/missions?${query}` : "/v1/missions";
      const { status, body } = await fetchGenesis(path, { signal });
      return toResult<MissionListResult>(status, body, 200, "ok");
    } catch (e) {
      return {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        receivedAt: new Date().toISOString(),
      };
    }
  },

  /**
   * listMissions — ABSENT in the gateway (verified by source inspection).
   * Per 04_GATEWAY_DISCOVERY, square-bracket operations are not synthesized.
   * UI MissionList is client-side only (browser-known missions).
   *
   * The `undefined as never` assignment documents the absence in the type
   * system: any caller attempting `genesisApi.listMissions(...)` will get
   * a compile error because `undefined` is not callable.
   */
  // listMissions is now implemented above (G7-10). This placeholder is kept
  // for historical reference; the real implementation supersedes it.
  // listMissions: undefined as never,
  /**
   * listWorkers / getOrganization — ABSENT (no /workers endpoint).
   * Worker info is inferred from event payloads only (PARTIAL).
   */
  listWorkers: undefined as never,
  /**
   * Capability discovery — ABSENT (no /capabilities endpoint).
   * UI Studio renders static data/ownership.yaml labeled "Documentation only".
   */
  listCapabilities: undefined as never,
  /**
   * Approvals/HITL — ABSENT (WAITING_FOR_APPROVAL not advertised).
   * UI hides approval controls.
   */
  requestApproval: undefined as never,
} as const;
