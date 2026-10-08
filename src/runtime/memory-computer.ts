import type {
  RuntimeHandle,
  WorkerGenome,
} from '../contracts/core.js';
import type {
  WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces,
  ArtifactSnapshot,
  ArtifactsProvider,
} from './computer.js';

/**
 * G6-08 (RC-5 / B-EXEC-FINDING-007) — Promoted from tests/helpers/memory-runtime.ts.
 *
 * This is the canonical in-memory WorkerRuntime for development mode and for
 * tests that need a deterministic computer without spawning OpenBot processes.
 *
 * Production source (`src/gateway/mission-service.ts`, `src/gateway/main.ts`)
 * imports from here, not from `tests/helpers/` — closing the test-infrastructure
 * import that the G6-07 audit flagged.
 *
 * `MemoryRuntime` also implements {@link ArtifactsProvider} so that the gateway's
 * `getArtifacts()` retrieval path works uniformly for dev and production.
 */

/** Worker IDs whose computers hold clean-room verifier copies (not deliverables). */
const VERIFIER_WORKER_PREFIX = 'mission-verifier';
/** Files at or above this size are returned without inlined content. */
const ARTIFACT_INLINE_LIMIT = 65_536;

function isVerifierWorkerId(workerId: string): boolean {
  return workerId === 'mission-verifier-1' || workerId.startsWith(VERIFIER_WORKER_PREFIX);
}

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
    // G6-08 (Phase 4 / C-VERIFY-FINDING-002): support `rm -f <path>` so the
    // VerificationLoop's clearVerifierArtifacts() actually deletes files
    // (not just no-ops). Without this, stale files from a previous verify()
    // call would persist in the in-memory workspace and cause false-positive
    // file checks. The OpenBot adapter's real computer supports `rm` natively;
    // this brings MemoryComputer to parity for dev-mode verification tests.
    const rmMatch = /^rm\s+-f\s+"([^"]+)"\s*$/.exec(command)
      ?? /^rm\s+-f\s+([^\s]+)\s*$/.exec(command);
    if (rmMatch) {
      const pathToDelete = rmMatch[1];
      this.files.delete(pathToDelete);
      return { command, exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 };
    }
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

export class MemoryRuntime implements WorkerRuntime, ArtifactsProvider {
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

  /**
   * G6-08 (RB-1) — Snapshot of all worker artifacts produced by this runtime,
   * EXCLUDING verifier clean-room workers. Returns content for files small
   * enough to inline (< 64KB).
   */
  async listArtifacts(): Promise<readonly ArtifactSnapshot[]> {
    const out: ArtifactSnapshot[] = [];
    for (const [workerId, computer] of this.computers) {
      if (isVerifierWorkerId(workerId)) continue;
      for (const [path, content] of computer.files) {
        // Path traversal protection: reject paths containing '..' or absolute paths.
        if (path.includes('..') || path.startsWith('/')) continue;
        out.push({
          workerId,
          path,
          bytes: content.length,
          content: content.length <= ARTIFACT_INLINE_LIMIT ? content : undefined,
        });
      }
    }
    return out;
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
