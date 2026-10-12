/**
 * PILOT-003 R4 — Mission Acceptance Contract.
 *
 * A lightweight, mission-specific set of success conditions derived from
 * the goal text + context. The contract is NOT a fixed checklist — it
 * adapts to the mission type (build-from-scratch, deploy-from-github,
 * library, analysis). The worker sees the contract in its prompt; the
 * completion gate enforces it before accepting `finish`.
 *
 * ## Design principles
 *
 * 1. **Goal-derived, not hardcoded.** The contract is extracted from the
 *    goal text + context using keyword analysis. If the goal mentions
 *    "npm start", the contract includes a "server started" condition.
 *    If it mentions "browser", the contract includes a "browser tested"
 *    condition. No invention of requirements the goal did not state.
 *
 * 2. **Evidence-based.** Each condition has a verification method that
 *    checks REAL operational evidence (file exists, process listening,
 *    HTTP 200, ZIP non-empty) — not just worker claims.
 *
 * 3. **Worker cannot weaken.** The contract is fixed at mission start.
 *    The worker can satisfy conditions but cannot remove or relax them.
 *
 * 4. **Type-aware.** Different mission types have different conditions:
 *    - build-from-scratch: npm test + npm start + files exist
 *    - deploy-from-github: repo cloned + build + serve + HTTP + browser
 *    - library: tests pass + package builds
 *    - analysis: report exists + sections present
 */

import type { Goal } from '../contracts/core.js';

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

export type MissionType =
  | 'deploy-from-github'   // Clone, build, serve, verify
  | 'build-from-scratch'  // Generate files, test, start, verify
  | 'library'              // Build + test
  | 'analysis'             // Produce a report
  | 'general';             // Fallback

export type ConditionKind =
  | 'repo-cloned'          // Git clone succeeded (deploy-from-github)
  | 'dependencies-installed' // npm install succeeded
  | 'application-built'    // Build command exited 0
  | 'application-started' // Process is listening on a port
  | 'http-verified'        // HTTP GET returned 2xx/3xx
  | 'browser-tested'       // Browser interaction completed
  | 'tests-pass'           // npm test exited 0
  | 'delivery-packaged'    // Non-empty ZIP exists
  | 'files-exist'          // Required files are present
  | 'report-exists';       // Analysis report file exists

export interface AcceptanceCondition {
  readonly kind: ConditionKind;
  readonly label: string;
  readonly description: string;
  readonly verified: boolean;
  readonly evidence?: string;
}

export interface MissionAcceptanceContract {
  readonly missionType: MissionType;
  readonly conditions: readonly AcceptanceCondition[];
}

// ---------------------------------------------------------------------------
// Contract derivation
// ---------------------------------------------------------------------------

/**
 * Derive a mission acceptance contract from the goal + context.
 *
 * The derivation is deterministic keyword analysis — no LLM calls. It scans
 * the goal text + context for indicators of mission type and required
 * conditions, then builds the contract.
 *
 * @param goal the mission goal (outcome + context + constraints)
 * @returns a mission acceptance contract
 */
