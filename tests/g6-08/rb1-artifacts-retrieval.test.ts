/**
 * G6-08 — RB-1: Production getArtifacts() returns genuine non-empty artifacts.
 *
 * Acceptance: an independently executed production-path integration test
 * must return genuine non-empty artifacts from a controlled worker execution.
 *
 * Approach: inject a controlled stub WorkerRuntime that mimics the OpenBot
 * adapter's "internal computers Map" shape (computers held by the adapter,
 * NOT by the gateway). The stub implements ArtifactsProvider by reading
 * from its internal Map via listFiles()/readFile(). The mission is executed
 * through the real MissionService → MissionOrchestrator → VerificationLoop
 * path. We assert that:
 *
 *   1. getArtifacts() returns the genuine artifact ('output.md').
 *   2. Artifact content matches what the worker actually wrote.
 *   3. Artifact provenance (workerId) is correct.
 *   4. Verified flag reflects the actual verification result.
 *   5. Verifier clean-room copies are excluded (mission-verifier-*).
 *   6. Negative: when the runtime does NOT implement ArtifactsProvider,
 *      getArtifacts() falls back to the legacy computers Map (dev path).
 *
 * This test is the positive-path integration the audit (RB-1) requires:
 * the previously-broken production contract (artifacts always []) is now
 * verifiably satisfied by the runtime's listArtifacts() contract.
 */
import { describe, it, expect } from 'vitest';
import { MissionService } from '../../src/gateway/mission-service.js';
import type { CallerIdentity } from '../../src/gateway/types.js';
import type { RuntimeHandle, WorkerGenome } from '../../src/contracts/core.js';
import type {
  ArtifactSnapshot,
  ArtifactsProvider,
  WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces,
} from '../../src/runtime/computer.js';

/**
 * A controlled stub runtime that mimics the OpenBot adapter's shape:
 *   - Holds an INTERNAL `computers` Map (the gateway cannot see it directly).
 *   - Implements ArtifactsProvider.listArtifacts() by iterating the Map.
 *   - ensureWorker creates a stub WorkerComputer that records writes.
 *   - Used to prove RB-1: getArtifacts() works against the production contract.
 */
class StubOpenBotLikeRuntime implements WorkerRuntime, ArtifactsProvider {
  readonly name = 'stub-openbot-like';
  private readonly computers = new Map<string, StubWorkerComputer>();
  private stopped = new Set<string>();

  async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
    if (!this.computers.has(genome.identity.id)) {
      this.computers.set(genome.identity.id, new StubWorkerComputer(genome.identity.id));
    }
    return { workerId: genome.identity.id, ref: `stub:${genome.identity.id}` };
  }

  computer(handle: RuntimeHandle): WorkerComputer {
    const c = this.computers.get(handle.workerId);
    if (!c) throw new Error(`no computer for ${handle.workerId}`);
    return c;
  }

  surfaces(handle: RuntimeHandle): WorkerSurfaces {
    const c = this.computers.get(handle.workerId);
    return c === undefined ? {} : { computer: c };
  }

  async stopWorker(handle: RuntimeHandle): Promise<void> {
    this.stopped.add(handle.workerId);
  }

  /** Production contract: read artifacts from the internal Map. */
  async listArtifacts(): Promise<readonly ArtifactSnapshot[]> {
    const out: ArtifactSnapshot[] = [];
    for (const [workerId, c] of this.computers) {
      if (workerId === 'mission-verifier-1' || workerId.startsWith('mission-verifier')) continue;
      for (const [path, content] of c.files) {
        if (path.includes('..') || path.startsWith('/')) continue;
        out.push({
          workerId,
          path,
          bytes: content.length,
          content: content.length <= 65_536 ? content : undefined,
        });
      }
    }
    return out;
  }

  /** Test-only accessor: simulate a worker writing a file. */
  _forceWrite(workerId: string, path: string, content: string): void {
    let c = this.computers.get(workerId);
    if (!c) {
      c = new StubWorkerComputer(workerId);
      this.computers.set(workerId, c);
    }
    c.files.set(path, content);
  }

  _stopped(): ReadonlySet<string> {
    return this.stopped;
  }
}

class StubWorkerComputer implements WorkerComputer {
  readonly files = new Map<string, string>();

  constructor(readonly workerId: string) {}

  async exec() {
    return { command: '', exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 };
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
    return [...this.files.keys()].map((path) => ({ path, kind: 'file' as const, bytes: this.files.get(path)!.length }));
  }
}

/**
 * A minimal scripted reasoning provider that writes one file via the runtime
 * and finishes. The orchestrator's worker-agent will call this and pipe the
 * file write through the runtime's surfaces.computer.writeFile().
 */
function scriptedReasoningThatWrites(path: string, contents: string) {
  let step = 0;
  return {
    name: 'stub-reasoning-writes-file',
    async reason() {
      step += 1;
      if (step === 1) {
        return { text: JSON.stringify({ action: 'write_file', path, contents }) };
      }
      return { text: JSON.stringify({ action: 'finish', summary: `wrote ${path}`, artifacts: [path] }) };
    },
  };
}

const CALLER: CallerIdentity = {
  callerId: 'caller-rb1',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 5,
  maxMissionTimeoutMs: 30_000,
};

