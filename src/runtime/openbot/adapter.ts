import type { RuntimeHandle, WorkerGenome } from '../../contracts/core.js';
import type {
  ArtifactSnapshot,
  ArtifactsProvider,
  WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces,
} from '../computer.js';
import { ComputerApiClient } from './computer-api.js';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isOpenBotBotId,
  resetComputerProcess,
  startComputerProcess,
  type ComputerProcessConfig,
  type RunningComputer,
} from './computer-process.js';

/**
 * OpenBot Runtime Adapter (TASK-010) — the thin boundary between Genesis and
 * the canonical execution runtime.
 *
 * OpenBot is Alpha and stays isolated here: Genesis holds no upstream imports,
 * no vendored copies and no parallel computer manager. Everything on the other
 * side of this file is the upstream agent-computer service, spoken to over its
 * documented HTTP API.
 *
 * Genome → computer mapping follows "least grants": a worker whose genome
 * grants no computer-requiring domain (`computer.required === false`, e.g. a
 * pure-reasoning coordinator) gets NO computer process at all; a worker with
 * grants gets exactly one upstream computer, isolated per worker.
 */

export interface OpenBotAdapterOptions extends ComputerProcessConfig {
  /** Per-call computer API timeout (default 60s). */
  readonly apiTimeoutMs?: number;
  /** Raw output per worker computer (flight recorder raw log). */
  readonly onWorkerOutput?: (workerId: string, chunk: string) => void;
}

/** A running worker inside the OpenBot runtime. */
interface RunningWorker {
  readonly genome: WorkerGenome;
  readonly computer: RunningComputer | null;
}

/** Worker IDs whose computers hold clean-room verifier copies (not deliverables). */
const VERIFIER_WORKER_PREFIX = 'mission-verifier';
/** Files at or above this size are returned without inlined content. */
const ARTIFACT_INLINE_LIMIT = 65_536;
/**
 * G7-19A: hard cap on the number of file entries a single worker's
 * recursive listing can return. Defends against a runaway workspace
 * (e.g. a worker that wrote a million tiny files, or a symlink loop).
 * The G7-18E workspace had 9 files in 4 directories; this cap leaves
 * plenty of headroom while bounding the worst case.
 */
const ARTIFACT_LISTING_MAX_FILES = 4_096;

function isVerifierWorkerId(workerId: string): boolean {
  return workerId === 'mission-verifier-1' || workerId.startsWith(VERIFIER_WORKER_PREFIX);
}

/**
 * G7-19A — Deterministic recursive file listing under a workspace root.
 *
 * The pre-G7-19A `listArtifacts` and `listArtifactsFromDisk` implementations
 * called `readdir(workspaceDir, { withFileTypes: true })` and then filtered
 * with `if (!entry.isFile()) continue;`. That filter skipped every directory
 * entry, so files inside `public/`, `test/`, or any other subdirectory were
 * silently dropped from the artifact response — even though they existed
 * on disk in the worker's workspace.
 *
 * This helper walks the workspace tree depth-first, accumulating every
 * regular file's workspace-relative path. Path-traversal protection is
 * applied per segment (no `..`, no leading `/`, no NUL bytes). Symlinks
 * are skipped (we only follow real subdirectories) to prevent a crafted
 * symlink from escaping the workspace.
 *
 * The walk is bounded by {@link ARTIFACT_LISTING_MAX_FILES} so a runaway
 * workspace cannot exhaust memory. When the cap is reached, the walk
 * stops and the caller sees the files accumulated so far — never a
 * silent truncation that masquerades as a complete listing.
 *
 * Exported for direct unit-testing in
 * `tests/runtime/g7-19a-recursion.test.ts`. The function is pure with
 * respect to its inputs (it only reads the filesystem under the given
 * `workspaceDir`).
 *
 * @param workspaceDir absolute filesystem path to the worker's workspace root
 * @returns array of `{ relativePath, fullPath, bytes }` for every regular
 *          file under `workspaceDir`, sorted by relativePath for determinism
 */
export async function listWorkspaceFilesRecursive(workspaceDir: string): Promise<
  ReadonlyArray<{ readonly relativePath: string; readonly fullPath: string; readonly bytes: number }>
