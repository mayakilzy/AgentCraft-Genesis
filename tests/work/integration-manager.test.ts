import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
} from '../../src/contracts/core.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { AcceptanceCheck } from '../../src/mission/verification.js';
import { fixtureRepo, GitWorkspace } from '../../src/work/git-workspace.js';
import { IntegrationManager } from '../../src/work/integration-manager.js';
import { runRepoMission } from '../../src/work/repo-mission.js';

/**
 * TASK-020 acceptance:
 *
 *   - two workers on DIFFERENT modules integrate successfully;
 *   - a conflict fails safely with a clear decision (structured report,
 *     aborted merge, integration branch keeps its last good state);
 *   - the live composition proves the whole GROUP 3 loop on real computers:
 *     real worktree workspaces, real commits, real integration, a real
 *     clean-room clone and real gates deciding the mission.
 */

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    execFileSync('rm', ['-rf', dir], { stdio: 'ignore' });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sh(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function withTwoWorkers(
  fn: (
    workspace: GitWorkspace,
    manager: IntegrationManager,
    root: string,
  ) => Promise<void>,
): Promise<void> {
  const root = tempDir('g3-im-');
  const source = fixtureRepo(join(root, 'source-repo'));
  source.write('src/module-a.ts', 'export const a = 1;\n');
  source.write('src/module-b.ts', 'export const b = 2;\n');
  source.write('.gitignore', 'node_modules\ndist\n');
  source.commit('two modules');
  const workspace = new GitWorkspace({
    source: source.path,
    rootDir: join(root, 'mission'),
  });
  await workspace.open();
  try {
    const manager = new IntegrationManager(workspace, {
      order: ['worker-one', 'worker-two'],
    });
    await fn(workspace, manager, root);
  } finally {
    await workspace.destroy().catch(() => undefined);
  }
}

describe('IntegrationManager (TASK-020) — merge with the smallest honest layer', () => {
  it('inspects per-worker diffs and detects overlapping edits before merging', async () => {
    await withTwoWorkers(async (workspace, manager) => {
      const w1 = await workspace.ensureWorktree('worker-one');
      const w2 = await workspace.ensureWorktree('worker-two');
      execFileSync('bash', ['-c', `echo a > "${join(w1.path, 'src/module-a.ts')}"`]);
      execFileSync('bash', ['-c', `echo b > "${join(w2.path, 'src/module-b.ts')}"`]);
      await workspace.commitWorktree('worker-one', 'a');
      await workspace.commitWorktree('worker-two', 'b');

      const diffs = await manager.inspect();
      expect(diffs.map((d) => d.workerId)).toEqual(['worker-one', 'worker-two']);
      expect(diffs[0]?.files).toEqual(['src/module-a.ts']);
      expect(await manager.overlappingFiles()).toEqual([]);

      // Now overlap: both touch the same file on top of their own module.
      execFileSync('bash', ['-c', `echo shared > "${join(w1.path, 'shared.txt')}"`]);
      execFileSync('bash', ['-c', `echo other > "${join(w2.path, 'shared.txt')}"`]);
      await workspace.commitWorktree('worker-one', 'shared 1');
      await workspace.commitWorktree('worker-two', 'shared 2');
      expect(await manager.overlappingFiles()).toEqual(['shared.txt']);
    });
  });

  it('two workers on different modules integrate successfully, in order', async () => {
    await withTwoWorkers(async (workspace, manager, root) => {
      const w1 = await workspace.ensureWorktree('worker-one');
      const w2 = await workspace.ensureWorktree('worker-two');
      execFileSync('bash', ['-c', `echo 'FEATURE_A' > "${join(w1.path, 'src/module-a.ts')}"`]);
      execFileSync('bash', ['-c', `echo 'FEATURE_B' > "${join(w2.path, 'src/module-b.ts')}"`]);
      await workspace.commitWorktree('worker-one', 'a feature');
      await workspace.commitWorktree('worker-two', 'b feature');

      const report = await manager.integrate();
      expect(report.ok).toBe(true);
      expect(report.merged).toEqual(['worker-one', 'worker-two']);
      expect(report.conflicts).toEqual([]);

      const cloneDir = join(root, 'verifier-clone');
      execFileSync('bash', ['-c', workspace.verifierCloneCommand(cloneDir)], { cwd: root });
      expect(readFileSync(join(cloneDir, 'src/module-a.ts'), 'utf8')).toBe('FEATURE_A\n');
      expect(readFileSync(join(cloneDir, 'src/module-b.ts'), 'utf8')).toBe('FEATURE_B\n');
    });
  });

  it('a conflicting merge fails safely: structured conflict, aborted merge, listed unmerged', async () => {
    await withTwoWorkers(async (workspace, manager, root) => {
      const w1 = await workspace.ensureWorktree('worker-one');
      const w2 = await workspace.ensureWorktree('worker-two');
      execFileSync('bash', ['-c', `echo one-version > "${join(w1.path, 'src/module-a.ts')}"`]);
      execFileSync('bash', ['-c', `echo two-version > "${join(w2.path, 'src/module-a.ts')}"`]);
      execFileSync('bash', ['-c', `echo only-two > "${join(w2.path, 'src/module-b.ts')}"`]);
      await workspace.commitWorktree('worker-one', 'a v1');
      await workspace.commitWorktree('worker-two', 'a v2 + b');

      const report = await manager.integrate();
      expect(report.ok).toBe(false);
      expect(report.merged).toEqual(['worker-one']);
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0]?.file).toBe('src/module-a.ts');
      expect(report.unmerged).toEqual(['worker-two']);
      expect(report.overlappingFiles).toEqual(['src/module-a.ts']);

      // The failing merge was aborted: no conflict markers anywhere, the
      // first worker's state is intact, and worker-two's NON-conflicting
      // edit did NOT leak in (module-b still holds its base content).
      const integration = await workspace.ensureIntegrationWorktree();
      expect(readFileSync(join(integration.path, 'src/module-a.ts'), 'utf8')).toBe(
        'one-version\n',
      );
      expect(readFileSync(join(integration.path, 'src/module-b.ts'), 'utf8')).toBe(
        'export const b = 2;\n',
      );
      expect(sh(integration.path, ['status', '--porcelain']).trim()).toBe('');
      expect(sh(integration.path, ['log', '--oneline', '-1'])).toContain('a v1');
    });
  });

  it('rollback returns the integration branch to the mission base', async () => {
    await withTwoWorkers(async (workspace, manager) => {
      const w1 = await workspace.ensureWorktree('worker-one');
      await workspace.ensureWorktree('worker-two');
      execFileSync('bash', ['-c', `echo x > "${join(w1.path, 'src/module-a.ts')}"`]);
      await workspace.commitWorktree('worker-one', 'a change');
      expect((await manager.integrate()).ok).toBe(true);
      await manager.rollback();
      const integration = await workspace.ensureIntegrationWorktree();
      expect(readFileSync(join(integration.path, 'src/module-a.ts'), 'utf8')).toBe(
        'export const a = 1;\n',
      );
    });
  });
});

