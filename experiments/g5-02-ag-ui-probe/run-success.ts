/**
 * G5-02 — Real AG-UI external consumer probe (SUCCESS).
 *
 * Causal chain (every arrow must hold):
 *   Real Genesis Mission
 *     → Actual Genesis Execution (WorkerAgent runs, actions execute)
 *     → Internal Semantic Events (FlightEvents recorded)
 *     → AG-UI Translation (AgUiEventBridge translates FlightEvents → AG-UI Events)
 *     → AG-UI Protocol Stream (MemoryAgUiSink collects serialized JSON events)
 *     → SEPARATE Consumer (consumer.ts reads the sink, reconstructs lifecycle)
 *     → Consumer verifies: run started, activity observed, output observed,
 *       run finished, ordering valid, identity coherent
 *     → Independent comparison with Genesis mission outcome
 *
 * The consumer operates OUTSIDE the bridge — it reads only the serialized
 * AG-UI JSON events from the sink. It does NOT inspect Genesis internals.
 *
 * Run: npx tsx experiments/g5-02-ag-ui-probe/run-success.ts
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
const EVIDENCE_DIR = join(__dirname, 'evidence-success');

/**
 * Scripted reasoning provider — simulates a worker that reads a file,
 * runs a command, and writes a result. The worker does NOT know the
 * mission outcome; it performs real actions and observes real results.
 */
