import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  Goal,
  MissionResult,
  ReasoningProvider,
  TierSelector,
} from '../contracts/core.js';
import { GoalCompiler } from '../goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../genome/genome-compiler.js';
import { MissionOrchestrator } from '../mission/orchestrator.js';
import type { AcceptanceCheck } from '../mission/verification.js';
import type { FlightRecorder } from '../mission/flight-recorder.js';
import { OrganizationPlanner } from '../organization/organization-planner.js';
import { CognitiveRouter } from '../routing/cognitive-router.js';
import { RuleDecisionProvider } from '../routing/decision-provider.js';
import { OpenBotRuntimeAdapter } from '../runtime/openbot/adapter.js';
import { deriveEngineeringGates } from './dev-runtime.js';
import { GitWorkspace } from './git-workspace.js';
import { IntegrationManager } from './integration-manager.js';

/**
 * Repository Mission (TASK-020 composition): the whole GROUP 3 target loop
 * wired once, so experiments and benchmarks configure instead of rebuild:
 *
 *   Goal → Organization → Workers(with worktrees) → Repository → Build →
 *   Run → Observe → Diagnose → Fix → Verify → Integrate → Measured Result
 *
 * Non-goals honored: no CI/CD platform, no process manager, no Git
 * framework. One mission = one private clone, one worktree per specialist,
 * one integration branch, one clean-room verifier that clones COMMITTED
 * state only. The planner and tier selector are injectable so the benchmark
 * (TASK-023) can compare organizational strategies through the exact same
 * machinery — no cherry-picked paths.
 */

export interface RepoMissionConfig {
  readonly goal: Goal;
  /** The external repository (URL or path). Only ever read. */
  readonly source: string;
  /** Ref to pin (branch, tag or commit sha). */
  readonly ref?: string;
  /** Mission-scoped root for the clone, worktrees and git state. */
  readonly missionRoot: string;
  /** Root for computer processes and their default (non-worktree) workspaces. */
  readonly computersRoot: string;
  /** Upstream OpenBot checkout (its own repo — never vendored). */
  readonly openbotCheckout: string;
  readonly reasoning: ReasoningProvider;
  readonly reviewer?: ReasoningProvider;
  readonly recorder: FlightRecorder;
  readonly missionId: string;
  /** Subproject directory inside the repo ('' for the root). */
  readonly projectDir?: string;
  /** Include install/build/test gates derived from the repository itself. */
  readonly gates: boolean;
  /** Task-specific assertions composed against the verifier's clone. */
  readonly extraChecks?: (context: {
    readonly repoDir: string;
    readonly projectDir: string;
  }) => readonly AcceptanceCheck[];
  /** Injectable organization strategy (benchmark arms); default: real planner. */
  readonly planner?: OrganizationPlanner;
  /** Injectable tier selection (benchmark arms); default: rule router. */
  readonly tierSelector?: TierSelector;
  readonly maxWorkerSteps?: number;
  readonly missionTimeoutMs?: number;
  readonly costSource?: () => { usd: number; tokens: number };
  readonly providerCallsSource?: () => number;
  readonly apiTimeoutMs?: number;
}

export interface RepoMissionRun {
  readonly result: MissionResult;
  readonly workspace: GitWorkspace;
  readonly runtime: OpenBotRuntimeAdapter;
  /** The integration branch's state after the final verification pass. */
  readonly integration: {
    readonly path: string;
    readonly branch: string;
  };
}

const REPO_DIR = 'repo';

function readPackageJson(path: string): { scripts?: Record<string, string> } | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}

/**
 * Run one repository mission end to end. The caller owns the mission root's
 * lifetime (evidence preservation) and the computers root.
 */
