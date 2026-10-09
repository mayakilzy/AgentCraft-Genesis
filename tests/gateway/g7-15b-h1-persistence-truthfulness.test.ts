/**
 * G7-15B-H1 — Terminal Persistence Truthfulness fault-injection tests.
 *
 * These tests deliberately inject filesystem failures into the mission
 * history store to verify the H1-C remediation:
 *
 *   H1-01: Terminal SUCCEEDED persists normally and survives restart unchanged.
 *   H1-02: Terminal FAILED persists normally and survives restart unchanged.
 *   H1-03: Terminal write failure is observable and not silently presented
 *          as durable success.
 *   H1-04: Restart after terminal-write failure does NOT fabricate a confirmed
 *          mission failure (recovers as OUTCOME_UNCONFIRMED, NOT FAILED).
 *   H1-05: A genuinely interrupted mission is not displayed as RUNNING after
 *          restart (recovers as OUTCOME_UNCONFIRMED — terminal, not active).
 *   H1-06: Mission list and detail endpoints agree on recovered status.
 *   H1-07: Previously persisted verification and artifact metadata are not
 *          fabricated or corrupted.
 *   H1-08: No secrets appear in recovery records, logs, or API responses.
 *
 * Fault injection: a FaultInjectingHistoryStore wraps a real
 * FileMissionHistoryStore and can be configured to throw on the Nth write
 * call or on writes matching a specific missionId. This is deterministic
 * (no reliance on accidental disk failures).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MissionService } from '../../src/gateway/mission-service.js';
import {
  FileMissionHistoryStore,
  type MissionHistoryRecord,
} from '../../src/mission/mission-history-store.js';
import type { CallerIdentity } from '../../src/gateway/types.js';

const CALLER: CallerIdentity = {
  callerId: 'g7-15b-h1-caller',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 50,
  maxMissionTimeoutMs: 60_000,
};

// ---------------------------------------------------------------------------
// Deterministic reasoning providers
// ---------------------------------------------------------------------------

function makeSuccessReasoning() {
  let step = 0;
  return {
    name: 'h1-success-reasoning',
    async reason() {
      step += 1;
      if (step === 1) {
        return {
          text: JSON.stringify({
            action: 'write_file',
            path: 'output.md',
            contents: '# H1 test artifact\n',
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: 'wrote output.md',
          artifacts: ['output.md'],
        }),
      };
    },
  };
}

function makeFailureReasoning() {
  return {
    name: 'h1-failure-reasoning',
    async reason() {
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: 'no artifact',
          artifacts: ['missing.md'],
        }),
      };
    },
  };
}

function makeHangingReasoning() {
  return {
    name: 'h1-hanging-reasoning',
    async reason() {
      await new Promise(() => { /* never resolves */ });
      return { text: '{}' };
    },
  };
}

// ---------------------------------------------------------------------------
// Fault-injecting history store wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a real FileMissionHistoryStore. Can be configured to throw on the
 * Nth write call (1-indexed) or on writes matching a specific missionId.
 * The first write (initial ACCEPTED) is write #1; the terminal write is #2.
 * To inject a terminal-write failure, configure failOnWriteNumber=2.
 */
class FaultInjectingHistoryStore extends FileMissionHistoryStore {
  private failOnWriteNumber: number | null = null;
  private failOnMissionId: string | null = null;
  private writeCount = 0;
  public lastWriteError: Error | null = null;

  configureFault(opts: { failOnWriteNumber?: number; failOnMissionId?: string }): void {
    this.failOnWriteNumber = opts.failOnWriteNumber ?? null;
    this.failOnMissionId = opts.failOnMissionId ?? null;
  }

  clearFault(): void {
    this.failOnWriteNumber = null;
    this.failOnMissionId = null;
  }

  write(record: MissionHistoryRecord): void {
    this.writeCount += 1;
    const shouldFail =
      (this.failOnWriteNumber !== null && this.writeCount === this.failOnWriteNumber) ||
      (this.failOnMissionId !== null && record.missionId === this.failOnMissionId);
    if (shouldFail) {
      const err = new Error(`injected fault: write #${this.writeCount} for mission ${record.missionId}`);
      this.lastWriteError = err;
      throw err;
    }
    super.write(record);
  }

