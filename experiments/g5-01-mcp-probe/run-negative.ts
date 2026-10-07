/**
 * G5-01 — Real MCP negative authorization probe.
 *
 * Condition:
 *   - The MCP server is running and the `analyze` tool is discoverable.
 *   - The provider is connected and the capability EXISTS.
 *   - BUT the worker's genome does NOT include the `mcp:analyze` grant.
 *
 * Expected:
 *   - The worker attempts to call the tool.
 *   - The WorkerAgent's grant check REFUSES the invocation.
 *   - The MCP tool is NEVER actually invoked (the stub records no call).
 *   - No successful MCP tool result reaches the worker.
 *   - The mission does NOT falsely succeed.
 *
 * Run: npx tsx experiments/g5-01-mcp-probe/run-negative.ts
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReasoningProvider, ReasoningOutput } from '../../src/contracts/core.js';
import type { WorkerAction } from '../../src/worker/worker-agent.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { FlightEvent } from '../../src/mission/flight-recorder.js';
import type { McpCapabilityProvider, McpToolResult } from '../../src/runtime/mcp/capability-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, 'evidence-negative');

const DATASET_VALUES = [47, 23, 89, 12, 64];

/**
 * A stub MCP provider that RECORDS whether invokeTool was ever called.
 * If invokeTool is called, it means the grant check FAILED to block
 * the unauthorized invocation — a negative probe failure.
 */
function makeRecordingProvider(): { provider: McpCapabilityProvider; invokeCount: number } {
  let invokeCount = 0;
  return {
    provider: {
      name: 'recording-stub',
      listTools: async () => ['analyze'],
      invokeTool: async (): Promise<McpToolResult> => {
        invokeCount += 1;
        return { ok: true, text: 'SHOULD_NOT_REACH', raw: null };
      },
      close: async () => {},
    },
    get invokeCount() { return invokeCount; },
  };
}

function makeNegativeProbeReasoning(): ReasoningProvider {
  const queue: WorkerAction[] = [
    { action: 'call_tool', tool: 'analyze', args: { values: DATASET_VALUES } },
    { action: 'finish', summary: 'blocked: could not invoke analyze tool', artifacts: [] },
  ];
  let step = 0;
  return {
    name: 'negative-probe-scripted',
    async reason(): Promise<ReasoningOutput> {
      step += 1;
      const next = queue[step - 1];
      if (next === undefined) {
        return { text: JSON.stringify({ action: 'finish', summary: 'done', artifacts: [] }) };
      }
      return { text: JSON.stringify(next) };
    },
  };
}

async function main(): Promise<void> {
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('G5-01 NEGATIVE PROBE — starting');
  console.log('Worker genome: NO mcp:analyze grant');
  console.log('MCP capability: EXISTS (provider connected, tool discoverable)');

  const recording = makeRecordingProvider();

  // Genome WITHOUT the mcp:analyze grant.
  const genome = {
    identity: { id: 'unauthorized-1', displayName: 'Worker' },
    role: 'Analyst',
    objective: 'test negative authorization',
    model: 'cheap' as const,
    skills: [],
    tools: [], // NO mcp:analyze grant!
    computer: { required: false, browser: false, shell: false, workspace: false },
    memory: 'none' as const,
    budget: { maxUsd: 1, maxTier: 'cheap' as const },
    autonomy: 'autonomous' as const,
  };

  const recorder = new MemoryFlightRecorder();

  const { WorkerAgent } = await import('../../src/worker/worker-agent.js');
  const agent = new WorkerAgent({
    genome,
    reasoning: makeNegativeProbeReasoning(),
    computer: null,
    mcp: recording.provider, // provider IS available — but grant is missing
    taskBrief: 'Analyze the dataset using the analyze tool.',
    maxSteps: 5,
    onEvent: (event: FlightEvent) => recorder.record(event),
  });

  const result = await agent.run();

  console.log('\n=== Worker Result ===');
  console.log('Status:', result.status);
  console.log('Steps:', result.steps);
  console.log('Refusals:', result.refusals);

  // The refusal must mention the missing mcp:analyze grant.
  const hasGrantRefusal = result.refusals.some((r) =>
    r.includes('mcp:analyze') && r.includes('not authorized'),
  );
  console.log('\nGrant refusal mentions mcp:analyze:', hasGrantRefusal);

  // The provider's invokeTool must NEVER have been called.
  console.log('invokeTool call count:', recording.invokeCount);
  const invokeBlocked = recording.invokeCount === 0;

  // No flight event should show call_tool with ok=true.
  const events = recorder.events;
  const callToolOkEvents = events.filter(
    (e) => e.type === 'worker-step' &&
      (e as { action: string }).action === 'call_tool' &&
      (e as { ok: boolean }).ok === true,
  );
  console.log('call_tool ok=true events:', callToolOkEvents.length);
  const noSuccessfulCall = callToolOkEvents.length === 0;

  // The worker should NOT have falsely succeeded.
  const noFalseSuccess = result.status !== 'success' || result.refusals.length > 0;

  // -----------------------------------------------------------------------
  // Evidence dump.
  // -----------------------------------------------------------------------
  const evidence = {
    probe: 'G5-01 NEGATIVE_AUTHORIZATION',
    timestamp: new Date().toISOString(),
    genomeTools: genome.tools,
    mcpCapabilityExists: true,
    workerResult: result,
    invokeToolCallCount: recording.invokeCount,
    invokeBlocked,
    hasGrantRefusal,
    noSuccessfulCallToolEvent: noSuccessfulCall,
    noFalseSuccess,
    flightEvents: events.map((e) => JSON.stringify(e)),
  };

  writeFileSync(
    join(EVIDENCE_DIR, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
  writeFileSync(
    join(EVIDENCE_DIR, 'flight-events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n'),
  );

  // -----------------------------------------------------------------------
  // Classification.
  // -----------------------------------------------------------------------
  const PASS = invokeBlocked && hasGrantRefusal && noSuccessfulCall && noFalseSuccess;

  console.log('\n=== CLASSIFICATION ===');
  console.log('NEGATIVE_AUTHORIZATION_PROBE_PASS:', PASS);
  console.log('  invokeBlocked:', invokeBlocked);
  console.log('  hasGrantRefusal:', hasGrantRefusal);
  console.log('  noSuccessfulCall:', noSuccessfulCall);
  console.log('  noFalseSuccess:', noFalseSuccess);

  if (!PASS) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('NEGATIVE PROBE FAILED:', error);
  process.exit(1);
});