/** A reasoning provider whose replies depend on the role in the system prompt. */
class RoleScriptedReasoning implements ReasoningProvider {
  readonly name = 'role-scripted';
  readonly calls: ReasoningInput[] = [];
  private readonly queues = new Map<string, readonly string[]>();

  constructor(scripts: Record<string, readonly string[]>) {
    for (const [marker, replies] of Object.entries(scripts)) {
      this.queues.set(marker, [...replies]);
    }
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    this.calls.push(input);
    const system = input.system ?? '';
    for (const [marker, queue] of this.queues) {
      if (system.includes(`You are ${marker}`)) {
        const [next, ...rest] = queue;
        this.queues.set(marker, rest);
        // An exhausted script finishes safely instead of crashing the loop —
        // the mission outcome (and the diagnostics) stay observable.
        return {
          text:
            next ??
            JSON.stringify({
              action: 'finish',
              summary: 'script exhausted',
              artifacts: [],
            }),
        };
      }
    }
    throw new Error('no script for a worker in this mission');
  }
}

const OPENBOT_CHECKOUT =
  process.env.GENESIS_OPENBOT_DIR ?? join(process.cwd(), '..', 'OpenBot');
const liveAvailable = existsSync(
  join(OPENBOT_CHECKOUT, 'agent-computer', 'src', 'index.ts'),
);
const maybeLive = liveAvailable ? describe : describe.skip;