export async function runRepoMission(
  config: RepoMissionConfig,
): Promise<RepoMissionRun> {
  const projectDir = config.projectDir ?? '';
  const goalCompiler = new GoalCompiler();
  const planner = config.planner ?? new OrganizationPlanner();

  // Deterministic pre-compilation of the SAME chain the orchestrator will
  // run, so worktrees exist before the computers that point at them spawn.
  const requirements = await goalCompiler.compile(config.goal);
  const plan = planner.plan(requirements);
  const genomeCompiler = new GenomeCompiler({
    registry: loadOwnership('data/ownership.yaml'),
    selectTier:
      config.tierSelector ??
      ((selection) => new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection)),
  });
  const compilation = await genomeCompiler.compilePlan(plan, requirements);
  if (!compilation.ok) {
    throw new Error(
      'repo mission cannot run: capability gaps — ' +
        compilation.results
          .flatMap((r) => r.gaps ?? [])
          .map((gap) => `${gap.workerId}:${gap.need}`)
          .join(', '),
    );
  }

  const workspace = new GitWorkspace({
    source: config.source,
    rootDir: config.missionRoot,
    ...(config.ref === undefined ? {} : { ref: config.ref }),
  });
  await workspace.open();

  // One worktree per computer-requiring specialist; the coordinator and the
  // clean-room verifier keep the default workspace layout.
  const specialistOrder: string[] = [];
  const worktreePaths = new Map<string, string>();
  for (const result of compilation.results) {
    const genome = result.genome!;
    if (!genome.computer.required) continue;
    const state = await workspace.ensureWorktree(genome.identity.id);
    worktreePaths.set(genome.identity.id, state.path);
    specialistOrder.push(genome.identity.id);
  }

  config.recorder.record({
    type: 'repository',
    missionId: config.missionId,
    phase: 'workspace-prepared',
    branch: `base ${workspace.baseCommit.slice(0, 12)}`,
    changedFiles: specialistOrder.map((id) => `worktree:${id}`),
    detail:
      `cloned ${config.source}` +
      (config.ref === undefined ? '' : ` @ ${config.ref}`) +
      `; ${specialistOrder.length} specialist worktree(s) on genesis/* branches`,
  });

  const runtime = new OpenBotRuntimeAdapter({
    checkoutDir: config.openbotCheckout,
    rootDir: config.computersRoot,
    apiTimeoutMs: config.apiTimeoutMs ?? 300_000,
    workspaceOf: (botId) =>
      worktreePaths.get(botId) ?? join(config.computersRoot, botId, 'workspace'),
    onWorkerOutput: (workerId, chunk) =>
      (config.recorder as { raw?: (source: string, chunk: string) => void }).raw?.(
        `computer:${workerId}`,
        chunk,
      ),
  });

  const integrator = new IntegrationManager(workspace, {
    order: specialistOrder,
  });

  // Gate inputs are computed once, from the mission base: the repository's
  // own declared manifest and files decide which gates exist (install/build/
  // test) — deterministic, and honest about what this repo IS rather than
  // what workers may or may not rewrite mid-mission.
  const baseFiles = await workspace.trackedFiles();
  const basePackageJson = readPackageJson(
    join(workspace.originPath, projectDir, 'package.json'),
  );

  const beforeVerification = async (context: { attempt: 1 | 2 }): Promise<void> => {
    // Commit each specialist's current worktree state — commits are the
    // evidence boundary everything downstream trusts.
    for (const workerId of specialistOrder) {
      const dirty = await workspace.dirtyFiles(workerId);
      if (dirty.length === 0) continue;
      const commit = await workspace.commitWorktree(
        workerId,
        `work of ${workerId} (verification attempt ${context.attempt})`,
      );
      config.recorder.record({
        type: 'repository',
        missionId: config.missionId,
        phase: 'worktree-committed',
        workerId,
        branch: `genesis/${workerId}`,
        changedFiles: dirty.slice(0, 50),
        detail: `${commit.files} file(s) committed`,
      });
    }

    const report = await integrator.integrate();
    config.recorder.record({
      type: 'repository',
      missionId: config.missionId,
      phase: report.ok ? 'integrated' : 'integration-conflict',
      branch: 'genesis/integration',
      changedFiles: report.overlappingFiles,
      detail: report.detail,
    });
    if (!report.ok) {
      // The failing merge was already aborted; the integration branch holds
      // the last good state. Verification downstream will fail honestly on
      // the missing work — no fake success is possible.
    }
  };

  const buildChecks = (): AcceptanceCheck[] => {
    const checks: AcceptanceCheck[] = [
      {
        kind: 'command',
        label: 'clean-room clone of the integrated repository (committed state only)',
        command: workspace.verifierCloneCommand(REPO_DIR),
      },
    ];
    if (config.gates) {
      checks.push(
        ...deriveEngineeringGates({
          files: baseFiles,
          packageJson: basePackageJson,
          ...(projectDir === '' ? {} : { projectDir }),
          repoDir: REPO_DIR,
        }),
      );
    }
    if (config.extraChecks !== undefined) {
      checks.push(...config.extraChecks({ repoDir: REPO_DIR, projectDir }));
    }
    return checks;
  };

  const orchestrator = new MissionOrchestrator({
    goalCompiler,
    planner,
    genomeCompiler,
    runtime,
    reasoning: config.reasoning,
    ...(config.reviewer === undefined ? {} : { reviewer: config.reviewer }),
    recorder: config.recorder,
    missionId: config.missionId,
    beforeVerification,
    checks: () => buildChecks(),
    workerBriefSuffix: repoWorkerContext(projectDir),
    ...(config.maxWorkerSteps === undefined ? {} : { maxWorkerSteps: config.maxWorkerSteps }),
    ...(config.missionTimeoutMs === undefined
      ? {}
      : { missionTimeoutMs: config.missionTimeoutMs }),
    ...(config.costSource === undefined ? {} : { costSource: config.costSource }),
    ...(config.providerCallsSource === undefined
      ? {}
      : { providerCallsSource: config.providerCallsSource }),
  });

  // GROUP 3 (Experiment 003 defect) fix: the goal reaches the orchestrator
  // UNMODIFIED — the repository preamble travels as a worker-brief suffix
  // instead of goal.context, so it cannot pollute domain classification
  // (a diagnostic mission on a repository must classify as diagnostic).
  const result = await orchestrator.run(config.goal);

  return {
    result,
    workspace,
    runtime,
    integration: { path: workspace.integrationPath(), branch: 'genesis/integration' },
  };
}

/**
 * The standing repository context every worker needs: their workspace IS a
 * checkout; git collaboration follows developer semantics. This is worker
 * instructions, delivered as a task-brief suffix — it deliberately never
 * enters the goal, so it cannot skew domain classification.
 */
function repoWorkerContext(projectDir: string): string {
  return (
    'The mission repository is already checked out in your workspace: your ' +
    'own git worktree on your own branch (genesis/<your-worker-id>). Edit ' +
    'files, run commands (install, build, test) and create new files ' +
    'directly there' +
    (projectDir === '' ? '' : ` (the project lives in ${projectDir}/)`) +
    '. Commit your own work on your branch when it is ready ' +
    '(git add -A && git commit -m "...") — colleagues can only build on ' +
    'COMMITTED work. You may merge a colleague\u2019s committed branch into ' +
    'your own worktree to build on or verify it (git merge <branch> ' +
    '--no-edit). Never push, never touch remotes, never modify main or ' +
    'another worker\u2019s branch — the orchestrator owns final integration.'
  );
}
