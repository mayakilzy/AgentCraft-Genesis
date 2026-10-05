import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readlink, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { ComputerApiClient } from './computer-api.js';

/**
 * Process-mode deployment of the upstream agent-computer service (TASK-010).
 *
 * The canonical OpenBot deployment gives every Bot its own computer CONTAINER
 * through the supervisor (ensure/stop/reset over the Docker socket). Where no
 * container runtime exists — this development sandbox — the same upstream
 * service can be started as one process per worker, with the per-worker
 * isolation the container would otherwise provide expressed through the
 * service's own documented configuration: a dedicated WORKSPACE_DIR, a
 * dedicated PROFILES_DIR, a dedicated port and a per-worker COMPUTER_TOKEN.
 *
 * This is a deployment shim, not a computer manager: it manages no images,
 * networks, volumes or isolation policies, and the upstream source is run
 * unmodified from its own checkout. On Docker-capable infrastructure the
 * supervisor performs this role and the adapter keeps the same boundary.
 *
 * EGRESS_POLICY_REQUIRED=0 is the upstream-documented setting for a computer
 * run without the OpenBot API server to push a network policy (v0.1.0
 * release notes); the egress filter still runs, it simply does not hard-fail
 * before a policy arrives.
 */

/** Upstream bot-id rule (agent-computer/src/bot-id.ts): plain, single segment. */
const BOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_BOT_ID = 64;

export function isOpenBotBotId(value: string): boolean {
  return value.length <= MAX_BOT_ID && BOT_ID_PATTERN.test(value);
}

export class ComputerProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComputerProcessError';
  }
}

export interface ComputerProcessConfig {
  /** Root of the upstream OpenBot checkout (its own repo — never vendored). */
  readonly checkoutDir: string;
  /** Directory under which per-worker workspace/profile dirs are created. */
  readonly rootDir: string;
  /**
   * GROUP 3 (TASK-017): per-worker workspace placement. Repository missions
   * point a worker's WORKSPACE_DIR at the git worktree that worker owns,
   * instead of the default rootDir/<botId>/workspace. The default stays
   * exactly as before when this is absent.
   */
  readonly workspaceOf?: (botId: string) => string;
  /** Bun executable (default: `bun`). */
  readonly bunPath?: string;
  /** Startup budget (default 20s). */
  readonly startTimeoutMs?: number;
  /** Extra environment for the computer process. */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** Raw process output sink (flight recorder raw log). Diagnostics only. */
  readonly onOutput?: (chunk: string) => void;
}

/** One running upstream computer process bound to a single worker. */
export interface RunningComputer {
  readonly botId: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly token: string;
  readonly workspaceDir: string;
  /**
   * False when the workspace path was placed by the caller (GROUP 3 repo
   * missions: a git worktree). Such workspaces are NOT deleted on reset —
   * their lifecycle belongs to the GitWorkspace that created them.
   */
  readonly ownsWorkspaceDir: boolean;
  /** Bounded process output for diagnostics (raw, never treated as learning). */
  readonly outputTail: () => string;
  /** Resolve with the exit code when the process ends. */
  readonly exited: Promise<number>;
  /** SIGTERM, then SIGKILL after a grace period — `docker stop` semantics. */
  readonly stop: () => Promise<void>;
}

/** Ask the OS for a free TCP port (listen on 0, read back, close). */
async function findFreePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const OUTPUT_TAIL_LIMIT = 8 * 1024;

/**
 * PIDs of live processes whose working directory is under one of the given
 * directories — the realistic trail of everything exec'd inside a computer
 * (upstream runs every command with cwd = the workspace). Upstream gives
 * each exec'd command its own process group, so a nohup-ed server escapes
 * a group kill once its parent bash exits; its cwd does not escape.
 * Excluded: the caller itself and the computer's own pid.
 */
async function pidsWorkingUnder(
  dirs: readonly string[],
  exclude: ReadonlySet<number>,
): Promise<number[]> {
  const pids: number[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir('/proc');
  } catch {
    return pids; // not Linux procfs — best effort only
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (exclude.has(pid)) continue;
    try {
      const cwd = await readlink(`/proc/${entry}/cwd`);
      if (dirs.some((dir) => cwd === dir || cwd.startsWith(`${dir}/`))) {
        pids.push(pid);
      }
    } catch {
      // process gone, or not ours to inspect — skip it
    }
  }
  return pids;
}

const signalPids = (pids: readonly number[], signal: NodeJS.Signals): void => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone, or not ours — best effort
    }
  }
};

