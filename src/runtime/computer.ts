import type { RuntimeAdapter, RuntimeHandle } from '../contracts/core.js';

/**
 * Runtime execution surface (TASK-010).
 *
 * GROUP 1 froze `RuntimeAdapter` as the worker LIFECYCLE boundary
 * (ensureWorker/stopWorker). TASK-010 exposed the concrete integration need
 * the frozen contract does not cover: a worker must also DO things on its
 * computer (run commands, read and write workspace files). Rather than
 * reopening the frozen core contracts, that execution surface lives here as a
 * separate port, satisfied by the OpenBot adapter against the documented
 * agent-computer HTTP API.
 *
 * Shapes mirror the published OpenBot computer contract (`/exec`, `/files/*`)
 * — the same fields upstream returns, nothing added.
 */

/** Result of one command run on a worker computer (OpenBot `/exec` contract). */
export interface ExecResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
}

/** One entry in a workspace listing (OpenBot `/files/list` contract). */
export interface WorkspaceEntry {
  readonly path: string;
  readonly kind: 'file' | 'folder';
  readonly bytes?: number;
}

// ---------------------------------------------------------------------------
// G6-08 (RB-1) — Artifacts retrieval contract
// ---------------------------------------------------------------------------

/**
 * G6-08 (RB-1) — One worker's artifact as observed by the runtime adapter.
 *
 * The runtime is the source of truth for what files exist in each worker's
 * workspace; the gateway's `getArtifacts()` retrieval path delegates to the
 * runtime's {@link ArtifactsProvider.listArtifacts} to enumerate them.
 *
 * `content` is inlined iff the file is small enough (≤ 64KB); larger files are
 * reported by size only — callers must retrieve their content out-of-band.
 */
export interface ArtifactSnapshot {
  readonly workerId: string;
  readonly path: string;
  readonly bytes: number;
  /** Inlined file content (≤ 64KB). Undefined for larger files. */
  readonly content?: string;
}

/**
 * G6-08 (RB-1) — Optional runtime capability: enumerate the artifacts
 * produced by every worker this runtime has ensured.
 *
 * Runtimes that hold their own internal `computers` Map (the OpenBot adapter,
 * MemoryRuntime) implement this so the gateway's `getArtifacts()` retrieves
 * genuine artifacts rather than an empty list.
 *
 * Verifier clean-room workers (`mission-verifier-*`) are excluded by
 * convention — they hold verification copies, not mission deliverables.
 */
export interface ArtifactsProvider {
  listArtifacts(): Promise<readonly ArtifactSnapshot[]>;
}

/** Result of reading one workspace file (OpenBot `/files/read` contract). */
export interface ReadResult {
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

/** Result of writing one workspace file (OpenBot `/files/write` contract). */
export interface WriteResult {
  readonly path: string;
  readonly bytes: number;
  readonly appended: boolean;
}

/** Options for one command execution. */
export interface ExecOptions {
  /** Hard per-command timeout; the computer enforces its own cap on top. */
  readonly timeoutMs?: number;
}

/** Result of navigating the computer's browser (OpenBot `/navigate` contract). */
export interface NavigateResult {
  readonly url: string;
  readonly title: string;
  /** Readable page text — the verification-relevant content. */
  readonly text: string;
  readonly truncated: boolean;
  readonly elapsedMs: number;
  /** Upstream challenge signal (e.g. CDN interstitials), passed through. */
  readonly challenge?: unknown;
}

/** Result of a screenshot (OpenBot `/screenshot` contract, minus pixels). */
export interface ScreenshotEvidence {
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly url: string;
  readonly capturedAt: string;
}

/**
 * The browser surface of one worker's computer (TASK-018): navigate to an
 * http(s) URL and capture screenshot evidence. Mirrors the upstream
 * agent-computer endpoints exactly — navigation errors come back as the
 * computer's own error responses, which is precisely the useful failure
 * evidence the verification loop wants.
 */
export interface BrowserSurface {
  navigate(url: string): Promise<NavigateResult>;
  screenshot(): Promise<ScreenshotEvidence>;
}

/**
 * The hands of one worker: a single worker's computer, already bound to that
 * worker's identity. Implementations confine every path to the worker's own
 * workspace and run every command with the workspace as cwd — exactly the
 * upstream semantics. The browser surface is optional: it exists exactly
 * when the worker's genome was granted a browser (TASK-018).
 */
export interface WorkerComputer {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, contents: string): Promise<WriteResult>;
  readFile(path: string): Promise<ReadResult>;
  listFiles(path?: string): Promise<readonly WorkspaceEntry[]>;
  /** Present iff this computer exposes its browser (browser-granted workers). */
  readonly browser?: BrowserSurface;
}

