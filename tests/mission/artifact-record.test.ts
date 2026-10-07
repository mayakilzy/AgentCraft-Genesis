import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArtifactRegistry,
  buildArtifactRecord,
  hashContent,
} from '../../src/mission/artifact-record.js';

describe('G6-01 artifact-record — Section 40 minimal artifact registry', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'genesis-artifact-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('hashContent returns SHA-256 hex of the content', () => {
    const hash = hashContent('hello world');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Known SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('hashContent returns empty string for empty input', () => {
    expect(hashContent('')).toBe('');
  });

  it('buildArtifactRecord computes hash and bytes from content', () => {
    const record = buildArtifactRecord({
      missionId: 'mission-001',
      workerId: 'worker-A',
      path: 'output.txt',
      provider: 'openbot',
      content: 'hello world',
    });
    expect(record.missionId).toBe('mission-001');
    expect(record.workerId).toBe('worker-A');
    expect(record.path).toBe('output.txt');
    expect(record.type).toBe('artifact');
    expect(record.provider).toBe('openbot');
    expect(record.contentHash).toBe(hashContent('hello world'));
    expect(record.bytes).toBe(11);
    expect(record.verificationState).toBe('unverified');
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('buildArtifactRecord accepts optional sourceWorkerId for lineage', () => {
    const record = buildArtifactRecord({
      missionId: 'mission-001',
      workerId: 'coordinator-1',
      path: 'integrated.md',
      provider: 'openbot',
      content: 'integrated summary',
      sourceWorkerId: 'specialist-A',
    });
    expect(record.sourceWorkerId).toBe('specialist-A');
  });

  it('ArtifactRegistry persists and reads back records', () => {
    const registry = new ArtifactRegistry({ dir: tempDir });
    const record = buildArtifactRecord({
      missionId: 'mission-001',
      workerId: 'worker-A',
      path: 'output.txt',
      provider: 'openbot',
      content: 'content here',
    });
    registry.record(record);
    const all = registry.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].missionId).toBe('mission-001');
    expect(all[0].contentHash).toBe(record.contentHash);
  });

  it('ArtifactRegistry.findLatest returns the most recent record for an artifact', () => {
    const registry = new ArtifactRegistry({ dir: tempDir });
    const baseInput = {
      missionId: 'mission-001',
      workerId: 'worker-A',
      path: 'output.txt',
      provider: 'openbot',
      content: 'content',
    };
    registry.record(buildArtifactRecord(baseInput));
    // Record a second artifact with the same key but different content
    registry.record(buildArtifactRecord({ ...baseInput, content: 'updated content' }));
    const latest = registry.findLatest('mission-001', 'worker-A', 'output.txt');
    expect(latest).toBeDefined();
    expect(latest!.contentHash).toBe(hashContent('updated content'));
  });

  it('ArtifactRegistry.forMission returns all records for a mission', () => {
    const registry = new ArtifactRegistry({ dir: tempDir });
    registry.record(
      buildArtifactRecord({
        missionId: 'mission-A',
        workerId: 'worker-1',
        path: 'a.txt',
        provider: 'openbot',
        content: 'a',
      }),
    );
    registry.record(
      buildArtifactRecord({
        missionId: 'mission-A',
        workerId: 'worker-2',
        path: 'b.txt',
        provider: 'openbot',
        content: 'b',
      }),
    );
    registry.record(
      buildArtifactRecord({
        missionId: 'mission-B',
        workerId: 'worker-1',
        path: 'c.txt',
        provider: 'openbot',
        content: 'c',
      }),
    );
    const forA = registry.forMission('mission-A');
    expect(forA).toHaveLength(2);
    expect(forA.map((r) => r.path).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('ArtifactRegistry.updateVerificationState appends a new record with updated state', async () => {
    const registry = new ArtifactRegistry({ dir: tempDir });
    const record = buildArtifactRecord({
      missionId: 'mission-001',
      workerId: 'worker-A',
      path: 'output.txt',
      provider: 'openbot',
      content: 'content',
    });
    registry.record(record);
    // Sleep briefly to ensure the updatedAt timestamp differs from createdAt
    // (timestamps have millisecond resolution; same-millisecond updates are equal).
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = registry.updateVerificationState(
      'mission-001',
      'worker-A',
      'output.txt',
      'verified',
    );
    expect(updated).toBeDefined();
    expect(updated!.verificationState).toBe('verified');
    expect(updated!.updatedAt).not.toBe(record.updatedAt);
    // Two records now: original + update
    const all = registry.readAll();
    expect(all).toHaveLength(2);
    // findLatest returns the verified one
    const latest = registry.findLatest('mission-001', 'worker-A', 'output.txt');
    expect(latest!.verificationState).toBe('verified');
  });

  it('ArtifactRegistry.updateVerificationState returns undefined for unknown artifact', () => {
    const registry = new ArtifactRegistry({ dir: tempDir });
    const result = registry.updateVerificationState(
      'unknown',
      'unknown',
      'unknown',
      'verified',
    );
    expect(result).toBeUndefined();
  });

  it('ArtifactRegistry.readAll returns empty array when file does not exist', () => {
    const registry = new ArtifactRegistry({ dir: tempDir });
    expect(registry.readAll()).toEqual([]);
  });

  it('ArtifactRegistry.readAll skips malformed lines gracefully', () => {
    const registry = new ArtifactRegistry({ dir: tempDir });
    // Write a valid record followed by garbage
    registry.record(
      buildArtifactRecord({
        missionId: 'm1',
        workerId: 'w1',
        path: 'p.txt',
        provider: 'openbot',
        content: 'x',
      }),
    );
    // Append garbage directly to the file via the registry's path
    appendFileSync(registry.path, '\n{not valid json}\n', 'utf8');
    const all = registry.readAll();
    expect(all).toHaveLength(1); // garbage line skipped
  });

  it('contentHash differs for different content (P0-1 false-success resistance)', () => {
    const a = hashContent('The mission succeeded with all checks passing.');
    const b = hashContent('The mission succeeded with all checks passing!'); // differs by one char
    expect(a).not.toBe(b);
  });
});
