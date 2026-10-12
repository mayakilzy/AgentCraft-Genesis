/**
 * LocalShellComputer — a WorkerComputer that executes real shell commands
 * against a local directory. Used for deterministic integration tests
 * that need real command execution without spawning an OpenBot process.
 *
 * PILOT-002 R3.1 TASK 01: exercises the actual Runtime Acceptance Gate
 * against the known-bad PILOT-002 app (bad node:sqlite imports).
 */
import { exec } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative, resolve, sep } from 'node:path';

import type { WorkerComputer, WorkspaceEntry, ReadResult, WriteResult, ExecResult } from '../../src/runtime/computer.js';

export class LocalShellComputer implements WorkerComputer {
  constructor(private readonly workspaceDir: string) {}

  async exec(command: string): Promise<ExecResult> {
    return new Promise((resolveFn) => {
      exec(command, {
        cwd: this.workspaceDir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        resolveFn({
          command,
          exitCode: error ? (error as any).code ?? 1 : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          timedOut: error?.message?.includes('TIMEOUT') ?? false,
          elapsedMs: 0,
        });
      });
    });
  }

  async readFile(path: string): Promise<ReadResult> {
    const fullPath = this.resolveSafe(path);
    const text = await readFile(fullPath, 'utf8');
    return { path, text, bytes: Buffer.byteLength(text), truncated: false };
  }

  async writeFile(path: string, contents: string): Promise<WriteResult> {
    const fullPath = this.resolveSafe(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents, 'utf8');
    return { path, bytes: Buffer.byteLength(contents), appended: false };
  }

  async writeFileTrusted(path: string, contents: string): Promise<WriteResult> {
    return this.writeFile(path, contents);
  }

  async listFiles(): Promise<readonly WorkspaceEntry[]> {
    const entries: WorkspaceEntry[] = [];
    await this.walk(this.workspaceDir, '', entries);
    return entries;
  }

  private resolveSafe(path: string): string {
    if (path.includes('..')) throw new Error(`path traversal refused: ${path}`);
    if (path.startsWith('/')) throw new Error(`absolute path refused: ${path}`);
    return resolve(this.workspaceDir, path);
  }

  private async walk(base: string, prefix: string, out: WorkspaceEntry[]): Promise<void> {
    const entries = await readdir(base, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(base, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, rel, out);
      } else if (entry.isFile()) {
        const s = await stat(full);
        out.push({ path: rel, kind: 'file', bytes: s.size });
      }
    }
  }
}
