import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  FileFlightRecorder,
  type FlightEvent,
} from '../../src/mission/flight-recorder.js';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * G6-01 (P0 H-33): secret redaction boundary.
 *
 * Tests that the expanded SECRET_PATTERNS in flight-recorder.ts catch
 * known provider token formats (GitHub PAT, OpenAI/Azure keys, AWS access
 * keys, generic API keys) without false positives on configuration keys.
 *
 * Tokens are constructed DYNAMICALLY so no literal credential-shaped
 * string appears in the test source — matches real-world usage where
 * tokens come from environment variables, never inline literals.
 */

// Build a fake GitHub PAT (ghp_ + 36 lowercase chars). The literal
// pattern never appears in the source — only its construction does.
const FAKE_GHP = ['ghp_', 'a'.repeat(36)].join('');
const FAKE_GITHUB_PAT = ['github_pat_', 'b'.repeat(25)].join('');
const FAKE_OPENAI = ['sk-proj-', 'c'.repeat(40)].join('');
const FAKE_ANTHROPIC = ['sk-ant-', 'd'.repeat(40)].join('');
// AWS access key ids are AKIA + 16 uppercase alphanumerics.
const FAKE_AWS = ['AKIA', 'EFGHIJKLMN012345'].join('');
// A fake JWT-like bearer token (header.payload.signature shape).
const FAKE_BEARER = ['Bearer ', 'ey', 'abc'.repeat(20), '.', 'def'.repeat(15), '.', 'ghi'.repeat(10)].join('');

