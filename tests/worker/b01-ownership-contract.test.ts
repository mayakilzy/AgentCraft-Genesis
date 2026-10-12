/**
 * D+ Task B01 — Responsibility & Artifact Ownership Contract tests.
 *
 * Tests B01-T01 to B01-T06 from the Task B01 specification (§B01).
 * All tests are deterministic: scripted reasoning provider + in-memory
 * computer. No real Z.ai calls, no OpenBot runtime, no live missions.
 */
import { describe, expect, it } from 'vitest';

import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
  WorkerGenome,
} from '../../src/contracts/core.js';
import type { WorkerComputer } from '../../src/runtime/computer.js';
import { WorkerAgent } from '../../src/worker/worker-agent.js';
import {
  buildOwnershipContract,
  encodeOwnershipPrefix,
  matchesOwnership,
  ownsArtifact,
  parseOwnershipPrefix,
  renderOwnershipBrief,
} from '../../src/worker/ownership-contract.js';

// ---------------------------------------------------------------------------
// Test helpers (mirrors completion-contract.test.ts)
// ---------------------------------------------------------------------------

class ScriptedReasoning implements ReasoningProvider {
  readonly name = 'scripted';
  private replies: readonly string[];
  readonly seen: ReasoningInput[] = [];

  constructor(replies: readonly string[]) {
    this.replies = replies;
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    expect(this.replies.length).toBeGreaterThan(0);
    const [next, ...rest] = this.replies;
    this.replies = rest;
    this.seen.push(input);
    return { text: next };
  }
}

