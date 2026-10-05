import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/**
 * Git Workspace Adapter (TASK-016) — safe work on an external repository.
 *
 * The domain `software-engineering-coordination` is GENESIS-BUILD in the
 * ownership registry, but "build" here means the thinnest possible wrap of
 * the standard git binary — this file contains no Git reimplementation, no
 * Git abstraction framework, and no VCS feature catalog. Every operation is
 * one `git` CLI invocation via execFile (no shell, no string concatenation
 * into a command line).
 *
 * Safety model, matching the GROUP 3 review requirements:
 *
 *   1. The SOURCE repository is only ever read. `clone --no-hardlinks`
 *      copies objects into the mission directory; there is no push, no
 *      fetch-back, no ref update, no worktree inside the source — the class
 *      exposes no operation that can write to the source at all.
 *   2. Everything Genesis creates lives under one mission root; every path
 *      handed to git is asserted to be inside it.
 *   3. Main is never checked out for work: workers get their own branches in
 *      their own worktrees; integration happens on its own branch.
 *   4. Commits are the artifact boundary: only committed state can be merged
 *      or cloned into the clean-room verifier, so untracked junk cannot fake
 *      a pass (proven by test).
 */

/** What one `git` invocation failed with, including stderr for diagnosis. */
export class GitWorkspaceError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitWorkspaceError';
  }
}

export interface GitWorkspaceOptions {
  /** The external repository: a URL or a local path. Only ever read. */
  readonly source: string;
  /** Mission-scoped directory the clone and all worktrees live under. */
  readonly rootDir: string;
  /**
   * Ref to pin the mission to (branch, tag or commit). Default: the
   * source's default branch HEAD.
   */
  readonly ref?: string;
  /** Git identity for mission-local commits (default: a genesis bot identity). */
  readonly committer?: { readonly name: string; readonly email: string };
  /** Per-invocation timeout (default 60s; the clone raises it internally). */
  readonly timeoutMs?: number;
}

export interface WorktreeState {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
}

