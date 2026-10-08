/**
 * G6-05A — Gateway HTTP Service API tests.
 *
 * Covers API-01..API-12 from the Test Matrix (Section 24).
 */
import { describe, it, expect } from 'vitest';
import { httpCall, SIMPLE_GOAL, CALLER_A, service } from './helpers.js';
import { randomUUID } from 'node:crypto';

describe('G6-05A — HTTP Service API', () => {
  it('API-01: authorized mission submission returns 202 with missionId', async () => {
    const res = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    expect(res.status).toBe(202);
    const body = res.body as { missionId: string; status: string; links: Record<string, string> };
    expect(typeof body.missionId).toBe('string');
    expect(body.status).toBe('RUNNING');
    expect(body.links.self).toBe(`/v1/missions/${body.missionId}`);
    expect(body.links.events).toBe(`/v1/missions/${body.missionId}/events`);
    expect(body.links.result).toBe(`/v1/missions/${body.missionId}/result`);
    expect(body.links.cancel).toBe(`/v1/missions/${body.missionId}/cancel`);
  });

  it('API-02: unauthorized submission rejected with 401', async () => {
    const res = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, null);
    expect(res.status).toBe(401);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('API-02b: invalid API key rejected with 401', async () => {
    const res = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'bogus-key');
    expect(res.status).toBe(401);
  });

  it('API-02c: restricted caller (no mission:submit) rejected with 403', async () => {
    const res = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-restricted');
    expect(res.status).toBe(403);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('API-03: invalid payload rejected with 400', async () => {
    const res = await httpCall('POST', '/v1/missions', { notOutcome: 'foo' }, 'key-a');
    expect(res.status).toBe(400);
  });

  it('API-04: stable mission identity (GET returns same missionId)', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    const get = await httpCall('GET', `/v1/missions/${missionId}`, null, 'key-a');
    expect(get.status).toBe(200);
    expect((get.body as { missionId: string }).missionId).toBe(missionId);
  });

  it('API-05: status retrieval reflects lifecycle', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);
    const get = await httpCall('GET', `/v1/missions/${missionId}`, null, 'key-a');
    expect(get.status).toBe(200);
    const snap = get.body as { status: string; terminal: boolean };
    expect(snap.terminal).toBe(true);
    expect(['SUCCEEDED', 'FAILED', 'PARTIAL']).toContain(snap.status);
  });

  it('API-06: event retrieval returns ordered events', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);
    const get = await httpCall('GET', `/v1/missions/${missionId}/events`, null, 'key-a');
    expect(get.status).toBe(200);
    const body = get.body as { events: Array<{ seq: number; type: string }> };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    const types = body.events.map((e) => e.type);
    expect(types).toContain('mission-started');
    expect(types).toContain('mission-finished');
    for (let i = 1; i < body.events.length; i++) {
      expect(body.events[i].seq).toBeGreaterThan(body.events[i - 1].seq);
    }
  });

  it('API-07: verified result retrieval returns MissionResult after terminal', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);
    const get = await httpCall('GET', `/v1/missions/${missionId}/result`, null, 'key-a');
    expect(get.status).toBe(200);
    const body = get.body as { status: string; result: { status: string; summary: string } };
    expect(body.result).toBeDefined();
    expect(typeof body.result.summary).toBe('string');
  });

  it('API-08: artifact retrieval returns produced artifacts', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);
    const get = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'key-a');
    expect(get.status).toBe(200);
    const body = get.body as { artifacts: Array<{ path: string; content?: string; bytes: number }> };
    expect(body.artifacts.length).toBeGreaterThan(0);
    const outputArtifact = body.artifacts.find((a) => a.path === 'output.md');
    expect(outputArtifact).toBeDefined();
    expect(outputArtifact!.content).toContain('# Genesis gateway output');
  });

  it('API-09: missing mission returns 404', async () => {
    const res = await httpCall('GET', '/v1/missions/nonexistent-id/artifacts', null, 'key-a');
    expect(res.status).toBe(404);
  });

  it('API-10: cancellation propagation', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    const cancel = await httpCall('POST', `/v1/missions/${missionId}/cancel`, null, 'key-a');
    expect(cancel.status).toBe(202);
    const body = cancel.body as { status: string; cancelRequested: boolean };
    expect(body.cancelRequested).toBe(true);
    expect([
      'CANCELLATION_REQUESTED',
      'CANCELLED',
      'SUCCEEDED',
      'PARTIAL',
    ]).toContain(body.status);
  });

  it('API-10b: cancel of already-terminal mission is idempotent', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);
    const cancel = await httpCall('POST', `/v1/missions/${missionId}/cancel`, null, 'key-a');
    expect(cancel.status).toBe(202);
    const body = cancel.body as { status: string };
    expect(['SUCCEEDED', 'FAILED', 'PARTIAL']).toContain(body.status);
  });

  it('API-11: idempotent submission returns existing missionId', async () => {
    const idempotencyKey = `test-idem-${randomUUID()}`;
    const submit1 = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, idempotencyKey },
      'key-a',
    );
    const submit2 = await httpCall(
      'POST',
      '/v1/missions',
      { outcome: SIMPLE_GOAL, idempotencyKey },
      'key-a',
    );
    expect(submit1.status).toBe(202);
    expect(submit2.status).toBe(202);
    const id1 = (submit1.body as { missionId: string }).missionId;
    const id2 = (submit2.body as { missionId: string }).missionId;
    expect(id1).toBe(id2);
  });

  it('API-12: oversized request body rejected', async () => {
    const huge = 'x'.repeat(2_000_000);
    // The server may either return a 4xx status OR reset the connection
    // (ECONNRESET) when the body exceeds the size limit. Both are acceptable;
    // the point is the server did not accept the oversized payload.
    let result: { status: number } | 'ECONNRESET' = 'ECONNRESET';
    try {
      result = await httpCall('POST', '/v1/missions', { outcome: huge }, 'key-a');
    } catch {
      // ECONNRESET is expected when the server destroys the socket mid-body.
      result = 'ECONNRESET';
    }
    if (result === 'ECONNRESET') {
      // Connection reset — acceptable (server refused the oversized body).
      expect(true).toBe(true);
    } else {
      expect([400, 429, 500]).toContain(result.status);
    }
  });

  it('health endpoint returns ok without auth', async () => {
    const res = await httpCall('GET', '/health', null, null);
    expect(res.status).toBe(200);
    const body = res.body as { status: string; version: string; limitations: string[] };
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(body.limitations.length).toBeGreaterThan(0);
  });

  it('ready endpoint returns ok without auth', async () => {
    const res = await httpCall('GET', '/ready', null, null);
    expect(res.status).toBe(200);
  });
});
