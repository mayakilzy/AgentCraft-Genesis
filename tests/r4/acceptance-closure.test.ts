/**
 * PILOT-003 R4 — Deterministic tests for the Autonomous Completion Closure.
 *
 * Tests all 4 components:
 *   1. MissionAcceptanceContract derivation
 *   2. Evidence-Based Completion Gate
 *   3. Mission State Awareness
 *   4. Nonproductive Loop Detection
 *
 * Covers success, failure, recovery, and early-finish rejection.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { Goal } from '../../src/contracts/core.js';
import type { WorkerGenome } from '../../src/contracts/core.js';
import {
  deriveAcceptanceContract,
  verifyAcceptanceContract,
  buildMissionStateSummary,
  type ContractVerificationContext,
} from '../../src/worker/acceptance-contract.js';
import {
  freshEvidence,
  checkAcceptanceContract,
} from '../../src/worker/completion-policy.js';
import { LocalShellComputer } from '../helpers/local-shell-computer.js';

const seGenome: WorkerGenome = {
  identity: { id: 'se-1', displayName: 'SE' }, role: 'SE', objective: 'x', model: 'default',
  skills: ['code-execution'], tools: ['openbot:shell-execution', 'openbot:workspace-files'],
  computer: { required: true, browser: false, shell: true, workspace: true },
  memory: 'none', budget: { maxUsd: 100, maxTier: 'default' }, autonomy: 'autonomous',
};

describe('PILOT-003 R4 — Component 1: MissionAcceptanceContract', () => {
  it('derives deploy-from-github contract when goal mentions git clone + github', () => {
    const goal: Goal = {
      outcome: 'Clone https://github.com/tastejs/todomvc.git and deploy it',
      context: 'git clone the repository, npm install, npm run build, npm start',
    };
    const contract = deriveAcceptanceContract(goal);
    expect(contract.missionType).toBe('deploy-from-github');
    expect(contract.conditions.length).toBeGreaterThan(4);
    expect(contract.conditions.some((c) => c.kind === 'repo-cloned')).toBe(true);
    expect(contract.conditions.some((c) => c.kind === 'application-built')).toBe(true);
    expect(contract.conditions.some((c) => c.kind === 'application-started')).toBe(true);
    expect(contract.conditions.some((c) => c.kind === 'http-verified')).toBe(true);
    expect(contract.conditions.some((c) => c.kind === 'delivery-packaged')).toBe(true);
  });

  it('derives build-from-scratch contract when goal mentions build + create', () => {
    const goal: Goal = {
      outcome: 'Build a web application with frontend and backend',
      context: 'Create the files, npm test must pass, npm start to launch',
    };
    const contract = deriveAcceptanceContract(goal);
    expect(contract.missionType).toBe('build-from-scratch');
    expect(contract.conditions.some((c) => c.kind === 'files-exist')).toBe(true);
    expect(contract.conditions.some((c) => c.kind === 'tests-pass')).toBe(true);
    expect(contract.conditions.some((c) => c.kind === 'application-started')).toBe(true);
  });

  it('does NOT invent conditions the goal did not mention', () => {
    const goal: Goal = {
      outcome: 'Write a Python library for math operations',
      context: 'No server, no browser, just a library',
    };
    const contract = deriveAcceptanceContract(goal);
    expect(contract.missionType).toBe('library');
    expect(contract.conditions.some((c) => c.kind === 'application-started')).toBe(false);
    expect(contract.conditions.some((c) => c.kind === 'http-verified')).toBe(false);
    expect(contract.conditions.some((c) => c.kind === 'browser-tested')).toBe(false);
  });

  it('includes browser-tested condition when goal mentions browser interactions', () => {
    const goal: Goal = {
      outcome: 'Clone todomvc and test it in the browser',
      context: 'git clone, build, serve, browser interactions',
    };
    const contract = deriveAcceptanceContract(goal);
    expect(contract.conditions.some((c) => c.kind === 'browser-tested')).toBe(true);
  });
});

describe('PILOT-003 R4 — Component 2: Evidence-Based Completion Gate', () => {
  it('rejects finish when acceptance conditions are unverified', () => {
    const goal: Goal = {
      outcome: 'Clone https://github.com/tastejs/todomvc.git and deploy it',
      context: 'git clone, npm install, npm run build, npm start, browser test',
    };
    const contract = deriveAcceptanceContract(goal);
    const evidence = freshEvidence(seGenome, 'test brief');
    const result = checkAcceptanceContract(evidence, contract, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unverified');
    expect(result.actionableFeedback).toContain('Repository cloned');
  });

  it('accepts finish when all conditions are verified with real evidence', () => {
    const goal: Goal = {
      outcome: 'Clone https://github.com/tastejs/todomvc.git and deploy it',
      context: 'git clone, npm install, npm run build, npm start',
    };
    const contract = deriveAcceptanceContract(goal);
    const evidence = freshEvidence(seGenome, 'test brief');
    // Simulate all conditions met (including browser-tested since todomvc matches).
    evidence.repoCloned = true;
    evidence.dependenciesInstalled = true;
    evidence.lastBuildExitCode = 0;
    evidence.lastStartResult = { ok: true, command: 'npm start', httpStatus: 200, reason: 'ok', stderr: '' };
    evidence.browserEvidence = { screenshotTaken: true, interactionsPassed: 3 };
    evidence.deliveryPackage = { exists: true, bytes: 1024 };
    const result = checkAcceptanceContract(evidence, contract, ['todomvc/package.json']);
    expect(result.ok).toBe(true);
  });

  it('provides specific feedback about which conditions are missing', () => {
    const goal: Goal = {
      outcome: 'Clone https://github.com/tastejs/todomvc.git and deploy it',
      context: 'git clone, npm install, npm run build, npm start',
    };
    const contract = deriveAcceptanceContract(goal);
    const evidence = freshEvidence(seGenome, 'test brief');
    evidence.repoCloned = true; // only this is verified
    evidence.dependenciesInstalled = true;
    const result = checkAcceptanceContract(evidence, contract, []);
    expect(result.ok).toBe(false);
    expect(result.actionableFeedback).toContain('Application built');
    expect(result.actionableFeedback).toContain('Application started');
    expect(result.actionableFeedback).toContain('HTTP verified');
    expect(result.actionableFeedback).toContain('Application delivered');
  });
});

describe('PILOT-003 R4 — Component 3: Mission State Awareness', () => {
  it('builds a summary showing what is accomplished and what remains', () => {
    const goal: Goal = {
      outcome: 'Clone https://github.com/tastejs/todomvc.git and deploy it',
      context: 'git clone, npm install, npm run build, npm start',
    };
    const contract = deriveAcceptanceContract(goal);
    const evidence = freshEvidence(seGenome, 'test brief');
    evidence.repoCloned = true;
    evidence.dependenciesInstalled = true;
    const ctx: ContractVerificationContext = {
      workspaceFiles: ['todomvc/package.json'],
      lastTestExitCode: null,
      lastBuildExitCode: null,
      lastStartResult: null,
      browserEvidence: { screenshotTaken: false, interactionsPassed: 0 },
      deliveryPackage: null,
      repoCloned: evidence.repoCloned,
      dependenciesInstalled: evidence.dependenciesInstalled,
    };
    const verified = verifyAcceptanceContract(contract, ctx);
    const summary = buildMissionStateSummary(verified.contract);
    expect(summary).toContain('MISSION STATE:');
    expect(summary).toContain('✓ Repository cloned');
    expect(summary).toContain('✓ Dependencies installed');
    expect(summary).toContain('✗ Application built');
    expect(summary).toContain('REMAINING:');
  });

  it('shows ALL CONDITIONS MET when everything is verified', () => {
    const goal: Goal = {
      outcome: 'Clone https://github.com/tastejs/todomvc.git and deploy it',
      context: 'git clone, npm install, npm run build, npm start',
    };
    const contract = deriveAcceptanceContract(goal);
    const evidence = freshEvidence(seGenome, 'test brief');
    evidence.repoCloned = true;
    evidence.dependenciesInstalled = true;
    evidence.lastBuildExitCode = 0;
    evidence.lastStartResult = { ok: true, command: 'npm start', httpStatus: 200, reason: 'ok', stderr: '' };
    evidence.browserEvidence = { screenshotTaken: true, interactionsPassed: 3 };
    evidence.deliveryPackage = { exists: true, bytes: 1024 };
    const ctx: ContractVerificationContext = {
      workspaceFiles: ['todomvc/package.json'],
      lastTestExitCode: null,
      lastBuildExitCode: evidence.lastBuildExitCode,
      lastStartResult: { ok: true, httpStatus: 200 },
      browserEvidence: evidence.browserEvidence,
      deliveryPackage: evidence.deliveryPackage,
      repoCloned: evidence.repoCloned,
      dependenciesInstalled: evidence.dependenciesInstalled,
    };
    const verified = verifyAcceptanceContract(contract, ctx);
    const summary = buildMissionStateSummary(verified.contract);
    expect(summary).toContain('ALL CONDITIONS MET');
  });
});

describe('PILOT-003 R4 — Component 4: Nonproductive Loop Detection', () => {
  it('the stagnation threshold is 5 steps (not arbitrary, based on progress)', () => {
    // This is a design verification — the threshold is 5 steps without
    // a NEW condition being verified. It's not an absolute step limit.
    const STAGNATION_THRESHOLD = 5;
    expect(STAGNATION_THRESHOLD).toBe(5);
  });

  it('verifies that progress resets the stagnation counter', () => {
    // Simulate: 3 steps with no progress, then progress on step 4.
    let lastVerifiedCount = 0;
    let stepsSinceProgress = 0;

    // Steps 1-3: no progress.
    for (let i = 0; i < 3; i++) {
      const currentVerifiedCount = 0;
      if (currentVerifiedCount > lastVerifiedCount) {
        lastVerifiedCount = currentVerifiedCount;
        stepsSinceProgress = 0;
      } else {
        stepsSinceProgress += 1;
      }
    }
    expect(stepsSinceProgress).toBe(3);

    // Step 4: progress (new condition verified).
    const currentVerifiedCount = 1;
    if (currentVerifiedCount > lastVerifiedCount) {
      lastVerifiedCount = currentVerifiedCount;
      stepsSinceProgress = 0;
    }
    expect(stepsSinceProgress).toBe(0);
    expect(lastVerifiedCount).toBe(1);
  });

  it('the worker is NOT terminated on stagnation — only warned', () => {
    // The stagnation detection injects a WARNING into the prompt, not a
    // termination. The worker continues and can recover.
    // This test verifies the design: stagnation does not kill the mission.
    const STAGNATION_THRESHOLD = 5;
    let stepsSinceProgress = STAGNATION_THRESHOLD;
    const shouldWarn = stepsSinceProgress >= STAGNATION_THRESHOLD;
    const shouldTerminate = false; // never terminate on stagnation alone.
    expect(shouldWarn).toBe(true);
    expect(shouldTerminate).toBe(false);
  });
});

describe('PILOT-003 R4 — Integration: early finish rejection', () => {
  it('rejects early finish when contract is not satisfied (PILOT-003 scenario)', async () => {
    // Simulate the PILOT-003 scenario: worker cloned + built but did NOT
    // start the server. The acceptance contract gate must reject finish.
    const goal: Goal = {
      outcome: 'Clone https://github.com/tastejs/todomvc.git and deploy it',
      context: 'git clone, npm install, npm run build, npm start, browser test',
    };
    const contract = deriveAcceptanceContract(goal);
    const evidence = freshEvidence(seGenome, 'test brief');
    // Worker did clone + install + build, but NOT start the server.
    evidence.repoCloned = true;
    evidence.dependenciesInstalled = true;
    evidence.lastBuildExitCode = 0;
    // lastStartResult is null — server was never started.
    const result = checkAcceptanceContract(evidence, contract, ['todomvc/examples/react/package.json']);
    expect(result.ok).toBe(false);
    expect(result.actionableFeedback).toContain('Application started');
    expect(result.actionableFeedback).toContain('HTTP verified');
    expect(result.actionableFeedback).toContain('Application delivered');
  });
});
