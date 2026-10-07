import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  VerificationLoop,
  type AcceptanceCheck,
} from '../../src/mission/verification.js';
import type { WorkerComputer, ReadResult, WriteResult, ExecResult, WorkspaceEntry } from '../../src/runtime/computer.js';

/**
 * G6-01 (P0 H-06): hash-match verification hardening.
 *
 * Tests that a real-LLM worker producing plausible-but-wrong content
 * (file EXISTS, contains expected substring, but is materially wrong)
 * is caught by the hash-match check.
 */

class StubComputer implements WorkerComputer {
  private readonly files = new Map<string, string>();

  writeFile(path: string, contents: string): Promise<WriteResult> {
    this.files.set(path, contents);
    return Promise.resolve({ path, bytes: Buffer.byteLength(contents, 'utf8'), appended: false });
  }
  readFile(path: string): Promise<ReadResult> {
    const text = this.files.get(path);
    if (text === undefined) {
      return Promise.reject(new Error(`file not found: ${path}`));
    }
    return Promise.resolve({
      path,
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      truncated: false,
    });
  }
  listFiles(): Promise<readonly WorkspaceEntry[]> {
    return Promise.resolve([...this.files.keys()].map((p) => ({ path: p, kind: 'file' as const })));
  }
  exec(command: string): Promise<ExecResult> {
    return Promise.resolve({
      command,
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      elapsedMs: 0,
    });
  }
}

describe('G6-01 verification hash-match — P0 H-06 false-success resistance', () => {
  let verifier: StubComputer;

  beforeEach(() => {
    verifier = new StubComputer();
  });

  it('passes when the artifact hash matches the expected gold answer', async () => {
    const goldContent = 'The correct answer is 42.';
    const expectedHash = createHash('sha256').update(goldContent, 'utf8').digest('hex');
    // Stage the correct artifact in the verifier's clean room
    await verifier.writeFile('artifacts/worker-A/answer.txt', goldContent);
    const loop = new VerificationLoop(verifier);
    const check: AcceptanceCheck = {
      kind: 'hash-match',
      label: 'gold-answer-hash',
      path: 'artifacts/worker-A/answer.txt',
      expectHash: expectedHash,
    };
    const result = await loop.verify([check], []);
    expect(result.ok).toBe(true);
    expect(result.outcomes[0].ok).toBe(true);
  });

  it('fails when a real-LLM worker produces plausible-but-wrong content', async () => {
    const goldContent = 'The correct answer is 42.';
    const wrongButPlausible = 'The correct answer is 43.'; // one character off
    const expectedHash = createHash('sha256').update(goldContent, 'utf8').digest('hex');
    // Stage the WRONG artifact — it exists, looks plausible, but is materially wrong
    await verifier.writeFile('artifacts/worker-A/answer.txt', wrongButPlausible);
    const loop = new VerificationLoop(verifier);
    const check: AcceptanceCheck = {
      kind: 'hash-match',
      label: 'gold-answer-hash',
      path: 'artifacts/worker-A/answer.txt',
      expectHash: expectedHash,
    };
    const result = await loop.verify([check], []);
    expect(result.ok).toBe(false);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].detail).toContain('does NOT match');
    expect(result.outcomes[0].detail).toContain('plausible-but-wrong');
  });

  it('fails honestly when the artifact file is missing entirely', async () => {
    const loop = new VerificationLoop(verifier);
    const check: AcceptanceCheck = {
      kind: 'hash-match',
      label: 'gold-answer-hash',
      path: 'artifacts/worker-A/missing.txt',
      expectHash: '0'.repeat(64),
    };
    const result = await loop.verify([check], []);
    expect(result.ok).toBe(false);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].detail).toContain('not found');
  });

  it('normalizes the expected hash to lowercase before comparison', async () => {
    const goldContent = 'lowercase hash test';
    const expectedHash = createHash('sha256').update(goldContent, 'utf8').digest('hex');
    await verifier.writeFile('artifacts/worker-A/file.txt', goldContent);
    const loop = new VerificationLoop(verifier);
    const check: AcceptanceCheck = {
      kind: 'hash-match',
      label: 'gold-answer-hash',
      path: 'artifacts/worker-A/file.txt',
      expectHash: expectedHash.toUpperCase(), // caller passes uppercase
    };
    const result = await loop.verify([check], []);
    expect(result.ok).toBe(true);
  });

  it('catches the case where the file exists and contains expected substring but is materially wrong', async () => {
    // This is the precise scenario H-06 warns about: a real-LLM worker
    // produces content that satisfies an `expectIncludes` check but is
    // materially wrong. The hash-match check catches it.
    const goldContent = 'STATUS: success\nRESULT: 42\nDONE';
    const wrongButContainsSubstring = 'STATUS: success\nRESULT: 999\nDONE';
    const expectedHash = createHash('sha256').update(goldContent, 'utf8').digest('hex');
    await verifier.writeFile('artifacts/worker-A/report.txt', wrongButContainsSubstring);
    const loop = new VerificationLoop(verifier);
    // A naive `file` check with `expectIncludes: "STATUS: success"` would PASS.
    // The `hash-match` check correctly FAILS.
    const checks: AcceptanceCheck[] = [
      {
        kind: 'file',
        label: 'naive-substring-check',
        path: 'artifacts/worker-A/report.txt',
        expectIncludes: 'STATUS: success',
      },
      {
        kind: 'hash-match',
        label: 'gold-answer-hash',
        path: 'artifacts/worker-A/report.txt',
        expectHash: expectedHash,
      },
    ];
    const result = await loop.verify(checks, []);
    // The naive check passes...
    expect(result.outcomes[0].ok).toBe(true);
    // ...but the hash-match check correctly fails.
    expect(result.outcomes[1].ok).toBe(false);
    expect(result.ok).toBe(false);
  });
});
