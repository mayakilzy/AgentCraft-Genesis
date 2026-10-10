/**
 * G7-17 Step 0 — Safety guard: reject root deletion in cleanupWorkspace().
 *
 * Verifies that cleanupWorkspace() cannot delete OPENBOT_ROOT_DIR itself
 * or a symlink that resolves to OPENBOT_ROOT_DIR.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MissionService } from '../../src/gateway/mission-service.js';
import { FileMissionHistoryStore } from '../../src/mission/mission-history-store.js';
import { MemoryRuntime } from '../../src/runtime/memory-computer.js';
import type { CallerIdentity } from '../../src/gateway/types.js';

const CALLER: CallerIdentity = {
  callerId: 'g7-17-caller',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 50,
  maxMissionTimeoutMs: 60_000,
};

function makeSuccessReasoning() {
  let step = 0;
  return {
    name: 'g7-17-reasoning',
    async reason() {
      step += 1;
      if (step === 1) return { text: JSON.stringify({ action: 'write_file', path: 'output.md', contents: '# Test\n' }) };
      return { text: JSON.stringify({ action: 'finish', summary: 'done', artifacts: ['output.md'] }) };
    },
  };
}

let tempDir: string;
let historyDir: string;
let workspaceRoot: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'g7-17-'));
  historyDir = join(tempDir, 'missions');
  workspaceRoot = join(tempDir, 'workspaces');
  mkdirSync(workspaceRoot, { recursive: true });
  process.env.OPENBOT_ROOT_DIR = workspaceRoot;
});

afterEach(() => {
  delete process.env.OPENBOT_ROOT_DIR;
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('G7-17 Step 0 — Root deletion guard', () => {
  it('SG-01: workspaceDir === OPENBOT_ROOT_DIR — root NOT deleted', async () => {
    // Set workspaceDir to exactly the root — should be rejected.
    const service = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: new FileMissionHistoryStore({ dir: historyDir }),
      reasoningFactory: () => makeSuccessReasoning() as never,
      sweepIntervalMs: 0,
      terminalMissionRetentionMs: 0,
      runtimeFactory: () => {
        const runtime = new MemoryRuntime();
        return {
          runtime: runtime as never,
          computers: runtime.computers as never,
          workspaceDir: workspaceRoot, // === root!
        };
      },
    });
    const { missionId } = service.start({ outcome: 'Root guard test.' }, CALLER);
    await service.awaitCompletion(missionId, CALLER);
    service.sweepTerminalMissions();
    // Root must NOT be deleted.
    expect(existsSync(workspaceRoot)).toBe(true);
    service.close();
  }, 10_000);

  it('SG-02: workspaceDir under root (valid) — workspace deleted, root preserved', async () => {
    const wsDir = join(workspaceRoot, 'mission-valid');
    mkdirSync(wsDir, { recursive: true });
    const service = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: new FileMissionHistoryStore({ dir: historyDir }),
      reasoningFactory: () => makeSuccessReasoning() as never,
      sweepIntervalMs: 0,
      terminalMissionRetentionMs: 0,
      runtimeFactory: () => {
        const runtime = new MemoryRuntime();
        return {
          runtime: runtime as never,
          computers: runtime.computers as never,
          workspaceDir: wsDir,
        };
      },
    });
    const { missionId } = service.start({ outcome: 'Valid cleanup test.' }, CALLER);
    await service.awaitCompletion(missionId, CALLER);
    service.sweepTerminalMissions();
    // Workspace deleted, root preserved.
    expect(existsSync(wsDir)).toBe(false);
    expect(existsSync(workspaceRoot)).toBe(true);
    service.close();
  }, 10_000);

  it('SG-03: workspaceDir outside root — rejected, not deleted', async () => {
    const externalDir = join(tempDir, 'external');
    mkdirSync(externalDir, { recursive: true });
    const service = new MissionService({
      defaultMissionTimeoutMs: 5_000,
      missionHistoryStore: new FileMissionHistoryStore({ dir: historyDir }),
      reasoningFactory: () => makeSuccessReasoning() as never,
      sweepIntervalMs: 0,
      terminalMissionRetentionMs: 0,
      runtimeFactory: () => {
        const runtime = new MemoryRuntime();
        return {
          runtime: runtime as never,
          computers: runtime.computers as never,
          workspaceDir: externalDir, // outside root!
        };
      },
    });
    const { missionId } = service.start({ outcome: 'External path test.' }, CALLER);
    await service.awaitCompletion(missionId, CALLER);
    service.sweepTerminalMissions();
    // External dir must NOT be deleted.
    expect(existsSync(externalDir)).toBe(true);
    service.close();
  }, 10_000);
});