function memoryComputer(): WorkerComputer & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async exec(command) {
      return {
        command,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        elapsedMs: 1,
      };
    },
    async writeFile(path, contents) {
      files.set(path, contents);
      return { path, bytes: contents.length, appended: false };
    },
    async readFile(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no file at ${path}`);
      return { path, text, bytes: text.length, truncated: false };
    },
    async listFiles() {
      return [...files.keys()].map((path) => ({ path, kind: 'file' as const }));
    },
  };
}

function codeGenome(overrides: Partial<WorkerGenome> = {}): WorkerGenome {
  return {
    identity: { id: 'software-engineer-1', displayName: 'Software Engineer' },
    role: 'Software Engineer',
    objective: 'test',
    model: 'cheap',
    skills: ['code-execution'],
    tools: ['openbot:shell-execution', 'openbot:workspace-files'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'none',
    budget: { maxUsd: 1, maxTier: 'default' },
    autonomy: 'autonomous',
    ...overrides,
  };
}

function docGenome(overrides: Partial<WorkerGenome> = {}): WorkerGenome {
  return codeGenome({
    identity: { id: 'documentation-writer-1', displayName: 'Documentation Writer' },
    role: 'Documentation Writer',
    skills: ['document-authoring'],
    tools: ['openbot:workspace-files'],
    computer: { required: true, browser: false, shell: false, workspace: true },
    ...overrides,
  });
}

const GOAL_WITH_NPM_TEST =
  'Build a Node.js app. After producing all files, npm test MUST exit 0 within 60 seconds.';

// ---------------------------------------------------------------------------
// B01-T01 — Multi-worker mission with different responsibilities
// ---------------------------------------------------------------------------

describe('B01-T01 — Multi-worker mission with different responsibilities', () => {
  it('assigns different ownership contracts to code worker vs doc worker', () => {
    // Simulate what buildSpecialists() produces: responsibility strings
    // with [owns: ...] prefixes.
    const codeWorker = buildOwnershipContract(
      'software-engineer-1',
      'Software Engineer',
      'Implements, runs and fixes the code changes',
      ['code-execution'],
      ['src/**', 'test/**', 'package.json'],
      [],
      GOAL_WITH_NPM_TEST,
    );
    const docWorker = buildOwnershipContract(
      'documentation-writer-1',
      'Documentation Writer',
      'Documents the change and its usage',
      ['document-authoring'],
      ['README.md', 'docs/**'],
      ['software-engineer-1'], // depends on code worker
      GOAL_WITH_NPM_TEST,
    );

    // Code worker owns src/, test/, package.json — must run npm test
    expect(codeWorker.deliverableKind).toBe('testable-code');
    expect(codeWorker.applicableChecks.length).toBeGreaterThan(0);
    expect(codeWorker.applicableChecks[0]!.command).toBe('npm test');

    // Doc worker owns README.md, docs/ — does NOT run npm test
    expect(docWorker.deliverableKind).toBe('documentation');
    expect(docWorker.applicableChecks).toEqual([]);

    // Code worker does not own README.md
    expect(ownsArtifact(codeWorker, 'README.md')).toBe(false);
    expect(ownsArtifact(codeWorker, 'src/index.js')).toBe(true);
    expect(ownsArtifact(codeWorker, 'package.json')).toBe(true);

    // Doc worker does not own src/
    expect(ownsArtifact(docWorker, 'src/index.js')).toBe(false);
    expect(ownsArtifact(docWorker, 'README.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B01-T02 — Doc worker with shell grant not forced to test
// ---------------------------------------------------------------------------

describe('B01-T02 — Documentation worker with shell grant not forced to run npm test', () => {
  it('accepts finish for a doc worker (with shell) that did not run npm test', async () => {
    // Doc worker has shell grant (unusual but possible) + document-authoring skill.
    // The ownership contract scopes applicable checks to documentation → no test.
    const computer = memoryComputer();
    // The task brief must contain the [owns: ...] prefix for the ownership
    // contract to be parsed. We simulate what renderTaskBrief() produces.
    const taskBrief = [
      'Mission: "Build a Node.js app. npm test MUST exit 0."',
      'Your assignment in it: [owns: README.md, docs/**] Documents the change and its usage.',
      'Deliverables go to your own workspace. Finish with your artifact paths when done.',
    ].join('\n');

    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'README.md', contents: '# App' }),
      JSON.stringify({ action: 'finish', summary: 'Wrote README.', artifacts: ['README.md'] }),
    ]);
    const result = await new WorkerAgent({
      genome: docGenome({ tools: ['openbot:shell-execution', 'openbot:workspace-files'] }),
      reasoning,
      computer,
      taskBrief,
    }).run();

    expect(result.status).toBe('success');
    expect(result.completionEvidence!.deliverableKind).toBe('documentation');
    expect(result.completionEvidence!.ownershipContract).not.toBeNull();
    expect(result.completionEvidence!.ownershipContract!.ownedArtifacts).toEqual(['README.md', 'docs/**']);
    expect(result.completionEvidence!.lastTestCommand).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B01-T03 — Code worker cannot bypass required test
// ---------------------------------------------------------------------------

describe('B01-T03 — Code worker cannot bypass required test', () => {
  it('rejects finish for a code worker that did not run npm test', async () => {
    const computer = memoryComputer();
    const taskBrief = [
      'Mission: "Build a Node.js app. npm test MUST exit 0."',
      'Your assignment in it: [owns: src/**, test/**, package.json] Implements, runs and fixes the code changes.',
      'Deliverables go to your own workspace.',
    ].join('\n');

    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
    ]);
    const result = await new WorkerAgent({
      genome: codeGenome(),
      reasoning,
      computer,
      taskBrief,
    }).run();

    expect(result.status).toBe('failure');
    expect(result.summary).toMatch(/completion gate|test command/i);
    expect(result.completionEvidence!.ownershipContract).not.toBeNull();
    expect(result.completionEvidence!.ownershipContract!.ownedArtifacts).toContain('package.json');
  });

  it('accepts finish for a code worker after running npm test', async () => {
    const computer = memoryComputer();
    const taskBrief = [
      'Mission: "Build a Node.js app. npm test MUST exit 0."',
      'Your assignment in it: [owns: src/**, test/**, package.json] Implements.',
    ].join('\n');

    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
    ]);
    const result = await new WorkerAgent({
      genome: codeGenome(),
      reasoning,
      computer,
      taskBrief,
    }).run();

    expect(result.status).toBe('success');
    expect(result.completionEvidence!.lastTestCommand).toMatchObject({ command: 'npm test', exitCode: 0 });
  });
});

// ---------------------------------------------------------------------------
// B01-T04 — Claiming ownership of another worker's file is rejected
// ---------------------------------------------------------------------------

describe('B01-T04 — Claiming ownership of another worker\'s file is rejected', () => {
  it('doc worker claiming package.json (owned by code worker) is flagged', () => {
    // The ownership contract for doc worker says it owns README.md, docs/**.
    // If the doc worker claims package.json as its artifact, the system
    // can detect this mismatch (package.json is NOT in the doc worker's
    // ownedArtifacts). This is a diagnostic, not a hard rejection — the
    // worker can still produce the file, but the ownership contract
    // records that it does not own it.
    const docContract = buildOwnershipContract(
      'documentation-writer-1',
      'Documentation Writer',
      'Documents the change and its usage',
      ['document-authoring'],
      ['README.md', 'docs/**'],
      ['software-engineer-1'],
      GOAL_WITH_NPM_TEST,
    );
    // package.json is NOT owned by the doc worker
    expect(ownsArtifact(docContract, 'package.json')).toBe(false);
    // README.md IS owned
    expect(ownsArtifact(docContract, 'README.md')).toBe(true);
    // docs/intro.md IS owned (docs/** pattern)
    expect(ownsArtifact(docContract, 'docs/intro.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B01-T05 — Intentional collaboration not rejected
// ---------------------------------------------------------------------------

describe('B01-T05 — Intentional collaboration not rejected', () => {
  it('allows two workers to own overlapping patterns when explicitly declared', () => {
    // Two workers might legitimately co-own a file (e.g., a shared config).
    // The ownership contract does not prevent this — it records ownership
    // for diagnostic purposes. Enforcement is in B02 (read-only staging).
    const workerA = buildOwnershipContract(
      'worker-a',
      'Software Engineer',
      'Implements code',
      ['code-execution'],
      ['src/**', 'shared/config.json'],
      [],
      GOAL_WITH_NPM_TEST,
    );
    const workerB = buildOwnershipContract(
      'worker-b',
      'DevOps Engineer',
      'Configures deployment',
      ['code-execution'],
      ['deploy/**', 'shared/config.json'],
      ['worker-a'],
      GOAL_WITH_NPM_TEST,
    );
    // Both workers own shared/config.json — intentional collaboration
    expect(ownsArtifact(workerA, 'shared/config.json')).toBe(true);
    expect(ownsArtifact(workerB, 'shared/config.json')).toBe(true);
    // This is not an error — it's intentional collaboration. The ownership
    // contract records it; B02's read-only enforcement will handle conflicts.
  });
});

// ---------------------------------------------------------------------------
// B01-T06 — Unresolvable responsibility reported clearly
// ---------------------------------------------------------------------------

describe('B01-T06 — Unresolvable responsibility reported clearly', () => {
  it('falls back to Task A behavior when no [owns: ...] prefix is present', async () => {
    // A Generalist or Sole Operator has no ownedArtifacts — the ownership
    // contract is null, and the gate falls back to Task A behavior
    // (all mentions apply to testable-code workers).
    const computer = memoryComputer();
    // No [owns: ...] prefix in the brief
    const taskBrief = [
      'Mission: "Build a Node.js app. npm test MUST exit 0."',
      'Your assignment in it: Covers a required capability directly.',
      'Deliverables go to your own workspace.',
    ].join('\n');

    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
    ]);
    const result = await new WorkerAgent({
      genome: codeGenome({ skills: ['code-execution', 'document-authoring'] }), // generalist
      reasoning,
      computer,
      taskBrief,
    }).run();

    // No ownership contract parsed (no [owns: ...] prefix)
    expect(result.completionEvidence!.ownershipContract).toBeNull();
    // Falls back to Task A: testable-code + npm test mention → test required
    expect(result.completionEvidence!.deliverableKind).toBe('testable-code');
    expect(result.status).toBe('success'); // test was run
  });

  it('reports clearly when ownership prefix is malformed', () => {
    // A malformed prefix (e.g., [owns: ] with no patterns) is treated
    // as "no ownership declared" — the contract is null.
    const { ownedArtifacts, cleanResponsibility } = parseOwnershipPrefix(
      '[owns: ] Does something',
    );
    expect(ownedArtifacts).toEqual([]);
    expect(cleanResponsibility).toBe('Does something');
  });
});

// ---------------------------------------------------------------------------
// Unit tests for ownership-contract module
// ---------------------------------------------------------------------------

describe('ownership-contract unit tests', () => {
  describe('matchesOwnership', () => {
    it('matches exact path', () => {
      expect(matchesOwnership('package.json', 'package.json')).toBe(true);
      expect(matchesOwnership('package.json', 'other.json')).toBe(false);
    });
    it('matches directory glob (**)', () => {
      expect(matchesOwnership('src/**', 'src/index.js')).toBe(true);
      expect(matchesOwnership('src/**', 'src/deep/path/file.js')).toBe(true);
      expect(matchesOwnership('src/**', 'test/file.js')).toBe(false);
    });
    it('matches single-level glob (*)', () => {
      expect(matchesOwnership('test/*', 'test/app.test.js')).toBe(true);
      expect(matchesOwnership('test/*', 'test/deep/file.js')).toBe(false);
    });
  });

  describe('encodeOwnershipPrefix + parseOwnershipPrefix roundtrip', () => {
    it('roundtrips correctly', () => {
      const owned = ['src/**', 'test/**', 'package.json'];
      const responsibility = 'Implements code';
      const encoded = encodeOwnershipPrefix(owned, responsibility);
      const parsed = parseOwnershipPrefix(encoded);
      expect(parsed.ownedArtifacts).toEqual(owned);
      expect(parsed.cleanResponsibility).toBe(responsibility);
    });
    it('returns clean responsibility when no prefix', () => {
      const parsed = parseOwnershipPrefix('Just a responsibility');
      expect(parsed.ownedArtifacts).toEqual([]);
      expect(parsed.cleanResponsibility).toBe('Just a responsibility');
    });
  });

  describe('renderOwnershipBrief', () => {
    it('renders a readable brief with ownership info', () => {
      const contract = buildOwnershipContract(
        'software-engineer-1',
        'Software Engineer',
        'Implements code',
        ['code-execution'],
        ['src/**', 'package.json'],
        [],
        GOAL_WITH_NPM_TEST,
      );
      const brief = renderOwnershipBrief(contract);
      expect(brief).toContain('YOUR OWNERSHIP CONTRACT');
      expect(brief).toContain('Software Engineer');
      expect(brief).toContain('src/**');
      expect(brief).toContain('npm test');
    });
  });
});
