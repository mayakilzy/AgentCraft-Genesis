/**
 * G6-08 — Phase 4: Verification and Artifact Integrity tests (RC-7).
 *
 * Closes:
 *   - C-VERIFY-FINDING-001 (binary all-or-nothing verified flag) — already
 *     addressed in Phase 1 via per-artifact verifiedPaths Set; verified here.
 *   - C-VERIFY-FINDING-002 (verifier clean-room workspace not cleared)
 *   - C-VERIFY-FINDING-004 (flight-action disabled with FileFlightRecorder)
 *   - C-VERIFY-FINDING-005 (60-char fingerprint fabrication)
 *   - C-VERIFY-FINDING-012 (unknown check kinds silently dropped)
 *
 * Acceptance: tests with one valid artifact, one invalid artifact, one
 * stale artifact, one missing artifact, and one unexpected check type.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { VerificationLoop } from '../../src/mission/verification.js';
import { MemoryComputer } from '../../src/runtime/memory-computer.js';
import type { AcceptanceCheck, ArtifactSource } from '../../src/mission/verification.js';
import type { WorkerComputer } from '../../src/runtime/computer.js';

/**
 * A minimal WorkerComputer stub for verification tests. Verifier reads/writes
 * go through this — the cleanup logic must clear files between verify() calls.
 */
class StubComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
  async exec() { return { command: '', exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 }; }
  async writeFile(p: string, c: string) { this.files.set(p, c); return { path: p, bytes: c.length, appended: false }; }
  async readFile(p: string) {
    const t = this.files.get(p);
    if (t === undefined) throw new Error(`no file at ${p}`);
    return { path: p, text: t, bytes: t.length, truncated: false };
  }
  async listFiles() {
    return [...this.files.keys()].map((p) => ({ path: p, kind: 'file' as const, bytes: this.files.get(p)!.length }));
  }
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('G6-08 — Phase 4: Verification and Artifact Integrity', () => {
  it('P4-01: verify() clears stale artifacts from previous verify() call (C-VERIFY-FINDING-002)', async () => {
    const verifierComputer = new MemoryComputer();
    const verifier = verifierComputer as unknown as WorkerComputer;
    const loop = new VerificationLoop(verifier, {});

    // First verify(): produces artifact 'output.md' and runs a file check on it.
    const stubComputer1 = new StubComputer();
    const source1: ArtifactSource = {
      workerId: 'worker-a',
      computer: stubComputer1,
      paths: ['output.md'],
    };
    stubComputer1.files.set('output.md', 'first content');
    const checks1: AcceptanceCheck[] = [
      { kind: 'file', label: 'output exists', path: 'artifacts/worker-a/output.md' },
    ];
    const result1 = await loop.verify(checks1, [source1]);
    expect(result1.ok).toBe(true);

    // Stale state: the verifier workspace now has 'artifacts/worker-a/output.md'.
    const staleEntries = await verifier.listFiles();
    expect(staleEntries.some((e) => e.path === 'artifacts/worker-a/output.md')).toBe(true);

    // Second verify(): produces NO artifacts (worker produced nothing).
    // WITHOUT the C-VERIFY-FINDING-002 fix, the stale 'output.md' would
    // persist in the verifier workspace, and the file check would falsely PASS.
    const source2: ArtifactSource = {
      workerId: 'worker-b',
      computer: new StubComputer(),
      paths: [],  // no artifacts produced
    };
    const checks2: AcceptanceCheck[] = [
      { kind: 'file', label: 'output exists for worker-b', path: 'artifacts/worker-a/output.md' },
    ];
    const result2 = await loop.verify(checks2, [source2]);
    // The check SHOULD fail because:
    // 1. worker-b produced no artifacts → no copy was made
    // 2. C-VERIFY-FINDING-002 fix cleared the stale 'artifacts/worker-a/output.md'
    expect(result2.ok).toBe(false);
  });

  it('P4-02: unknown check kind is rejected with a clear detail (C-VERIFY-FINDING-012)', async () => {
    const verifier = new MemoryComputer() as unknown as WorkerComputer;
    const loop = new VerificationLoop(verifier, {});

    const stubComputer = new StubComputer();
    const source: ArtifactSource = {
      workerId: 'worker-x',
      computer: stubComputer,
      paths: ['out.txt'],
    };
    stubComputer.files.set('out.txt', 'hello');
    // Cast to AcceptanceCheck via unknown — the runtime switch's default case
    // must catch this unknown kind.
    const checks: AcceptanceCheck[] = [
      { kind: 'totally-unknown-check-kind', label: 'unknown' } as unknown as AcceptanceCheck,
    ];

    const result = await loop.verify(checks, [source]);
    expect(result.ok).toBe(false);
    // The unknown-kind outcome must have a clear detail mentioning the kind name.
    const unknownOutcome = result.outcomes.find((o) => o.label.startsWith('unknown-check-kind:'));
    expect(unknownOutcome).toBeDefined();
    expect(unknownOutcome!.ok).toBe(false);
    expect(unknownOutcome!.detail).toContain('totally-unknown-check-kind');
  });

  it('P4-03: missing artifact fails honestly (no false positive)', async () => {
    const verifier = new MemoryComputer() as unknown as WorkerComputer;
    const loop = new VerificationLoop(verifier, {});

    const stubComputer = new StubComputer();
    const source: ArtifactSource = {
      workerId: 'worker-missing',
      computer: stubComputer,
      paths: ['claimed-but-missing.txt'],
    };
    // Don't actually set the file — simulate the worker claiming an artifact
    // it never produced.
    const checks: AcceptanceCheck[] = [
      { kind: 'file', label: 'claimed file exists', path: 'artifacts/worker-missing/claimed-but-missing.txt' },
    ];

    const result = await loop.verify(checks, [source]);
    expect(result.ok).toBe(false);
    // The copy failure should be reported as an outcome.
    const copyFailure = result.outcomes.find((o) => o.label.startsWith('artifact-copy:'));
    expect(copyFailure).toBeDefined();
    expect(copyFailure!.ok).toBe(false);
  });

  it('P4-04: invalid artifact (hash mismatch) fails (C-VERIFY-FINDING-005 hash-match)', async () => {
    const verifier = new MemoryComputer() as unknown as WorkerComputer;
    const loop = new VerificationLoop(verifier, {});

    const stubComputer = new StubComputer();
    const source: ArtifactSource = {
      workerId: 'worker-bad-hash',
      computer: stubComputer,
      paths: ['output.md'],
    };
    stubComputer.files.set('output.md', 'plausible-but-wrong content');
    // The expected hash is for "correct content", but the worker wrote wrong content.
    const expectedHash = sha256Hex('correct content');
    const checks: AcceptanceCheck[] = [
      { kind: 'hash-match', label: 'hash matches expected', path: 'artifacts/worker-bad-hash/output.md', expectHash: expectedHash },
    ];

    const result = await loop.verify(checks, [source]);
    expect(result.ok).toBe(false);
    const hashOutcome = result.outcomes.find((o) => o.kind === 'hash-match');
    expect(hashOutcome).toBeDefined();
    expect(hashOutcome!.ok).toBe(false);
    expect(hashOutcome!.detail).toContain('does NOT match');
  });

  it('P4-05: valid artifact with matching hash passes', async () => {
    const verifier = new MemoryComputer() as unknown as WorkerComputer;
    const loop = new VerificationLoop(verifier, {});

    const stubComputer = new StubComputer();
    const source: ArtifactSource = {
      workerId: 'worker-good',
      computer: stubComputer,
      paths: ['output.md'],
    };
    const correctContent = 'correct content';
    stubComputer.files.set('output.md', correctContent);
    const expectedHash = sha256Hex(correctContent);
    const checks: AcceptanceCheck[] = [
      { kind: 'hash-match', label: 'hash matches', path: 'artifacts/worker-good/output.md', expectHash: expectedHash },
    ];

    const result = await loop.verify(checks, [source]);
    expect(result.ok).toBe(true);
  });

  it('P4-06: flight-action check works without MemoryFlightRecorder (C-VERIFY-FINDING-004)', async () => {
    // The C-VERIFY-FINDING-004 fix is in the orchestrator, not in VerificationLoop
    // directly. VerificationLoop accepts `flightEvents` as an option; the fix
    // makes the orchestrator pass them regardless of recorder type.
    //
    // Here we verify that VerificationLoop correctly uses the flightEvents
    // option to satisfy a flight-action check, even when no MemoryFlightRecorder
    // is in play.
    const verifier = new MemoryComputer() as unknown as WorkerComputer;
    const loop = new VerificationLoop(verifier, {
flightEvents: [
        { type: 'worker-step', at: new Date().toISOString(), action: 'run_command', ok: true } as never,
      ]
});

    const stubComputer = new StubComputer();
    const source: ArtifactSource = {
      workerId: 'worker-fa',
      computer: stubComputer,
      paths: ['output.md'],
    };
    stubComputer.files.set('output.md', 'content');
    const checks: AcceptanceCheck[] = [
      { kind: 'file', label: 'output exists', path: 'artifacts/worker-fa/output.md' },
      { kind: 'flight-action', label: 'run_command was invoked', action: 'run_command' },
    ];

    const result = await loop.verify(checks, [source]);
    expect(result.ok).toBe(true);
    const fa = result.outcomes.find((o) => o.kind === 'flight-action');
    expect(fa).toBeDefined();
    expect(fa!.ok).toBe(true);
  });

  it('P4-07: flight-action check fails when the action was NOT invoked', async () => {
    const verifier = new MemoryComputer() as unknown as WorkerComputer;
    const loop = new VerificationLoop(verifier, {
flightEvents: [
        { type: 'worker-step', at: new Date().toISOString(), action: 'some_other_action', ok: true } as never,
      ]
});

    const stubComputer = new StubComputer();
    const source: ArtifactSource = {
      workerId: 'worker-fa-fail',
      computer: stubComputer,
      paths: ['output.md'],
    };
    stubComputer.files.set('output.md', 'content');
    const checks: AcceptanceCheck[] = [
      { kind: 'flight-action', label: 'run_command was invoked', action: 'run_command' },
    ];

    const result = await loop.verify(checks, [source]);
    expect(result.ok).toBe(false);
    const fa = result.outcomes.find((o) => o.kind === 'flight-action');
    expect(fa).toBeDefined();
    expect(fa!.ok).toBe(false);
  });

  it('P4-08: mission-input check supports expectHash (C-VERIFY-FINDING-005)', async () => {
    const verifier = new MemoryComputer() as unknown as WorkerComputer;
    const workerComputer = new StubComputer();
    const inputContent = 'authoritative input bytes';
    workerComputer.files.set('input.txt', inputContent);

    const loop = new VerificationLoop(verifier, {
missionInputComputers: [{ workerId: 'worker-input', computer: workerComputer }]
});

    // The mission-input check should verify the file's hash matches.
    const expectedHash = sha256Hex(inputContent);
    const checks: AcceptanceCheck[] = [
      { kind: 'mission-input', label: 'input hash matches', path: 'input.txt', expectHash: expectedHash },
    ];

    const result = await loop.verify(checks, []);
    expect(result.ok).toBe(true);
    const mi = result.outcomes.find((o) => o.kind === 'mission-input');
    expect(mi).toBeDefined();
    expect(mi!.ok).toBe(true);
    expect(mi!.detail).toContain('verified by hash');
  });

  it('P4-09: mission-input check with expectHash fails on fabrication', async () => {
    const verifier = new MemoryComputer() as unknown as WorkerComputer;
    const workerComputer = new StubComputer();
    // Worker fabricated a file at the right path but with WRONG content.
    workerComputer.files.set('input.txt', 'fabricated content');

    const loop = new VerificationLoop(verifier, {
missionInputComputers: [{ workerId: 'worker-fabricated', computer: workerComputer }]
});

    const expectedHash = sha256Hex('authoritative input bytes');
    const checks: AcceptanceCheck[] = [
      { kind: 'mission-input', label: 'input hash matches', path: 'input.txt', expectHash: expectedHash },
    ];

    const result = await loop.verify(checks, []);
    expect(result.ok).toBe(false);
    const mi = result.outcomes.find((o) => o.kind === 'mission-input');
    expect(mi).toBeDefined();
    expect(mi!.ok).toBe(false);
    expect(mi!.detail).toContain('hash does NOT match');
  });
});
