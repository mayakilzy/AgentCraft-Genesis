/**
 * G7-18B — Mission Input Bridge tests (Phase C).
 *
 * Verifies that the gateway's newly-wired `missionInputs` field:
 *   1. Accepts valid files (TEST-01).
 *   2. Rejects invalid paths — absolute, `..`, backslash, leading/trailing
 *      slash, `.` segments, NUL bytes (TEST-02..TEST-02h).
 *   3. Rejects duplicate and parent/child conflicting paths (TEST-03..TEST-04).
 *   4. Rejects oversized inputs — per-file, total, count (TEST-05..TEST-07).
 *   5. Preserves backward compatibility for submissions without inputs (TEST-08).
 *   6. Stages files into the real worker workspace through the orchestrator (TEST-09).
 *   7. Staged files are byte-for-byte correct before worker execution (TEST-10).
 *   8. Inputs cannot escape workspace containment (TEST-11).
 *   9. Input contents are not leaked into routine logs (TEST-12).
 *
 * No ZAI calls. Uses the shared helpers' MemoryRuntime + scripted reasoning
 * provider (DEVELOPMENT_REASONING_FALLBACK). The default reasoning writes
 * `output.md` and finishes; staged inputs persist in the worker's workspace
 * because the orchestrator writes them BEFORE the worker starts.
 */
import { describe, it, expect } from 'vitest';
import { httpCall, SIMPLE_GOAL, CALLER_A, service } from './helpers.js';

