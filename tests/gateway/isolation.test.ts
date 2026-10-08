/**
 * G6-05A — Cross-caller isolation tests.
 *
 * Covers ISO-01..ISO-04 from the Test Matrix (Section 24).
 * All denials are enforced by the SERVICE, not merely hidden in the client.
 */
import { describe, it, expect } from 'vitest';
import { httpCall, SIMPLE_GOAL, CALLER_B, service } from './helpers.js';

describe('G6-05A — Cross-caller isolation', () => {
  it('ISO-01: caller A cannot read caller B\'s mission', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-b');
    const missionId = (submit.body as { missionId: string }).missionId;
    const get = await httpCall('GET', `/v1/missions/${missionId}`, null, 'key-a');
    // Per Section 11: return 404 (not 403) to avoid leaking existence.
    expect(get.status).toBe(404);
  });

  it('ISO-02: caller A cannot read caller B\'s events', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-b');
    const missionId = (submit.body as { missionId: string }).missionId;
    const get = await httpCall('GET', `/v1/missions/${missionId}/events`, null, 'key-a');
    expect(get.status).toBe(404);
  });

  it('ISO-03: caller A cannot read caller B\'s artifacts', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-b');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_B);
    const get = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'key-a');
    expect(get.status).toBe(404);
  });

  it('ISO-04: caller A cannot cancel caller B\'s mission', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-b');
    const missionId = (submit.body as { missionId: string }).missionId;
    const cancel = await httpCall('POST', `/v1/missions/${missionId}/cancel`, null, 'key-a');
    expect(cancel.status).toBe(404);
  });
});