export function deriveAcceptanceContract(goal: Goal): MissionAcceptanceContract {
  const fullText = `${goal.outcome}\n${goal.context ?? ''}\n${(goal.constraints ?? []).join('\n')}`;
  const lower = fullText.toLowerCase();
  const missionType = detectMissionType(lower);

  const conditions: AcceptanceCondition[] = [];

  switch (missionType) {
    case 'deploy-from-github': {
      conditions.push({
        kind: 'repo-cloned',
        label: 'Repository cloned',
        description: 'Git clone succeeded — the repo directory exists with a .git folder',
        verified: false,
      });
      conditions.push({
        kind: 'dependencies-installed',
        label: 'Dependencies installed',
        description: 'npm install (or equivalent) exited 0 — node_modules populated',
        verified: false,
      });
      conditions.push({
        kind: 'application-built',
        label: 'Application built',
        description: 'Build command (npm run build or equivalent) exited 0',
        verified: false,
      });
      conditions.push({
        kind: 'application-started',
        label: 'Application started',
        description: 'A process is listening on a port (server or dev server)',
        verified: false,
      });
      conditions.push({
        kind: 'http-verified',
        label: 'HTTP verified',
        description: 'HTTP GET returned 2xx or 3xx from the started server',
        verified: false,
      });
      // Browser test only if the goal mentions browser interactions.
      if (/browser|interact|todo|click|ui/i.test(lower)) {
        conditions.push({
          kind: 'browser-tested',
          label: 'Browser tested',
          description: 'Real browser interaction completed (at least one screenshot or interaction)',
          verified: false,
        });
      }
      conditions.push({
        kind: 'delivery-packaged',
        label: 'Application delivered',
        description: 'Non-empty ZIP package created with the application files',
        verified: false,
      });
      break;
    }
    case 'build-from-scratch': {
      // Files exist is always required for build-from-scratch.
      conditions.push({
        kind: 'files-exist',
        label: 'Required files exist',
        description: 'The deliverable files declared in the goal are present in the workspace',
        verified: false,
      });
      // npm test if the goal mentions it.
      if (/npm\s+test|test\s+must\s+pass|tests?\s+pass/i.test(lower)) {
        conditions.push({
          kind: 'tests-pass',
          label: 'Tests pass',
          description: 'npm test (or equivalent) exited 0',
          verified: false,
        });
      }
      // Application start if the goal mentions a server/start command.
      if (/npm\s+start|node\s+server|launch|serve|port/i.test(lower)) {
        conditions.push({
          kind: 'application-started',
          label: 'Application started',
          description: 'Application server is listening on a port',
          verified: false,
        });
        conditions.push({
          kind: 'http-verified',
          label: 'HTTP verified',
          description: 'HTTP GET returned 2xx or 3xx from the started server',
          verified: false,
        });
      }
      // Delivery package only if the goal mentions delivery/package/zip.
      if (/deliver|package|zip|ship/i.test(lower)) {
        conditions.push({
          kind: 'delivery-packaged',
          label: 'Application delivered',
          description: 'Non-empty ZIP package created with the application files',
          verified: false,
        });
      }
      break;
    }
    case 'library': {
      conditions.push({
        kind: 'files-exist',
        label: 'Library files exist',
        description: 'The library source files are present',
        verified: false,
      });
      if (/test/i.test(lower)) {
        conditions.push({
          kind: 'tests-pass',
          label: 'Tests pass',
          description: 'Test command exited 0',
          verified: false,
        });
      }
      conditions.push({
        kind: 'application-built',
        label: 'Library builds',
        description: 'Build command exited 0 (or no build needed)',
        verified: false,
      });
      break;
    }
    case 'analysis': {
      conditions.push({
        kind: 'report-exists',
        label: 'Report exists',
        description: 'The analysis report file exists',
        verified: false,
      });
      break;
    }
    default: {
      // general — minimal contract.
      conditions.push({
        kind: 'files-exist',
        label: 'Deliverable exists',
        description: 'At least one deliverable file exists',
        verified: false,
      });
    }
  }

  return { missionType, conditions };
}

/**
 * Detect the mission type from the goal text.
 */
function detectMissionType(lowerText: string): MissionType {
  // deploy-from-github: mentions git clone, github, repository, existing app
  if (/git\s+clone|github\.com|repository|clone\s+the\s+repo/i.test(lowerText)) {
    return 'deploy-from-github';
  }
  // analysis: mentions report, analysis, document (as deliverable, not docs)
  if (/write\s+a\s+report|analyze|analysis\s+report|produce\s+a\s+document/i.test(lowerText)) {
    return 'analysis';
  }
  // library: mentions library, package, npm publish
  if (/library|npm\s+publish|package\s+for\s+publishing/i.test(lowerText)) {
    return 'library';
  }
  // build-from-scratch: mentions build, create, generate (default for code)
  if (/build|create|generate|implement|develop/i.test(lowerText)) {
    return 'build-from-scratch';
  }
  return 'general';
}

// ---------------------------------------------------------------------------
// Contract verification (system-level, not worker-level)
// ---------------------------------------------------------------------------

