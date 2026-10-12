/**
 * PILOT-003 R4.1 — Active Mission Progress Recovery tests.
 *
 * Tests the evidence-based next-action guidance and productive loop recovery:
 *   1. Mission state with unverified conditions triggers specific guidance.
 *   2. Repeated build commands are detected and warned about.
 *   3. Build-succeeded-but-server-not-started → directive to start server.
 *   4. HTTP-not-verified → directive to verify HTTP.
 *   5. All conditions met → no guidance (worker can proceed).
 *   6. Stagnation with repeated actions → specific warning, not generic.
 */

import { describe, expect, it } from 'vitest';

import type { WorkerGenome } from '../../src/contracts/core.js';
import { WorkerAgent } from '../../src/worker/worker-agent.js';
import {
  deriveAcceptanceContract,
  verifyAcceptanceContract,
  buildMissionStateSummary,
} from '../../src/worker/acceptance-contract.js';
import { freshEvidence } from '../../src/worker/completion-policy.js';

const seGenome: WorkerGenome = {
  identity: { id: 'se-1', displayName: 'SE' }, role: 'SE', objective: 'x', model: 'default',
  skills: ['code-execution'], tools: ['openbot:shell-execution', 'openbot:workspace-files'],
  computer: { required: true, browser: false, shell: true, workspace: true },
  memory: 'none', budget: { maxUsd: 100, maxTier: 'default' }, autonomy: 'autonomous',
};

function makeAgent(): WorkerAgent {
  return new WorkerAgent({
    genome: seGenome,
    reasoning: { name: 'stub', async reason() { return { text: '{"action":"finish","summary":"x"}' }; } },
    computer: null,
    taskBrief: 'test',
    maxSteps: 5,
  });
}

