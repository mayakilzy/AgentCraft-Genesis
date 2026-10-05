import { describe, expect, it } from 'vitest';

import type {
  Evidence,
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
} from '../../src/contracts/core.js';
import type { WorkerComputer } from '../../src/runtime/computer.js';
import {
  VerificationLoop,
  cleanRoomPath,
  deriveChecks,
  type ArtifactSource,
} from '../../src/mission/verification.js';

/**
 * TASK-013 acceptance: a mission does not complete before relevant
 * verification, and a failing verification can send the work back exactly
 * once. Checks are deterministic and run in a clean room — copied out of the
 * producing workers' computers — so no worker-side leftovers can fake a pass.
 */

class MemoryComputer implements WorkerComputer {
  execResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
  readonly files = new Map<string, string>();

  setExec(command: string, result: { exitCode: number; stdout: string; stderr?: string }) {
    this.execResults.set(command, { stderr: '', ...result });
  }

  async exec(command: string) {
    const canned = this.execResults.get(command);
    if (canned) {
      return {
        command,
        exitCode: canned.exitCode,
        stdout: canned.stdout,
        stderr: canned.stderr,
        timedOut: false,
        elapsedMs: 1,
      };
    }
    return {
      command,
      exitCode: 0,
      stdout: '',
      stderr: '',
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

class CannedReviewer implements ReasoningProvider {
  readonly name = 'canned-reviewer';
  readonly calls: ReasoningInput[] = [];
  constructor(
    private readonly reply: string,
    private readonly fail = false,
  ) {}

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    this.calls.push(input);
    if (this.fail) throw new Error('reviewer unavailable');
    return { text: this.reply };
  }
}

function producerWith(
  files: Record<string, string>,
): { computer: MemoryComputer; source: ArtifactSource } {
  const computer = new MemoryComputer();
  for (const [path, contents] of Object.entries(files)) {
    computer.files.set(path, contents);
  }
  return {
    computer,
    source: { workerId: 'producer-1', computer, paths: Object.keys(files) },
  };
}

const EVIDENCE: readonly Evidence[] = [
  { kind: 'artifact', description: 'report', location: 'producer-1:report.md' },
  { kind: 'test-run', description: 'tests passed', location: 'producer-1:test.log' },
];

describe('VerificationLoop — acceptance checks in a clean room', () => {
  it('copies artifacts out of the producer and checks them in the verifier', async () => {
    const verifier = new MemoryComputer();
    verifier.setExec('head -1 artifacts/producer-1/report.md', {
      exitCode: 0,
      stdout: '# Findings',
    });
    const { computer: producer, source } = producerWith({
      'report.md': '# Findings\nAll 12 dependencies audited.',
    });
    const loop = new VerificationLoop(verifier);

    const result = await loop.verify(
      [
        {
          kind: 'file',
          label: 'report exists and is real',
          path: 'artifacts/producer-1/report.md',
          expectIncludes: '12 dependencies',
        },
        {
          kind: 'command',
          label: 'report has a heading',
          command: 'head -1 artifacts/producer-1/report.md',
          expectOutputIncludes: '# Findings',
        },
        { kind: 'evidence', label: 'artifact evidence attached', evidenceKind: 'artifact' },
      ],
      [source],
      EVIDENCE,
    );

    expect(result.ok).toBe(true);
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((outcome) => outcome.ok)).toBe(true);
    // The clean room holds a COPY — the verifier saw the artifact without
    // touching the producer's workspace state.
    expect(verifier.files.has('artifacts/producer-1/report.md')).toBe(true);
    expect(producer.files.has('report.md')).toBe(true);
  });

  it('fails loudly with traceable reasons when artifacts are missing', async () => {
    const verifier = new MemoryComputer();
    const { source } = producerWith({});
    const loop = new VerificationLoop(verifier);

    const result = await loop.verify(
      [
        {
          kind: 'file',
          label: 'report exists',
          path: 'artifacts/producer-1/report.md',
        },
      ],
      [{ ...source, paths: ['report.md'] }], // claimed but never produced
      [],
    );

    expect(result.ok).toBe(false);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].detail).toContain('not found in the clean room');
    // The failed COPY is its own traceable outcome — loud on both counts.
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[1].detail).toContain('could not be copied');
    expect(result.summary).toContain('2 of 2');
  });

  it('asserts command exit codes and output content, not just "it ran"', async () => {
    const verifier = new MemoryComputer();
    verifier.setExec('node checks/verify.js', {
      exitCode: 1,
      stdout: '2 checks failed',
      stderr: 'assertion error',
    });
    verifier.setExec('node checks/pass.js', { exitCode: 0, stdout: 'all good' });
    const loop = new VerificationLoop(verifier);

    const result = await loop.verify(
      [
        {
          kind: 'command',
          label: 'verification script',
          command: 'node checks/verify.js',
        },
        {
          kind: 'command',
          label: 'output content',
          command: 'node checks/pass.js',
          expectOutputIncludes: 'all good',
          expectOutputExcludes: 'failed',
        },
      ],
      [],
      [],
    );

    expect(result.ok).toBe(false);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].detail).toContain('exited 1');
    expect(result.outcomes[1].ok).toBe(true);
  });

  it('consults a reviewer ONLY on failure and returns a traceable diagnosis', async () => {
    const reviewer = new CannedReviewer(
      JSON.stringify({
        rootCause: 'The writer cited the wrong registry version',
        retryable: true,
        guidance: 'Re-run with registry versions read from the live npm view output',
      }),
    );
    const failingLoop = new VerificationLoop(new MemoryComputer(), { reviewer });
    const result = await failingLoop.verify(
      [{ kind: 'file', label: 'missing', path: 'artifacts/producer-1/x.md' }],
      [{ workerId: 'producer-1', computer: new MemoryComputer(), paths: ['x.md'] }],
      [],
    );

    expect(result.ok).toBe(false);
    expect(result.diagnosis).toMatchObject({
      rootCause: 'The writer cited the wrong registry version',
      retryable: true,
    });
    expect(reviewer.calls).toHaveLength(1);

    // A passing run never wakes the reviewer.
    const passingLoop = new VerificationLoop(new MemoryComputer(), { reviewer });
    await passingLoop.verify([], [], []);
    expect(reviewer.calls).toHaveLength(1);
  });

  it('a failing reviewer never masks the real verification failures', async () => {
    const reviewer = new CannedReviewer('', true);
    const loop = new VerificationLoop(new MemoryComputer(), { reviewer });
    const result = await loop.verify(
      [{ kind: 'evidence', label: 'missing evidence', evidenceKind: 'metric' }],
      [],
      [],
    );
    expect(result.ok).toBe(false);
    expect(result.diagnosis).toBeUndefined();
    expect(result.summary).toContain('no evidence of kind "metric"');
  });

  it('derives the structural floor: every produced artifact must exist', async () => {
    const { source } = producerWith({ 'a.txt': 'A', 'b.txt': 'B' });
    const checks = deriveChecks([source]);
    expect(checks).toHaveLength(2);
    expect(checks.map((check) => check.kind)).toEqual(['file', 'file']);

    const verifier = new MemoryComputer();
    const loop = new VerificationLoop(verifier);
    const result = await loop.verify(checks, [source], []);
    expect(result.ok).toBe(true);
    expect(cleanRoomPath(source, 'a.txt')).toBe('artifacts/producer-1/a.txt');
  });
});
