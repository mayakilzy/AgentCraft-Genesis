/**
 * G7-15B — Durable Mission History acceptance tests.
 *
 * Verifies the 9 acceptance criteria from the G7-15B spec:
 *   B4-01: SUCCEEDED mission survives Gateway restart.
 *   B4-02: FAILED mission survives Gateway restart.
 *   B4-03: Interrupted RUNNING mission is not falsely presented as active after restart.
 *   B4-04: Mission detail and list endpoints return consistent recovered data.
 *   B4-05: Existing artifact and verification records remain intact.
 *   B4-06: Concurrent mission writes do not corrupt records.
 *   B4-07: Truncated or malformed persistence data is handled predictably.
 *   B4-08: Sensitive values do not leak into persisted records.
 *   B4-09: Existing conversation and project persistence remains unaffected.
 *
 * "Restart" is simulated by constructing a fresh MissionService pointing at
 * the same history store directory — exactly what happens when the gateway
 * process dies and restarts. The in-process registry is empty in the new
 * instance; the history index is loaded from disk by recoverHistory().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MissionService } from '../../src/gateway/mission-service.js';
import { FileMissionHistoryStore, MISSION_HISTORY_SCHEMA_VERSION } from '../../src/mission/mission-history-store.js';
import { FileConversationStore } from '../../src/conversation/conversation-store.js';
import { FileProjectStore } from '../../src/project/project-store.js';
import type { CallerIdentity } from '../../src/gateway/types.js';

const CALLER: CallerIdentity = {
  callerId: 'g7-15b-caller',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 5,
  maxMissionTimeoutMs: 60_000,
};

// A deterministic reasoning provider that writes a known file and finishes.
// Used to produce SUCCEEDED missions.
function makeSuccessReasoning() {
  let step = 0;
  return {
    name: 'g7-15b-success-reasoning',
    async reason() {
      step += 1;
      if (step === 1) {
        return {
          text: JSON.stringify({
            action: 'write_file',
            path: 'output.md',
            contents: '# G7-15B test artifact\n',
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

// A deterministic reasoning provider that finishes without writing any file.
// Used to produce FAILED missions (the verification loop rejects no-artifact).
function makeFailureReasoning() {
  return {
    name: 'g7-15b-failure-reasoning',
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

// A reasoning provider that NEVER finishes (stays RUNNING until the mission
// timeout). Used to simulate an interrupted mission. We persist the initial
// ACCEPTED record, then "kill the process" by constructing a fresh
// MissionService — the interrupted mission should recover as FAILED.
function makeHangingReasoning() {
  return {
    name: 'g7-15b-hanging-reasoning',
    async reason() {
      // Sleep forever — the mission will time out. We construct the fresh
      // MissionService BEFORE the timeout fires, so the in-process record
      // is still RUNNING when we "restart".
      await new Promise(() => { /* never resolves */ });
      return { text: '{}' };
    },
  };
}

let tempDir: string;
let historyDir: string;
let conversationDir: string;
let projectDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'g7-15b-'));
  historyDir = join(tempDir, 'missions');
  conversationDir = join(tempDir, 'conversations');
  projectDir = join(tempDir, 'projects');
});

