/**
 * PILOT-002 R3 — Clean Room 404 fix: defensive workspace path discovery.
 *
 * When a worker finishes without declaring any artifacts (empty
 * `source.paths`), the verification copy loop must defensively list
 * the worker's workspace files via `source.computer.listFiles()` so
 * the clean room receives the actual produced files. Without this fix,
 * every `kind: 'file'` check fails with 404 because the clean room
 * stayed empty.
 *
 * These tests prove:
 *   1. Empty `paths` → discovery copies actual files → checks pass.
 *   2. Non-empty `paths` → discovery is NOT used (declared paths honored).
 *   3. Path traversal in discovered paths is refused.
 *   4. Discovery failure (computer throws) → fail-closed empty list.
 *   5. Excluded patterns (node_modules, .git, .npm) are filtered.
 */

import { describe, expect, it } from 'vitest';

import type { WorkerComputer } from '../../src/runtime/computer.js';
import {
  VerificationLoop,
  cleanRoomPath,
  type ArtifactSource,
} from '../../src/mission/verification.js';

class MemoryComputer implements WorkerComputer {
  readonly files = new Map<string, string>();

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

/** A computer that throws on listFiles — simulates a stopped OpenBot process. */
class ThrowingComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
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
  async listFiles(): Promise<readonly { path: string; kind: 'file'; bytes?: number }[]> {
    throw new Error('computer process exited');
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

/** A computer that reports a malicious traversal path. */
class TraversalComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
  constructor(files: Record<string, string>) {
    for (const [k, v] of Object.entries(files)) this.files.set(k, v);
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

describe('PILOT-002 R3 — Clean Room 404 fix (defensive workspace discovery)', () => {
  it('discovers files when source.paths is empty and copies them to clean room', async () => {
    // Worker produced files on disk but did not declare them in finish().
    const producer = new MemoryComputer();
    producer.files.set('package.json', '{"name":"task-manager"}');
    producer.files.set('server.js', 'import http from "node:http";');
    producer.files.set('README.md', '# Task Manager');

    // source.paths is EMPTY — worker did not declare artifacts.
    const source: ArtifactSource = {
      workerId: 'software-engineer-1',
      computer: producer,
      paths: [],
    };

    const verifier = new MemoryComputer();
    const loop = new VerificationLoop(verifier);

    // Caller passes bare paths (the conventional contract).
    const checks = [
      { kind: 'file' as const, label: 'package.json exists', path: cleanRoomPath(source, 'package.json') },
      { kind: 'file' as const, label: 'server.js exists', path: cleanRoomPath(source, 'server.js') },
    ];

    const result = await loop.verify(checks, [source], []);

    expect(result.ok).toBe(true);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((o) => o.ok)).toBe(true);
    // Clean room has the prefixed copies.
    expect(verifier.files.has('artifacts/software-engineer-1/package.json')).toBe(true);
    expect(verifier.files.has('artifacts/software-engineer-1/server.js')).toBe(true);
  });

  it('does NOT use discovery when source.paths is non-empty (declared paths honored)', async () => {
    // Worker declared specific paths — discovery must not override.
    const producer = new MemoryComputer();
    producer.files.set('declared.js', 'content');
    producer.files.set('hidden.js', 'should-not-be-copied');

    const source: ArtifactSource = {
      workerId: 'software-engineer-1',
      computer: producer,
      paths: ['declared.js'], // declared
    };

    const verifier = new MemoryComputer();
    const loop = new VerificationLoop(verifier);

    const checks = [
      { kind: 'file' as const, label: 'declared exists', path: cleanRoomPath(source, 'declared.js') },
    ];

    const result = await loop.verify(checks, [source], []);

    expect(result.ok).toBe(true);
    // Only the declared file is in the clean room — hidden.js was NOT discovered.
    expect(verifier.files.has('artifacts/software-engineer-1/declared.js')).toBe(true);
    expect(verifier.files.has('artifacts/software-engineer-1/hidden.js')).toBe(false);
  });

  it('refuses path traversal in discovered paths', async () => {
    // Malicious worker: listFiles returns traversal paths.
    const producer = new TraversalComputer({
      'safe.js': 'safe content',
      '../../../etc/passwd': 'malicious',
      '/etc/shadow': 'malicious-absolute',
    });

    const source: ArtifactSource = {
      workerId: 'software-engineer-1',
      computer: producer,
      paths: [], // empty → triggers discovery
    };

    const verifier = new MemoryComputer();
    const loop = new VerificationLoop(verifier);

    const checks = [
      { kind: 'file' as const, label: 'safe exists', path: cleanRoomPath(source, 'safe.js') },
    ];

    const result = await loop.verify(checks, [source], []);

    // safe.js is copied; traversal paths are refused.
    expect(verifier.files.has('artifacts/software-engineer-1/safe.js')).toBe(true);
    // No traversal path was written to verifier.
    expect(verifier.files.has('artifacts/software-engineer-1/../../../etc/passwd')).toBe(false);
    expect(verifier.files.has('artifacts/software-engineer-1//etc/shadow')).toBe(false);
  });

  it('excludes OpenBot internals from discovery (node_modules, .git, .npm)', async () => {
    const producer = new TraversalComputer({
      'package.json': '{}',
      'node_modules/express/index.js': 'should-be-excluded',
      '.npm/_logs/debug-0.log': 'should-be-excluded',
      '.git/config': 'should-be-excluded',
    });

    const source: ArtifactSource = {
      workerId: 'software-engineer-1',
      computer: producer,
      paths: [],
    };

    const verifier = new MemoryComputer();
    const loop = new VerificationLoop(verifier);

    await loop.verify([], [source], []);

    expect(verifier.files.has('artifacts/software-engineer-1/package.json')).toBe(true);
    expect(verifier.files.has('artifacts/software-engineer-1/node_modules/express/index.js')).toBe(false);
    expect(verifier.files.has('artifacts/software-engineer-1/.npm/_logs/debug-0.log')).toBe(false);
    expect(verifier.files.has('artifacts/software-engineer-1/.git/config')).toBe(false);
  });

  it('fails closed when listFiles throws (stopped computer)', async () => {
    // Worker process exited — listFiles throws.
    const producer = new ThrowingComputer();
    producer.files.set('package.json', '{}'); // files exist in map but listFiles throws

    const source: ArtifactSource = {
      workerId: 'software-engineer-1',
      computer: producer,
      paths: [],
    };

    const verifier = new MemoryComputer();
    const loop = new VerificationLoop(verifier);

    const checks = [
      { kind: 'file' as const, label: 'package.json exists', path: cleanRoomPath(source, 'package.json') },
    ];

    const result = await loop.verify(checks, [source], []);

    // Discovery returned [] → nothing copied → check fails honestly.
    expect(result.ok).toBe(false);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].detail).toContain('not found in the clean room');
  });
});
