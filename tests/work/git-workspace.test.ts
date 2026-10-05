import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  fixtureRepo,
  GitWorkspace,
  GitWorkspaceError,
} from '../../src/work/git-workspace.js';

/**
 * TASK-016 acceptance, proven on REAL git repositories in temp directories:
 *
 *   - two workers can work in separate worktrees;
 *   - the original (source) repository is preserved;
 *   - commits are the artifact boundary: uncommitted junk never crosses a
 *     clone of the integration branch (the clean-room property).
 *
 * No mocks: every assertion runs against the real git binary, the same one
 * the runtime uses.
 */

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'g3-ws-'));
}

function sh(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function withWorkspace(
  fn: (workspace: GitWorkspace, source: ReturnType<typeof fixtureRepo>, root: string) => Promise<void>,
): Promise<void> {
  const root = tempRoot();
  const source = fixtureRepo(join(root, 'source-repo'));
  source.write('README.md', '# fixture\n');
  source.write('src/a.txt', 'alpha\n');
  source.commit('init');
  const workspace = new GitWorkspace({
    source: source.path,
    rootDir: join(root, 'mission'),
  });
  await workspace.open();
  try {
    await fn(workspace, source, root);
  } finally {
    await workspace.destroy().catch(() => undefined);
  }
}

describe('GitWorkspace (TASK-016) — safe external repository work', () => {
  test('open() clones the source, pins the base, and leaves the source untouched', async () => {
    await withWorkspace(async (workspace, source) => {
      expect(workspace.baseCommit).toBe(source.head());
      expect(existsSync(join(workspace.originPath, '.git'))).toBe(true);
      // The clone is a copy, not a link into the source's object store.
      expect(workspace.originPath).not.toBe(source.path);
      // Nothing was written into the source.
      expect(source.status()).toBe('');
      expect(source.head()).toBe(workspace.baseCommit);
    });
  });

  test('two workers get separate worktrees on separate branches, isolated from each other', async () => {
    await withWorkspace(async (workspace) => {
      const w1 = await workspace.ensureWorktree('worker-one');
      const w2 = await workspace.ensureWorktree('worker-two');
      expect(w1.path).not.toBe(w2.path);
      expect(w1.branch).toBe('genesis/worker-one');
      expect(w2.branch).toBe('genesis/worker-two');

      execFileSync('bash', ['-c', `echo one > "${join(w1.path, 'src/a.txt')}"`]);
      execFileSync('bash', ['-c', `echo two > "${join(w2.path, 'src/a.txt')}"`]);

      expect(readFileSync(join(w1.path, 'src/a.txt'), 'utf8')).toBe('one\n');
      expect(readFileSync(join(w2.path, 'src/a.txt'), 'utf8')).toBe('two\n');
    });
  });

  test('worker edits + commits stay isolated, and the source repository is preserved', async () => {
    await withWorkspace(async (workspace, source) => {
      const w1 = await workspace.ensureWorktree('worker-one');
      const w2 = await workspace.ensureWorktree('worker-two');
      execFileSync('bash', ['-c', `echo one > "${join(w1.path, 'src/a.txt')}"`]);
      execFileSync('bash', ['-c', `echo two > "${join(w2.path, 'src/b.txt')}"`]);
      const c1 = await workspace.commitWorktree('worker-one', 'worker one change');
      const c2 = await workspace.commitWorktree('worker-two', 'worker two change');
      expect(c1.commit).not.toBeNull();
      expect(c2.commit).not.toBeNull();
      expect(c1.commit).not.toBe(c2.commit);

      expect(await workspace.changedFiles('worker-one')).toEqual(['src/a.txt']);
      expect(await workspace.changedFiles('worker-two')).toEqual(['src/b.txt']);

      // The source repository is exactly as it was.
      expect(source.head()).toBe(workspace.baseCommit);
      expect(source.status()).toBe('');
      expect(readFileSync(join(source.path, 'src/a.txt'), 'utf8')).toBe('alpha\n');
    });
  });

  test('committing with nothing staged reports zero files instead of failing', async () => {
    await withWorkspace(async (workspace) => {
      await workspace.ensureWorktree('idle-worker');
      const result = await workspace.commitWorktree('idle-worker', 'no changes');
      expect(result.commit).toBeNull();
      expect(result.files).toBe(0);
    });
  });

  test('clean-room property: untracked junk in the integration worktree never crosses a clone', async () => {
    await withWorkspace(async (workspace, _source, root) => {
      const w = await workspace.ensureWorktree('writer-1');
      execFileSync('bash', ['-c', `echo 'the real deliverable' > "${join(w.path, 'report.md')}"`]);
      await workspace.commitWorktree('writer-1', 'add report');
      const integration = await workspace.ensureIntegrationWorktree();
      const merged = await workspace.mergeIntoIntegration('writer-1');
      expect(merged.ok).toBe(true);

      // Uncommitted junk a worker left in the INTEGRATION worktree itself:
      execFileSync('bash', ['-c', `echo 'FAKE PASS' > "${join(integration.path, 'cheat.txt')}"`]);

      const cloneDir = join(root, 'verifier-clone');
      execFileSync('bash', ['-c', workspace.verifierCloneCommand(cloneDir)], {
        cwd: root,
      });
      expect(readFileSync(join(cloneDir, 'report.md'), 'utf8')).toBe(
        'the real deliverable\n',
      );
      expect(existsSync(join(cloneDir, 'cheat.txt'))).toBe(false);
      expect(sh(cloneDir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(
        'genesis/integration',
      );
    });
  });

  test('merges bring committed worker changes together on the integration branch', async () => {
    await withWorkspace(async (workspace, _source, root) => {
      const w1 = await workspace.ensureWorktree('worker-one');
      const w2 = await workspace.ensureWorktree('worker-two');
      execFileSync('bash', ['-c', `echo one > "${join(w1.path, 'src/a.txt')}"`]);
      execFileSync('bash', ['-c', `echo two > "${join(w2.path, 'src/b.txt')}"`]);
      await workspace.commitWorktree('worker-one', 'a change');
      await workspace.commitWorktree('worker-two', 'b change');
      await workspace.ensureIntegrationWorktree();
      expect((await workspace.mergeIntoIntegration('worker-one')).ok).toBe(true);
      expect((await workspace.mergeIntoIntegration('worker-two')).ok).toBe(true);

      const cloneDir = join(root, 'verifier-clone');
      execFileSync('bash', ['-c', workspace.verifierCloneCommand(cloneDir)], {
        cwd: root,
      });
      expect(readFileSync(join(cloneDir, 'src/a.txt'), 'utf8')).toBe('one\n');
      expect(readFileSync(join(cloneDir, 'src/b.txt'), 'utf8')).toBe('two\n');
    });
  });

  test('a conflicting merge fails safely with structured conflict files and no partial state', async () => {
    await withWorkspace(async (workspace, _source, root) => {
      const w1 = await workspace.ensureWorktree('worker-one');
      const w2 = await workspace.ensureWorktree('worker-two');
      execFileSync('bash', ['-c', `echo one-version > "${join(w1.path, 'src/a.txt')}"`]);
      execFileSync('bash', ['-c', `echo a-different-version > "${join(w2.path, 'src/a.txt')}"`]);
      await workspace.commitWorktree('worker-one', 'conflicting a');
      await workspace.commitWorktree('worker-two', 'conflicting a too');
      await workspace.ensureIntegrationWorktree();

      const first = await workspace.mergeIntoIntegration('worker-one');
      expect(first.ok).toBe(true);
      const second = await workspace.mergeIntoIntegration('worker-two');
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.conflicts).toEqual(['src/a.txt']);
      }

      // The failed merge is fully rolled back: the integration branch holds
      // worker one's committed change and no conflict markers.
      const cloneDir = join(root, 'verifier-clone');
      execFileSync('bash', ['-c', workspace.verifierCloneCommand(cloneDir)], {
        cwd: root,
      });
      expect(readFileSync(join(cloneDir, 'src/a.txt'), 'utf8')).toBe('one-version\n');
    });
  });

  test('resetIntegration rolls the integration branch back to the mission base', async () => {
    await withWorkspace(async (workspace, _source, root) => {
      const w = await workspace.ensureWorktree('worker-one');
      execFileSync('bash', ['-c', `echo one > "${join(w.path, 'src/a.txt')}"`]);
      await workspace.commitWorktree('worker-one', 'a change');
      const integration = await workspace.ensureIntegrationWorktree();
      expect((await workspace.mergeIntoIntegration('worker-one')).ok).toBe(true);
      await workspace.resetIntegration();

      const cloneDir = join(root, 'verifier-clone');
      execFileSync('bash', ['-c', workspace.verifierCloneCommand(cloneDir)], {
        cwd: root,
      });
      expect(readFileSync(join(cloneDir, 'src/a.txt'), 'utf8')).toBe('alpha\n');
      expect(sh(integration.path, ['status', '--porcelain'])).toBe('');
    });
  });

  test('cleanup removes worktrees but keeps mission evidence; destroy removes everything', async () => {
    const root = tempRoot();
    const source = fixtureRepo(join(root, 'source-repo'));
    source.write('README.md', '# fixture\n');
    source.write('src/a.txt', 'alpha\n');
    source.commit('init');
    const workspace = new GitWorkspace({
      source: source.path,
      rootDir: join(root, 'mission'),
    });
    await workspace.open();
    const w = await workspace.ensureWorktree('worker-one');
    execFileSync('bash', ['-c', `echo one > "${join(w.path, 'src/a.txt')}"`]);
    await workspace.commitWorktree('worker-one', 'a change');

    await workspace.cleanup();
    expect(existsSync(w.path)).toBe(false);
    expect(existsSync(workspace.originPath)).toBe(true);
    const branches = sh(workspace.originPath, ['branch', '--list', 'genesis/*']);
    expect(branches).toContain('genesis/worker-one');

    await workspace.destroy();
    expect(existsSync(workspace.rootDir)).toBe(false);
    expect(source.status()).toBe('');
  });

  test('invalid worktree names and unopened use are refused loudly', async () => {
    await withWorkspace(async (workspace) => {
      await expect(workspace.ensureWorktree('bad name!')).rejects.toBeInstanceOf(
        GitWorkspaceError,
      );
      await expect(workspace.ensureWorktree('../escape')).rejects.toBeInstanceOf(
        GitWorkspaceError,
      );
    });

    const root = tempRoot();
    const unopened = new GitWorkspace({
      source: 'nowhere',
      rootDir: join(root, 'm'),
    });
    await expect(unopened.ensureWorktree('x')).rejects.toBeInstanceOf(GitWorkspaceError);
    await expect(unopened.commitWorktree('x', 'm')).rejects.toBeInstanceOf(
      GitWorkspaceError,
    );
  });

  test('open() can pin the mission to an explicit ref', async () => {
    const root = tempRoot();
    const source = fixtureRepo(join(root, 'source-repo'));
    source.write('README.md', 'v1\n');
    const v1 = source.commit('v1');
    source.write('README.md', 'v2\n');
    source.commit('v2');

    const workspace = new GitWorkspace({
      source: source.path,
      rootDir: join(root, 'mission'),
      ref: v1,
    });
    await workspace.open();
    // A sha pin detaches the origin clone at exactly that commit.
    expect(workspace.baseCommit).toBe(v1);
    await workspace.destroy();
  });
});
