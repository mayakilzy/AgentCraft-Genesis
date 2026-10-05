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
 * the frozen lifecycle boundary PLUS a way to obtain a worker's computer.
 * The OpenBot adapter satisfies this; tests satisfy it with stubs.
 */
export interface WorkerRuntime extends RuntimeAdapter {
  /** The execution surface for one ensured worker. */
  computer(handle: RuntimeHandle): WorkerComputer;
}
