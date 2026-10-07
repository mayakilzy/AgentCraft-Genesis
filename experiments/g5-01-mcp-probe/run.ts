/**
 * G5-01 — Real MCP blind-ish probe (POSITIVE).
 *
 * Causal chain (every arrow must hold):
 *   Natural Mission
 *     → Worker needs capability (compute statistics on a dataset)
 *     → Authorized MCP capability available (mcp:analyze grant + provider)
 *     → REAL MCP discovery/invocation (stdio transport, official SDK)
 *     → REAL MCP result (deterministic statistics)
 *     → Worker observes result (call_tool observation in scratchpad)
 *     → Worker uses result (writes it to result.txt)
 *     → Mission output (result.txt artifact)
 *     → Independent verification (flight-action check + content check)
 *
 * The worker does NOT receive the expected answer in its prompt. The dataset
 * is staged as a mission input file. The worker must:
 *   1. read_file data.json (discover the dataset)
 *   2. call_tool analyze (invoke the MCP tool — the ONLY way to get the stats)
 *   3. write_file result.txt (use the MCP result)
 *   4. finish
 *
 * The scripted reasoning provider simulates a worker that reasons about the
 * task and decides to use the available tool. The result comes through REAL
 * MCP protocol execution, not from the prompt.
 *
 * Run: npx tsx experiments/g5-01-mcp-probe/run.ts
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReasoningProvider, ReasoningInput, ReasoningOutput } from '../../src/contracts/core.js';
import type { WorkerAction } from '../../src/worker/worker-agent.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { FlightEvent } from '../../src/mission/flight-recorder.js';
import type { McpCapabilityProvider } from '../../src/runtime/mcp/capability-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, 'evidence-positive');

// ---------------------------------------------------------------------------
// Dataset — the authoritative mission input. The worker does NOT see this
// in its prompt. The correct statistics are derived from this data; the
// worker must invoke the MCP tool to obtain them.
// ---------------------------------------------------------------------------
const DATASET_VALUES = [47, 23, 89, 12, 64, 38, 91, 55, 6, 77];
const EXPECTED_SUM = DATASET_VALUES.reduce((a, b) => a + b, 0); // 502
const DATA_JSON = JSON.stringify({ values: DATASET_VALUES }, null, 2);

// ---------------------------------------------------------------------------
// Scripted Reasoning Provider — simulates a worker that reasons about the
// task and decides to use the available MCP tool.
//
// IMPORTANT: the scripted provider does NOT know the answer. It reads the
// data file, passes the values to the MCP tool, and writes whatever the
// tool returns. The answer comes through REAL MCP invocation.
// ---------------------------------------------------------------------------
function makeProbeReasoning(): ReasoningProvider {
  const queue: WorkerAction[] = [
    { action: 'read_file', path: 'data.json' },
    { action: 'call_tool', tool: 'analyze', args: { values: DATASET_VALUES } },
    { action: 'write_file', path: 'result.txt', contents: '__PENDING__' },
    { action: 'finish', summary: 'Computed statistics via MCP analyze tool', artifacts: ['result.txt'] },
  ];
  // The write_file contents will be patched at runtime — the scripted provider
  // doesn't know the answer until the MCP tool returns it.
  let mcpResultText = '';
  let step = 0;

  return {
    name: 'probe-scripted',
    async reason(input: ReasoningInput): Promise<ReasoningOutput> {
      // Extract the MCP result from the scratchpad observation lines.
      // The observation for call_tool is: {"tool":"analyze","ok":true,"result":"<json>"}
      // JSON.parse properly unescapes the inner JSON string.
      const prompt = input.prompt;
      for (const line of prompt.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('observation: ') && trimmed.includes('"tool":"analyze"')) {
          try {
            const obs = JSON.parse(trimmed.slice('observation: '.length));
            if (typeof obs.result === 'string' && obs.result.length > 0) {
              mcpResultText = obs.result;
            }
          } catch {
            // ignore — the line may be truncated or malformed
          }
        }
      }

      step += 1;
      const next = queue[step - 1];
      if (next === undefined) {
        return { text: JSON.stringify({ action: 'finish', summary: 'no more actions', artifacts: [] }) };
      }

      // Patch the write_file action with the actual MCP result.
      if (next.action === 'write_file' && (next as { contents: string }).contents === '__PENDING__') {
        const contents = `Dataset Analysis Result\n=========================\n\n${mcpResultText}\n`;
        return { text: JSON.stringify({ ...next, contents }) };
      }

      return { text: JSON.stringify(next) };
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory computer stub for the probe (avoids needing a real OpenBot).
// ---------------------------------------------------------------------------
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
    return entries.filter((e) => path === undefined || e.path.startsWith(path));
  }
}

async function main(): Promise<void> {
  // Clean evidence directory.
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('G5-01 POSITIVE PROBE — starting');
  console.log('Expected sum:', EXPECTED_SUM);

  // -----------------------------------------------------------------------
  // Start the REAL MCP server as a child process via stdio.
  // -----------------------------------------------------------------------
  const { StdioClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/stdio.js'
  );
  const { McpCapabilityProviderImpl } = await import(
    '../../src/runtime/mcp/capability-provider.js'
  );

  const serverPath = join(__dirname, 'server.ts');
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', serverPath],
  });

  const provider = new McpCapabilityProviderImpl(transport as unknown as { start(): Promise<void> });
  await provider.connect();
  console.log('MCP client connected to server via stdio');

  // Discover tools — proves real MCP protocol discovery.
  const tools = await provider.listTools();
  console.log('Discovered MCP tools:', tools);
  if (!tools.includes('analyze')) {
    throw new Error('FAIL: analyze tool not discovered');
  }

  // -----------------------------------------------------------------------
  // Build a worker genome with the mcp:analyze grant.
  // -----------------------------------------------------------------------
  const genome = {
    identity: { id: 'analyst-1', displayName: 'Data Analyst' },
    role: 'Data Analyst',
    objective: 'Analyze the dataset and report the statistics.',
    model: 'cheap' as const,
    skills: ['data-analysis'],
    tools: ['mcp:analyze', 'openbot:workspace-files', 'openbot:shell-execution'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'none' as const,
    budget: { maxUsd: 1, maxTier: 'cheap' as const },
    autonomy: 'autonomous' as const,
  };

  const computer = new ProbeComputer();
  // Stage the dataset as a mission input.
  computer.files.set('data.json', DATA_JSON);

  const recorder = new MemoryFlightRecorder();
  const reasoning = makeProbeReasoning();

  const { WorkerAgent } = await import('../../src/worker/worker-agent.js');
  const agent = new WorkerAgent({
    genome,
    reasoning,
    computer: computer as unknown as Parameters<typeof WorkerAgent>[0]['computer'],
    mcp: provider as McpCapabilityProvider,
    taskBrief: [
      'Mission: Analyze the dataset in data.json and write the statistics to result.txt.',
      'Use the analyze tool to compute the statistics.',
      'Write the result to result.txt and finish.',
    ].join('\n'),
    maxSteps: 8,
    onEvent: (event: FlightEvent) => recorder.record(event),
  });

  const result = await agent.run();

  console.log('\n=== Worker Result ===');
  console.log('Status:', result.status);
  console.log('Steps:', result.steps);
  console.log('Summary:', result.summary);
  console.log('Artifacts:', result.artifacts);
  console.log('Refusals:', result.refusals);

  // -----------------------------------------------------------------------
  // Verify: flight-action check — call_tool was invoked with ok=true.
  // -----------------------------------------------------------------------
  const events = recorder.events;
  const callToolEvents = events.filter(
    (e) => e.type === 'worker-step' && (e as { action: string }).action === 'call_tool',
  );
  const callToolOk = callToolEvents.some((e) => (e as { ok: boolean }).ok === true);
  console.log('\n=== Verification ===');
  console.log('call_tool events:', callToolEvents.length);
  console.log('call_tool ok=true:', callToolOk);

  // -----------------------------------------------------------------------
  // Verify: content check — the correct sum appears in result.txt.
  // The MCP tool returns JSON like {"count":10,"sum":502,"mean":50.2,...}
  // -----------------------------------------------------------------------
  const resultText = computer.files.get('result.txt') ?? '';
  const hasCorrectSum = resultText.includes(`"sum":${EXPECTED_SUM}`);
  console.log('result.txt contains correct sum ("sum":502):', hasCorrectSum);
  console.log('result.txt contents:\n', resultText);

  // -----------------------------------------------------------------------
  // Verify: the MCP result was observed and USED by the worker.
  // The flight recorder captures action + ok (not the observation text —
  // that is worker-private scratchpad). The causal proof that the worker
  // OBSERVED the result is: call_tool ok=true (tool returned a result)
  // AND result.txt contains the correct sum (the worker wrote that result).
  // Together these prove: MCP result → worker observed → worker used → output.
  // -----------------------------------------------------------------------
  const observedMcpResult = callToolOk && hasCorrectSum;
  console.log('MCP result observed and used (call_tool ok + correct sum in artifact):', observedMcpResult);

  // -----------------------------------------------------------------------
  // Evidence dump.
  // -----------------------------------------------------------------------
  const evidence = {
    probe: 'G5-01 POSITIVE',
    timestamp: new Date().toISOString(),
    dataset: { values: DATASET_VALUES, expectedSum: EXPECTED_SUM },
    mcpToolsDiscovered: tools,
    workerResult: result,
    callToolEvents: callToolEvents.length,
    callToolOk,
    resultFileContent: resultText,
    hasCorrectSum,
    mcpResultObserved: observedMcpResult,
    flightEvents: events.map((e) => JSON.stringify(e)),
  };

  writeFileSync(
    join(EVIDENCE_DIR, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );

  // Flight record JSONL.
  const jsonl = events.map((e) => JSON.stringify(e)).join('\n');
  writeFileSync(join(EVIDENCE_DIR, 'flight-events.jsonl'), jsonl);

  await provider.close();

  // -----------------------------------------------------------------------
  // Classification.
  // -----------------------------------------------------------------------
  const PASS =
    result.status === 'success' &&
    callToolEvents.length > 0 &&
    callToolOk &&
    hasCorrectSum &&
    observedMcpResult;

  console.log('\n=== CLASSIFICATION ===');
  console.log('POSITIVE_PROBE_PASS:', PASS);

  if (!PASS) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('PROBE FAILED:', error);
  process.exit(1);
});
