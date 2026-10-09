/**
 * G7-10 — Mission Visibility tests.
 *
 * Covers the GET /v1/missions (list) endpoint and MissionService.listMissions():
 *   B1 — Authenticated list returns a valid response.
 *   B2 — Caller isolation (caller A cannot enumerate caller B's missions).
 *   B3 — Pagination traversal without duplicates.
 *   B4 — Invalid input (bad limit, malformed cursor) handled safely.
 *   B7 — Terminal eviction: evicted missions disappear from the list.
 *   B8 — Restart limitation: empty registry returns empty list.
 *   B9 — Existing endpoints remain functional (submit + get still work).
 *
 * All tests use the real MissionService with MemoryRuntime (deterministic,
 * no external services) and the real HTTP server bound to ephemeral ports.
 */
import { describe, it, expect } from 'vitest';
import { httpCall, SIMPLE_GOAL, CALLER_A, CALLER_B, service } from './helpers.js';
import type { MissionListResult, MissionListSummary } from '../../src/gateway/types.js';

describe('G7-10 — Mission Visibility (GET /v1/missions)', () => {
  // Shared state: we submit a few missions as caller A and caller B in
  // beforeAll so the tests have a stable dataset. Tests that need a clean
  // registry create their own MissionService instance.

  it('B1: authenticated GET /v1/missions?limit=10 returns a valid response', async () => {
    // Submit a mission to ensure the registry is non-empty.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    // List with default limit.
    const res = await httpCall('GET', '/v1/missions?limit=10', null, 'key-a');
    expect(res.status).toBe(200);
    const body = res.body as MissionListResult;
    expect(body).toHaveProperty('missions');
    expect(body).toHaveProperty('nextCursor');
    expect(Array.isArray(body.missions)).toBe(true);
    expect(body.missions.length).toBeGreaterThan(0);
    expect(body.missions.length).toBeLessThanOrEqual(10);

    // Each summary has the required fields.
    const first = body.missions[0] as MissionListSummary;
    expect(first).toHaveProperty('missionId');
    expect(first).toHaveProperty('status');
    expect(first).toHaveProperty('terminal');
    expect(first).toHaveProperty('acceptedAt');
    expect(first).toHaveProperty('outcomePreview');
    expect(typeof first.missionId).toBe('string');
    expect(typeof first.acceptedAt).toBe('string');
    expect(typeof first.outcomePreview).toBe('string');
  });

  it('B1b: unauthenticated request returns 401', async () => {
    const res = await httpCall('GET', '/v1/missions?limit=10', null, null);
    expect(res.status).toBe(401);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('B2: caller isolation — caller A cannot enumerate caller B missions', async () => {
    // Submit one mission as caller A and one as caller B.
    const submitA = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const idA = (submitA.body as { missionId: string }).missionId;
    await service.awaitCompletion(idA, CALLER_A);

    const submitB = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-b');
    const idB = (submitB.body as { missionId: string }).missionId;
    await service.awaitCompletion(idB, CALLER_B);

    // Caller A's list should contain idA but NOT idB.
    const resA = await httpCall('GET', '/v1/missions?limit=50', null, 'key-a');
    expect(resA.status).toBe(200);
    const listA = (resA.body as MissionListResult).missions;
    const idsA = listA.map((m) => m.missionId);
    expect(idsA).toContain(idA);
    expect(idsA).not.toContain(idB);

    // Caller B's list should contain idB but NOT idA.
    const resB = await httpCall('GET', '/v1/missions?limit=50', null, 'key-b');
    expect(resB.status).toBe(200);
    const listB = (resB.body as MissionListResult).missions;
    const idsB = listB.map((m) => m.missionId);
    expect(idsB).toContain(idB);
    expect(idsB).not.toContain(idA);
  });

  it('B3: pagination traverses all missions without duplicates', async () => {
    // We need a controlled set of missions. Use the shared service (which
    // already has missions from other tests) and traverse with limit=2.
    // Collect all missionIds across pages and assert no duplicates.
    const allIds = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    const maxPages = 50; // safety bound

    while (pages < maxPages) {
      const path = cursor
        ? `/v1/missions?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/v1/missions?limit=2';
      const res = await httpCall('GET', path, null, 'key-a');
      expect(res.status).toBe(200);
      const body = res.body as MissionListResult;
      for (const m of body.missions) {
        // No duplicates across pages.
        expect(allIds.has(m.missionId)).toBe(false);
        allIds.add(m.missionId);
      }
      pages += 1;
      if (body.nextCursor === null) break;
      cursor = body.nextCursor;
    }

    // We should have traversed at least one page.
    expect(pages).toBeGreaterThanOrEqual(1);
    // The total count should be > 0 (we submitted missions in earlier tests).
    expect(allIds.size).toBeGreaterThan(0);
  });

  it('B4a: invalid limit (0) returns 400', async () => {
    const res = await httpCall('GET', '/v1/missions?limit=0', null, 'key-a');
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_LIMIT');
  });

  it('B4b: invalid limit (101) returns 400', async () => {
    const res = await httpCall('GET', '/v1/missions?limit=101', null, 'key-a');
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_LIMIT');
  });

  it('B4c: invalid limit (non-numeric) returns 400', async () => {
    const res = await httpCall('GET', '/v1/missions?limit=abc', null, 'key-a');
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_LIMIT');
  });

  it('B4d: evicted/invalid cursor returns empty page (not error)', async () => {
    // Use a cursor that definitely doesn't exist.
    const res = await httpCall(
      'GET',
      `/v1/missions?limit=10&cursor=${encodeURIComponent('nonexistent-mission-id-00000000')}`,
      null,
      'key-a',
    );
    expect(res.status).toBe(200);
    const body = res.body as MissionListResult;
    expect(body.missions).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('B7: terminal eviction — evicted missions disappear from the list', async () => {
    // Submit a mission, capture its id, then force-evict it via the sweeper
    // with a zero retention window. It should no longer appear in the list.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    // Confirm it appears in the list before eviction.
    const before = await httpCall('GET', '/v1/missions?limit=100', null, 'key-a');
    const beforeIds = ((before.body as MissionListResult).missions).map((m) => m.missionId);
    expect(beforeIds).toContain(missionId);

    // Force-evict by running the sweeper with a very old "now" (retention
    // window is 5 min by default; setting now to 1 hour in the future evicts
    // all terminal missions).
    service.sweepTerminalMissions(Date.now() + 60 * 60 * 1000);

    // Confirm it no longer appears.
    const after = await httpCall('GET', '/v1/missions?limit=100', null, 'key-a');
    const afterIds = ((after.body as MissionListResult).missions).map((m) => m.missionId);
    expect(afterIds).not.toContain(missionId);
  });

  it('B8: restart limitation — empty registry returns empty list', async () => {
    // Create a fresh MissionService (simulates a restart — empty registry).
    // We test the service method directly since spinning up a new HTTP server
    // in a test is expensive. The HTTP layer is covered by B1.
    const { MissionService } = await import('../../src/gateway/mission-service.js');
    const fresh = new MissionService({ defaultMissionTimeoutMs: 5_000 });
    const result = fresh.listMissions(CALLER_A, { limit: 10 });
    expect(result.missions).toEqual([]);
    expect(result.nextCursor).toBeNull();
    fresh.close();
  });

  it('B9: existing endpoints remain functional (submit + get)', async () => {
    // Regression: the new GET /v1/missions (list) route must NOT break
    // POST /v1/missions (submit) or GET /v1/missions/{id} (single).
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;

    const get = await httpCall('GET', `/v1/missions/${missionId}`, null, 'key-a');
    expect(get.status).toBe(200);
    const snap = get.body as { missionId: string; status: string };
    expect(snap.missionId).toBe(missionId);
    expect(['ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED']).toContain(snap.status);
  });

  it('B-extra: listMissions redacts outcome (no MissionResult in summary)', async () => {
    // The summary must NOT include the full MissionResult, failure details,
    // or idempotency key — only the redacted outcomePreview.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const res = await httpCall('GET', '/v1/missions?limit=50', null, 'key-a');
    const list = (res.body as MissionListResult).missions;
    const found = list.find((m) => m.missionId === missionId);
    expect(found).toBeDefined();
    // The summary must not have these fields.
    expect(found).not.toHaveProperty('result');
    expect(found).not.toHaveProperty('failureClass');
    expect(found).not.toHaveProperty('failureMessage');
    expect(found).not.toHaveProperty('idempotencyKey');
    // But it must have the redacted preview.
    expect(found!.outcomePreview).toBeDefined();
    expect(typeof found!.outcomePreview).toBe('string');
  });

  it('B-extra: deterministic sort order (newest first)', async () => {
    // Submit two missions and verify they appear in descending acceptedAt order.
    const submit1 = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const id1 = (submit1.body as { missionId: string }).missionId;
    await service.awaitCompletion(id1, CALLER_A);

    // Small delay to ensure different acceptedAt timestamps.
    await new Promise((r) => setTimeout(r, 10));

    const submit2 = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const id2 = (submit2.body as { missionId: string }).missionId;
    await service.awaitCompletion(id2, CALLER_A);

    const res = await httpCall('GET', '/v1/missions?limit=50', null, 'key-a');
    const list = (res.body as MissionListResult).missions;
    const idx1 = list.findIndex((m) => m.missionId === id1);
    const idx2 = list.findIndex((m) => m.missionId === id2);
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);
    // id2 was submitted later → should appear before id1 (lower index).
    expect(idx2).toBeLessThan(idx1);
  });
});