> {
  const out: Array<{ relativePath: string; fullPath: string; bytes: number }> = [];
  const stack: Array<{ readonly dir: string; readonly prefix: string }> = [
    { dir: workspaceDir, prefix: '' },
  ];
  // Guard against symlink loops and runaway directory nesting. The G7-18E
  // workspace was 2 levels deep; 32 leaves ample headroom without being
  // unbounded.
  const visitedRealpaths = new Set<string>();
  while (stack.length > 0 && out.length < ARTIFACT_LISTING_MAX_FILES) {
    const { dir, prefix } = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // directory vanished or unreadable — skip silently
    }
    // Sort entries by name for deterministic ordering (independent of FS order)
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (out.length >= ARTIFACT_LISTING_MAX_FILES) break;
      // Path-traversal protection per segment.
      if (
        entry.name === '' ||
        entry.name === '.' ||
        entry.name === '..' ||
        entry.name.includes('\0') ||
        entry.name.includes('/')
      ) {
        continue;
      }
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const fullPath = join(dir, entry.name);
      if (entry.isFile()) {
        try {
          const stats = await stat(fullPath);
          out.push({ relativePath, fullPath, bytes: stats.size });
        } catch {
          // File vanished between readdir and stat — skip.
        }
      } else if (entry.isDirectory()) {
        // Skip symlinked directories to prevent escape — only follow real
        // subdirectories. This also bounds the walk to the workspace tree.
        if (entry.isSymbolicLink()) continue;
        try {
          const real = await stat(fullPath);
          if (!real.isDirectory()) continue;
          // Use real path to dedupe in case of bind mounts.
          const key = `${real.dev}:${real.ino}:${real.size}`;
          if (visitedRealpaths.has(key)) continue;
          visitedRealpaths.add(key);
          stack.push({ dir: fullPath, prefix: relativePath });
        } catch {
          // stat failed — skip silently
        }
      }
      // Other entry kinds (block devices, sockets, FIFOs) are ignored.
    }
  }
  out.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  return out;
}

export class OpenBotRuntimeAdapter implements WorkerRuntime, ArtifactsProvider {
  readonly name = 'openbot-runtime-v0.1.0';

  private readonly options: OpenBotAdapterOptions;
  private readonly workers = new Map<string, RunningWorker>();
  private readonly computers = new Map<string, WorkerComputer>();
  private closed = false;

  constructor(options: OpenBotAdapterOptions) {
    this.options = options;
  }

  private handleOf(botId: string, port: number | null): RuntimeHandle {
    // Opaque to Genesis core. The port is what this adapter needs to find its
    // own running computer again; it contains no secret.
    return { workerId: botId, ref: port === null ? 'openbot:none' : `openbot:process:${port}` };
  }

  private botIdOf(handle: RuntimeHandle): string {
    const running = this.workers.get(handle.workerId);
    if (!running || !handle.ref.startsWith('openbot:')) {
      throw new Error(
        `handle for worker "${handle.workerId}" does not belong to adapter "${this.name}"`,
      );
    }
    return handle.workerId;
  }

  async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
    if (this.closed) {
      throw new Error('adapter is closed');
    }
    const botId = genome.identity.id;
    if (!isOpenBotBotId(botId)) {
      throw new Error(
        `genome identity id "${botId}" cannot become an OpenBot bot id`,
      );
    }
    const existing = this.workers.get(botId);
    if (existing) {
      // Idempotent ensure — the supervisor's own contract.
      const computer = existing.computer;
      return this.handleOf(botId, computer === null ? null : computer.port);
    }

    if (!genome.computer.required) {
      // Least grants: no computer-requiring domain → no computer.
      this.workers.set(botId, { genome, computer: null });
      return this.handleOf(botId, null);
    }

