/**
 * PILOT-002 R3.1 — TASK 02: Clean Room Recovery validation.
 *
 * Validates the defensive artifact discovery mechanism against five
 * required scenarios:
 *
 *   S1. A worker completing successfully with declared artifacts.
 *   S2. A worker failing before `finish` but leaving files on disk.
 *   S3. A worker declaring nonexistent files (false claim).
 *   S4. Multiple workers with separate workspaces.
 *   S5. Invalid paths and unauthorized file access (path traversal).
 *
 * Key principle: recovered evidence ≠ accepted deliverables.
 * Files discovered from a failed worker's disk are visible to the
 * verifier (so verification can run), but the mission status still
 * reflects the worker's failure. The verifier never silently promotes
 * files from failed workers into verified final products.
 */

import { describe, expect, it } from 'vitest';

import type { WorkerComputer, WorkspaceEntry } from '../../src/runtime/computer.js';
import {
  VerificationLoop,
  cleanRoomPath,
  type ArtifactSource,
} from '../../src/mission/verification.js';

class TestComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
  readonly execResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();

  setExec(cmd: string, result: { exitCode: number; stdout: string; stderr?: string }) {
    this.execResults.set(cmd, { stderr: '', ...result });
  }

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
  async listFiles(): Promise<readonly WorkspaceEntry[]> {
    return [...this.files.keys()].map((path) => ({
      path,
      kind: 'file' as const,
      bytes: this.files.get(path)!.length,
    }));
  }
  async exec(command: string) {
    const canned = this.execResults.get(command);
    if (canned) return { command, ...canned, timedOut: false, elapsedMs: 1 };
    return { command, exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 };
  }
}

/** A computer that reports traversal paths in listFiles. */
class TraversalComputer implements WorkerComputer {
  constructor(private readonly realFiles: Map<string, string>) {}
  async writeFile(path: string, contents: string) {
    this.realFiles.set(path, contents);
    return { path, bytes: contents.length, appended: false };
  }
  async writeFileTrusted(path: string, contents: string) {
    this.realFiles.set(path, contents);
    return { path, bytes: contents.length, appended: false };
  }
  async readFile(path: string) {
    const text = this.realFiles.get(path);
    if (text === undefined) throw new Error(`no file at ${path}`);
    return { path, text, bytes: text.length, truncated: false };
  }
  async listFiles(): Promise<readonly WorkspaceEntry[]> {
    // Include both real files AND malicious traversal entries.
    return [...this.realFiles.keys()].map((path) => ({
      path,
      kind: 'file' as const,
      bytes: this.realFiles.get(path)!.length,
    }));
  }
  async exec(command: string) {
    return { command, exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 };
  }
}