describe('PILOT-003 R4.1 — Active Next-Action Guidance', () => {
  const agent = makeAgent();
  // Access private methods via any-cast (test-only).
  const buildGuidance = (state: string, scratchpad: string[], steps: number) =>
    (agent as any).buildNextActionGuidance(state, scratchpad, steps) as string;
  const findMilestone = (state: string) =>
    (agent as any).findNextUnverifiedMilestone(state) as string | null;
  const detectRepeat = (actions: { step: number; command: string }[]) =>
    (agent as any).detectRepeatedCommand(actions) as string | null;
  const extractActions = (scratchpad: string[], count: number) =>
    (agent as any).extractRecentActions(scratchpad, count) as { step: number; command: string }[];

  it('provides directive to start server when build is verified but server is not', () => {
    const missionState = `MISSION STATE:
✓ Repository cloned (repo directory exists with .git)
✓ Dependencies installed (node_modules populated)
✓ Application built (build exit 0)
✗ Application started (no server detected)
✗ HTTP verified (no HTTP response)
✗ Browser tested (no browser evidence)
✗ Application delivered (no package)

REMAINING: application started, http verified, browser tested, application delivered.`;

    const guidance = buildGuidance(missionState, [], 0);
    expect(guidance).toContain('NEXT REQUIRED MILESTONE');
    expect(guidance).toContain('Start the application server');
    expect(guidance).not.toContain('Clone the repository');
    expect(guidance).not.toContain('Build the application');
  });

  it('provides directive to verify HTTP when server is started but HTTP not verified', () => {
    const missionState = `MISSION STATE:
✓ Repository cloned
✓ Dependencies installed
✓ Application built
✓ Application started (server listening)
✗ HTTP verified (no HTTP response)
✗ Browser tested`;

    const guidance = buildGuidance(missionState, [], 0);
    expect(guidance).toContain('Verify the running server responds over HTTP');
  });

  it('detects repeated build commands and warns about them', () => {
    const scratchpad = [
      'step 1: {"action":"run_command","command":"npm run build"} observation: ok',
      'step 2: {"action":"run_command","command":"ls -la"} observation: ok',
      'step 3: {"action":"run_command","command":"npm run build"} observation: ok',
    ];
    const actions = extractActions(scratchpad, 8);
    const repeat = detectRepeat(actions);
    expect(repeat).toBe('npm run build');
  });

  it('detects repeated commands with cwd prefix normalization', () => {
    const scratchpad = [
      'step 1: {"action":"run_command","command":"cd todomvc/examples/react && npm run build"} observation: ok',
      'step 2: {"action":"run_command","command":"cd todomvc/examples/react && ls -la"} observation: ok',
      'step 3: {"action":"run_command","command":"cd todomvc/examples/react && npm run build"} observation: ok',
    ];
    const actions = extractActions(scratchpad, 8);
    const repeat = detectRepeat(actions);
    expect(repeat).toBe('npm run build');
  });

  it('provides stagnation warning with repeated command detection', () => {
    const missionState = `MISSION STATE:
✓ Application built (build exit 0)
✗ Application started (no server detected)`;

    const scratchpad = [
      'step 1: {"action":"run_command","command":"npm run build"} observation: ok',
      'step 2: {"action":"run_command","command":"ls -la"} observation: ok',
      'step 3: {"action":"run_command","command":"npm run build"} observation: ok',
    ];

    const guidance = buildGuidance(missionState, scratchpad, 6);
    expect(guidance).toContain('STAGNATION DETECTED');
    expect(guidance).toContain('You are repeating: "npm run build"');
    expect(guidance).toContain('do NOT repeat it');
    expect(guidance).toContain('NEXT REQUIRED MILESTONE');
    expect(guidance).toContain('Start the application server');
  });

  it('does NOT provide guidance when all conditions are met', () => {
    const missionState = `MISSION STATE:
✓ Repository cloned
✓ Dependencies installed
✓ Application built
✓ Application started
✓ HTTP verified
✓ Browser tested
✓ Application delivered

ALL CONDITIONS MET — you may call finish.`;

    const guidance = buildGuidance(missionState, [], 0);
    expect(guidance).toBe('');
  });

  it('does NOT provide guidance when no mission state (no acceptance contract)', () => {
    const guidance = buildGuidance('', [], 0);
    expect(guidance).toBe('');
  });

  it('provides guidance even before stagnation threshold when conditions are unverified', () => {
    const missionState = `MISSION STATE:
✗ Application started (no server detected)`;

    // stepsSinceProgress = 2 (below threshold of 5)
    const guidance = buildGuidance(missionState, [], 2);
    // Should still provide milestone guidance (just not the stagnation warning)
    expect(guidance).toContain('NEXT REQUIRED MILESTONE');
    expect(guidance).toContain('Start the application server');
    expect(guidance).not.toContain('STAGNATION');
  });

  it('findNextUnverifiedMilestone returns null when all verified', () => {
    const missionState = `MISSION STATE:
✓ All conditions met

ALL CONDITIONS MET`;
    const milestone = findMilestone(missionState);
    expect(milestone).toBeNull();
  });
});

describe('PILOT-003 R4.1 — Acceptance Contract Active Evaluation', () => {
  it('derives contract and builds mission state for a deploy-from-github goal', () => {
    const goal = {
      outcome: 'Clone https://github.com/tastejs/todomvc.git and deploy it',
      context: 'git clone, npm install, npm run build, npm start, browser test',
    };
    const contract = deriveAcceptanceContract(goal);
    expect(contract.missionType).toBe('deploy-from-github');

    // Simulate worker state: cloned + installed + built, but NOT started.
    const evidence = freshEvidence(seGenome, 'test brief');
    evidence.repoCloned = true;
    evidence.dependenciesInstalled = true;
    evidence.lastBuildExitCode = 0;
    // lastStartResult is null — server was never started.

    const ctx = {
      workspaceFiles: ['todomvc/package.json', 'todomvc/examples/react/dist/index.html'],
      lastTestExitCode: null,
      lastBuildExitCode: evidence.lastBuildExitCode,
      lastStartResult: null,
      browserEvidence: { screenshotTaken: false, interactionsPassed: 0 },
      deliveryPackage: null,
      repoCloned: evidence.repoCloned,
      dependenciesInstalled: evidence.dependenciesInstalled,
    };
    const verified = verifyAcceptanceContract(contract, ctx);
    const summary = buildMissionStateSummary(verified.contract);

    // The summary should show what's done and what's missing.
    expect(summary).toContain('✓ Repository cloned');
    expect(summary).toContain('✓ Dependencies installed');
    expect(summary).toContain('✓ Application built');
    expect(summary).toContain('✗ Application started');
    expect(summary).toContain('✗ HTTP verified');
    expect(summary).toContain('REMAINING:');
  });
});
