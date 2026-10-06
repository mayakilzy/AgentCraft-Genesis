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
  // Phase 4.6 will add: readonly workspace?: WorkspaceSurface;
  // Phase 4.7 will add: readonly job?: JobSurface;
}