afterEach(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('G7-15B — Durable Mission History', () => {
  it('B4-01: SUCCEEDED mission survives Gateway restart', async () => {
    // Phase 1: start a mission, let it succeed, then "die" (drop the service).
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a report summarizing the G7-15B test.' },
      CALLER,
    );
    const snap = await service1.awaitCompletion(missionId, CALLER);
    expect(snap.status).toBe('SUCCEEDED');
    expect(snap.terminal).toBe(true);
    service1.close();

    // Phase 2: "restart" — construct a fresh MissionService pointing at the
    // same history directory. The in-process registry is empty; the history
    // index should have the SUCCEEDED record.
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const recovered = service2.get(missionId, CALLER);
    expect(recovered.status).toBe('SUCCEEDED');
    expect(recovered.terminal).toBe(true);
    expect(recovered.missionId).toBe(missionId);
    expect(recovered.callerId).toBe(CALLER.callerId);
    expect(recovered.result?.status).toBe('success');
    service2.close();
  }, 15_000);

  it('B4-02: FAILED mission survives Gateway restart', async () => {
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeFailureReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a report on the dataset.' },
      CALLER,
    );
    const snap = await service1.awaitCompletion(missionId, CALLER);
    expect(snap.status).toBe('FAILED');
    expect(snap.terminal).toBe(true);
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
  }, 15_000);

  it('B4-03: Interrupted RUNNING mission is not falsely presented as active after restart', async () => {
    // Phase 1: start a mission with a hanging reasoning provider. The
    // mission will be RUNNING. We persist the initial ACCEPTED record,
    // then "die" by constructing a fresh MissionService WITHOUT awaiting
    // completion (the in-process record stays RUNNING).
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 60_000, // long timeout — we will not wait
      missionHistoryStore: store1,
      reasoningFactory: () => makeHangingReasoning() as never,
    });
    const { missionId } = service1.start(
      { outcome: 'Write a long report that never completes.' },
      CALLER,
    );
    // Give the orchestrator a moment to register the mission + persist the
    // initial ACCEPTED record.
    await new Promise((r) => setTimeout(r, 500));
    // Verify the mission is RUNNING in process 1.
    const snap1 = service1.get(missionId, CALLER);
    expect(snap1.status).toBe('RUNNING');
    // "Die" — do NOT await completion. The persisted record is still ACCEPTED
    // (the orchestrator never reached terminal). We do call close() to
    // release the sweeper timer so the test process can exit cleanly.
    service1.close();

    // Phase 2: "restart". The fresh service's recoverHistory() should find
    // the ACCEPTED record and rewrite it to FAILED (RUNTIME_FAILURE).
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 60_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const recovered = service2.get(missionId, CALLER);
    // The mission must NOT be RUNNING — it must be FAILED (interrupted).
    expect(recovered.status).toBe('FAILED');
    expect(recovered.terminal).toBe(true);
    expect(recovered.failureClass).toBe('RUNTIME_FAILURE');
    expect(recovered.failureMessage).toContain('interrupted');
    expect(recovered.result?.status).toBe('failure');
    // Never invent success — the result summary must reflect failure.
    expect(recovered.result?.summary).toContain('interrupted');
    service2.close();
  }, 15_000);

  it('B4-04: Mission detail and list endpoints return consistent recovered data', async () => {
    // Produce one SUCCEEDED + one FAILED mission in process 1.
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const { missionId: succId } = service1.start(
      { outcome: 'Write a report on topic A.', label: 'succeeded-mission' },
      CALLER,
    );
    await service1.awaitCompletion(succId, CALLER);
    service1.close();

    const store1b = new FileMissionHistoryStore({ dir: historyDir });
    const service1b = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1b,
      reasoningFactory: () => makeFailureReasoning() as never,
    });
    const { missionId: failId } = service1b.start(
      { outcome: 'Write a report on topic B.', label: 'failed-mission' },
      CALLER,
    );
    await service1b.awaitCompletion(failId, CALLER);
    service1b.close();

    // Phase 2: restart. List should contain both missions. Detail should
    // match the list summaries.
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const list = service2.listMissions(CALLER, { limit: 100 });
    expect(list.missions.length).toBe(2);
    const ids = list.missions.map((m) => m.missionId);
    expect(ids).toContain(succId);
    expect(ids).toContain(failId);

    // The list summaries should match the detail snapshots.
    const succSummary = list.missions.find((m) => m.missionId === succId)!;
    const failSummary = list.missions.find((m) => m.missionId === failId)!;
    expect(succSummary.status).toBe('SUCCEEDED');
    expect(succSummary.terminal).toBe(true);
    expect(succSummary.label).toBe('succeeded-mission');
    expect(failSummary.status).toBe('FAILED');
    expect(failSummary.terminal).toBe(true);
    expect(failSummary.label).toBe('failed-mission');

    const succDetail = service2.get(succId, CALLER);
    const failDetail = service2.get(failId, CALLER);
    expect(succDetail.status).toBe(succSummary.status);
    expect(succDetail.terminal).toBe(succSummary.terminal);
    expect(succDetail.acceptedAt).toBe(succSummary.acceptedAt);
    expect(failDetail.status).toBe(failSummary.status);
    expect(failDetail.terminal).toBe(failSummary.terminal);
    expect(failDetail.acceptedAt).toBe(failSummary.acceptedAt);
    service2.close();
  }, 15_000);

  it('B4-05: Existing artifact and verification records remain intact', async () => {
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
    const snap = await service1.awaitCompletion(missionId, CALLER);
    expect(snap.status).toBe('SUCCEEDED');
    // Capture the artifacts before restart.
    const artifactsBefore = await service1.getArtifacts(missionId, CALLER);
    expect(artifactsBefore.length).toBeGreaterThan(0);
    const outputBefore = artifactsBefore.find((a) => a.path === 'output.md')!;
    expect(outputBefore).toBeDefined();
    expect(outputBefore.verified).toBe(true);
    expect(outputBefore.bytes).toBeGreaterThan(0);
    service1.close();

    // Phase 2: restart. The artifact metadata should be preserved (path +
    // verified + bytes). The content is NOT available (workspace gone).
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const artifactsAfter = await service2.getArtifacts(missionId, CALLER);
    expect(artifactsAfter.length).toBe(artifactsBefore.length);
    const outputAfter = artifactsAfter.find((a) => a.path === 'output.md')!;
    expect(outputAfter).toBeDefined();
    expect(outputAfter.verified).toBe(true);
    expect(outputAfter.bytes).toBe(outputBefore.bytes);
    // Content is NOT available after restart — truthful (workspace gone).
    expect(outputAfter.content).toBeUndefined();
    service2.close();
  }, 15_000);

  it('B4-06: Concurrent mission writes do not corrupt records', async () => {
    // Start 10 missions concurrently in the same process. Each gets its own
    // history file (one per missionId). Verify all 10 records are well-formed
    // after completion. Use a caller with a higher concurrency limit.
    const CONCURRENT_CALLER: CallerIdentity = {
      callerId: 'g7-15b-concurrent-caller',
      allowedOperations: ['mission:submit'],
      maxActiveMissions: 50,
      maxMissionTimeoutMs: 60_000,
    };
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 10_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
      maxActiveMissionsGlobal: 50,
    });
    const missionIds: string[] = [];
    const startPromises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      const { missionId, status } = service1.start(
        { outcome: `Write report number ${i}.`, label: `concurrent-${i}` },
        CONCURRENT_CALLER,
      );
      expect(['ACCEPTED', 'RUNNING']).toContain(status);
      missionIds.push(missionId);
      startPromises.push(service1.awaitCompletion(missionId, CONCURRENT_CALLER).then(() => undefined));
    }
    await Promise.all(startPromises);
    service1.close();

    // Verify all 10 files exist on disk and are valid JSON with the right schema.
    const files = readdirSync(historyDir).filter((f) => f.endsWith('.mission.json'));
    expect(files.length).toBe(10);
    for (const f of files) {
      const raw = readFileSync(join(historyDir, f), 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.schemaVersion).toBe(MISSION_HISTORY_SCHEMA_VERSION);
      expect(parsed.status).toBe('SUCCEEDED');
      expect(parsed.callerId).toBe(CONCURRENT_CALLER.callerId);
    }

    // Restart and verify all 10 are recoverable.
    const store2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 10_000,
      missionHistoryStore: store2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const list = service2.listMissions(CONCURRENT_CALLER, { limit: 100 });
    expect(list.missions.length).toBe(10);
    expect(list.missions.every((m) => m.status === 'SUCCEEDED')).toBe(true);
    service2.close();
  }, 30_000);

  it('B4-07: Truncated or malformed persistence data is handled predictably', async () => {
    // Write a corrupt mission file directly to disk. The store should skip it
    // (return undefined from read) and the service should start without error.
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    // Write a valid mission first so the directory exists.
    store1.write({
      schemaVersion: MISSION_HISTORY_SCHEMA_VERSION,
      missionId: 'valid-mission-00000000',
      callerId: CALLER.callerId,
      status: 'SUCCEEDED',
      acceptedAt: new Date().toISOString(),
      goalOutcome: 'valid mission',
    });
    // Now write a corrupt file (truncated JSON).
    writeFileSync(join(historyDir, 'corrupt-mission-00000000.mission.json'), '{"schemaVersion":1,"missionId":"corrupt-mis', 'utf8');
    // And a file with wrong schemaVersion.
    writeFileSync(
      join(historyDir, 'wrong-schema-00000000.mission.json'),
      JSON.stringify({ schemaVersion: 99, missionId: 'wrong-schema-00000000', callerId: CALLER.callerId, status: 'SUCCEEDED', acceptedAt: new Date().toISOString(), goalOutcome: 'wrong' }),
      'utf8',
    );

    // The service should start without error and load only the valid record.
    const service = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const list = service.listMissions(CALLER, { limit: 100 });
    // Only the valid mission should be in the list. The corrupt + wrong-schema
    // files should be skipped (preserved on disk for manual recovery).
    expect(list.missions.length).toBe(1);
    expect(list.missions[0].missionId).toBe('valid-mission-00000000');
    service.close();

    // Verify the corrupt files are PRESERVED on disk (not silently deleted).
    expect(existsSync(join(historyDir, 'corrupt-mission-00000000.mission.json'))).toBe(true);
    expect(existsSync(join(historyDir, 'wrong-schema-00000000.mission.json'))).toBe(true);
  }, 10_000);

  it('B4-08: Sensitive values do not leak into persisted records', async () => {
    // Submit a mission whose outcome contains a sentinel secret. The
    // MissionService should scrub it before persistence (via scrubSecrets).
    const store1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: store1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });
    const SENTINEL_SECRET = 'ghp_G715B_SENTINEL_SECRET_VALUE_9f3a7c2d';
    const { missionId } = service1.start(
      { outcome: `Write a report. The secret is ${SENTINEL_SECRET}.` },
      CALLER,
    );
    await service1.awaitCompletion(missionId, CALLER);
    service1.close();

    // Read the persisted file directly from disk and verify the sentinel
    // is NOT present.
    const files = readdirSync(historyDir).filter((f) => f.endsWith('.mission.json'));
    expect(files.length).toBe(1);
    const raw = readFileSync(join(historyDir, files[0]), 'utf8');
    expect(raw).not.toContain(SENTINEL_SECRET);
    // The scrubbed placeholder should be present instead.
    expect(raw).toContain('[REDACTED]');
  }, 10_000);

  it('B4-09: Existing conversation and project persistence remains unaffected', async () => {
    // Create a conversation + project in separate stores, then create a
    // mission history. Restart. Verify the conversation + project are intact
    // AND the mission history is intact — the three persistence layers are
    // independent.
    const convStore1 = new FileConversationStore({ dir: conversationDir });
    const projStore1 = new FileProjectStore({ dir: projectDir });
    const histStore1 = new FileMissionHistoryStore({ dir: historyDir });
    const service1 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: histStore1,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });

    // Create a conversation + project.
    const conv = convStore1.createConversation(CALLER.callerId, {
      title: 'G7-15B conversation',
      firstMessage: 'hello',
    });
    const proj = projStore1.createProject(CALLER.callerId, {
      name: 'G7-15B project',
      description: 'test project',
    });

    // Create a mission.
    const { missionId } = service1.start(
      { outcome: 'Write a report on the conversation and project.' },
      CALLER,
    );
    await service1.awaitCompletion(missionId, CALLER);
    service1.close();

    // "Restart" — new store instances pointing at the same dirs.
    const convStore2 = new FileConversationStore({ dir: conversationDir });
    const projStore2 = new FileProjectStore({ dir: projectDir });
    const histStore2 = new FileMissionHistoryStore({ dir: historyDir });
    const service2 = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: histStore2,
      reasoningFactory: () => makeSuccessReasoning() as never,
    });

    // Conversation survives.
    const convRecovered = convStore2.getConversation(conv.conversationId, CALLER.callerId);
    expect(convRecovered.title).toBe('G7-15B conversation');
    const msgs = convStore2.getMessages(conv.conversationId, CALLER.callerId);
    expect(msgs.messages.length).toBe(1);
    expect(msgs.messages[0].content).toBe('hello');

    // Project survives.
    const projRecovered = projStore2.getProject(proj.projectId, CALLER.callerId);
    expect(projRecovered.name).toBe('G7-15B project');
    expect(projRecovered.description).toBe('test project');

    // Mission history survives.
    const missionRecovered = service2.get(missionId, CALLER);
    expect(missionRecovered.status).toBe('SUCCEEDED');
    expect(missionRecovered.missionId).toBe(missionId);
    service2.close();
  }, 15_000);
});