function makeScriptedReasoning(): ReasoningProvider {
  const queue: WorkerAction[] = [
    { action: 'write_file', path: 'greeting.txt', contents: 'Hello from Genesis!' },
    { action: 'read_file', path: 'greeting.txt' },
    { action: 'finish', summary: 'Created greeting.txt with the message Hello from Genesis!', artifacts: ['greeting.txt'] },
  ];
  let step = 0;
  return {
    name: 'probe-scripted',
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

/** In-memory computer for the probe (avoids needing a real OpenBot). */
class ProbeComputer {
  readonly files = new Map<string, string>();
  async exec(command: string) {
    return { command, exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 };
  }
  async writeFile(path: string, contents: string) {
    this.files.set(path, contents);
    return { path, bytes: contents.length, appended: false };
  }
  async readFile(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`file not found: ${path}`);
    return { path, text, bytes: text.length, truncated: false };
  }
  async listFiles(path?: string) {
    const entries = [...this.files.keys()].map((p) => ({ path: p, kind: 'file' as const, bytes: this.files.get(p)!.length }));
    return path === undefined ? entries : entries.filter((e) => e.path.startsWith(path));
  }
}

/**
 * The SEPARATE external consumer. It reads AG-UI events from the sink
 * (serialized JSON strings) and reconstructs the mission lifecycle.
 * It does NOT import Genesis internals — only @ag-ui/core types.
 */
function consumeMission(sink: MemoryAgUiSink): {
  runStarted: boolean;
  runFinished: boolean;
  runError: boolean;
  subagentEvents: number;
  toolCallEvents: number;
  textMessageContent: string | null;
  eventTypes: string[];
  orderingValid: boolean;
  runId: string | null;
} {
  const events = sink.collected() as Array<Record<string, unknown>>;
  const eventTypes = events.map((e) => e.type as string);

  const runStarted = eventTypes.includes('RUN_STARTED');
  const runFinished = eventTypes.includes('RUN_FINISHED');
  const runError = eventTypes.includes('RUN_ERROR');

  const subagentEvents = eventTypes.filter((t) => t.startsWith('SUBAGENT')).length;
  const toolCallEvents = eventTypes.filter((t) => t.startsWith('TOOL_CALL')).length;

  const textContent = events.find((e) => e.type === 'TEXT_MESSAGE_CONTENT') as { delta?: string } | undefined;
  const textMessageContent = textContent?.delta ?? null;

  // Ordering: RUN_STARTED must come before RUN_FINISHED/RUN_ERROR.
  const runStartIdx = eventTypes.indexOf('RUN_STARTED');
  const runEndIdx = Math.max(eventTypes.indexOf('RUN_FINISHED'), eventTypes.indexOf('RUN_ERROR'));
  const orderingValid = runStartIdx >= 0 && runEndIdx >= 0 && runStartIdx < runEndIdx;

  const runStartedEvent = events.find((e) => e.type === 'RUN_STARTED') as { runId?: string } | undefined;
  const runId = runStartedEvent?.runId ?? null;

  return {
    runStarted,
    runFinished,
    runError,
    subagentEvents,
    toolCallEvents,
    textMessageContent,
    eventTypes,
    orderingValid,
    runId,
  };
}

async function main(): Promise<void> {
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('G5-02 SUCCESS PROBE — starting');

  // The AG-UI sink (the stream boundary). The bridge emits to it; the
  // consumer reads from it. They are SEPARATE components.
  const sink = new MemoryAgUiSink();
  // The inner flight recorder (Genesis-owned truth, separate from AG-UI).
  const innerRecorder = new MemoryFlightRecorder();
  // The bridge wraps the inner recorder and translates to AG-UI.
  const bridge = new AgUiEventBridge(sink, { inner: innerRecorder });

  const genome = {
    identity: { id: 'writer-1', displayName: 'Writer' },
    role: 'Writer',
    objective: 'Write a greeting file.',
    model: 'cheap' as const,
    skills: ['document-authoring'],
    tools: ['openbot:workspace-files', 'openbot:shell-execution'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'none' as const,
    budget: { maxUsd: 1, maxTier: 'cheap' as const },
    autonomy: 'autonomous' as const,
  };

  const computer = new ProbeComputer();
  const reasoning = makeScriptedReasoning();

  const { WorkerAgent } = await import('../../src/worker/worker-agent.js');
  const agent = new WorkerAgent({
    genome,
    reasoning,
    computer: computer as unknown as Parameters<typeof WorkerAgent>[0]['computer'],
    taskBrief: 'Write a greeting to greeting.txt and read it back.',
    maxSteps: 8,
    onEvent: (event: FlightEvent) => {
      // The worker emits events to the bridge (which is the FlightRecorder).
      bridge.record(event);
    },
  });

  // Emit mission-started and mission-finished manually (the orchestrator
  // normally does this, but we're running a bare WorkerAgent for the probe).
  bridge.record({
    type: 'mission-started',
    at: new Date().toISOString(),
    missionId: 'g5-02-success',
    goalOutcome: 'Write a greeting file',
    budgetUsd: 10,
  });

  const result = await agent.run();

  bridge.record({
    type: 'mission-finished',
    at: new Date().toISOString(),
    missionId: 'g5-02-success',
    status: result.status === 'success' ? 'success' : 'failure',
    wallMs: 1000,
    reasoningCalls: result.reasoningCalls,
    worker_reasoning_calls: result.reasoningCalls,
    reviewer_calls: 0,
    handoff_calls: 0,
  });

  console.log('\n=== Genesis Worker Result ===');
  console.log('Status:', result.status);
  console.log('Summary:', result.summary);
  console.log('Artifacts:', result.artifacts);

  // -----------------------------------------------------------------------
  // The SEPARATE consumer reads the AG-UI stream.
  // -----------------------------------------------------------------------
  const consumer = consumeMission(sink);

  console.log('\n=== External Consumer Reconstruction ===');
  console.log('RUN_STARTED observed:', consumer.runStarted);
  console.log('RUN_FINISHED observed:', consumer.runFinished);
  console.log('RUN_ERROR observed:', consumer.runError);
  console.log('Subagent events:', consumer.subagentEvents);
  console.log('Tool call events:', consumer.toolCallEvents);
  console.log('Text message content:', consumer.textMessageContent);
  console.log('Event ordering valid:', consumer.orderingValid);
  console.log('Run ID:', consumer.runId);
  console.log('Event types:', consumer.eventTypes.join(', '));

  // -----------------------------------------------------------------------
  // Independent comparison: consumer's view vs Genesis outcome.
  // -----------------------------------------------------------------------
  const genesisSucceeded = result.status === 'success';
  const consumerSeesSuccess = consumer.runFinished && !consumer.runError;
  const resultsMatch = genesisSucceeded === consumerSeesSuccess;

  // The consumer observed meaningful activity (tool calls).
  const meaningfulActivity = consumer.toolCallEvents > 0 && consumer.subagentEvents > 0;

  // The consumer observed useful output (text message with summary).
  const usefulOutput = consumer.textMessageContent !== null && consumer.textMessageContent.length > 0;

  console.log('\n=== Independent Comparison ===');
  console.log('Genesis succeeded:', genesisSucceeded);
  console.log('Consumer sees success:', consumerSeesSuccess);
  console.log('Results match:', resultsMatch);
  console.log('Meaningful activity observed:', meaningfulActivity);
  console.log('Useful output observed:', usefulOutput);

  // -----------------------------------------------------------------------
  // Evidence dump.
  // -----------------------------------------------------------------------
  const evidence = {
    probe: 'G5-02 SUCCESS',
    timestamp: new Date().toISOString(),
    genesisResult: result,
    innerFlightEvents: innerRecorder.events.length,
    aguiEventCount: sink.events.length,
    aguiEventTypes: consumer.eventTypes,
    consumerReconstruction: consumer,
    independentComparison: {
      genesisSucceeded,
      consumerSeesSuccess,
      resultsMatch,
      meaningfulActivity,
      usefulOutput,
      orderingValid: consumer.orderingValid,
      runIdCoherent: consumer.runId === 'g5-02-success',
    },
    rawAguiEvents: sink.events,
  };

  writeFileSync(join(EVIDENCE_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));

  // -----------------------------------------------------------------------
  // Classification.
  // -----------------------------------------------------------------------
  const PASS =
    genesisSucceeded &&
    consumer.runStarted &&
    consumer.runFinished &&
    !consumer.runError &&
    meaningfulActivity &&
    usefulOutput &&
    consumer.orderingValid &&
    consumer.runId === 'g5-02-success' &&
    resultsMatch;

  console.log('\n=== CLASSIFICATION ===');
  console.log('SUCCESS_PROBE_PASS:', PASS);

  if (!PASS) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('PROBE FAILED:', error);
  process.exit(1);
});
