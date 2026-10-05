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

/**
 * The hands of one worker: a single worker's computer, already bound to that
 * worker's identity. Implementations confine every path to the worker's own
 * workspace and run every command with the workspace as cwd — exactly the
 * upstream semantics.
 */
export interface WorkerComputer {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, contents: string): Promise<WriteResult>;
  readFile(path: string): Promise<ReadResult>;
  listFiles(path?: string): Promise<readonly WorkspaceEntry[]>;
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
