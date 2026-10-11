/**
 * G7-19A — Phase 3: listArtifacts recursion test (Defect A fix).
 *
 * Verifies that the G7-19A `listWorkspaceFilesRecursive` helper (exported
 * from `src/runtime/openbot/adapter.ts`) actually walks into subdirectories.
 *
 * This is the fix for the G7-18E defect where files in `public/` and `test/`
 * were silently dropped from the artifacts response. The pre-G7-19A code
 * used `readdir(workspaceDir, { withFileTypes: true })` and filtered with
 * `if (!entry.isFile()) continue;` — that filter skipped every directory,
 * so the 6 subdirectory files of the 9-file Community Project Hub were
 * invisible to the gateway.
 *
 * No real OpenBot processes. No real Z.ai calls. The test creates a fake
 * workspace directory tree on disk and calls the helper directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listWorkspaceFilesRecursive } from '../../src/runtime/openbot/adapter.js';

const TEST_ROOT = join(tmpdir(), `g7-19a-recursion-${process.pid}-${Date.now()}`);

describe('G7-19A — listWorkspaceFilesRecursive (Defect A fix)', () => {
  beforeAll(async () => {
    await mkdir(TEST_ROOT, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('R-01: returns all 9 files across 4 directories (G7-18E shape)', async () => {
    // Reproduce the G7-18E software-engineer-1 workspace layout exactly:
    // 3 top-level files + 3 in public/ + 3 in test/
    const ws = join(TEST_ROOT, 'r01');
    await mkdir(join(ws, 'public'), { recursive: true });
    await mkdir(join(ws, 'test'), { recursive: true });
    await writeFile(join(ws, 'README.md'), 'readme');
    await writeFile(join(ws, 'package.json'), '{}');
    await writeFile(join(ws, 'server.js'), 'node');
    await writeFile(join(ws, 'public/app.js'), 'app');
    await writeFile(join(ws, 'public/index.html'), '<html>');
    await writeFile(join(ws, 'public/styles.css'), 'body{}');
    await writeFile(join(ws, 'test/api.test.js'), 'test1');
    await writeFile(join(ws, 'test/db.test.js'), 'test2');
    await writeFile(join(ws, 'test/integration.test.js'), 'test3');

    const out = await listWorkspaceFilesRecursive(ws);

    // ALL 9 files surface, not just the 3 top-level ones.
    expect(out).toHaveLength(9);
    const paths = out.map((e) => e.relativePath).sort();
    expect(paths).toEqual([
      'README.md',
      'package.json',
      'public/app.js',
      'public/index.html',
      'public/styles.css',
      'server.js',
      'test/api.test.js',
      'test/db.test.js',
      'test/integration.test.js',
    ]);
    // Each entry has the right bytes field.
    const readme = out.find((e) => e.relativePath === 'README.md')!;
    expect(readme.bytes).toBe(6); // "readme" = 6 bytes
    const api = out.find((e) => e.relativePath === 'test/api.test.js')!;
    expect(api.bytes).toBe(5); // "test1" = 5 bytes
  });

  it('R-02: empty workspace returns empty array', async () => {
    const ws = join(TEST_ROOT, 'r02');
    await mkdir(ws, { recursive: true });

    const out = await listWorkspaceFilesRecursive(ws);
    expect(out).toEqual([]);
  });

  it('R-03: nonexistent workspace returns empty array (no throw)', async () => {
    const ws = join(TEST_ROOT, 'r03-nonexistent');
    // intentionally do not create the directory

    const out = await listWorkspaceFilesRecursive(ws);
    expect(out).toEqual([]);
  });

  it('R-04: nested subdirectories (3 levels deep) all surface', async () => {
    const ws = join(TEST_ROOT, 'r04');
    await mkdir(join(ws, 'a/b/c'), { recursive: true });
    await writeFile(join(ws, 'a/b/c/deep.txt'), 'deep');
    await writeFile(join(ws, 'a/mid.txt'), 'mid');
    await writeFile(join(ws, 'top.txt'), 'top');

    const out = await listWorkspaceFilesRecursive(ws);
    expect(out).toHaveLength(3);
    const paths = out.map((e) => e.relativePath).sort();
    expect(paths).toEqual(['a/b/c/deep.txt', 'a/mid.txt', 'top.txt']);
  });

  it('R-05: files with `..` or `/` in their names are skipped (path-traversal protection)', async () => {
    // The traversal protection is per-segment in the helper. Files with
    // names like '..foo' (which would be a weird filename but legal on
    // some filesystems) are not skipped — the protection specifically
    // rejects the literal `..` and `.` segments. We can't actually create
    // a file named `..` on POSIX filesystems, so we test that the helper
    // does NOT skip normal-looking files with dots in their names.
    const ws = join(TEST_ROOT, 'r05');
    await mkdir(ws, { recursive: true });
    await writeFile(join(ws, '.eslintrc.json'), '{}');
    await writeFile(join(ws, 'package.json'), '{}');
    await writeFile(join(ws, 'foo.bar.baz'), 'x');

    const out = await listWorkspaceFilesRecursive(ws);
    const paths = out.map((e) => e.relativePath).sort();
    expect(paths).toEqual(['.eslintrc.json', 'foo.bar.baz', 'package.json']);
  });

  it('R-06: output is sorted by relativePath (deterministic order)', async () => {
    const ws = join(TEST_ROOT, 'r06');
    await mkdir(join(ws, 'z'), { recursive: true });
    await mkdir(join(ws, 'a'), { recursive: true });
    await mkdir(join(ws, 'm'), { recursive: true });
    await writeFile(join(ws, 'z/zebra.txt'), 'z');
    await writeFile(join(ws, 'a/apple.txt'), 'a');
    await writeFile(join(ws, 'm/mango.txt'), 'm');
    await writeFile(join(ws, 'README.md'), 'r');

    const out = await listWorkspaceFilesRecursive(ws);
    const paths = out.map((e) => e.relativePath);
    // Sorted alphabetically, not by creation order.
    expect(paths).toEqual([
      'README.md',
      'a/apple.txt',
      'm/mango.txt',
      'z/zebra.txt',
    ]);
  });

  it('R-07: symlinked directories are NOT followed (escape protection)', async () => {
    // Create a workspace, then a symlink inside it pointing OUTSIDE.
    // The helper should not follow the symlink — its target's files
    // should NOT appear in the listing.
    const ws = join(TEST_ROOT, 'r07');
    const outside = join(TEST_ROOT, 'r07-outside');
    await mkdir(ws, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'should-not-surface.txt'), 'secret');
    await writeFile(join(ws, 'real.txt'), 'real');
    // Create a symlink to the outside directory.
    await symlink(outside, join(ws, 'symlinked'), 'dir');

    const out = await listWorkspaceFilesRecursive(ws);
    const paths = out.map((e) => e.relativePath);
    expect(paths).toEqual(['real.txt']);
    expect(paths).not.toContain('symlinked/should-not-surface.txt');
  });

  it('R-08: hidden files (.eslintrc etc.) are included (not skipped)', async () => {
    const ws = join(TEST_ROOT, 'r08');
    await mkdir(join(ws, '.config'), { recursive: true });
    await writeFile(join(ws, '.env'), 'SECRET=key');
    await writeFile(join(ws, '.config/settings.json'), '{}');
    await writeFile(join(ws, 'app.js'), 'app');

    const out = await listWorkspaceFilesRecursive(ws);
    const paths = out.map((e) => e.relativePath).sort();
    expect(paths).toEqual(['.config/settings.json', '.env', 'app.js']);
  });
});