describe('G6-01 flight-recorder secret redaction — P0 H-33', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'genesis-redact-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function recordAndRead(event: FlightEvent): Record<string, unknown> {
    const recorder = new FileFlightRecorder({
      dir: tempDir,
      missionId: 'test-mission',
    });
    recorder.record(event);
    recorder.close();
    const text = readFileSync(join(tempDir, 'test-mission.jsonl'), 'utf8');
    return JSON.parse(text.trim().split('\n')[0]);
  }

  function makeEvent(goalOutcome: string): FlightEvent {
    return {
      type: 'mission-started',
      at: '2026-10-07T00:00:00Z',
      missionId: 'm1',
      goalOutcome,
      budgetUsd: 10,
    };
  }

  it('redacts GitHub PAT (ghp_ prefix) in any string field', () => {
    const recorded = recordAndRead(makeEvent(`clone using ${FAKE_GHP} token`));
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain(FAKE_GHP);
    expect(serialized).toContain('ghp_[redacted]');
  });

  it('redacts github_pat_ (fine-grained PAT) format', () => {
    const recorded = recordAndRead(makeEvent(`auth with ${FAKE_GITHUB_PAT}`));
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain(FAKE_GITHUB_PAT);
    expect(serialized).toContain('github_pat_[redacted]');
  });

  it('redacts OpenAI sk- key format', () => {
    const recorded = recordAndRead(makeEvent(`call openai with ${FAKE_OPENAI}`));
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain(FAKE_OPENAI);
    expect(serialized).toContain('sk-[redacted]');
  });

  it('redacts Anthropic sk-ant- key format', () => {
    const recorded = recordAndRead(makeEvent(`call anthropic with ${FAKE_ANTHROPIC}`));
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain(FAKE_ANTHROPIC);
    expect(serialized).toContain('sk-ant-[redacted]');
  });

  it('redacts AWS access key id format (AKIA prefix)', () => {
    const recorded = recordAndRead(makeEvent(`s3 access with ${FAKE_AWS} key`));
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain(FAKE_AWS);
    expect(serialized).toContain('AKIA[redacted]');
  });

  it('redacts Bearer authorization headers', () => {
    const recorded = recordAndRead(makeEvent(`curl with ${FAKE_BEARER} header`));
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain(FAKE_BEARER);
    expect(serialized).toContain('Bearer [redacted]');
  });

  it('redacts generic env var assignments for credential-like keys', () => {
    const recorded = recordAndRead(
      makeEvent('set DATABASE_PASSWORD=supersecret123abc and continue'),
    );
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain('supersecret123abc');
    expect(serialized).toContain('DATABASE_PASSWORD=[redacted]');
  });

  it('redacts api_key=value patterns', () => {
    const recorded = recordAndRead(
      makeEvent('config api_key=abc123def456ghi789jkl012mno345pqr678'),
    );
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain('abc123def456ghi789jkl012mno345pqr678');
  });

  it('redacts ghp_-shaped tokens embedded inside JSON strings', () => {
    // The redaction boundary operates on STRINGS via regex. It cannot
    // parse nested JSON inside a string field — but it DOES catch the
    // credential-shaped token inside the JSON string. This is the
    // minimum required behavior: secrets never reach the flight record,
    // regardless of how they're wrapped.
    const recorded = recordAndRead(
      makeEvent(
        `config: {"token":"${FAKE_GHP}","nested":{"password":"mysecret"}}`,
      ),
    );
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain(FAKE_GHP);
    expect(serialized).toContain('ghp_[redacted]');
    // 'mysecret' is short and doesn't match the password=... regex
    // pattern (it's not preceded by `password=`). It WILL be caught by
    // the SECRET_KEY-based object walker only if the value is a parsed
    // object. Inside a JSON string, it is NOT redacted — that's the
    // documented boundary. This test asserts the actual behavior.
  });

  it('redacts object values when the parent KEY looks like a credential (parsed-object path)', () => {
    // The sanitize() function walks parsed objects and redacts any value
    // whose KEY matches the SECRET_KEY pattern. We exercise this by
    // constructing a custom event shape with a nested credentials object
    // and casting it to FlightEvent. The recorder walks the object and
    // applies the SECRET_KEY-based redaction.
    const objTempDir = mkdtempSync(join(tmpdir(), 'genesis-redact-obj-'));
    const missionId = 'obj-test';
    const recorder = new FileFlightRecorder({
      dir: objTempDir,
      missionId,
    });
    // The structured record file is named `{missionId}.jsonl` inside the dir.
    const recordPath = join(objTempDir, `${missionId}.jsonl`);
    // Cast a custom-shaped event to FlightEvent to exercise the parsed-object path.
    // This mimics what would happen if a future event carried nested credentials.
    const customEvent = {
      type: 'mission-started',
      at: '2026-10-07T00:00:00Z',
      missionId,
      goalOutcome: 'mission with embedded config',
      budgetUsd: 10,
      // Hypothetical future field carrying nested credentials
      providerConfig: {
        token: 'should-be-redacted-value',
        password: 'should-also-be-redacted',
        hostname: 'not-a-secret-keep-me',
      },
    } as unknown as FlightEvent;
    recorder.record(customEvent);
    recorder.close();
    const text = readFileSync(recordPath, 'utf8');
    // The credential-named keys have their values redacted.
    expect(text).not.toContain('should-be-redacted-value');
    expect(text).not.toContain('should-also-be-redacted');
    // The non-credential key keeps its value.
    expect(text).toContain('not-a-secret-keep-me');
    expect(text).toContain('"token":"[redacted]"');
    expect(text).toContain('"password":"[redacted]"');
    // Cleanup
    rmSync(objTempDir, { recursive: true, force: true });
  });

  it('does NOT redact non-credential configuration keys (no false positives)', () => {
    const recorded = recordAndRead(
      makeEvent('config key=hostname port=8080 endpoint=/api/v1'),
    );
    const serialized = JSON.stringify(recorded);
    // The word "key" appears in non-credential context — should NOT be redacted
    expect(serialized).toContain('key=hostname');
    expect(serialized).toContain('port=8080');
  });

  it('preserves non-secret content alongside redacted secrets', () => {
    const recorded = recordAndRead(
      makeEvent(`mission uses ${FAKE_GHP} to clone repo`),
    );
    const goal = String(recorded.goalOutcome);
    expect(goal).toContain('mission uses');
    expect(goal).toContain('to clone repo');
    expect(goal).not.toContain(FAKE_GHP);
    expect(goal).toContain('ghp_[redacted]');
  });
});
