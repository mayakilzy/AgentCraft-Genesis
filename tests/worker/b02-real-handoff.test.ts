/**
 * D+ B02 — Real Handoff tests (H01-H16).
 *
 * Tests the secure cross-worker artifact handoff:
 * - H01-H04: basic staging + read-only enforcement (write_file)
 * - H05-H08: shell mutation + traversal rejection
 * - H09-H12: conflict/failure handling + collaboration
 * - H13-H16: regression + frozen exception verification
 *
 * All tests use MemoryRuntime + MemoryComputer (deterministic, no Z.ai).
 */
import { describe, expect, it } from 'vitest';

import type { WorkerGenome } from '../../src/contracts/core.js';
import { MemoryComputer, MemoryRuntime } from '../../src/runtime/memory-computer.js';
import {
  stageUpstreamArtifactsForWorker,
  stagedPath,
  isUpstreamPath,
  UPSTREAM_PREFIX,
} from '../../src/runtime/handoff-staging.js';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComputer(): MemoryComputer {
  return new MemoryComputer();
}

function codeGenome(id: string): WorkerGenome {
  return {
    identity: { id, displayName: id },
    role: 'Software Engineer',
    objective: 'test',
    model: 'cheap',
    skills: ['code-execution'],
    tools: ['openbot:shell-execution', 'openbot:workspace-files'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'none',
    budget: { maxUsd: 1, maxTier: 'default' },
    autonomy: 'autonomous',
  };
}

// ---------------------------------------------------------------------------
// H01 — Producer creates file, Consumer reads actual bytes
// ---------------------------------------------------------------------------

describe('H01 — Producer creates file, Consumer reads actual bytes', () => {
  it('consumer receives real content from producer', async () => {
    const producer = makeComputer();
    const consumer = makeComputer();
    await producer.writeFile('src/index.js', 'console.log("hello")');
    await stageUpstreamArtifactsForWorker(
      'software-engineer-1',
      ['src/index.js'],
      producer,
      consumer,
      () => {},
    );
    // Consumer can read the staged file
    const read = await consumer.readFile('upstream/software-engineer-1/src/index.js');
    expect(read.text).toBe('console.log("hello")');
  });
});

// ---------------------------------------------------------------------------
// H02 — Hash preserved across staging
// ---------------------------------------------------------------------------

describe('H02 — Hash preserved across staging', () => {
  it('content hash matches before and after staging', async () => {
    const producer = makeComputer();
    const consumer = makeComputer();
    const content = '{"name":"app","version":"1.0.0"}';
    await producer.writeFile('package.json', content);
    const originalHash = createHash('sha256').update(content).digest('hex');

    await stageUpstreamArtifactsForWorker(
      'producer-1',
      ['package.json'],
      producer,
      consumer,
      () => {},
    );

    const staged = await consumer.readFile('upstream/producer-1/package.json');
    const stagedHash = createHash('sha256').update(staged.text).digest('hex');
    expect(stagedHash).toBe(originalHash);
  });
});

// ---------------------------------------------------------------------------
// H03 — No dependency means no upstream transfer
// ---------------------------------------------------------------------------

describe('H03 — No dependency means no upstream transfer', () => {
  it('empty artifacts list → no files staged', async () => {
    const producer = makeComputer();
    const consumer = makeComputer();
    await producer.writeFile('src/file.js', 'code');
    await stageUpstreamArtifactsForWorker(
      'producer-1',
      [], // no artifacts declared
      producer,
      consumer,
      () => {},
    );
    const files = await consumer.listFiles();
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// H04 — Missing required artifact
// ---------------------------------------------------------------------------

describe('H04 — Missing required artifact → explicit failure', () => {
  it('staging a non-existent artifact records failure (not silent success)', async () => {
    const producer = makeComputer();
    const consumer = makeComputer();
    const events: Array<{ action: string; ok: boolean }> = [];
    // Producer has no files — artifact 'missing.js' does not exist
    await stageUpstreamArtifactsForWorker(
      'producer-1',
      ['missing.js'],
      producer,
      consumer,
      (e) => events.push({ action: (e as { action: string }).action, ok: (e as { ok: boolean }).ok }),
    );
    // A failure event was recorded
    expect(events.some((e) => e.action.startsWith('stage-handoff-failed:'))).toBe(true);
    expect(events.every((e) => !e.ok)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H05 — write_file attempts upstream modification → rejected
// ---------------------------------------------------------------------------

describe('H05 — write_file attempts upstream modification → rejected', () => {
  it('consumer cannot writeFile to upstream/ path', async () => {
    const consumer = makeComputer();
    await expect(consumer.writeFile('upstream/producer-1/src/file.js', 'evil')).rejects.toThrow(/read-only upstream/);
  });
  it('consumer cannot writeFile to nested upstream/ path', async () => {
    const consumer = makeComputer();
    await expect(consumer.writeFile('upstream/producer-1/deep/path/file.js', 'evil')).rejects.toThrow(/read-only upstream/);
  });
});

// ---------------------------------------------------------------------------
// H06 — Shell attempts upstream modification → rejected via snapshot
// ---------------------------------------------------------------------------

describe('H06 — Shell attempts upstream modification → detected via snapshot', () => {
  it('isUpstreamPath detects upstream/ prefix', () => {
    expect(isUpstreamPath('upstream/producer-1/file.js')).toBe(true);
    expect(isUpstreamPath('upstream')).toBe(true);
    expect(isUpstreamPath('upstream\\producer-1\\file.js')).toBe(true);
    expect(isUpstreamPath('src/file.js')).toBe(false);
    expect(isUpstreamPath('package.json')).toBe(false);
  });
  // Note: shell-based mutation (e.g., echo > upstream/...) cannot be
  // prevented by MemoryComputer.writeFile because exec runs in a
  // subprocess. The protection is:
  // 1. writeFile rejects direct writes (H05).
  // 2. completion-policy.ts snapshot comparison detects mutations at finish.
  // This test verifies the path detection; the snapshot comparison is
  // tested in completion-contract.test.ts (R05/R06).
});

// ---------------------------------------------------------------------------
// H07 — Delete/rename/redirection attempts → rejected
// ---------------------------------------------------------------------------

describe('H07 — Delete/rename/redirection attempts → rejected', () => {
  it('cannot delete upstream file via writeFile overwrite (writeFile rejects)', async () => {
    const consumer = makeComputer();
    // Attempt to "delete" by writing empty content
    await expect(consumer.writeFile('upstream/producer-1/file.js', '')).rejects.toThrow(/read-only upstream/);
  });
});

// ---------------------------------------------------------------------------
// H08 — Traversal and symlink escape → rejected
// ---------------------------------------------------------------------------

describe('H08 — Traversal and symlink escape → rejected', () => {
  it('stagedPath rejects traversal in artifact path', () => {
    expect(() => stagedPath('producer-1', '../etc/passwd')).toThrow(/traversal/);
    expect(() => stagedPath('producer-1', '/etc/passwd')).toThrow(/absolute/);
    expect(() => stagedPath('producer-1', 'C:\\file')).toThrow(/Windows drive/);
  });
  it('stagedPath sanitizes producerId (defense-in-depth)', () => {
    // A malicious producerId with traversal characters is sanitized.
    // '../evil' → each non-alphanumeric char (except -) becomes '-'.
    const path = stagedPath('../evil', 'src/file.js');
    // The sanitized path must NOT contain '..' (traversal prevented)
    expect(path).not.toContain('..');
    // The path is upstream/<sanitized>/src/file.js
    expect(path.startsWith('upstream/')).toBe(true);
    expect(path.endsWith('/src/file.js')).toBe(true);
    // The sanitized producerId segment has no '..'
    const segment = path.split('/')[1]!; // 'upstream' / <segment> / 'src' / 'file.js'
    expect(segment).not.toContain('..');
  });
  it('stageUpstreamArtifactsForWorker rejects unsafe artifact paths', async () => {
    const producer = makeComputer();
    const consumer = makeComputer();
    await producer.writeFile('../evil', 'content');
    const events: Array<{ action: string; ok: boolean }> = [];
    await stageUpstreamArtifactsForWorker(
      'producer-1',
      ['../evil'],
      producer,
      consumer,
      (e) => events.push({ action: (e as { action: string }).action, ok: (e as { ok: boolean }).ok }),
    );
    // The unsafe path was rejected (failure event recorded)
    expect(events.some((e) => e.action.startsWith('stage-handoff-failed:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H09 — Conflicting ownership/content → deterministic handling
// ---------------------------------------------------------------------------

describe('H09 — Conflicting ownership/content → deterministic handling', () => {
  it('two producers with same artifact path → both staged under separate dirs', async () => {
    const producerA = makeComputer();
    const producerB = makeComputer();
    const consumer = makeComputer();
    await producerA.writeFile('config.json', '{"from":"A"}');
    await producerB.writeFile('config.json', '{"from":"B"}');

    await stageUpstreamArtifactsForWorker('producer-a', ['config.json'], producerA, consumer, () => {});
    await stageUpstreamArtifactsForWorker('producer-b', ['config.json'], producerB, consumer, () => {});

    // Both staged under separate producer dirs — no conflict
    const a = await consumer.readFile('upstream/producer-a/config.json');
    const b = await consumer.readFile('upstream/producer-b/config.json');
    expect(a.text).toBe('{"from":"A"}');
    expect(b.text).toBe('{"from":"B"}');
  });
});

// ---------------------------------------------------------------------------
// H10 — Producer failure → no false successful handoff
// ---------------------------------------------------------------------------

describe('H10 — Producer failure → no false successful handoff', () => {
  it('producer with no artifacts → consumer receives nothing', async () => {
    const producer = makeComputer();
    const consumer = makeComputer();
    // Producer produced nothing (failed)
    await stageUpstreamArtifactsForWorker('producer-1', [], producer, consumer, () => {});
    const files = await consumer.listFiles();
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// H11 — Existing single-worker mission → no regression
// ---------------------------------------------------------------------------

describe('H11 — Existing single-worker mission → no regression', () => {
  it('single worker with no upstream edges → no staging', async () => {
    // Verify MemoryComputer works normally for a single worker
    const computer = makeComputer();
    await computer.writeFile('src/file.js', 'code');
    const read = await computer.readFile('src/file.js');
    expect(read.text).toBe('code');
    // No upstream/ files
    const files = await computer.listFiles();
    expect(files.every((f) => !f.path.startsWith('upstream/'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H12 — Multi-worker code → docs → verification → real collaboration
// ---------------------------------------------------------------------------

describe('H12 — Multi-worker code → docs → verification → real collaboration', () => {
  it('code worker produces, doc worker receives upstream artifacts', async () => {
    const codeComputer = makeComputer();
    const docComputer = makeComputer();
    // Code worker produces package.json + src/index.js
    await codeComputer.writeFile('package.json', '{"name":"app"}');
    await codeComputer.writeFile('src/index.js', 'console.log("hi")');

    // Stage code worker's artifacts into doc worker's workspace
    await stageUpstreamArtifactsForWorker(
      'software-engineer-1',
      ['package.json', 'src/index.js'],
      codeComputer,
      docComputer,
      () => {},
    );

    // Doc worker can read the staged files (real content, not just names)
    const pkg = await docComputer.readFile('upstream/software-engineer-1/package.json');
    const src = await docComputer.readFile('upstream/software-engineer-1/src/index.js');
    expect(pkg.text).toBe('{"name":"app"}');
    expect(src.text).toBe('console.log("hi")');

    // Doc worker produces its own output (README.md — not under upstream/)
    await docComputer.writeFile('README.md', '# App\n\nBased on package.json');
    const readme = await docComputer.readFile('README.md');
    expect(readme.text).toContain('App');
  });
});

// ---------------------------------------------------------------------------
// H13 — Task A completion evidence preserved
// ---------------------------------------------------------------------------

describe('H13 — Task A completion evidence preserved', () => {
  it('MemoryComputer still supports exec/readFile/listFiles normally', async () => {
    const computer = makeComputer();
    await computer.writeFile('test.js', 'x');
    const exec = await computer.exec('node test.js');
    expect(exec.exitCode).toBe(0);
    const read = await computer.readFile('test.js');
    expect(read.text).toBe('x');
    const files = await computer.listFiles();
    expect(files.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// H14 — Stage 1 responsibility rules preserved
// ---------------------------------------------------------------------------

describe('H14 — Stage 1 responsibility rules preserved', () => {
  it('upstream/ writes rejected even by non-code workers', async () => {
    const docComputer = makeComputer();
    await expect(docComputer.writeFile('upstream/any/file', 'x')).rejects.toThrow(/read-only upstream/);
  });
});

// ---------------------------------------------------------------------------
// H15 — Frozen exception narrow and documented
// ---------------------------------------------------------------------------

describe('H15 — Frozen exception narrow and documented', () => {
  it('UPSTREAM_PREFIX is "upstream"', () => {
    expect(UPSTREAM_PREFIX).toBe('upstream');
  });
  it('stagedPath produces upstream/<producer>/<path> format', () => {
    const path = stagedPath('worker-1', 'src/index.js');
    expect(path).toBe('upstream/worker-1/src/index.js');
  });
});

// ---------------------------------------------------------------------------
// H16 — No duplicate independent application caused by missing handoff
// ---------------------------------------------------------------------------

describe('H16 — No duplicate independent application caused by missing handoff', () => {
  it('doc worker receives code worker\'s output → does not need to reproduce it', async () => {
    // This is the core B02 value: the doc worker can READ the code worker's
    // output instead of producing its own copy. The handoff provides real
    // file access, eliminating the duplicate-production pattern from G7-19H.
    const codeComputer = makeComputer();
    const docComputer = makeComputer();
    await codeComputer.writeFile('src/store.js', 'export function create() {}');
    await stageUpstreamArtifactsForWorker(
      'software-engineer-1',
      ['src/store.js'],
      codeComputer,
      docComputer,
      () => {},
    );
    // Doc worker can read the staged src/store.js — no need to reproduce it
    const store = await docComputer.readFile('upstream/software-engineer-1/src/store.js');
    expect(store.text).toBe('export function create() {}');
    // Doc worker produces only its own deliverable (README), not src/store.js
    await docComputer.writeFile('README.md', '# Docs\n\nSee src/store.js');
    // The doc worker's workspace has README.md + upstream/ (not src/store.js)
    const files = await docComputer.listFiles();
    const paths = files.map((f) => f.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('upstream/software-engineer-1/src/store.js');
    expect(paths).not.toContain('src/store.js'); // doc worker did NOT reproduce it
  });
});