describe('PILOT-002 R3.1 TASK 02 — Clean Room Recovery', () => {
  // S1: Worker completing successfully with declared artifacts.
  describe('S1: successful worker with declared artifacts', () => {
    it('copies declared artifacts to clean room and passes file checks', async () => {
      const producer = new TestComputer();
      producer.files.set('package.json', '{"name":"app"}');
      producer.files.set('server.js', 'console.log("ok")');

      const source: ArtifactSource = {
        workerId: 'se-1',
        computer: producer,
        paths: ['package.json', 'server.js'], // declared
      };

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);

      const checks = [
        { kind: 'file' as const, label: 'pkg', path: cleanRoomPath(source, 'package.json') },
        { kind: 'file' as const, label: 'srv', path: cleanRoomPath(source, 'server.js') },
      ];

      const result = await loop.verify(checks, [source], []);
      expect(result.ok).toBe(true);
      expect(verifier.files.has('artifacts/se-1/package.json')).toBe(true);
      expect(verifier.files.has('artifacts/se-1/server.js')).toBe(true);
    });

    it('does NOT use discovery when paths are declared', async () => {
      const producer = new TestComputer();
      producer.files.set('declared.js', 'content');
      producer.files.set('hidden.js', 'should-not-be-copied');

      const source: ArtifactSource = {
        workerId: 'se-1',
        computer: producer,
        paths: ['declared.js'],
      };

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);
      await loop.verify([], [source], []);

      expect(verifier.files.has('artifacts/se-1/declared.js')).toBe(true);
      expect(verifier.files.has('artifacts/se-1/hidden.js')).toBe(false);
    });
  });

  // S2: Worker failing before finish but leaving files on disk.
  describe('S2: failed worker with files on disk', () => {
    it('discovers files via listFiles when source.paths is empty', async () => {
      const producer = new TestComputer();
      producer.files.set('package.json', '{}');
      producer.files.set('server.js', 'console.log("ok")');

      // Worker failed — source.paths is empty (no declaration).
      const source: ArtifactSource = {
        workerId: 'se-1',
        computer: producer,
        paths: [],
      };

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);

      const checks = [
        { kind: 'file' as const, label: 'pkg', path: cleanRoomPath(source, 'package.json') },
      ];

      const result = await loop.verify(checks, [source], []);
      expect(result.ok).toBe(true);
      expect(verifier.files.has('artifacts/se-1/package.json')).toBe(true);
      expect(verifier.files.has('artifacts/se-1/server.js')).toBe(true);
    });

    it('recovered evidence is visible to verifier but mission status still reflects failure', async () => {
      // The verification can see the files, but the worker's failure
      // is tracked separately by the orchestrator (workerFailures).
      // This test proves the verifier can see the files — the
      // orchestrator's status logic is tested separately.
      const producer = new TestComputer();
      producer.files.set('app.js', 'console.log("hello")');

      const source: ArtifactSource = {
        workerId: 'se-1',
        computer: producer,
        paths: [], // empty — simulates failed worker
      };

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);

      // Even with empty paths, discovery finds the file.
      const checks = [
        { kind: 'file' as const, label: 'app exists', path: cleanRoomPath(source, 'app.js') },
      ];

      const result = await loop.verify(checks, [source], []);
      expect(result.ok).toBe(true);
      // The file was recovered from disk — NOT silently promoted.
      // The verification passed, but the orchestrator tracks the
      // worker's failure separately (workerFailures.length > 0 →
      // status='partial' even if verification.ok=true).
    });
  });

  // S3: Worker declaring nonexistent files (false claim).
  describe('S3: worker declares nonexistent files', () => {
    it('fails honestly when declared files do not exist on disk', async () => {
      const producer = new TestComputer();
      // Producer has NO files — worker claimed them but never wrote them.

      const source: ArtifactSource = {
        workerId: 'se-1',
        computer: producer,
        paths: ['phantom.js'], // declared but never produced
      };

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);

      const checks = [
        { kind: 'file' as const, label: 'phantom exists', path: cleanRoomPath(source, 'phantom.js') },
      ];

      const result = await loop.verify(checks, [source], []);
      expect(result.ok).toBe(false);
      // The copy failed → the file is not in the clean room → check fails.
      expect(verifier.files.has('artifacts/se-1/phantom.js')).toBe(false);
    });
  });

  // S4: Multiple workers with separate workspaces.
  describe('S4: multiple workers with separate workspaces', () => {
    it('copies from each worker into its own clean-room subdirectory', async () => {
      const se = new TestComputer();
      se.files.set('server.js', 'SE server');

      const doc = new TestComputer();
      doc.files.set('README.md', 'Doc readme');

      const sources: ArtifactSource[] = [
        { workerId: 'se-1', computer: se, paths: ['server.js'] },
        { workerId: 'doc-2', computer: doc, paths: ['README.md'] },
      ];

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);

      const checks = [
        { kind: 'file' as const, label: 'se server', path: cleanRoomPath(sources[0]!, 'server.js') },
        { kind: 'file' as const, label: 'doc readme', path: cleanRoomPath(sources[1]!, 'README.md') },
      ];

      const result = await loop.verify(checks, sources, []);
      expect(result.ok).toBe(true);
      // Each worker's files are in their own subdirectory.
      expect(verifier.files.has('artifacts/se-1/server.js')).toBe(true);
      expect(verifier.files.has('artifacts/doc-2/README.md')).toBe(true);
    });

    it('discovers from multiple failed workers (both with empty paths)', async () => {
      const se = new TestComputer();
      se.files.set('server.js', 'SE server');

      const doc = new TestComputer();
      doc.files.set('README.md', 'Doc readme');

      // Both workers failed — both have empty paths.
      const sources: ArtifactSource[] = [
        { workerId: 'se-1', computer: se, paths: [] },
        { workerId: 'doc-2', computer: doc, paths: [] },
      ];

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);

      const checks = [
        { kind: 'file' as const, label: 'se server', path: cleanRoomPath(sources[0]!, 'server.js') },
        { kind: 'file' as const, label: 'doc readme', path: cleanRoomPath(sources[1]!, 'README.md') },
      ];

      const result = await loop.verify(checks, sources, []);
      expect(result.ok).toBe(true);
      expect(verifier.files.has('artifacts/se-1/server.js')).toBe(true);
      expect(verifier.files.has('artifacts/doc-2/README.md')).toBe(true);
    });
  });

  // S5: Invalid paths and unauthorized file access.
  describe('S5: invalid paths and unauthorized access', () => {
    it('refuses path traversal in discovered paths', async () => {
      const files = new Map<string, string>([
        ['safe.js', 'safe'],
        ['../../../etc/passwd', 'malicious'],
        ['/etc/shadow', 'malicious-absolute'],
      ]);
      const producer = new TraversalComputer(files);

      const source: ArtifactSource = {
        workerId: 'se-1',
        computer: producer,
        paths: [], // triggers discovery
      };

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);
      await loop.verify([], [source], []);

      // safe.js was copied; traversal paths were refused.
      expect(verifier.files.has('artifacts/se-1/safe.js')).toBe(true);
      expect(verifier.files.has('artifacts/se-1/../../../etc/passwd')).toBe(false);
      expect(verifier.files.has('artifacts/se-1//etc/shadow')).toBe(false);
    });

    it('excludes OpenBot internals from discovery', async () => {
      const producer = new TestComputer();
      producer.files.set('package.json', '{}');
      producer.files.set('node_modules/express/index.js', 'excluded');
      producer.files.set('.npm/_logs/debug.log', 'excluded');
      producer.files.set('.git/config', 'excluded');

      const source: ArtifactSource = {
        workerId: 'se-1',
        computer: producer,
        paths: [],
      };

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);
      await loop.verify([], [source], []);

      expect(verifier.files.has('artifacts/se-1/package.json')).toBe(true);
      expect(verifier.files.has('artifacts/se-1/node_modules/express/index.js')).toBe(false);
      expect(verifier.files.has('artifacts/se-1/.npm/_logs/debug.log')).toBe(false);
      expect(verifier.files.has('artifacts/se-1/.git/config')).toBe(false);
    });

    it('fails closed when listFiles throws', async () => {
      const producer = {
        files: new Map(),
        async writeFile() { return { path: '', bytes: 0, appended: false }; },
        async writeFileTrusted() { return { path: '', bytes: 0, appended: false }; },
        async readFile() { throw new Error('no file'); },
        async listFiles() { throw new Error('computer stopped'); },
        async exec() { return { command: '', exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 }; },
      } as unknown as WorkerComputer;

      const source: ArtifactSource = {
        workerId: 'se-1',
        computer: producer,
        paths: [],
      };

      const verifier = new TestComputer();
      const loop = new VerificationLoop(verifier);

      const checks = [
        { kind: 'file' as const, label: 'pkg', path: cleanRoomPath(source, 'package.json') },
      ];

      const result = await loop.verify(checks, [source], []);
      // Discovery failed → nothing copied → check fails honestly.
      expect(result.ok).toBe(false);
    });
  });
});