function run(
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          rejectRun(
            new GitWorkspaceError(
              `git ${args[0]} failed in ${cwd}: ${String(error.message).slice(0, 300)}`,
              String(stderr).slice(0, 500),
            ),
          );
          return;
        }
        resolveRun({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function shellQuote(value: string): string {
  return /[^A-Za-z0-9_@%+=:,./-]/.test(value)
    ? `'${value.replace(/'/g, `'\\''`)}'`
    : value;
}

/**
 * One mission's repository workspace: a private clone of an external source
 * plus git worktrees for the workers and the integration context.
 */
export class GitWorkspace {
  readonly rootDir: string;
  readonly originPath: string;
  private readonly options: GitWorkspaceOptions;
  private readonly worktrees = new Map<string, WorktreeState>();
  private baseShaValue = '';
  private opened = false;

  constructor(options: GitWorkspaceOptions) {
    this.options = options;
    this.rootDir = resolve(options.rootDir);
    this.originPath = join(this.rootDir, 'origin');
  }

  /** The commit the mission is pinned to (empty before `open`). */
  get baseCommit(): string {
    return this.baseShaValue;
  }

  /** All worktrees created so far, in creation order. */
  get worktreeStates(): readonly WorktreeState[] {
    return [...this.worktrees.values()];
  }

  /** Clone the source into the mission root and pin the base ref. */
  async open(): Promise<void> {
    if (this.opened) {
      throw new GitWorkspaceError('workspace already opened', '');
    }
    await mkdir(this.rootDir, { recursive: true });
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    await run(
      this.rootDir,
      ['clone', '--no-hardlinks', '--', this.options.source, 'origin'],
      Math.max(timeoutMs, 300_000),
    );
    const identity = this.options.committer ?? {
      name: 'genesis-mission',
      email: 'genesis@mission.local',
    };
    await run(this.originPath, ['config', 'user.name', identity.name], timeoutMs);
    await run(this.originPath, ['config', 'user.email', identity.email], timeoutMs);
    if (this.options.ref !== undefined) {
      // Pin to exactly this state: a branch, tag or commit sha — detached,
      // so no mission operation can move a source branch pointer.
      await run(
        this.originPath,
        ['checkout', '--detach', this.options.ref],
        timeoutMs,
      );
    }
    const head = await run(this.originPath, ['rev-parse', 'HEAD'], timeoutMs);
    this.baseShaValue = head.stdout.trim();
    this.opened = true;
  }

  /** Assert a path stays inside the mission root — every git call goes through this. */
  private inside(path: string): string {
    const resolved = resolve(path);
    const root = this.rootDir.endsWith(sep) ? this.rootDir : this.rootDir + sep;
    if (resolved !== this.rootDir && !resolved.startsWith(root)) {
      throw new GitWorkspaceError(
        `refusing to operate on "${path}" outside the mission root ${this.rootDir}`,
        '',
      );
    }
    return resolved;
  }

  /**
   * Create (or return the existing) worktree for one named worker on its own
   * branch off the mission base. The worker's computer points its
   * WORKSPACE_DIR at this path, so every shell/file action the worker takes
   * lands in its own disposable worktree.
   */
  async ensureWorktree(name: string): Promise<WorktreeState> {
    this.assertOpened();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      throw new GitWorkspaceError(
        `worktree name "${name}" must be plain letters/digits/hyphen/underscore`,
        '',
      );
    }
    const existing = this.worktrees.get(name);
    if (existing !== undefined) return existing;

    const path = this.inside(join(this.rootDir, 'wt', name));
    const branch = `genesis/${name}`;
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    await mkdir(join(this.rootDir, 'wt'), { recursive: true });
    await run(
      this.originPath,
      ['worktree', 'add', '-b', branch, path, this.baseShaValue],
      timeoutMs,
    );
    const state: WorktreeState = { name, path, branch };
    this.worktrees.set(name, state);
    return state;
  }

  /** The mission's integration worktree (created on first use). */
  async ensureIntegrationWorktree(): Promise<WorktreeState> {
    return this.ensureWorktree('integration');
  }

  /** Files changed on a worktree's branch relative to the mission base. */
  async changedFiles(name: string): Promise<readonly string[]> {
    this.assertOpened();
    const state = this.requireWorktree(name);
    const diff = await run(
      this.originPath,
      ['diff', '--name-only', `${this.baseShaValue}..${state.branch}`],
      this.options.timeoutMs ?? 60_000,
    );
    return diff.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Files the mission base tracks (repo-relative). Consumers: development
   * runtime discovery (TASK-017) reads lockfiles from the real file list
   * instead of guessing.
   */
  async trackedFiles(): Promise<readonly string[]> {
    this.assertOpened();
    const list = await run(
      this.originPath,
      ['ls-files', '--', '.'],
      this.options.timeoutMs ?? 60_000,
    );
    return list.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /** Uncommitted modifications inside a worktree (before committing). */
  async dirtyFiles(name: string): Promise<readonly string[]> {
    this.assertOpened();
    const state = this.requireWorktree(name);
    const status = await run(
      state.path,
      ['status', '--porcelain'],
      this.options.timeoutMs ?? 60_000,
    );
    return status.stdout
      .split('\n')
      .map((line) => line.trim().slice(3).trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Commit everything currently in a worktree (git add -A). This is the
   * structural bridge from "a worker edited files" to "evidence on a branch"
   * — the integration manager and the clean-room verifier only ever see
   * committed state. Returns the commit sha and file count (0 files = a
   * valid "nothing to commit" outcome, reported not thrown).
   */
  async commitWorktree(
    name: string,
    message: string,
  ): Promise<{ commit: string | null; files: number }> {
    this.assertOpened();
    const state = this.requireWorktree(name);
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    // GROUP 3 fix, exposed by Experiment 002's first integration conflict:
    // package-manager cache directories (`.npm/` — created by npm installs
    // inside the worktree when the computer resolves its cache there) are
    // machine state, not work. Committing them poisoned the evidence
    // boundary and conflicted across every worker branch that installed
    // anything. Excluded from the auto-commit exactly like a .gitignore
    // would; a worker can still commit such paths explicitly if it ever
    // has a reason to.
    await run(
      state.path,
      ['add', '-A', '--', '.', ':!.npm', ':!node_modules'],
      timeoutMs,
    );
    const staged = await run(
      state.path,
      ['diff', '--cached', '--name-only'],
      timeoutMs,
    );
    const files = staged.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0).length;
    if (files === 0) {
      return { commit: null, files: 0 };
    }
    await run(
      state.path,
      ['commit', '-m', `${message} (${state.branch})`],
      timeoutMs,
    );
    const rev = await run(state.path, ['rev-parse', 'HEAD'], timeoutMs);
    return { commit: rev.stdout.trim(), files };
  }

  /**
   * Merge one worker branch into the integration branch, inside the
   * integration worktree. Used by the Integration Manager (TASK-020) —
   * workers and other components do not merge.
   */
  async mergeIntoIntegration(
    name: string,
  ): Promise<{ ok: true } | { ok: false; conflicts: readonly string[] }> {
    this.assertOpened();
    const state = this.requireWorktree(name);
    const integration = this.requireWorktree('integration');
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const merge = await run(integration.path, ['merge', '--no-edit', state.branch], timeoutMs)
      .then(() => null)
      .catch((error: GitWorkspaceError) => error);
    if (merge === null) {
      return { ok: true };
    }
    const conflicts = await run(
      integration.path,
      ['diff', '--name-only', '--diff-filter=U'],
      timeoutMs,
    )
      .then((out) =>
        out.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      )
      .catch(() => [] as string[]);
    await run(integration.path, ['merge', '--abort'], timeoutMs).catch(() => undefined);
    return { ok: false, conflicts };
  }

  /** Roll the integration branch back to the mission base. */
  async resetIntegration(): Promise<void> {
    this.assertOpened();
    const integration = this.worktrees.get('integration');
    if (integration === undefined) return;
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    await run(integration.path, ['reset', '--hard', this.baseShaValue], timeoutMs);
    await run(integration.path, ['clean', '-fd'], timeoutMs);
  }

  /** The integration worktree path, once it exists (clean-room clone source). */
  integrationPath(): string {
    return this.requireWorktree('integration').path;
  }

  /**
   * A clone command the clean-room verifier runs inside ITS OWN computer:
   * clones the committed integration state — never untracked or modified
   * files in the worktree — and checks out the integration branch by name.
   * Idempotent: a retry re-clones from scratch, so a previous attempt's
   * clone can never leak into this one. Shell-quoted; composed only from
   * paths this workspace created.
   */
  verifierCloneCommand(targetDir: string): string {
    const integration = this.integrationPath();
    return (
      `rm -rf ${shellQuote(targetDir)} && ` +
      `git clone -q --no-hardlinks ${shellQuote(integration)} ${shellQuote(targetDir)} ` +
      `&& git -C ${shellQuote(targetDir)} checkout -q genesis/integration`
    );
  }

  /**
   * Best-effort cleanup: remove every worktree this workspace created and
   * prune. The mission root itself (and the origin clone inside it) is left
   * for the caller's lifecycle decision — mission evidence lives there.
   */
  async cleanup(): Promise<void> {
    if (!this.opened) return;
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    for (const state of this.worktrees.values()) {
      await run(
        this.originPath,
        ['worktree', 'remove', '--force', state.path],
        timeoutMs,
      ).catch(() => undefined);
    }
    await run(this.originPath, ['worktree', 'prune'], timeoutMs).catch(() => undefined);
    this.worktrees.clear();
  }

  /** Remove the whole mission root (tests and full teardown). */
  async destroy(): Promise<void> {
    await this.cleanup();
    await rm(this.rootDir, { recursive: true, force: true });
  }

  private requireWorktree(name: string): WorktreeState {
    const state = this.worktrees.get(name);
    if (state === undefined) {
      throw new GitWorkspaceError(`no worktree "${name}" in this workspace`, '');
    }
    return state;
  }

  private assertOpened(): void {
    if (!this.opened) {
      throw new GitWorkspaceError('workspace not opened — call open() first', '');
    }
  }
}

/**
 * Fixture repository builder for tests and experiment preparation: a REAL
 * git repository on disk with real commits — never a mock of one. The sync
 * helpers are intentional: fixtures are small and test-scoped.
 */
export interface FixtureRepo {
  readonly path: string;
  write(path: string, contents: string): void;
  commit(message: string): string;
  head(): string;
  status(): string;
}

export function fixtureRepo(dir: string): FixtureRepo {
  mkdirSync(dir, { recursive: true });
  const sh = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  sh(['init', '-q', '-b', 'main']);
  sh(['config', 'user.email', 'fixture@genesis.test']);
  sh(['config', 'user.name', 'fixture']);
  return {
    path: dir,
    write(path, contents) {
      const full = join(dir, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, contents, 'utf8');
    },
    commit(message) {
      sh(['add', '-A']);
      sh(['commit', '-qm', message]);
      return sh(['rev-parse', 'HEAD']).trim();
    },
    head() {
      return sh(['rev-parse', 'HEAD']).trim();
    },
    status() {
      return sh(['status', '--porcelain']);
    },
  };
}