/**
 * What the Mission Orchestrator (TASK-012) actually needs from a runtime:
 * the frozen lifecycle boundary PLUS a way to obtain a worker's surfaces.
 * The OpenBot adapter satisfies this; tests satisfy it with stubs.
 *
 * PHASE 4.5: `WorkerRuntime` is generalized from a computer-only interface to
 * a surface-bundle interface. The legacy `computer(handle)` method remains
 * for backward compatibility (the OpenBot adapter and existing tests use it);
 * the new `surfaces(handle)` method is the provider-neutral dispatch point
 * the MissionOrchestrator uses. A worker may have zero, one, or multiple
 * surfaces; `surfaces(handle)` returns the bundle of whatever is available.
 *
 * Phase 4.6 will add `workspace` to `WorkerSurfaces` (OpenDots adapter).
 * Phase 4.7 will add `job` to `WorkerSurfaces` (OpenMuse adapter).
 * The orchestrator does not change — it already calls `surfaces(handle)`.
 */
export interface WorkerRuntime extends RuntimeAdapter {
  /**
   * The execution surface for one ensured worker. Legacy method — the
   * OpenBot adapter implements it directly. New code should call
   * `surfaces(handle)` and read `surfaces.computer`.
   */
  computer(handle: RuntimeHandle): WorkerComputer;
  /**
   * PHASE 4.5. The surfaces available for one ensured worker. A worker that
   * needs no computer gets `{}`. A worker that needs a computer gets
   * `{ computer: ... }`. Phase 4.6+ will add `workspace` and `job` surfaces.
   */
  surfaces(handle: RuntimeHandle): WorkerSurfaces;
  /**
   * G6-08-R1 (B-EXEC-FINDING-003): optional best-effort close that stops
   * every worker this runtime still holds. Implementations that hold
   * external process resources (OpenBotRuntimeAdapter) override this to
   * terminate child processes gracefully. Implementations with no external
   * resources (MemoryRuntime) can omit it — the default is a no-op.
   *
   * Called by MissionService.shutdown() after all active missions have
   * been cancelled and their orchestrator finally{} blocks have run
   * stopWorker() per-worker. close() is the safety net for any workers
   * that survived per-mission stopWorker (e.g., the verifier worker that
   * was ensured after the mission's main workers retired).
   */
  close?(): Promise<void>;
}

/**
 * PHASE 4.5. The minimal surfaces a runtime adapter exposes for one worker.
 * A worker may have zero, one, or multiple surfaces. For Phase 4.5, only the
 * `computer` surface exists (provided by the OpenBot adapter). Phase 4.6
 * adds `workspace` (OpenDots); Phase 4.7 adds `job` (OpenMuse).
 *
 * Every surface field is optional — a worker that needs no computer (e.g., a
 * pure-reasoning coordinator) gets `{}`. A worker that needs a computer gets
 * `{ computer: ... }`. A future worker that needs both computer and
 * workspace gets `{ computer: ..., workspace: ... }`.
 */
export interface WorkerSurfaces {
  readonly computer?: WorkerComputer;
  /** PHASE 4.6: collaborative workspace surface (OpenDots adapter). */
  readonly workspace?: WorkspaceSurface;
  /** PHASE 4.7: durable delegated work surface (OpenMuse adapter). */
  readonly job?: JobSurface;
}

// ---------------------------------------------------------------------------
// PHASE 4.7 — Durable work surface (OpenMuse)
// ---------------------------------------------------------------------------

/**
 * PHASE 4.7. Provider-neutral durable task status. Mirrors the terminal and
 * near-terminal states a durable task can be in, without exposing upstream-
 * specific state names. The adapter maps upstream states to these.
 */
export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'paused';

/** The terminal states — no further state transitions are expected. */
export const TERMINAL_JOB_STATES: ReadonlySet<JobStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