  getWriteCount(): number {
    return this.writeCount;
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tempDir: string;
let historyDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'g7-15b-h1-'));
  historyDir = join(tempDir, 'missions');
});

afterEach(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('G7-15B-H1 — Terminal Persistence Truthfulness', () => {
  it('H1-01: Terminal SUCCEEDED persists normally and survives restart unchanged', async () => {
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a report on topic A.' },
      CALLER,
    );
    const snap = await service1.awaitCompletion(missionId, CALLER);
    expect(snap.status).toBe('SUCCEEDED');
    // No persistence warning — the terminal write succeeded.
    expect(snap.failureMessage).toBeUndefined();
    service1.close();

    // Restart — the SUCCEEDED record should survive unchanged.
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const recovered = service2.get(missionId, CALLER);
    expect(recovered.status).toBe('SUCCEEDED');
    expect(recovered.terminal).toBe(true);
    expect(recovered.result?.status).toBe('success');
    // No persistence warning after a clean restart.
    expect(recovered.failureMessage).toBeUndefined();
    expect(recovered.failureClass).toBeUndefined();
    service2.close();
  }, 10_000);

  it('H1-02: Terminal FAILED persists normally and survives restart unchanged', async () => {
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeFailureReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a report on topic B.' },
      CALLER,
    );
    const snap = await service1.awaitCompletion(missionId, CALLER);
    expect(snap.status).toBe('FAILED');
    // The failure is a REAL execution failure (no artifact), not a persistence warning.
    // The failureMessage should NOT contain the persistence warning.
    expect(snap.failureMessage).toBeUndefined();
    service1.close();

    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeFailureReasoning() as never,
    });
    const recovered = service2.get(missionId, CALLER);
    expect(recovered.status).toBe('FAILED');
    expect(recovered.terminal).toBe(true);
    expect(recovered.result?.status).toBe('failure');
    service2.close();
  }, 10_000);

  it('H1-03: Terminal write failure is observable and not silently presented as durable success', async () => {
    // Configure the fault-injecting store to fail on write #2 (the terminal
    // write). Write #1 is the initial ACCEPTED record — it succeeds.
    const store1 = new FaultInjectingHistoryStore({ dir: historyDir });
    store1.configureFault({ failOnWriteNumber: 2 });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a report on topic C.' },
      CALLER,
    );
    const snap = await service1.awaitCompletion(missionId, CALLER);

    // The in-process result is STILL SUCCEEDED — we don't lie about what
    // happened in memory. The mission genuinely succeeded.
    expect(snap.status).toBe('SUCCEEDED');
    expect(snap.terminal).toBe(true);
    expect(snap.result?.status).toBe('success');

    // G7-15B-H1: BUT the caller can observe that the durable record does NOT
    // confirm this outcome. The failureMessage is appended with a
    // persistence warning (the in-process status is unchanged).
    expect(snap.failureMessage).toBeDefined();
    expect(snap.failureMessage).toContain('persistence warning');
    expect(snap.failureMessage).toContain('does not confirm this outcome');
    expect(snap.failureMessage).toContain('OUTCOME_UNCONFIRMED');

    // Verify the fault was actually injected (write #2 threw).
    expect(store1.lastWriteError).not.toBeNull();
    expect(store1.lastWriteError?.message).toContain('injected fault');
    expect(store1.getWriteCount()).toBe(2); // initial ACCEPTED + terminal attempt
    service1.close();
  }, 10_000);

  it('H1-04: Restart after terminal-write failure does NOT fabricate a confirmed mission failure', async () => {
    // Phase 1: mission succeeds in-process, but the terminal write fails.
    const store1 = new FaultInjectingHistoryStore({ dir: historyDir });
    store1.configureFault({ failOnWriteNumber: 2 });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a report on topic D.' },
      CALLER,
    );
    const snap = await service1.awaitCompletion(missionId, CALLER);
    // In-process: SUCCEEDED (with persistence warning).
    expect(snap.status).toBe('SUCCEEDED');
    expect(snap.failureMessage).toContain('persistence warning');
    service1.close();

    // Verify the persisted file on disk is still the initial ACCEPTED record
    // (the terminal write failed, so the stale non-terminal record remains).
    const files = readdirSync(historyDir).filter((f) => f.endsWith('.mission.json'));
    expect(files.length).toBe(1);
    const raw = readFileSync(join(historyDir, files[0]), 'utf8');
    const persisted = JSON.parse(raw);
    expect(persisted.status).toBe('ACCEPTED'); // stale non-terminal record

    // Phase 2: restart. The recovery should find the stale ACCEPTED record
    // and recover it as OUTCOME_UNCONFIRMED — NOT as FAILED.
    //
    // G7-15B-H1: this is the core truthfulness fix. The old G7-15B behavior
    // would have rewritten this to FAILED / RUNTIME_FAILURE — fabricating a
    // confirmed mission failure when the mission may have actually succeeded
    // (the in-process result WAS SUCCEEDED; only the terminal write failed).
    // The new behavior truthfully communicates "outcome unknown."
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const recovered = service2.get(missionId, CALLER);
    expect(recovered.status).toBe('OUTCOME_UNCONFIRMED');
    expect(recovered.terminal).toBe(true);
    expect(recovered.failureClass).toBe('OUTCOME_UNCONFIRMED');
    expect(recovered.failureMessage).toContain('could not be confirmed');
    // CRITICAL: the recovery must NOT claim the mission FAILED.
    expect(recovered.status).not.toBe('FAILED');
    expect(recovered.failureClass).not.toBe('RUNTIME_FAILURE');
    // CRITICAL: the recovery must NOT fabricate a MissionResult.
    expect(recovered.result).toBeUndefined();
    service2.close();

    // Verify the recovery was persisted (subsequent restarts see OUTCOME_UNCONFIRMED).
    const raw2 = readFileSync(join(historyDir, files[0]), 'utf8');
    const persisted2 = JSON.parse(raw2);
    expect(persisted2.status).toBe('OUTCOME_UNCONFIRMED');
  }, 10_000);

  it('H1-05: A genuinely interrupted mission is not displayed as RUNNING after restart', async () => {
    // Phase 1: start a hanging mission. The mission is RUNNING when we
    // "die." The persisted record is ACCEPTED (initial write succeeded,
    // terminal write never happened because the mission never completed).
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 60_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeHangingReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a long report that never completes.' },
      CALLER,
    );
    await new Promise((r) => setTimeout(r, 500));
    const snap1 = service1.get(missionId, CALLER);
    expect(snap1.status).toBe('RUNNING');
    service1.close();

    // Phase 2: restart. The mission must NOT be RUNNING (no active executor).
    // It must be terminal. The truthful representation is OUTCOME_UNCONFIRMED
    // (we cannot confirm the outcome; the mission MAY have completed before
    // the process stopped, OR may have been genuinely interrupted).
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 60_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const recovered = service2.get(missionId, CALLER);
    expect(recovered.status).not.toBe('RUNNING');
    expect(recovered.status).not.toBe('ACCEPTED');
    expect(recovered.terminal).toBe(true);
    expect(recovered.status).toBe('OUTCOME_UNCONFIRMED');
    service2.close();
  }, 15_000);

  it('H1-06: Mission list and detail endpoints agree on recovered status', async () => {
    // Create one SUCCEEDED mission (normal persistence) + one mission where
    // the terminal write fails (recovers as OUTCOME_UNCONFIRMED).
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId: succId } = service1.start(
      { outcome: 'Write report on topic E.', label: 'succeeded' },
      CALLER,
    );
    await service1.awaitCompletion(succId, CALLER);
    service1.close();

    // Phase 1b: a mission whose terminal write fails.
    const store1b = new FaultInjectingHistoryStore({ dir: historyDir });
    store1b.configureFault({ failOnWriteNumber: 2 });
    const service1b = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1b,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId: unconfirmedId } = service1b.start(
      { outcome: 'Write report on topic F.', label: 'unconfirmed' },
      CALLER,
    );
    await service1b.awaitCompletion(unconfirmedId, CALLER);
    service1b.close();

    // Phase 2: restart. List + detail must agree.
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const list = service2.listMissions(CALLER, { limit: 100 });
    expect(list.missions.length).toBe(2);

    const succSummary = list.missions.find((m) => m.missionId === succId)!;
    const unconfirmedSummary = list.missions.find((m) => m.missionId === unconfirmedId)!;
    expect(succSummary.status).toBe('SUCCEEDED');
    expect(succSummary.terminal).toBe(true);
    expect(unconfirmedSummary.status).toBe('OUTCOME_UNCONFIRMED');
    expect(unconfirmedSummary.terminal).toBe(true);

    // Detail must match the list summaries.
    const succDetail = service2.get(succId, CALLER);
    const unconfirmedDetail = service2.get(unconfirmedId, CALLER);
    expect(succDetail.status).toBe(succSummary.status);
    expect(succDetail.terminal).toBe(succSummary.terminal);
    expect(unconfirmedDetail.status).toBe(unconfirmedSummary.status);
    expect(unconfirmedDetail.terminal).toBe(unconfirmedSummary.terminal);
    service2.close();
  }, 15_000);

  it('H1-07: Previously persisted verification and artifact metadata are not fabricated or corrupted', async () => {
    // Create a SUCCEEDED mission with a verified artifact. The artifact
    // metadata (path + verified + bytes) is persisted in the terminal record.
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a report on the artifact.' },
      CALLER,
    );
    await service1.awaitCompletion(missionId, CALLER);
    const artifactsBefore = await service1.getArtifacts(missionId, CALLER);
    expect(artifactsBefore.length).toBeGreaterThan(0);
    const outputBefore = artifactsBefore.find((a) => a.path === 'output.md')!;
    expect(outputBefore.verified).toBe(true);
    expect(outputBefore.bytes).toBeGreaterThan(0);
    service1.close();

    // Verify the persisted record contains the artifact metadata.
    const files = readdirSync(historyDir).filter((f) => f.endsWith('.mission.json'));
    expect(files.length).toBe(1);
    const raw = readFileSync(join(historyDir, files[0]), 'utf8');
    const persisted = JSON.parse(raw);
    expect(persisted.status).toBe('SUCCEEDED');
    expect(persisted.artifacts).toBeDefined();
    expect(persisted.artifacts.length).toBe(1);
    expect(persisted.artifacts[0].path).toBe('output.md');
    expect(persisted.artifacts[0].verified).toBe(true);
    expect(persisted.artifacts[0].bytes).toBe(outputBefore.bytes);

    // Phase 2: restart. The artifact metadata is preserved (path + verified
    // + bytes). The content is NOT available (workspace gone — truthful).
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const artifactsAfter = await service2.getArtifacts(missionId, CALLER);
    expect(artifactsAfter.length).toBe(1);
    const outputAfter = artifactsAfter.find((a) => a.path === 'output.md')!;
    expect(outputAfter.verified).toBe(true);
    expect(outputAfter.bytes).toBe(outputBefore.bytes);
    expect(outputAfter.content).toBeUndefined(); // content NOT available after restart
    service2.close();
  }, 10_000);

  it('H1-08: No secrets appear in recovery records, logs, or API responses', async () => {
    // Submit a mission whose outcome contains a sentinel secret. The
    // MissionService should scrub it before persistence. Verify:
    //   - The persisted file does NOT contain the sentinel.
    //   - The API snapshot (get) does NOT contain the sentinel in the
    //     goalOutcome (it's scrubbed via toSnapshot → goalOutcome is the raw
    //     in-process value; but the PERSISTED goalOutcome is scrubbed).
    //   - The recovered snapshot (after restart) does NOT contain the
    //     sentinel (it's read from the scrubbed persisted record).
    const SENTINEL = 'ghp_G715BH1_SENTINEL_SECRET_VALUE_9f3a7c2d_extra_padding_1234';
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: `Write a report. The secret is ${SENTINEL}.` },
      CALLER,
    );
    await service1.awaitCompletion(missionId, CALLER);
    service1.close();

    // Verify the persisted file does NOT contain the sentinel.
    const files = readdirSync(historyDir).filter((f) => f.endsWith('.mission.json'));
    expect(files.length).toBe(1);
    const raw = readFileSync(join(historyDir, files[0]), 'utf8');
    expect(raw).not.toContain(SENTINEL);
    expect(raw).toContain('[REDACTED]');

    // Phase 2: restart. The recovered snapshot's goalOutcome is read from
    // the scrubbed persisted record — no sentinel.
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const recovered = service2.get(missionId, CALLER);
    expect(recovered.goalOutcome).not.toContain(SENTINEL);
    expect(recovered.goalOutcome).toContain('[REDACTED]');
    expect(recovered.failureMessage ?? '').not.toContain(SENTINEL);
    service2.close();
  }, 10_000);
});
