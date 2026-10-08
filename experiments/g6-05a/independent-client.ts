/**
 * G6-05A — Independent application client (Section 16).
 *
 * A minimal independent consumer that uses ONLY the published Service API
 * contract. It does NOT import internal Genesis modules or directly call
 * MissionOrchestrator. It runs as a separate process pointing at a
 * running gateway.
 *
 * This script is BOTH:
 *   1. A demonstration of the public contract (how an AgentCraft
 *      application would consume Genesis).
 *   2. The Section-16 acceptance test (an independent application can
 *      submit a goal, observe execution, retrieve verified results).
 *
 * Usage:
 *   npx tsx experiments/g6-05a/independent-client.ts
 *
 * Environment:
 *   GENESIS_HTTP_URL — base URL of the HTTP API (default http://127.0.0.1:4180)
 *   GENESIS_API_KEY  — API key for authentication (REQUIRED)
 *
 * Exit code: 0 on success, 1 on failure.
 */
import { request } from 'node:http';

const baseUrl = process.env.GENESIS_HTTP_URL ?? 'http://127.0.0.1:4180';
const apiKey = process.env.GENESIS_API_KEY;

if (!apiKey) {
  console.error('FATAL: GENESIS_API_KEY environment variable is required.');
  process.exit(1);
}

interface MissionSubmissionResponse {
  missionId: string;
  status: string;
  links: Record<string, string>;
}

interface MissionSnapshot {
  missionId: string;
  callerId: string;
  status: string;
  terminal: boolean;
  result?: { status: string; summary: string };
}

interface MissionArtifactsResponse {
  missionId: string;
  artifacts: Array<{ path: string; content?: string; bytes: number }>;
}

function httpCall(
  method: string,
  path: string,
  body: unknown | null,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(path, baseUrl);
  const payload = body === null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = raw;
          try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main(): Promise<void> {
  console.log(`[independent-client] connecting to ${baseUrl}`);
  console.log(`[independent-client] using API key: ${apiKey.slice(0, 4)}...`);

  // 1. Health check.
  const health = await httpCall('GET', '/health', null);
  if (health.status !== 200) {
    console.error(`[independent-client] health check failed: ${health.status}`);
    process.exit(1);
  }
  console.log('[independent-client] gateway healthy');

  // 2. Submit a goal.
  const goal =
    'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.';
  const submit = await httpCall('POST', '/v1/missions', { outcome: goal });
  if (submit.status !== 202) {
    console.error(`[independent-client] submission failed: ${submit.status}`, submit.body);
    process.exit(1);
  }
  const submission = submit.body as MissionSubmissionResponse;
  console.log(`[independent-client] mission submitted: ${submission.missionId}`);

  // 3. Poll mission status until terminal.
  let snapshot: MissionSnapshot | null = null;
  for (let i = 0; i < 100; i++) {
    const get = await httpCall('GET', `/v1/missions/${submission.missionId}`, null);
    if (get.status !== 200) {
      console.error(`[independent-client] status poll failed: ${get.status}`);
      process.exit(1);
    }
    snapshot = get.body as MissionSnapshot;
    if (snapshot.terminal) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!snapshot || !snapshot.terminal) {
    console.error('[independent-client] mission did not reach terminal state in time');
    process.exit(1);
  }
  console.log(`[independent-client] mission terminal: status=${snapshot.status}`);

  // 4. Retrieve the final result.
  const result = await httpCall('GET', `/v1/missions/${submission.missionId}/result`, null);
  if (result.status !== 200) {
    console.error(`[independent-client] result retrieval failed: ${result.status}`);
    process.exit(1);
  }
  const resultBody = result.body as { result: { status: string; summary: string } };
  console.log(`[independent-client] result: status=${resultBody.result.status}`);
  console.log(`[independent-client] summary: ${resultBody.result.summary.slice(0, 100)}`);

  // 5. Retrieve artifacts.
  const artifacts = await httpCall('GET', `/v1/missions/${submission.missionId}/artifacts`, null);
  if (artifacts.status !== 200) {
    console.error(`[independent-client] artifact retrieval failed: ${artifacts.status}`);
    process.exit(1);
  }
  const artifactsBody = artifacts.body as MissionArtifactsResponse;
  console.log(`[independent-client] artifacts: ${artifactsBody.artifacts.length}`);

  // 6. Verify the artifact matches the expected output.
  const outputArtifact = artifactsBody.artifacts.find((a) => a.path === 'output.md');
  if (!outputArtifact) {
    console.error('[independent-client] expected artifact output.md not found');
    process.exit(1);
  }
  if (!outputArtifact.content?.includes('# Genesis gateway output')) {
    console.error('[independent-client] artifact content does not match expected output');
    console.error(`  got: ${outputArtifact.content?.slice(0, 100)}`);
    process.exit(1);
  }
  console.log('[independent-client] artifact verified: content matches expected output');

  // 7. Confirm the mission's verification status.
  if (snapshot.status !== 'SUCCEEDED' && snapshot.status !== 'PARTIAL') {
    console.error(`[independent-client] mission did not succeed: ${snapshot.status}`);
    process.exit(1);
  }

  console.log('[independent-client] SUCCESS: independent application completed real mission.');
  process.exit(0);
}

await main();