export async function startComputerProcess(
  config: ComputerProcessConfig,
  botId: string,
): Promise<RunningComputer> {
  if (!isOpenBotBotId(botId)) {
    throw new ComputerProcessError(
      `worker id "${botId}" is not a usable OpenBot bot id ` +
        '(letters, digits, hyphen, underscore; starts alphanumeric; max 64)',
    );
  }

  const workingDir = join(config.checkoutDir, 'agent-computer');
  const ownsWorkspaceDir = config.workspaceOf === undefined;
  const workspaceDir =
    config.workspaceOf?.(botId) ?? join(config.rootDir, botId, 'workspace');
  const profilesDir = join(config.rootDir, botId, 'profiles');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(profilesDir, { recursive: true });

  const port = await findFreePort();
  const token = randomBytes(24).toString('base64url');

  const child = spawn(config.bunPath ?? 'bun', ['src/index.ts'], {
    cwd: workingDir,
    env: {
      ...process.env,
      PORT: String(port),
      COMPUTER_TOKEN: token,
      WORKSPACE_DIR: workspaceDir,
      PROFILES_DIR: profilesDir,
      EGRESS_POLICY_REQUIRED: '0',
      ...config.extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // GROUP 3 fix, exposed by Experiment 002 evidence: a dedicated process
    // group lets stop() terminate EVERY process the computer spawned
    // (shells, nohup'd preview servers, Chromium). Without it, a nohup'd
    // server outlives stop() and poisons later missions on the same port.
    // The container deployment upstream gets this from `docker stop`
    // killing the whole PID namespace; this restores those semantics in
    // process mode. The group persists after the leader exits, so orphans
    // are still reachable for the kill below.
    detached: true,
  }) as ChildProcess;

  let tail = '';
  const append = (chunk: Buffer | string): void => {
    const text = String(chunk);
    tail = (tail + text).slice(-OUTPUT_TAIL_LIMIT);
    config.onOutput?.(text);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  const exited = new Promise<number>((resolve) => {
    child.once('exit', (code) => resolve(code ?? 1));
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const probe = new ComputerApiClient({ baseUrl, token, botId });

  const deadline = Date.now() + (config.startTimeoutMs ?? 20_000);
  let healthy = false;
  while (Date.now() < deadline) {
    if ((await Promise.race([exited, Promise.resolve(-1)])) !== -1) {
      throw new ComputerProcessError(
        `agent-computer for "${botId}" exited during startup:\n${tail}`,
      );
    }
    try {
      const health = await probe.health();
      if (health.status === 'ok') {
        healthy = true;
        break;
      }
    } catch {
      // not listening yet — retry within the startup budget
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!healthy) {
    child.kill('SIGKILL');
    throw new ComputerProcessError(
      `agent-computer for "${botId}" did not become healthy within ` +
        `${config.startTimeoutMs ?? 20_000}ms:\n${tail}`,
    );
  }

  const stop = async (): Promise<void> => {
    // Best-effort graceful browser stop first (upstream /computers/stop).
    // Then two-stage termination, restoring `docker stop` semantics as far
    // as a container-less deployment can:
    //   1. the computer's own process group (leader + non-detached
    //      children) — SIGTERM, SIGKILL after grace;
    //   2. the cwd sweep — upstream runs every exec'd command with its own
    //      process group (agent-computer/src/shell.ts), so a nohup-ed
    //      server escapes stage 1 once its parent bash exits; its working
    //      directory stays inside the workspace, which is what this stage
    //      catches. In the container deployment stage 2 is what the PID
    //      namespace provides for free.
    try {
      await probe.stopBrowser();
    } catch {
      // the process may already be gone; the kill below is the real stop
    }
    const pgid = child.pid;
    if (pgid !== undefined) {
      const killGroup = (signal: NodeJS.Signals): void => {
        try {
          process.kill(-pgid, signal);
        } catch {
          // the group is already gone — nothing left to stop
        }
      };
      killGroup('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          killGroup('SIGKILL');
          resolve();
        }, 2_000);
        exited.finally(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    // Stage 2: processes still working inside this computer's directories.
    const exclude = new Set<number>([process.pid]);
    if (child.pid !== undefined) exclude.add(child.pid);
    const escaped = await pidsWorkingUnder(
      [workspaceDir, profilesDir],
      exclude,
    );
    if (escaped.length > 0) {
      signalPids(escaped, 'SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      signalPids(escaped, 'SIGKILL');
    }
  };

  return {
    botId,
    port,
    baseUrl,
    token,
    workspaceDir,
    ownsWorkspaceDir,
    outputTail: () => tail,
    exited,
    stop,
  };
}

/** Forget everything: stop the process and delete the worker's directories. */
export async function resetComputerProcess(
  running: RunningComputer,
): Promise<void> {
  await running.stop();
  if (!running.ownsWorkspaceDir) {
    // Caller-placed workspace (a git worktree): its lifecycle is owned by
    // the caller — deleting the parent here could destroy the worktree
    // root and every sibling worktree with it.
    return;
  }
  await rm(join(running.workspaceDir, '..'), {
    recursive: true,
    force: true,
  });
}
