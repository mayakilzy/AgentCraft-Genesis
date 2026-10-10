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

function isVerifierWorkerId(workerId: string): boolean {
  return workerId === 'mission-verifier-1' || workerId.startsWith(VERIFIER_WORKER_PREFIX);
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
    // G7-15D: fall back to disk reads when the adapter is closed OR when all
    // computer processes have been retired (stopWorker deletes from
    // this.computers but keeps the worker in this.workers for disk access).
    // Previously, the fallback only fired when this.closed === true, which
    // left a window after stopWorker() (computers empty, not yet closed)
    // where listArtifacts() returned [] despite the workspace existing on disk.
    if (this.closed || this.computers.size === 0) {
      return this.listArtifactsFromDisk();
    }
    const out: ArtifactSnapshot[] = [];
    for (const [botId, computer] of this.computers) {
      if (isVerifierWorkerId(botId)) continue;
      try {
        const entries = await computer.listFiles();
        for (const entry of entries) {
          if (entry.kind !== 'file') continue;
          // Path traversal protection (defense-in-depth — the worker's
          // workspace is already confined by the computer contract).
          if (entry.path.includes('..') || entry.path.startsWith('/')) continue;
          const bytes = entry.bytes ?? 0;
          let content: string | undefined;
          if (bytes <= ARTIFACT_INLINE_LIMIT) {
            try {
              const r = await computer.readFile(entry.path);
              content = r.text;
            } catch {
              // File vanished between list and read — report by size only.
              content = undefined;
            }
          }
          out.push({ workerId: botId, path: entry.path, bytes, content });
        }
      } catch {
        // Worker's computer process may have exited — skip this worker.
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
      try {
        const entries = await readdir(workspaceDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const path = entry.name;
          // Path traversal protection (defense-in-depth).
          if (path.includes('..') || path.startsWith('/')) continue;
          const fullPath = join(workspaceDir, path);
          try {
            const stats = await stat(fullPath);
            const bytes = stats.size;
            let content: string | undefined;
            if (bytes <= ARTIFACT_INLINE_LIMIT) {
              content = await readFile(fullPath, 'utf8');
            }
            out.push({ workerId: botId, path, bytes, content });
          } catch {
            // File vanished between readdir and stat — skip.
          }
        }
      } catch {
        // Workspace directory may not exist or be unreadable — skip.
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