describe('G7-18B — Mission Input Bridge (Phase C)', () => {
  // ─── TEST-01: valid files are accepted ──────────────────────────────
  it('TEST-01: valid missionInputs submission is accepted (202)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: SIMPLE_GOAL,
        missionInputs: [
          { path: 'input.txt', contents: 'hello world' },
          { path: 'src/app.js', contents: 'console.log("hi");' },
          { path: 'data/orders.json', contents: '[]' },
        ],
      },
      'key-a',
    );
    expect(submit.status).toBe(202);
    expect((submit.body as { accepted: boolean }).accepted).toBe(true);
  });

  // ─── TEST-02: invalid paths are rejected ───────────────────────────
  it('TEST-02a: absolute path rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: '/etc/passwd', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02b: `..` traversal rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: '../outside.txt', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02c: nested `..` traversal rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: 'a/../../outside.txt', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02d: backslash separator rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: 'foo\\bar.txt', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02e: leading slash rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: '/foo.txt', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02f: trailing slash rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: 'foo/', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02g: `.` segment rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: './foo.txt', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02h: NUL byte in path rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: 'foo\0bar.txt', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02i: NUL byte in contents rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: 'foo.txt', contents: 'x\0y' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02j: empty path rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: '', contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02k: non-string path rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: 123, contents: 'x' }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02l: non-object entry rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: ['not-an-object'] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-02m: non-array missionInputs rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: 'not-an-array' },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  // ─── TEST-03: duplicate paths rejected ──────────────────────────────
  it('TEST-03: duplicate paths rejected (400)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: SIMPLE_GOAL,
        missionInputs: [
          { path: 'foo.txt', contents: 'a' },
          { path: 'foo.txt', contents: 'b' },
        ],
      },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  // ─── TEST-04: parent/child conflicts rejected ──────────────────────
  it('TEST-04a: file-then-child conflict rejected (400)', async () => {
    // `a/b` is staged as a file, then `a/b/c` would require `a/b` to be a directory.
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: SIMPLE_GOAL,
        missionInputs: [
          { path: 'a/b', contents: 'file' },
          { path: 'a/b/c', contents: 'child' },
        ],
      },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  it('TEST-04b: child-then-parent conflict rejected (400)', async () => {
    // `a/b/c` is staged, then `a/b` would have to be both file and directory.
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: SIMPLE_GOAL,
        missionInputs: [
          { path: 'a/b/c', contents: 'child' },
          { path: 'a/b', contents: 'file' },
        ],
      },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  // ─── TEST-05: per-file size limit ───────────────────────────────────
  it('TEST-05: per-file size > 256 KiB rejected (400)', async () => {
    const big = 'x'.repeat(256 * 1024 + 1);
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [{ path: 'big.txt', contents: big }] },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  // ─── TEST-06: total size limit ──────────────────────────────────────
  it('TEST-06: total size > 768 KiB rejected (400)', async () => {
    // 4 files of 200 KiB each = 800 KiB > 768 KiB (MISSION_INPUT_MAX_TOTAL_BYTES).
    // 200 KiB per file is under the 256 KiB per-file limit.
    // Total payload = 800 KiB + JSON overhead ≈ 810 KiB < 1 MB request body limit.
    const medium = 'x'.repeat(200 * 1024);
    const inputs = Array.from({ length: 4 }, (_, i) => ({
      path: `f${i}.txt`,
      contents: medium,
    }));
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: inputs },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  // ─── TEST-07: file count limit ──────────────────────────────────────
  it('TEST-07: file count > 64 rejected (400)', async () => {
    const inputs = Array.from({ length: 65 }, (_, i) => ({
      path: `f${i}.txt`,
      contents: 'x',
    }));
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: inputs },
      'key-a',
    );
    expect(submit.status).toBe(400);
  });

  // ─── TEST-08: backward compatibility ────────────────────────────────
  it('TEST-08: submission without missionInputs still works (backward compat)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL },
      'key-a',
    );
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);
    const result = await httpCall('GET', `/v1/missions/${missionId}/result`, null, 'key-a');
    expect(result.status).toBe(200);
    const body = result.body as { status: string };
    expect(body.status).toBe('SUCCEEDED');
  });

  it('TEST-08b: submission with empty missionInputs array works (backward compat)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, missionInputs: [] },
      'key-a',
    );
    expect(submit.status).toBe(202);
  });

  // ─── TEST-09: files reach the worker workspace ──────────────────────
  it('TEST-09: staged files appear in worker artifacts (workspace staging)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: SIMPLE_GOAL,
        missionInputs: [
          { path: 'staged-input.txt', contents: 'staged-content-here' },
          { path: 'src/config.json', contents: '{"key":"value"}' },
        ],
      },
      'key-a',
    );
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const art = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'key-a');
    expect(art.status).toBe(200);
    const artBody = art.body as { artifacts: Array<{ path: string; content?: string }> };
    const paths = artBody.artifacts.map((a) => a.path);
    // Both staged inputs must be present in the worker's workspace.
    expect(paths).toContain('staged-input.txt');
    expect(paths).toContain('src/config.json');
    // The default reasoning writes `output.md` too — it should also be present.
    expect(paths).toContain('output.md');
  });

  // ─── TEST-10: byte-for-byte correctness ─────────────────────────────
  it('TEST-10: staged files are byte-for-byte correct before worker execution', async () => {
    const magicContents = 'byte-fidelity-marker-9f8a7b3c';
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: SIMPLE_GOAL,
        missionInputs: [{ path: 'fidelity.txt', contents: magicContents }],
      },
      'key-a',
    );
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const art = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'key-a');
    const artBody = art.body as { artifacts: Array<{ path: string; content?: string }> };
    const fidelity = artBody.artifacts.find((a) => a.path === 'fidelity.txt');
    expect(fidelity).toBeDefined();
    expect(fidelity?.content).toBe(magicContents);
  });

  // ─── TEST-11: workspace containment ────────────────────────────────
  it('TEST-11: staged files cannot escape workspace containment (paths rejected)', async () => {
    // The validation rejects all escape attempts at the transport boundary.
    // Even if a caller tries `../../../etc/cron.d/evil`, the path is rejected
    // with 400 before any file is written. This test verifies the rejection
    // path; TEST-09 verifies that ACCEPTED paths land inside the workspace.
    const escapeAttempts = [
      '../../../etc/cron.d/evil',
      'a/../../b',
      '/etc/passwd',
      'foo/../../bar',
      '..',
      'foo/..',
    ];
    for (const path of escapeAttempts) {
      const submit = await httpCall(
        'POST',
        '/v1/missions',
        { outcome: SIMPLE_GOAL, missionInputs: [{ path, contents: 'x' }] },
        'key-a',
      );
      expect(submit.status).toBe(400);
    }
  });

  // ─── TEST-12: no content leaks in logs ──────────────────────────────
  it('TEST-12: input contents are not leaked into routine logs (events)', async () => {
    const secretMarker = 'SECRET-MARKER-do-not-leak-7c3a9f1b';
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: SIMPLE_GOAL,
        missionInputs: [{ path: 'secret.txt', contents: secretMarker }],
      },
      'key-a',
    );
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events?limit=200`, null, 'key-a');
    expect(eventsRes.status).toBe(200);
    const eventsBody = eventsRes.body as { events: Array<{ type: string; payload: Record<string, unknown> }> };

    // The secret marker must NOT appear in any event payload's stringified form.
    // The orchestrator's staging loop writes files silently (only emits a
    // stage-input event on FAILURE, which contains the path but not contents).
    // The worker's task brief DOES list the paths and byte-counts of staged
    // inputs, but the task brief is NOT part of the event stream — it's
    // internal to the worker. So neither the path nor the contents need to
    // appear in events; the contents MUST NOT appear.
    const eventJson = JSON.stringify(eventsBody.events);
    expect(eventJson).not.toContain(secretMarker);
  });
});
