import type { RuntimeHandle, WorkerGenome } from '../../contracts/core.js';
import type {
  WorkerComputer,
  WorkerRuntime,
} from '../computer.js';
import { ComputerApiClient } from './computer-api.js';
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

export class OpenBotRuntimeAdapter implements WorkerRuntime {
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

  async stopWorker(handle: RuntimeHandle): Promise<void> {
    const botId = this.botIdOf(handle);
    const running = this.workers.get(botId);
    if (!running) return;
    // Stop semantics follow upstream: stop the browser and the process, keep
    // the worker's workspace files (durable work survives retirement).
    if (running.computer) {
      await running.computer.stop();
    }
    this.computers.delete(botId);
    this.workers.delete(botId);
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

  /** Stop every worker this adapter still holds (mission teardown path). */
  async close(): Promise<void> {
    this.closed = true;
    const botIds = [...this.workers.keys()];
    for (const botId of botIds) {
      const running = this.workers.get(botId);
      if (running?.computer) {
        await running.computer.stop();
      }
    }
    this.workers.clear();
    this.computers.clear();
  }
}
