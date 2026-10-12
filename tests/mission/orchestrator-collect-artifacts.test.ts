/**
 * PILOT-002 R3 — Orchestrator collectArtifacts defensive discovery.
 *
 * When a worker finishes without declaring artifacts (budget exhaustion,
 * reasoning failure, or never called finish), the previous code skipped
 * it entirely — leaving artifactSources empty and causing every file
 * check to fail with 404.
 *
 * This test proves the orchestrator's collectArtifacts (now async)
 * discovers actual workspace files via listFiles() when the worker's
 * declared artifacts are empty, so the verifier can still see the
 * produced files.
 */

import { describe, expect, it } from 'vitest';

import type { WorkerComputer } from '../../src/runtime/computer.js';
import { MissionOrchestrator } from '../../src/mission/orchestrator.js';
import type { HandoffParticipant } from '../../src/worker/handoff.js';
import type { WorkerResult } from '../../src/worker/worker-agent.js';

class StubComputer implements WorkerComputer {
  constructor(private readonly files: Map<string, string>) {}
  async writeFile(path: string, contents: string) {
    this.files.set(path, contents);
    return { path, bytes: contents.length, appended: false };
  }
  async writeFileTrusted(path: string, contents: string) {
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
      bytes: this.files.get(path)!.length,
    }));
  }
  async exec() {
    return {
      command: '',
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      elapsedMs: 1,
    };
  }
}

describe('PILOT-002 R3 — collectArtifacts defensive discovery (unit)', () => {
  it('discovers workspace files when worker finished with empty artifacts', async () => {
    // Worker wrote 3 files to disk but never called finish (budget exhausted).
    const files = new Map<string, string>([
      ['package.json', '{"name":"task-manager"}'],
      ['server.js', 'import http from "node:http";'],
      ['README.md', '# Task Manager'],
    ]);
    const computer = new StubComputer(files);

    const participants = new Map<string, HandoffParticipant>([
      ['software-engineer-1', {
        genome: {} as any,
        reasoning: {} as any,
        computer,
      }],
    ]);

    const results = new Map<string, WorkerResult>([
      ['software-engineer-1', {
        workerId: 'software-engineer-1',
        status: 'failure',
        summary: 'budget exhausted',
        evidence: [],
        artifacts: [], // EMPTY — worker didn't declare
        steps: 10,
        reasoningCalls: 10,
        refusals: [],
        reasoningRetries: 1,
      }],
    ]);

    // Access the private method via any-cast (test-only).
    const orch = new MissionOrchestrator({} as any);
    const sources = await (orch as any).collectArtifacts(participants, results);

    expect(sources).toHaveLength(1);
    expect(sources[0].workerId).toBe('software-engineer-1');
    expect(sources[0].paths).toContain('package.json');
    expect(sources[0].paths).toContain('server.js');
    expect(sources[0].paths).toContain('README.md');
    // node_modules, .git, .npm should be excluded by discoverWorkerArtifacts.
    expect(sources[0].paths).not.toContain('node_modules/express/index.js');
  });

  it('uses declared artifacts when present (does not override with discovery)', async () => {
    const files = new Map<string, string>([
      ['declared.js', 'content'],
      ['hidden.js', 'should-not-be-returned'],
    ]);
    const computer = new StubComputer(files);

    const participants = new Map<string, HandoffParticipant>([
      ['worker-1', {
        genome: {} as any,
        reasoning: {} as any,
        computer,
      }],
    ]);

    const results = new Map<string, WorkerResult>([
      ['worker-1', {
        workerId: 'worker-1',
        status: 'success',
        summary: 'done',
        evidence: [],
        artifacts: ['declared.js'], // DECLARED
        steps: 5,
        reasoningCalls: 5,
        refusals: [],
        reasoningRetries: 0,
      }],
    ]);

    const orch = new MissionOrchestrator({} as any);
    const sources = await (orch as any).collectArtifacts(participants, results);

    expect(sources).toHaveLength(1);
    expect(sources[0].paths).toEqual(['declared.js']);
    // hidden.js was NOT discovered (declared paths take priority).
    expect(sources[0].paths).not.toContain('hidden.js');
  });

  it('skips worker when both declared and discovered are empty', async () => {
    const computer = new StubComputer(new Map()); // empty workspace

    const participants = new Map<string, HandoffParticipant>([
      ['worker-1', {
        genome: {} as any,
        reasoning: {} as any,
        computer,
      }],
    ]);

    const results = new Map<string, WorkerResult>([
      ['worker-1', {
        workerId: 'worker-1',
        status: 'failure',
        summary: 'no work done',
        evidence: [],
        artifacts: [],
        steps: 0,
        reasoningCalls: 0,
        refusals: [],
        reasoningRetries: 0,
      }],
    ]);

    const orch = new MissionOrchestrator({} as any);
    const sources = await (orch as any).collectArtifacts(participants, results);

    expect(sources).toHaveLength(0); // fail-closed: no files, no source
  });
});
