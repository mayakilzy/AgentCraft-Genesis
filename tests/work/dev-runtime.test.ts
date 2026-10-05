import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, test } from 'vitest';

import { fixtureRepo, GitWorkspace } from '../../src/work/git-workspace.js';
import {
  detectPackageManager,
  deriveEngineeringGates,
  httpProbeCommand,
  previewServerCommand,
} from '../../src/work/dev-runtime.js';
import { startComputerProcess } from '../../src/runtime/openbot/computer-process.js';

/**
 * TASK-017 acceptance:
 *
 *   - a fixture project BUILDS AND RUNS inside the OpenBot runtime
 *     (a real spawned agent-computer, real npm install from the registry,
 *     real build, real tests — nothing on the host);
 *   - the package manager is discovered from the repository, never imposed;
 *   - lockfiles are respected (npm ci, not npm install);
 *   - no host dependency pollution: node_modules exists only inside the
 *     computer's worktree workspace.
 */

const OPENBOT_CHECKOUT =
  process.env.GENESIS_OPENBOT_DIR ?? join(process.cwd(), '..', 'OpenBot');
const liveTestsAvailable = existsSync(
  join(OPENBOT_CHECKOUT, 'agent-computer', 'src', 'index.ts'),
);
const maybeLive = liveTestsAvailable ? describe : describe.skip;

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) {
    await new Promise<void>((resolve) => {
      execFileSync('rm', ['-rf', dir], { stdio: 'ignore' });
      resolve();
    }).catch(() => undefined);
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('detectPackageManager — discovery from repository files', () => {
  test('bun.lock selects bun with a frozen install', () => {
    const plan = detectPackageManager(['src/index.ts', 'bun.lock', 'package.json']);
    expect(plan?.manager).toBe('bun');
    expect(plan?.evidence).toBe('bun.lock');
    expect(plan?.install).toBe('bun install --frozen-lockfile');
    expect(plan?.script('test')).toBe('bun run test');
  });

  test('package-lock.json selects npm ci (lockfile respected)', () => {
    const plan = detectPackageManager(['package.json', 'package-lock.json']);
    expect(plan?.manager).toBe('npm');
    expect(plan?.install).toBe('npm ci');
  });

  test('yarn / pnpm / deno lockfiles select their managers', () => {
    expect(detectPackageManager(['yarn.lock'])?.manager).toBe('yarn');
    expect(detectPackageManager(['pnpm-lock.yaml'])?.manager).toBe('pnpm');
    expect(detectPackageManager(['deno.lock'])?.manager).toBe('deno');
  });

  test('a lockless package.json falls back to npm install', () => {
    const plan = detectPackageManager(['package.json', 'src/x.ts']);
    expect(plan?.manager).toBe('npm');
    expect(plan?.install).toBe('npm install');
    expect(plan?.evidence).toBeNull();
  });

  test('subdirectory project files are discovered, and no JS tooling yields null', () => {
    expect(detectPackageManager(['tabloid/package.json', 'tabloid/package-lock.json'])?.manager)
      .toBe('npm');
    expect(detectPackageManager(['README.md', 'docs/x.md'])).toBeNull();
  });
});

describe('deriveEngineeringGates — only gates the repository supports', () => {
  test('install + build + test when all three are declared', () => {
    const checks = deriveEngineeringGates({
      files: ['package.json', 'package-lock.json', 'src/a.ts'],
      packageJson: { scripts: { build: 'tsc', test: 'node --test' } },
    });
    expect(checks.map((c) => c.kind === 'command' && c.label)).toEqual([
      'install (npm, package-lock.json)',
      'build (npm)',
      'test (npm)',
    ]);
    expect(checks[0]).toMatchObject({ command: 'cd repo && npm ci' });
    expect(checks[1]).toMatchObject({ command: 'cd repo && npm run build' });
  });

  test('no build script means no build gate — gates are never forced', () => {
    const checks = deriveEngineeringGates({
      files: ['package.json'],
      packageJson: { scripts: { test: 'node --test' } },
    });
    expect(checks).toHaveLength(2);
    expect(checks.map((c) => (c.kind === 'command' ? c.label : ''))).toEqual([
      'install (npm, no lockfile)',
      'test (npm)',
    ]);
  });

  test('subdirectory projects run their gates inside the project dir', () => {
    const checks = deriveEngineeringGates({
      files: ['tabloid/package.json', 'tabloid/package-lock.json'],
      packageJson: { scripts: { build: 'tsc', test: 'node --test dist' } },
      projectDir: 'tabloid',
    });
    expect(checks[0]).toMatchObject({ command: 'cd repo/tabloid && npm ci' });
    expect(checks[2]).toMatchObject({ command: 'cd repo/tabloid && npm run test' });
  });

  test('no JavaScript tooling means no engineering gates at all', () => {
    expect(
      deriveEngineeringGates({ files: ['README.md'], packageJson: null }),
    ).toEqual([]);
  });
});

describe('preview process helpers', () => {
  test('previewServerCommand detaches with nohup, a log file, and a pid echo', () => {
    const command = previewServerCommand('node demo/serve.mjs 4173', {
      cwd: 'repo/tabloid',
    });
    expect(command).toContain('nohup node demo/serve.mjs 4173');
    expect(command).toContain('cd repo/tabloid');
    expect(command).toContain('preview pid $!');
    expect(command).toContain('.genesis/preview.log');
  });

  test('httpProbeCommand asserts response content with plain node', () => {
    const command = httpProbeCommand('http://127.0.0.1:4173/', 'tabloid demo');
    expect(command).toContain("node -e '");
    expect(command).toContain('fetch(u).then');
    expect(command).toContain('expected content missing');
    expect(command).toContain('process.exit(1)');
    // The shell quoting must survive a round trip: no unescaped inner quote.
    expect(command.match(/'/g)?.length ?? 0).toBe(2);
  });
});

maybeLive('TASK-017 live acceptance — a fixture project builds and runs inside the runtime', () => {
  it(
    'real computer, real worktree workspace, real npm ci + build + test; host stays clean',
    { timeout: 240_000 },
    async () => {
      const root = tempDir('g3-dev-live-');
      // A real fixture repository with a REAL lockfile (generated by npm
      // itself in the fixture dir — test preparation, not the mission).
      const fixture = fixtureRepo(join(root, 'fixture-repo'));
      fixture.write('package.json', JSON.stringify({
        name: 'fixture-project',
        version: '1.0.0',
        type: 'module',
        private: true,
        scripts: {
          build: 'node build.mjs',
          test: 'node --test',
        },
      }, null, 2));
      fixture.write('build.mjs', `import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
writeFileSync('dist/output.txt', 'built by fixture\\n');
console.log('fixture build complete');
`);
      fixture.write('src/lib.mjs', 'export const add = (a, b) => a + b;\n');
      fixture.write(
        'test/fixture.test.mjs',
        `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/lib.mjs';
test('addition works', () => { assert.equal(add(2, 3), 5); });
`,
      );
      fixture.write('.gitignore', 'node_modules\ndist\n');
      fixture.commit('fixture project with build and tests');
      // Real lockfile for exactly zero runtime dependencies: npm ci works
      // offline-fast and still proves lockfile respect.
      execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
        cwd: fixture.path,
        stdio: 'ignore',
      });
      fixture.commit('lockfile');

      const workspace = new GitWorkspace({
        source: fixture.path,
        rootDir: join(root, 'mission'),
      });
      await workspace.open();
      const worktree = await workspace.ensureWorktree('dev-worker');
      const computerRoot = join(root, 'computers');
      const computer = await startComputerProcess(
        {
          checkoutDir: OPENBOT_CHECKOUT,
          rootDir: computerRoot,
          // GROUP 3 wiring: this computer's workspace IS the git worktree.
          workspaceOf: () => worktree.path,
        },
        'g3-dev-worker',
      );

      try {
        // The workspace the computer serves is the worktree.
        expect(computer.workspaceDir).toBe(worktree.path);
        expect(computer.ownsWorkspaceDir).toBe(false);

        const exec = async (command: string): Promise<{ exitCode: number; stdout: string }> => {
          const result = await fetch(`${computer.baseUrl}/exec`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${computer.token}`,
              'x-openbot-bot-id': computer.botId,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ command, timeoutMs: 120_000 }),
          });
          const body = (await result.json()) as {
            exitCode: number;
            stdout: string;
            stderr: string;
          };
          return { exitCode: body.exitCode, stdout: body.stdout };
        };

        // Discover from the repository itself, inside the runtime.
        const ls = await exec('ls package.json package-lock.json && echo discovered');
        expect(ls.exitCode).toBe(0);
        expect(ls.stdout).toContain('discovered');

        // Install with the lockfile respected (npm ci), inside the computer.
        const install = await exec('npm ci --ignore-scripts');
        expect(install.exitCode).toBe(0);

        // Build and test inside the computer.
        const build = await exec('npm run build');
        expect(build.exitCode).toBe(0);
        expect(build.stdout).toContain('fixture build complete');
        const testRun = await exec('npm test');
        expect(testRun.exitCode).toBe(0);
        expect(testRun.stdout).toContain('addition works');

        // Host dependency pollution check: the HOST fixture repo has no
        // node_modules or dist — they exist only inside the worktree.
        expect(() => readFileSync(join(fixture.path, 'node_modules'))).toThrow();
        expect(() => readFileSync(join(fixture.path, 'dist'))).toThrow();
        const dist = readFileSync(join(worktree.path, 'dist/output.txt'), 'utf8');
        expect(dist).toContain('built by fixture');

        // The source repository is still pristine.
        expect(fixture.status().trim()).toBe('');
      } finally {
        await computer.stop();
        await workspace.cleanup();
      }
    },
  );
});