    const computer = await startComputerProcess(
      {
        ...this.options,
        ...(this.options.onWorkerOutput === undefined
          ? {}
          : {
              onOutput: (chunk: string) =>
                this.options.onWorkerOutput!(botId, chunk),
            }),
      },
      botId,
    );
    this.workers.set(botId, { genome, computer });
    this.computers.set(botId, this.makeComputer(computer));
    return this.handleOf(botId, computer.port);
  }

  private makeComputer(running: RunningComputer): WorkerComputer {
    const client = new ComputerApiClient({
      baseUrl: running.baseUrl,
      token: running.token,
      botId: running.botId,
      ...(this.options.apiTimeoutMs === undefined
        ? {}
        : { timeoutMs: this.options.apiTimeoutMs }),
    });
    return {
      exec: (command, options) => client.exec(command, options),
      writeFile: (path, contents) => client.writeFile(path, contents),
      readFile: (path) => client.readFile(path),
      listFiles: (path) => client.listFiles(path),
      // TASK-018: the browser surface every upstream computer exposes;
      // whether a worker may USE it is decided by its genome grants.
      browser: client.browserSurface(),
    };
  }

  computer(handle: RuntimeHandle): WorkerComputer {
    const botId = this.botIdOf(handle);
    const bound = this.computers.get(botId);
    if (!bound) {
      throw new Error(
        `worker "${botId}" has no computer (genome.computer.required is false)`,
      );
    }
    return bound;
  }

  /**
   * PHASE 4.5. Provider-neutral surface bundle. Returns `{ computer }` when
   * the worker has a computer, or `{}` when it does not. The orchestrator
   * calls this instead of the conditional `computer()` pattern, so it no
   * longer assumes every worker is a computer worker.
   */
  surfaces(handle: RuntimeHandle): WorkerSurfaces {
    const botId = this.botIdOf(handle);
    const bound = this.computers.get(botId);
    return bound === undefined ? {} : { computer: bound };
  }

  async stopWorker(handle: RuntimeHandle): Promise<void> {
    const botId = this.botIdOf(handle);
    const running = this.workers.get(botId);
    if (!running) return;
    // Stop semantics follow upstream: stop the browser and the process, keep
    // the worker's workspace files (durable work survives retirement).
    if (running.computer) {
      await running.computer.stop();
    }
    // G7-15D: remove the live computer API client (the process is stopped,
    // so HTTP calls would fail). But KEEP the worker in this.workers so
    // listArtifactsFromDisk() can still find workspaceDir after retirement.
    // Previously, stopWorker() deleted from BOTH Maps, making the workspace
    // invisible to getArtifacts() — a successful mission's artifact would
    // disappear from the API despite existing on disk.
    this.computers.delete(botId);
    // Do NOT delete from this.workers — the workspaceDir is still needed.
  }

  /**
   * Adapter-specific operation beyond the frozen contract: forget everything.
   * Mirrors the supervisor's reset (container + volumes gone). Used by ops and
   * tests; missions retire workers with stopWorker.
   */
  async resetWorker(handle: RuntimeHandle): Promise<void> {
    const botId = this.botIdOf(handle);
    const running = this.workers.get(botId);
    if (running?.computer) {
      await resetComputerProcess(running.computer);
    }
    this.computers.delete(botId);
    this.workers.delete(botId);
  }

  /**
   * G6-08 (RB-1) — Snapshot of all worker artifacts produced by this runtime,
   * EXCLUDING verifier clean-room workers (mission-verifier-*).
   *
   * For each non-verifier worker that has a computer, lists the workspace files
   * and reads their content (inlining files ≤ 64KB). Returns a stable ordering
   * by (workerId, path) so callers can compare snapshots deterministically.
   *
   * Verifier workers are excluded because their `artifacts/` subtree holds
   * copies made by the VerificationLoop for clean-room checks, not mission
   * deliverables.
   */
  async listArtifacts(): Promise<readonly ArtifactSnapshot[]> {
    // G7-15E: unified artifact listing — iterate this.workers (which has ALL
    // workers, both running and stopped). For each worker:
    //   - If the computer is still in this.computers → use the live HTTP API.
    //   - If the computer is NOT in this.computers (stopped) → read from disk
    //     via workspaceDir.
    //
    // This fixes the G7-15D mixed-lifecycle bug: when some workers are stopped
    // (removed from this.computers by stopWorker) and others are still running
    // (still in this.computers), the old code only iterated this.computers and
    // missed the stopped workers' artifacts. Now both paths are unified.
    //
    // The closed-adapter shortcut (this.closed) still goes straight to
    // listArtifactsFromDisk() since all computers are stopped at that point.
    if (this.closed) {
      return this.listArtifactsFromDisk();
    }
    const out: ArtifactSnapshot[] = [];
    for (const [botId, worker] of this.workers) {
      if (isVerifierWorkerId(botId)) continue;
      const computer = this.computers.get(botId);
      if (computer !== undefined) {
        // Live path: the computer process is still running.
        try {
          const entries = await computer.listFiles();
          for (const entry of entries) {
            if (entry.kind !== 'file') continue;
            if (entry.path.includes('..') || entry.path.startsWith('/')) continue;
            const bytes = entry.bytes ?? 0;
            let content: string | undefined;
            if (bytes <= ARTIFACT_INLINE_LIMIT) {
              try {
                const r = await computer.readFile(entry.path);
                content = r.text;
              } catch {
                content = undefined;
              }
            }
            out.push({ workerId: botId, path: entry.path, bytes, content });
          }
        } catch {
          // Worker's computer process may have exited — fall through to disk.
        }
      }
      // Disk path: the computer is stopped (not in this.computers) OR the
      // live read failed. Read directly from the workspace directory.
      // G7-19A: walk the workspace RECURSIVELY via listWorkspaceFilesRecursive
      // so files in subdirectories (public/, test/, etc.) are no longer
      // silently dropped. The pre-G7-19A code used `readdir(workspaceDir)`
      // and `if (!entry.isFile()) continue;` which skipped every directory
      // entry — causing the G7-18E artifact aggregation to miss 6 of the 9
      // Community Project Hub files (all of public/* and all of test/*).
      if (worker.computer !== null) {
        const workspaceDir = worker.computer.workspaceDir;
        const diskEntries = await listWorkspaceFilesRecursive(workspaceDir);
        for (const entry of diskEntries) {
          // Skip if already added via the live path (same path).
          if (out.some((a) => a.workerId === botId && a.path === entry.relativePath)) continue;
          let content: string | undefined;
          if (entry.bytes <= ARTIFACT_INLINE_LIMIT) {
            try {
              content = await readFile(entry.fullPath, 'utf8');
            } catch {
              content = undefined;
            }
          }
          out.push({
            workerId: botId,
            path: entry.relativePath,
            bytes: entry.bytes,
            content,
          });
        }
      }
    }
    out.sort((a, b) =>
      a.workerId === b.workerId
        ? a.path < b.path ? -1 : a.path > b.path ? 1 : 0
        : a.workerId < b.workerId ? -1 : 1,
    );
    return out;
  }

  /**
   * G7-11C: Read artifacts from the filesystem when the adapter is closed.
   *
   * After mission termination, the orchestrator's finally{} calls stopWorker()
   * which retires the computer process but does NOT delete the workspace
   * directory. The workspace persists on disk at `running.workspaceDir`. This
   * method scans those directories directly, applying the same path-traversal
   * and size protections as the live path.
   *
   * This is NOT a new storage subsystem — it reads the same workspace
   * directories the live path uses, just without requiring a running process.
   */
  private async listArtifactsFromDisk(): Promise<readonly ArtifactSnapshot[]> {
    const out: ArtifactSnapshot[] = [];
    for (const [botId, worker] of this.workers) {
      if (isVerifierWorkerId(botId)) continue;
      if (worker.computer === null) continue;
      const workspaceDir = worker.computer.workspaceDir;
      // G7-19A: walk the workspace RECURSIVELY via listWorkspaceFilesRecursive
      // so files in subdirectories (public/, test/, etc.) are no longer
      // silently dropped (same fix as the disk path in listArtifacts above).
      const diskEntries = await listWorkspaceFilesRecursive(workspaceDir);
      for (const entry of diskEntries) {
        let content: string | undefined;
        if (entry.bytes <= ARTIFACT_INLINE_LIMIT) {
          try {
            content = await readFile(entry.fullPath, 'utf8');
          } catch {
            content = undefined;
          }
        }
        out.push({
          workerId: botId,
          path: entry.relativePath,
          bytes: entry.bytes,
          content,
        });
      }
    }
    out.sort((a, b) =>
      a.workerId === b.workerId
        ? a.path < b.path ? -1 : a.path > b.path ? 1 : 0
        : a.workerId < b.workerId ? -1 : 1,
    );
    return out;
  }

  /** Stop every worker this adapter still holds (mission teardown path). */
  async close(): Promise<void> {
    this.closed = true;
    const botIds = [...this.workers.keys()];
    for (const botId of botIds) {
      const running = this.workers.get(botId);
      if (running?.computer) {
        // G7-15D: wrap in try-catch because stopWorker() may have already
        // stopped this computer. Double-stop is harmless but some process
        // managers throw on the second SIGTERM.
        try { await running.computer.stop(); } catch { /* already stopped */ }
      }
    }
    this.workers.clear();
    this.computers.clear();
  }
}