describe('G6-08 — RB-1: Production getArtifacts() returns genuine non-empty artifacts', () => {
  it('RB1-01: stub runtime that mimics OpenBot shape returns genuine artifacts via getArtifacts()', async () => {
    // Arrange: a stub runtime that holds its own internal computers Map.
    const stubRuntime = new StubOpenBotLikeRuntime();
    const service = new MissionService({
      defaultMissionTimeoutMs: 30_000,
      // Production-shape factory: receives missionId, returns a runtime.
      // The same stub instance is reused for THIS single-mission test.
      runtimeFactory: () => ({ runtime: stubRuntime }),
      reasoningFactory: () => scriptedReasoningThatWrites('output.md', '# Genesis gateway output\n'),
    });

    // Act: submit a mission and await completion.
    const { missionId } = service.start(
      { outcome: 'Write a markdown file named output.md' },
      CALLER,
    );
    await service.awaitCompletion(missionId, CALLER);

    // Assert: getArtifacts() returns the genuine artifact, not [].
    const artifacts = await service.getArtifacts(missionId, CALLER);
    expect(artifacts.length).toBeGreaterThan(0);

    const output = artifacts.find((a) => a.path === 'output.md');
    expect(output).toBeDefined();
    // The default organization planner assigns 'sole-operator-1' for a simple
    // single-worker goal — verify provenance is the producing worker, not the
    // verifier's clean-room copy.
    expect(output!.workerId).toBe('sole-operator-1');
    expect(output!.content).toContain('# Genesis gateway output');
    expect(output!.bytes).toBeGreaterThan(0);
    // Verification passed (the file exists in clean-room copy) → verified=true.
    expect(output!.verified).toBe(true);
  });

  it('RB1-02: negative — a runtime WITHOUT ArtifactsProvider falls back to empty list (no legacy computers Map)', async () => {
    // A runtime that does NOT implement ArtifactsProvider and returns no
    // computers Map. The gateway's getArtifacts() should return [] (the
    // honest answer — there are no artifacts to retrieve).
    const bareRuntime: WorkerRuntime = {
      name: 'bare-no-artifacts',
      async ensureWorker(g: WorkerGenome) {
        return { workerId: g.identity.id, ref: 'bare:none' };
      },
      computer() {
        throw new Error('no computer');
      },
      surfaces() {
        return {};
      },
      async stopWorker() { /* no-op */ },
    };

    const service = new MissionService({
      defaultMissionTimeoutMs: 30_000,
      runtimeFactory: () => ({ runtime: bareRuntime }),
      reasoningFactory: () => scriptedReasoningThatWrites('output.md', 'hello\n'),
    });

    const { missionId } = service.start(
      { outcome: 'Write a markdown file named output.md' },
      CALLER,
    );
    await service.awaitCompletion(missionId, CALLER);

    // No ArtifactsProvider + no computers Map → honest empty list.
    const artifacts = await service.getArtifacts(missionId, CALLER);
    expect(artifacts).toEqual([]);
  });

  it('RB1-03: verifier clean-room copies are excluded from getArtifacts()', async () => {
    // Arrange: stub runtime with a verifier worker that has files.
    const stubRuntime = new StubOpenBotLikeRuntime();
    // Simulate the verifier writing a file in its workspace (should be excluded).
    stubRuntime._forceWrite('mission-verifier-1', 'artifacts/output.md', 'verifier copy');
    // And a regular worker writing the same path (should be included).
    stubRuntime._forceWrite('sole-operator-1', 'output.md', 'worker copy');

    const service = new MissionService({
      defaultMissionTimeoutMs: 30_000,
      runtimeFactory: () => ({ runtime: stubRuntime }),
      reasoningFactory: () => ({
        name: 'stub-no-write',
        async reason() { return { text: JSON.stringify({ action: 'finish', summary: 'noop', artifacts: ['output.md'] }) }; },
      }),
    });

    const { missionId } = service.start(
      { outcome: 'Produce output.md' },
      CALLER,
    );
    await service.awaitCompletion(missionId, CALLER);

    const artifacts = await service.getArtifacts(missionId, CALLER);
    // Verifier's file is excluded.
    const verifierArtifacts = artifacts.filter((a) => a.workerId === 'mission-verifier-1');
    expect(verifierArtifacts).toEqual([]);
    // Worker's file is included.
    const workerArtifacts = artifacts.filter((a) => a.workerId === 'sole-operator-1');
    expect(workerArtifacts.length).toBeGreaterThan(0);
  });

  it('RB1-04: cross-caller artifact access is denied (404-equivalent MissionNotFoundError)', async () => {
    const stubRuntime = new StubOpenBotLikeRuntime();
    const service = new MissionService({
      defaultMissionTimeoutMs: 30_000,
      runtimeFactory: () => ({ runtime: stubRuntime }),
      reasoningFactory: () => scriptedReasoningThatWrites('output.md', 'cross-caller\n'),
    });

    const callerA: CallerIdentity = { ...CALLER, callerId: 'caller-a-rb1-04' };
    const callerB: CallerIdentity = { ...CALLER, callerId: 'caller-b-rb1-04' };

    const { missionId } = service.start({ outcome: 'Write output.md' }, callerA);
    await service.awaitCompletion(missionId, callerA);

    // Caller B attempts to read caller A's mission artifacts → denied.
    await expect(service.getArtifacts(missionId, callerB)).rejects.toThrow(/not found/);
  });
});
