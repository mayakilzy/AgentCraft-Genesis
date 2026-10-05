import type { AcceptanceCheck } from '../mission/verification.js';

/**
 * Development Runtime Adapter (TASK-017): run package install / build /
 * test / dev processes where they belong — INSIDE an OpenBot computer, in
 * the repository copy that computer owns.
 *
 * What this module deliberately is NOT: a universal package-manager
 * wrapper. It is discovery plus command derivation — pure functions that
 * turn "what this repository looks like" into the exact shell commands a
 * computer should run. Execution stays with the existing exec surface, so
 * there is no second process manager, no port registry, no log platform:
 * logs are files in the workspace, ports are arguments, lifecycle is
 * `nohup … &` plus the computer's own teardown.
 *
 * Lockfiles are respected: a repository that pins with package-lock.json
 * gets `npm ci`, one that pins with bun.lock gets `bun install
 * --frozen-lockfile`, and so on. A repository without JavaScript tooling
 * gets no forced gates at all ("لا تفرض gates غير منطقية").
 */

export type PackageManagerName =
  | 'npm'
  | 'bun'
  | 'yarn'
  | 'pnpm'
  | 'deno';

export interface PackageManagerPlan {
  readonly manager: PackageManagerName;
  /** The lockfile that decided the manager (null for a lockless package.json). */
  readonly evidence: string | null;
  /** Install command that respects the lockfile when one exists. */
  readonly install: string;
  /** Run a package.json script by name. */
  readonly script: (name: string) => string;
}

const LOCKFILE_ORDER: readonly { readonly file: string; readonly plan: Omit<PackageManagerPlan, 'evidence'> }[] = [
  {
    file: 'bun.lock',
    plan: {
      manager: 'bun',
      install: 'bun install --frozen-lockfile',
      script: (name) => `bun run ${name}`,
    },
  },
  {
    file: 'bun.lockb',
    plan: {
      manager: 'bun',
      install: 'bun install --frozen-lockfile',
      script: (name) => `bun run ${name}`,
    },
  },
  {
    file: 'package-lock.json',
    plan: {
      manager: 'npm',
      install: 'npm ci',
      script: (name) => `npm run ${name}`,
    },
  },
  {
    file: 'yarn.lock',
    plan: {
      manager: 'yarn',
      install: 'yarn install --frozen-lockfile',
      script: (name) => `yarn ${name}`,
    },
  },
  {
    file: 'pnpm-lock.yaml',
    plan: {
      manager: 'pnpm',
      install: 'pnpm install --frozen-lockfile',
      script: (name) => `pnpm run ${name}`,
    },
  },
  {
    file: 'deno.lock',
    plan: {
      manager: 'deno',
      install: 'deno install',
      script: (name) => `deno task ${name}`,
    },
  },
];

/**
 * Discover the package manager from the repository's own files — never
 * imposed from outside. `projectFiles` are repo-relative paths of the
 * target project. Returns null when the project has no JavaScript
 * toolchain to drive.
 */
export function detectPackageManager(
  projectFiles: readonly string[],
): PackageManagerPlan | null {
  for (const { file, plan } of LOCKFILE_ORDER) {
    if (projectFiles.some((path) => path === file || path.endsWith(`/${file}`))) {
      return { ...plan, evidence: file };
    }
  }
  if (projectFiles.some((path) => path === 'package.json' || path.endsWith('/package.json'))) {
    return {
      manager: 'npm',
      evidence: null,
      install: 'npm install',
      script: (name) => `npm run ${name}`,
    };
  }
  return null;
}

export interface PackageJsonMeta {
  readonly scripts?: Readonly<Record<string, string>>;
}

export interface EngineeringGateOptions {
  /** Repo-relative tracked files of the target project (lockfile evidence). */
  readonly files: readonly string[];
  /** Parsed package.json of the target project (null when absent). */
  readonly packageJson: PackageJsonMeta | null;
  /** Project directory inside the repo ('' for the root, e.g. 'tabloid'). */
  readonly projectDir?: string;
  /** Where the repository clone lives in the executing workspace (default 'repo'). */
  readonly repoDir?: string;
}

/** Join a cwd prefix onto a command (no prefix → command unchanged). */
function withCwd(cwd: string, command: string): string {
  return cwd === '' ? command : `cd ${cwd} && ${command}`;
}

/**
 * Derive the engineering gates a repository actually supports — the
 * completion contract's repo-specific floor (TASK-019 consumes this):
 *
 *   - install: always, when a package manager was discovered;
 *   - build: only when the project declares a build script;
 *   - test: only when the project declares a test script.
 *
 * Browser/E2E gates are NOT derived here: they apply only when the goal
 * itself has a UI acceptance requirement (GROUP 3 review rule 7) and are
 * composed by the mission, not guessed from files.
 */
export function deriveEngineeringGates(
  options: EngineeringGateOptions,
): AcceptanceCheck[] {
  const plan = detectPackageManager(options.files);
  if (plan === null || options.packageJson === null) {
    return [];
  }
  const projectDir = options.projectDir ?? '';
  const repoDir = options.repoDir ?? 'repo';
  const cwd = [repoDir, projectDir].filter((part) => part !== '').join('/');
  const scripts = options.packageJson.scripts ?? {};

  const checks: AcceptanceCheck[] = [
    {
      kind: 'command',
      label: `install (${plan.manager}${plan.evidence === null ? ', no lockfile' : `, ${plan.evidence}`})`,
      command: withCwd(cwd, plan.install),
    },
  ];
  if (typeof scripts.build === 'string') {
    checks.push({
      kind: 'command',
      label: `build (${plan.manager})`,
      command: withCwd(cwd, plan.script('build')),
    });
  }
  if (typeof scripts.test === 'string') {
    checks.push({
      kind: 'command',
      label: `test (${plan.manager})`,
      command: withCwd(cwd, plan.script('test')),
    });
  }
  return checks;
}

/**
 * Start a long-running dev/preview process inside a computer: detached via
 * nohup, output to a log file in the workspace (the computer's own teardown
 * ends it — no process manager). Returns the command to run; it prints the
 * pid so mission code can reference it.
 */
export function previewServerCommand(
  command: string,
  options: {
    readonly cwd?: string;
    readonly logFile?: string;
  } = {},
): string {
  const cwd = options.cwd ?? '.';
  const logFile = options.logFile ?? '.genesis/preview.log';
  return (
    `mkdir -p .genesis && cd ${cwd} && ` +
    `nohup ${command} > "../${logFile}" 2>&1 & echo "preview pid $!"`
  );
}

/**
 * A deterministic HTTP probe that runs inside any computer with node:
 * fetch a URL and require a substring of the response body. Used for
 * preview verification (TASK-018) without a curl dependency.
 */
export function httpProbeCommand(
  url: string,
  expectIncludes: string,
): string {
  // The -e script is single-quoted; inner strings double-quoted, so no
  // quote nesting breaks the shell. Single quotes inside either argument
  // are escaped POSIX-style.
  const shellLiteral = (value: string): string =>
    `'${value.replace(/'/g, `'\\''`)}'`;
  const script =
    `const u=${JSON.stringify(url)},n=${JSON.stringify(expectIncludes)};` +
    `fetch(u).then(r=>r.text()).then(t=>{` +
    `if(!t.includes(n)){console.error("probe: expected content missing");process.exit(1)}` +
    `console.log("probe: ok")` +
    `}).catch(e=>{console.error("probe: "+e.message);process.exit(1)})`;
  return `node -e ${shellLiteral(script)}`;
}