maybeLive('TASK-020 LIVE composition — a real repository mission end to end', () => {
  it(
    'two real workers on different modules, real commits, real integration, clean-room gates',
    { timeout: 300_000 },
    async () => {
      const root = tempDir('g3-repo-live-');

      // A real fixture repository with a real lockfile, build and tests.
      const source = fixtureRepo(join(root, 'source-repo'));
      source.write(
        'package.json',
        JSON.stringify(
          {
            name: 'fixture-repo-mission',
            version: '1.0.0',
            type: 'module',
            private: true,
            scripts: {
              build: 'node build.mjs',
              test: 'node --test',
            },
          },
          null,
          2,
        ),
      );
      source.write(
        'build.mjs',
        [
          "import { mkdirSync, writeFileSync } from 'node:fs';",
          "mkdirSync('dist', { recursive: true });",
          "writeFileSync('dist/built.txt', 'built\\n');",
          'console.log("build ok");',
        ].join('\n'),
      );
      source.write(
        'test/smoke.test.mjs',
        [
          "import { test } from 'node:test';",
          "import assert from 'node:assert/strict';",
          "test('smoke', () => { assert.ok(true); });",
        ].join('\n'),
      );
      source.write('.gitignore', 'node_modules\ndist\n');
      source.write('src/module-a.ts', 'export const a = 1;\n');
      source.write('src/module-b.ts', 'export const b = 2;\n');
      source.commit('fixture project');
      execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
        cwd: source.path,
        stdio: 'ignore',
      });
      source.commit('lockfile');

      const recorder = new MemoryFlightRecorder();
      const reasoning = new RoleScriptedReasoning({
        'Software Engineer': [
          JSON.stringify({
            action: 'write_file',
            path: 'src/module-a.ts',
            contents: 'export const a = 1; // FEATURE_A landed\n',
          }),
          JSON.stringify({
            action: 'finish',
            summary: 'module A extended',
            artifacts: ['src/module-a.ts'],
          }),
        ],
        'Documentation Writer': [
          JSON.stringify({
            action: 'write_file',
            path: 'NOTES.md',
            contents: '# notes\n\nFEATURE_A is documented here.\n',
          }),
          JSON.stringify({
            action: 'finish',
            summary: 'notes written',
            artifacts: ['NOTES.md'],
          }),
        ],
      });

      const run = await runRepoMission({
        goal: {
          outcome:
            'Extend module A of the fixture-repo-mission project and document ' +
            'the change in NOTES.md, with the build and tests passing.',
          constraints: ['keep the change small and focused'],
        },
        source: source.path,
        missionRoot: join(root, 'mission'),
        computersRoot: join(root, 'computers'),
        openbotCheckout: OPENBOT_CHECKOUT,
        reasoning,
        reviewer: reasoning,
        recorder,
        missionId: 'test-repo-mission-live',
        gates: true,
        extraChecks: ({ repoDir }): AcceptanceCheck[] => [
          {
            kind: 'command',
            label: 'both workers\u2019 work landed in the integration clone',
            command: `cd ${repoDir} && grep -q "FEATURE_A" src/module-a.ts && grep -q "FEATURE_A" NOTES.md`,
          },
        ],
        missionTimeoutMs: 5 * 60_000,
      });

      try {
        if (run.result.status !== 'success') {
          // Honest diagnostics: the flight record names the failing gate.
          for (const event of recorder.events) {
            if (event.type === 'verification') {
              console.error('[live-repo-mission] verification:', event.ok, event.failures);
            }
            if (event.type === 'repository') {
              console.error('[live-repo-mission] repository:', event.phase, event.detail);
            }
          }
        }
        expect(run.result.status).toBe('success');

        // The repository flight record tells the whole story.
        const phases = recorder.events
          .filter((e) => e.type === 'repository')
          .map((e) => (e.type === 'repository' ? e.phase : ''));
        expect(phases).toContain('workspace-prepared');
        expect(phases).toContain('worktree-committed');
        expect(phases).toContain('integrated');

        // The integration branch really holds both modules' work.
        expect(readFileSync(join(run.integration.path, 'src/module-a.ts'), 'utf8')).toContain(
          'FEATURE_A',
        );
        expect(readFileSync(join(run.integration.path, 'NOTES.md'), 'utf8')).toContain(
          'FEATURE_A',
        );

        // The source repository is preserved.
        expect(source.status().trim()).toBe('');

        // Metrics separation reached the flight record (2 workers x 2 calls,
        // no reviewer needed — the gates passed on the first pass).
        const finished = recorder.events.find((e) => e.type === 'mission-finished');
        if (finished?.type === 'mission-finished') {
          expect(finished.worker_reasoning_calls).toBe(4);
          expect(finished.reviewer_calls).toBe(0);
        }
      } finally {
        await run.runtime.close();
        await run.workspace.destroy().catch(() => undefined);
      }
    },
  );
});
