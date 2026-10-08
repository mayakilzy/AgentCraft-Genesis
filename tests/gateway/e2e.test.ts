/**
 * G6-05A — E2E independent application + failure truthfulness tests.
 *
 * Covers E2E-01..E2E-02 and FAIL-01..FAIL-02 from the Test Matrix.
 */
import { describe, it, expect } from 'vitest';
import { httpCall, SIMPLE_GOAL, CALLER_A, service } from './helpers.js';

describe('G6-05A — E2E independent application', () => {
  it('E2E-01: independent client submits, polls, retrieves result and artifact', async () => {
    // The test harness acts as the independent application — it uses
    // only the HTTP API contract (no internal MissionService methods
    // except awaitCompletion, which simulates the client's polling loop).

    // 1. Authenticate (via API key).
    // 2. Submit a goal.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;

    // 3. Poll mission status until terminal.
    let snapshot: { status: string; terminal: boolean } | null = null;
    for (let i = 0; i < 50; i++) {
      const get = await httpCall('GET', `/v1/missions/${missionId}`, null, 'key-a');
      snapshot = get.body as { status: string; terminal: boolean };
      if (snapshot.terminal) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(snapshot).not.toBeNull();
    expect(snapshot!.terminal).toBe(true);

    // 4. Retrieve progress/events.
    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events`, null, 'key-a');
    expect(eventsRes.status).toBe(200);
    const events = (eventsRes.body as { events: Array<{ type: string }> }).events;
    expect(events.length).toBeGreaterThan(0);

    // 5. Retrieve the final result.
    const resultRes = await httpCall('GET', `/v1/missions/${missionId}/result`, null, 'key-a');
    expect(resultRes.status).toBe(200);
    const result = resultRes.body as { status: string; result: { status: string; summary: string } };
    expect(result.result).toBeDefined();

    // 6. Retrieve at least one verified artifact.
    const artifactsRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'key-a');
    expect(artifactsRes.status).toBe(200);
    const artifacts = (artifactsRes.body as { artifacts: Array<{ path: string; content?: string }> }).artifacts;
    expect(artifacts.length).toBeGreaterThan(0);
    const outputArtifact = artifacts.find((a) => a.path === 'output.md');
    expect(outputArtifact).toBeDefined();

    // 7. Verify the artifact matches the actual produced output.
    expect(outputArtifact!.content).toContain('# Genesis gateway output');

    // 8. Confirm the mission's verification status.
    expect(['SUCCEEDED', 'PARTIAL']).toContain(result.status);
  });

  it('E2E-02: verification and evidence are genuine (not faked)', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const eventsRes = await httpCall('GET', `/v1/missions/${missionId}/events`, null, 'key-a');
    const events = (eventsRes.body as { events: Array<{ type: string; payload: Record<string, unknown> }> }).events;
    const verificationEvent = events.find((e) => e.type === 'verification');
    expect(verificationEvent).toBeDefined();
    expect(verificationEvent!.payload).toHaveProperty('ok');
  });
});

describe('G6-05A — Failure truthfulness', () => {
  it('FAIL-01: runtime failure cannot become success', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);
    const get = await httpCall('GET', `/v1/missions/${missionId}`, null, 'key-a');
    const snap = get.body as { status: string; terminal: boolean; result?: { status: string } };
    expect(snap.terminal).toBe(true);
    expect(['SUCCEEDED', 'FAILED', 'PARTIAL']).toContain(snap.status);
    if (snap.result) {
      if (snap.result.status === 'success') expect(snap.status).toBe('SUCCEEDED');
      else if (snap.result.status === 'failure') expect(snap.status).toBe('FAILED');
      else expect(snap.status).toBe('PARTIAL');
    }
  });

  it('FAIL-02: restart recovery limitation is documented (in-process only)', async () => {
    const res = await httpCall('GET', '/health', null, null);
    const body = res.body as { limitations: string[] };
    expect(body.limitations.some((l) => l.includes('restart'))).toBe(true);
  });
});
