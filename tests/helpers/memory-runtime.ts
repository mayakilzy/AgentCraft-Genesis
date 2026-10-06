import type {
  RuntimeHandle,
  WorkerGenome,
} from '../../src/contracts/core.js';
import type {
  WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces,
} from '../../src/runtime/computer.js';

/**
 * Shared in-memory WorkerRuntime for mission-level tests (the live OpenBot
 * runtime is exercised by the gated runtime tests and Experiment 001).
 */

export class MemoryComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
  execResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();

  setExec(
    command: string,
    result: { exitCode: number; stdout: string; stderr?: string },
  ): void {
    this.execResults.set(command, { stderr: '', ...result });
  }

  async exec(command: string) {
    const canned = this.execResults.get(command);
    return {
      command,
      exitCode: canned?.exitCode ?? 0,
      stdout: canned?.stdout ?? '',
      stderr: canned?.stderr ?? '',
      timedOut: false,
      elapsedMs: 1,
    };
  }

  async writeFile(path: string, contents: string) {
    this.files.set(path, contents);
    return { path, bytes: contents.length, appended: false };
  }

  async readFile(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`no file at ${path}`);
    return { path, text, bytes: text.length, truncated: false };
  }

  async listFiles() {
    return [...this.files.keys()].map((path) => ({
      path,
      kind: 'file' as const,
    }));
  }
}

export class MemoryRuntime implements WorkerRuntime {
  readonly name = 'memory-runtime';
  readonly stopped: string[] = [];
  readonly computers = new Map<string, MemoryComputer>();

  computersForTest(): ReadonlyMap<string, MemoryComputer> {
    return this.computers;
  }

  async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
    if (!genome.computer.required) {
      return { workerId: genome.identity.id, ref: 'memory:none' };
    }
    const computer = new MemoryComputer();
    this.computers.set(genome.identity.id, computer);
    return { workerId: genome.identity.id, ref: `memory:${genome.identity.id}` };
  }

  computer(handle: RuntimeHandle): WorkerComputer {
    const computer = this.computers.get(handle.workerId);
    if (!computer) throw new Error(`no computer for ${handle.workerId}`);
    return computer;
  }

  surfaces(handle: RuntimeHandle): WorkerSurfaces {
    const computer = this.computers.get(handle.workerId);
    return computer === undefined ? {} : { computer };
  }

  async stopWorker(handle: RuntimeHandle): Promise<void> {
    this.stopped.push(handle.workerId);
  }
}

export function memoryRuntimeForTest(): {
  runtime: MemoryRuntime;
  computersForTest(): ReadonlyMap<string, MemoryComputer>;
} {
  const runtime = new MemoryRuntime();
  return {
    runtime,
    computersForTest: () => runtime.computersForTest(),
  };
}