/**
 * PHASE 4.7. A handle to a durable delegated task. Obtained from
 * {@link JobSurface} when a worker's genome declares the `durable-delegation`
 * operational need. The handle carries the task identity; the surface carries
 * the current status and result.
 *
 * Provider-neutral: `provider` names who realized the task; `taskId` is the
 * provider-specific identifier. Neither leaks into WorkerGenome.
 */
export interface JobHandle {
  /** Provider that realized this durable task ('openmuse', future providers). */
  readonly provider: string;
  /** Provider-specific task identifier. */
  readonly taskId: string;
}

/**
 * PHASE 4.7. The durable work surface. Allows a worker (or the orchestrator)
 * to inspect the status and result of a durable delegated task. The task is
 * created by the adapter during `ensureJob`; the surface exposes its lifecycle.
 *
 * CRITICAL SEMANTIC (Phase 4.7 §12): JobHandle existence does NOT mean the
 * job succeeded. Completion may only recognize a durable deliverable when
 * `getStatus()` returns `'succeeded'` AND `getResult()` returns a non-empty
 * string. A queued/running/failed/cancelled task does NOT satisfy completion.
 *
 * Minimal: getStatus, getResult, cancel. No checkpoint inspection, no lease
 * management, no plan exposure — those are OpenMuse internals. Genesis
 * observes the task's terminal state and result.
 */
export interface JobSurface {
  /** The handle identifying this durable task. */
  readonly handle: JobHandle;
  /** Current task status (polled from the provider on each call). */
  getStatus(): Promise<JobStatus>;
  /** The task result string, when status is 'succeeded'. Undefined otherwise. */
  getResult(): Promise<string | undefined>;
  /** Request cancellation of the task. Best-effort. */
  cancel(): Promise<void>;
}

// ---------------------------------------------------------------------------
// PHASE 4.6 — Collaborative workspace surface (OpenDots)
// ---------------------------------------------------------------------------

/**
 * PHASE 4.6. A handle to a collaborative workspace that persists across
 * worker interactions. Obtained from {@link WorkspaceSurface.ensureWorkspace}
 * when a worker's genome declares the `collaborative-workspace` operational
 * need. The same handle can be shared across multiple workers so they
 * collaborate on the same persistent artifact.
 *
 * Provider-neutral: the fields describe WHAT Genesis needs (a shared space
 * with a persistent page), not HOW OpenDots implements it. Provider-specific
 * IDs (OpenDots spaceId, pageId) live here at the surface boundary, not on
 * WorkerGenome.
 */
export interface WorkspaceHandle {
  /** Provider that realized this workspace ('opendots', future providers). */
  readonly provider: string;
  /** Provider-specific space identifier (e.g. OpenDots space UUID). */
  readonly spaceId: string;
  /** Provider-specific page identifier for the shared artifact. */
  readonly pageId: string;
  /** The current revision of the page (for optimistic concurrency). */
  readonly revision: number;
}

/**
 * PHASE 4.6. The collaborative workspace surface. Allows a worker to read
 * and update a shared persistent artifact (an OpenDots Page). Multiple
 * workers sharing the same {@link WorkspaceHandle} collaborate on the same
 * artifact.
 *
 * The surface is deliberately minimal: read, append, update. It does NOT
 * expose page creation (the adapter creates the space+page during
 * ensureWorkspace), page deletion, conversation threading, or any
 * OpenDots-specific feature. Genesis orchestration needs shared artifact
 * read/write; everything else is owned by OpenDots.
 */
export interface WorkspaceSurface {
  /** The handle identifying this workspace (space + page + revision). */
  readonly handle: WorkspaceHandle;

  /**
   * Read the current content of the shared page. Returns the full content
   * string and the current revision.
   */
  readPage(): Promise<{ content: string; revision: number }>;

  /**
   * Append content to the shared page. Uses optimistic concurrency: if the
   * page was modified since the handle's revision, the adapter re-reads and
   * retries once. The contributor identifies which Genesis worker wrote this
   * section (for provenance — recorded in the page content as a header).
   */
  appendContent(contributor: string, section: string): Promise<{ revision: number }>;

  /**
   * Replace the full page content. Uses optimistic concurrency on the
   * handle's revision. Fails loudly on conflict after one retry.
   */
  updatePage(content: string): Promise<{ revision: number }>;
}
