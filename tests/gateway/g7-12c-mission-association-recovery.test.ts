/**
 * G7-12C — Mission Association Recovery tests.
 *
 * Verifies that if mission creation succeeds but conversation association
 * fails, the mission is NOT orphaned — the missionId is recoverable.
 *
 * Strategy: submit a mission via the Gateway, then simulate a link failure
 * (by using a nonexistent conversation ID). Verify the mission still exists
 * and is retrievable via GET /v1/missions/{id}.
 */
import { describe, it, expect } from 'vitest';
import { httpCall, SIMPLE_GOAL } from './helpers.js';

describe('G7-12C — Mission Association Recovery', () => {
  it('MAR-01: mission survives even if conversation link fails', async () => {
    // Submit a mission (this always works).
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;

    // Simulate link failure: try to link to a nonexistent conversation.
    // This returns 404 but the mission is still running.
    const linkRes = await httpCall(
      'POST',
      '/v1/conversations/nonexistent-conv-id/missions',
      { missionId },
      'key-a',
    );
    expect(linkRes.status).toBe(404);

    // The mission is NOT orphaned — it's still retrievable via GET /v1/missions/{id}.
    const getRes = await httpCall('GET', `/v1/missions/${missionId}`, null, 'key-a');
    expect(getRes.status).toBe(200);
    expect((getRes.body as { missionId: string }).missionId).toBe(missionId);
  });

  it('MAR-02: mission appears in list even if not linked to any conversation', async () => {
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;

    // List missions — the unlinked mission should appear.
    const listRes = await httpCall('GET', '/v1/missions?limit=50', null, 'key-a');
    expect(listRes.status).toBe(200);
    const missions = (listRes.body as { missions: { missionId: string }[] }).missions;
    expect(missions.some((m) => m.missionId === missionId)).toBe(true);
  });

  it('MAR-03: duplicate link calls are idempotent (no duplicate missions)', async () => {
    // Create a conversation.
    const convRes = await httpCall(
      'POST',
      '/v1/conversations',
      { title: 'MAR-03 Test' },
      'key-a',
    );
    expect(convRes.status).toBe(201);
    const convId = (convRes.body as { conversationId: string }).conversationId;

    // Submit a mission.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;

    // Link it twice — should be idempotent.
    const link1 = await httpCall(
      'POST',
      `/v1/conversations/${convId}/missions`,
      { missionId },
      'key-a',
    );
    expect(link1.status).toBe(200);

    const link2 = await httpCall(
      'POST',
      `/v1/conversations/${convId}/missions`,
      { missionId },
      'key-a',
    );
    expect(link2.status).toBe(200);

    // Verify only one missionId in the conversation.
    const conv = await httpCall('GET', `/v1/conversations/${convId}`, null, 'key-a');
    const missionIds = (conv.body as { missionIds: string[] }).missionIds;
    expect(missionIds.filter((id) => id === missionId).length).toBe(1);
  });

  it('MAR-04: missionId is preserved in conversation messages for recovery', async () => {
    // Create a conversation.
    const convRes = await httpCall('POST', '/v1/conversations', { title: 'MAR-04 Recovery' }, 'key-a');
    const convId = (convRes.body as { conversationId: string }).conversationId;

    // Append a message with a missionId (simulating the recovery message).
    const msgRes = await httpCall(
      'POST',
      `/v1/conversations/${convId}/messages`,
      { role: 'assistant', content: 'Mission ID: recovery-test-123', missionId: 'recovery-test-123' },
      'key-a',
    );
    expect(msgRes.status).toBe(201);

    // Retrieve messages — the missionId should be preserved.
    const msgsRes = await httpCall('GET', `/v1/conversations/${convId}/messages`, null, 'key-a');
    const messages = (msgsRes.body as { messages: { missionId?: string; content: string }[] }).messages;
    expect(messages.length).toBe(1);
    expect(messages[0].missionId).toBe('recovery-test-123');
    expect(messages[0].content).toContain('recovery-test-123');
  });
});