export interface ContractVerificationContext {
  readonly workspaceFiles: readonly string[];
  readonly lastTestExitCode: number | null;
  readonly lastBuildExitCode: number | null;
  readonly lastStartResult: { ok: boolean; httpStatus: number | null } | null;
  readonly browserEvidence: { screenshotTaken: boolean; interactionsPassed: number };
  readonly deliveryPackage: { exists: boolean; bytes: number } | null;
  readonly repoCloned: boolean;
  readonly dependenciesInstalled: boolean;
}

/**
 * Verify the acceptance contract against REAL operational evidence.
 *
 * This is the system-level enforcement: the worker cannot claim success
 * unless the evidence is present. Each condition is checked against
 * the verification context.
 *
 * @param contract the acceptance contract
 * @param context the verification context (real evidence)
 * @returns a new contract with conditions marked verified + an overall ok flag
 */
export function verifyAcceptanceContract(
  contract: MissionAcceptanceContract,
  context: ContractVerificationContext,
): { contract: MissionAcceptanceContract; allVerified: boolean; unverified: readonly AcceptanceCondition[] } {
  const verifiedConditions = contract.conditions.map((c) => {
    let verified = false;
    let evidence: string | undefined;
    switch (c.kind) {
      case 'repo-cloned':
        verified = context.repoCloned;
        evidence = verified ? 'repo directory exists with .git' : 'repo not found in workspace';
        break;
      case 'dependencies-installed':
        verified = context.dependenciesInstalled;
        evidence = verified ? 'node_modules populated' : 'node_modules missing';
        break;
      case 'application-built':
        verified = context.lastBuildExitCode === 0;
        evidence = verified ? 'build exit 0' : `build exit ${context.lastBuildExitCode ?? 'unknown'}`;
        break;
      case 'application-started':
        verified = context.lastStartResult?.ok ?? false;
        evidence = verified ? 'server listening' : 'no server detected';
        break;
      case 'http-verified':
        verified = (context.lastStartResult?.httpStatus ?? 0) >= 200 && (context.lastStartResult?.httpStatus ?? 0) < 400;
        evidence = verified ? `HTTP ${context.lastStartResult!.httpStatus}` : 'no HTTP response';
        break;
      case 'browser-tested':
        verified = context.browserEvidence.screenshotTaken || context.browserEvidence.interactionsPassed > 0;
        evidence = verified ? `${context.browserEvidence.interactionsPassed} interactions` : 'no browser evidence';
        break;
      case 'tests-pass':
        verified = context.lastTestExitCode === 0;
        evidence = verified ? 'test exit 0' : `test exit ${context.lastTestExitCode ?? 'unknown'}`;
        break;
      case 'delivery-packaged':
        verified = (context.deliveryPackage?.exists ?? false) && (context.deliveryPackage?.bytes ?? 0) > 0;
        evidence = verified ? `${context.deliveryPackage!.bytes} bytes` : 'no package';
        break;
      case 'files-exist':
        verified = context.workspaceFiles.length > 0;
        evidence = verified ? `${context.workspaceFiles.length} files` : 'no files';
        break;
      case 'report-exists':
        verified = context.workspaceFiles.some((f) => /report|analysis|\.md$/i.test(f));
        evidence = verified ? 'report file found' : 'no report file';
        break;
    }
    return { ...c, verified, evidence };
  });

  const unverified = verifiedConditions.filter((c) => !c.verified);
  return {
    contract: { ...contract, conditions: verifiedConditions },
    allVerified: unverified.length === 0,
    unverified,
  };
}

/**
 * Build a human-readable mission state summary for the worker's prompt.
 *
 * Shows what's accomplished and what remains, based on the verified contract.
 */
export function buildMissionStateSummary(contract: MissionAcceptanceContract): string {
  const lines: string[] = ['MISSION STATE:'];
  for (const c of contract.conditions) {
    const mark = c.verified ? '✓' : '✗';
    lines.push(`${mark} ${c.label}${c.evidence ? ` (${c.evidence})` : ''}`);
  }
  const unverified = contract.conditions.filter((c) => !c.verified);
  if (unverified.length > 0) {
    lines.push('');
    lines.push(`REMAINING: ${unverified.map((c) => c.label.toLowerCase()).join(', ')}.`);
  } else {
    lines.push('');
    lines.push('ALL CONDITIONS MET — you may call finish.');
  }
  return lines.join('\n');
}
