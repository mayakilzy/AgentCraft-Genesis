/**
 * G5-02 — Real AG-UI failure probe.
 *
 * Cause a controlled Genesis mission failure and verify the external consumer
 * receives coherent failure termination (RUN_ERROR), NOT a false RUN_FINISHED.
 *
 * Failure mechanism: the worker is given a mission that requires an action it
 * is NOT granted (e.g. run_command without the openbot:shell-execution grant).
 * The worker attempts the action, is refused, exhausts its step budget, and
 * fails. The mission-finished event carries status='failure'.
 *
 * Required invariant:
 *   GENESIS FAILURE → AG-UI RUN_ERROR
 *   NOT: GENESIS FAILURE → AG-UI RUN_FINISHED (success)
 *
 * Run: npx tsx experiments/g5-02-ag-ui-probe/run-failure.ts
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReasoningProvider, ReasoningOutput } from '../../src/contracts/core.js';
import type { WorkerAction } from '../../src/worker/worker-agent.js';
import { AgUiEventBridge, MemoryAgUiSink } from '../../src/agui/event-bridge.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { FlightEvent } from '../../src/mission/flight-recorder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, 'evidence-failure');

/** A worker that tries to run a command it is NOT authorized to run. */
function makeFailingReasoning(): ReasoningProvider {
  const queue: WorkerAction[] = [
    { action: 'run_command', command: 'echo test' },
    { action: 'run_command', command: 'echo test' },
    { action: 'run_command', command: 'echo test' },
    { action: 'run_command', command: 'echo test' },
    { action: 'run_command', command: 'echo test' },
    { action: 'finish', summary: 'blocked: could not run commands', artifacts: [] },
  ];
  let step = 0;
  return {
    name: 'failing-scripted',
    async reason(): Promise<ReasoningOutput> {
      step += 1;
      const next = queue[step - 1];
      if (next === undefined) {
        return { text: JSON.stringify({ action: 'finish', summary: 'exhausted', artifacts: [] }) };
      }
      return { text: JSON.stringify(next) };
    },
  };
}

async function main(): Promise<void> {
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('G5-02 FAILURE PROBE — starting');

  const sink = new MemoryAgUiSink();
  const innerRecorder = new MemoryFlightRecorder();
  const bridge = new AgUiEventBridge(sink, { inner: innerRecorder });

  // Genome WITHOUT the shell-execution grant — the worker will be refused.
  const genome = {
    identity: { id: 'blocked-worker-1', displayName: 'Worker' },
    role: 'Worker',
    objective: 'Run a command.',
    model: 'cheap' as const,
    skills: [],
    tools: [], // NO grants — run_command will be refused
    computer: { required: false, browser: false, shell: false, workspace: false },
    memory: 'none' as const,
    budget: { maxUsd: 1, maxTier: 'cheap' as const },
    autonomy: 'autonomous' as const,
  };

  const reasoning = makeFailingReasoning();

  bridge.record({
    type: 'mission-started',
    at: new Date().toISOString(),
    missionId: 'g5-02-failure',
    goalOutcome: 'Run a command (will fail — no grant)',
    budgetUsd: 10,
  });

  const { WorkerAgent } = await import('../../src/worker/worker-agent.js');
  const agent = new WorkerAgent({
    genome,
    reasoning,
    computer: null,
    taskBrief: 'Run the command echo test.',
    maxSteps: 4,
    onEvent: (event: FlightEvent) => bridge.record(event),
  });

  const result = await agent.run();

  bridge.record({
    type: 'mission-finished',
    at: new Date().toISOString(),
    missionId: 'g5-02-failure',
    status: result.status === 'success' ? 'success' : 'failure',
    wallMs: 500,
    reasoningCalls: result.reasoningCalls,
    worker_reasoning_calls: result.reasoningCalls,
    reviewer_calls: 0,
    handoff_calls: 0,
  });

  console.log('\n=== Genesis Worker Result ===');
  console.log('Status:', result.status);
  console.log('Refusals:', result.refusals.length);
  console.log('Summary:', result.summary);

  // -----------------------------------------------------------------------
  // Consumer reconstruction.
  // -----------------------------------------------------------------------
  const events = sink.collected() as Array<Record<string, unknown>>;
  const eventTypes = events.map((e) => e.type as string);

  const runStarted = eventTypes.includes('RUN_STARTED');
  const runError = eventTypes.includes('RUN_ERROR');
  const runFinished = eventTypes.includes('RUN_FINISHED');
  const falseSuccess = runFinished && !runError;

  console.log('\n=== External Consumer Reconstruction ===');
  console.log('RUN_STARTED:', runStarted);
  console.log('RUN_ERROR:', runError);
  console.log('RUN_FINISHED:', runFinished);
  console.log('FALSE successful finish:', falseSuccess);

  // -----------------------------------------------------------------------
  // Evidence dump.
  // -----------------------------------------------------------------------
  const evidence = {
    probe: 'G5-02 FAILURE',
    timestamp: new Date().toISOString(),
    genesisResult: {
      status: result.status,
      refusals: result.refusals,
      summary: result.summary,
    },
    aguiEventTypes: eventTypes,
    consumerReconstruction: {
      runStarted,
      runError,
      runFinished,
      falseSuccess,
    },
    rawAguiEvents: sink.events,
  };

  writeFileSync(join(EVIDENCE_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));

  // -----------------------------------------------------------------------
  // Classification.
  // -----------------------------------------------------------------------
  const PASS =
    result.status === 'failure' &&
    runStarted &&
    runError &&
    !falseSuccess;

  console.log('\n=== CLASSIFICATION ===');
  console.log('FAILURE_PROBE_PASS:', PASS);

  if (!PASS) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('FAILURE PROBE FAILED:', error);
  process.exit(1);
});
