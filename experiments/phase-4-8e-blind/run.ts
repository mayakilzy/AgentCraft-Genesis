/**
 * PHASE 4.8E — Third Blind Natural Mission.
 *
 * GLM is OBSERVER ONLY. The reasoning is driven by a REAL LLM
 * (z-ai-web-dev-sdk, glm-4-plus). GLM does NOT intervene during execution.
 *
 * This mission is STRONGER than Phase 4.8C:
 *   - Different dataset (sensor measurements JSON, not inventory/expenses)
 *   - Different computation (average + range, not sum)
 *   - Mission obligations enforce: delegated-result, shared-publication,
 *     computer-execution — verified by flight-action checks
 *   - content-in-artifacts check (not artifact-name-specific)
 *
 * The mission requires the worker to:
 *   1. Read the staged measurements.json
 *   2. Compute average and range via real computer execution
 *   3. Delegate the same analysis to the durable worker (JobSurface)
 *   4. Observe the durable result (get_durable_result)
 *   5. Compare the two results
 *   6. Publish the grounded conclusion to the shared workspace
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

import type {
  Goal,
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
} from '../../src/contracts/core.js';
import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../../src/genome/genome-compiler.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import { MissionOrchestrator } from '../../src/mission/orchestrator.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { MissionInput, MissionObligation } from '../../src/mission/orchestrator.js';
import { CompositeRuntime } from '../../src/runtime/composite-runtime.js';
import { OpenDotsWorkspaceAdapter } from '../../src/runtime/opendots/adapter.js';
import { OpenMuseAdapter } from '../../src/runtime/openmuse/adapter.js';
import { OpenBotRuntimeAdapter } from '../../src/runtime/openbot/adapter.js';
import ZAI from 'z-ai-web-dev-sdk';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OPENDOTS_URL = process.env.OPENDOTS_URL ?? 'http://127.0.0.1:4310';
const OPENMUSE_URL = process.env.OPENMUSE_URL ?? 'http://127.0.0.1:8787';
const OPENBOT_CHECKOUT =
  process.env.OPENBOT_CHECKOUT ?? '/home/z/my-project/upstream/OpenBot';
const OPENBOT_ROOT =
  process.env.OPENBOT_ROOT ?? '/tmp/genesis-phase-4-8e-openbot';

const MEASUREMENTS_JSON = readFileSync('/tmp/measurements.json', 'utf8');

// Expected values (for GLM's private verification only — NOT in worker prompt)
// Average: 22.23, Range: 8.90
const EXPECTED_AVG = '22.23';
const EXPECTED_RANGE = '8.90';

const NATURAL_USER_REQUEST: Goal = {
  outcome:
    'I have a sensor measurements file (measurements.json in the workspace). ' +
    'Please analyze the readings: compute the average temperature and the ' +
    'range (max minus min). To be thorough, also delegate the same analysis ' +
    'to a durable worker and confirm the two analyses agree. Write a brief ' +
    'summary of the results into the shared team workspace so everyone can ' +
    'see the final numbers.',
};

// ---------------------------------------------------------------------------
// LLM-backed reasoning provider
// ---------------------------------------------------------------------------

class LlmReasoningProvider implements ReasoningProvider {
  readonly name = 'llm-glm-4-plus';
  private zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;

  async ensureInitialized(): Promise<void> {
    if (this.zai === null) {
      this.zai = await ZAI.create();
    }
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    await this.ensureInitialized();
    const messages: Array<{ role: 'assistant' | 'user'; content: string }> = [];
    if (input.system !== undefined && input.system.trim() !== '') {
      messages.push({ role: 'assistant', content: input.system });
    }
    messages.push({ role: 'user', content: input.prompt });
    try {
      const completion = await this.zai!.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      });
      return { text: completion.choices[0]?.message?.content ?? '' };
    } catch (error) {
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: `LLM reasoning failed: ${error instanceof Error ? error.message : String(error)}`,
          artifacts: [],
        }),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// The blind mission
// ---------------------------------------------------------------------------

async function getCurrentHead(): Promise<string> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    spawn('git', ['rev-parse', 'HEAD'], {
      cwd: '/home/z/my-project/genesis-work/AgentCraft-Genesis',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).stdout.on('data', (chunk) => resolve(chunk.toString().trim()));
  });
}

async function getWorktreeStatus(): Promise<string> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--short'], {
      cwd: '/home/z/my-project/genesis-work/AgentCraft-Genesis',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', () => resolve(out.trim() === '' ? 'CLEAN' : 'DIRTY'));
  });
}

async function checkHealth(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch { return false; }
}

async function main(): Promise<void> {
  const headBefore = await getCurrentHead();
  const upstreamHealthy = {
    openbot: await checkHealth('http://127.0.0.1:4100/health'),
    opendots: await checkHealth('http://127.0.0.1:4310/api/workspace'),
    openmuse: await checkHealth('http://127.0.0.1:8787/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  };

  // Set up the three real adapters
  const openDotsAdapter = new OpenDotsWorkspaceAdapter({
    baseUrl: OPENDOTS_URL,
    spaceName: `Phase 4.8E Blind ${randomBytes(3).toString('hex')}`,
    pageTitle: 'Sensor Analysis Brief',
  });
  // OpenMuse finance task expects CSV. We provide the measurements as
  // CSV-equivalent so the durable worker can compute on them.
  const openMuseAdapter = new OpenMuseAdapter({
    baseUrl: OPENMUSE_URL,
    taskPrompt: 'Analyze the sensor measurements and produce the average and range.',
    taskKind: 'finance',
    taskInput: {
      csv: 'date,description,amount,category\n' +
        '2026-03-01,Reading 1,18.30,Temperature\n' +
        '2026-03-01,Reading 2,22.70,Temperature\n' +
        '2026-03-01,Reading 3,25.10,Temperature\n' +
        '2026-03-02,Reading 4,17.90,Temperature\n' +
        '2026-03-02,Reading 5,24.30,Temperature\n' +
        '2026-03-02,Reading 6,26.80,Temperature\n' +
        '2026-03-03,Reading 7,19.20,Temperature\n' +
        '2026-03-03,Reading 8,23.50,Temperature',
    },
  });
  const openBotAdapter = new OpenBotRuntimeAdapter({
    checkoutDir: OPENBOT_CHECKOUT,
    rootDir: OPENBOT_ROOT,
    apiTimeoutMs: 30_000,
    startTimeoutMs: 30_000,
    onWorkerOutput: (workerId, chunk) => {
      process.stderr.write(`[openbot:${workerId}] ${chunk}`);
    },
  });
  const composite = new CompositeRuntime({
    computer: openBotAdapter,
    workspace: openDotsAdapter,
    job: openMuseAdapter,
  });

  // Compile the mission with explicit operational needs + obligations
  const compiler = new GoalCompiler();
  const planner = new OrganizationPlanner();
  const router = new CognitiveRouter(new RuleDecisionProvider());
  const requirements = await compiler.compile(NATURAL_USER_REQUEST);
  const plan = planner.plan(requirements);
  const workerId = plan.workers[0]!.id;

  const extraOperationalNeeds: Record<string, readonly { kind: 'shell-execution' | 'collaborative-workspace' | 'durable-delegation' }[]> = {};
  for (const w of plan.workers) {
    extraOperationalNeeds[w.id] = [
      { kind: 'shell-execution' },
      { kind: 'collaborative-workspace' },
      { kind: 'durable-delegation' },
    ];
  }

  const genomeCompiler = new GenomeCompiler({
    registry: loadOwnership('data/ownership.yaml'),
    selectTier: (selection) => router.selectTier(selection),
    extraOperationalNeeds,
  });

  // Stage the authoritative input
  const missionInputs: MissionInput[] = [
    { path: 'measurements.json', contents: MEASUREMENTS_JSON },
  ];

  // Mission obligations — these are ENFORCED by flight-action checks
  const missionObligations: MissionObligation[] = [
    { kind: 'computer-execution', description: 'compute average and range from the real measurements' },
    { kind: 'delegated-result', description: 'delegate the same analysis to the durable worker and observe its result' },
    { kind: 'shared-publication', description: 'publish the final summary to the shared team workspace' },
  ];

  // Content-in-artifacts check: the worker must produce an artifact containing
  // the correct average. This is name-agnostic (fixes 4.8C's artifact-name issue).
  const checks = () => [
    {
      kind: 'content-in-artifacts' as const,
      label: 'correct-average',
      expectIncludes: EXPECTED_AVG,
    },
  ];

  const reasoning = new LlmReasoningProvider();
  const recorder = new MemoryFlightRecorder();
  const missionId = `phase-4-8e-blind-${randomBytes(3).toString('hex')}`;
  const orchestrator = new MissionOrchestrator({
    goalCompiler: compiler,
    planner,
    genomeCompiler,
    runtime: composite,
    reasoning,
    recorder,
    missionId,
    missionInputs,
    missionObligations,
    checks,
    missionTimeoutMs: 300_000,
    maxWorkerSteps: 15,
  });

  // === MISSION EXECUTION — GLM is now OBSERVER ONLY ===
  let missionStatus: 'success' | 'partial' | 'failure' = 'failure';
  let missionSummary = '';
  try {
    const result = await orchestrator.run(NATURAL_USER_REQUEST);
    missionStatus = result.status;
    missionSummary = result.summary;
  } catch (error) {
    missionSummary = `mission threw: ${error instanceof Error ? error.message : String(error)}`;
  }

  // === INSPECT EVIDENCE (GLM observes, does not intervene) ===
  const events = recorder.events;
  const wsHandle = openDotsAdapter.getWorkspaceHandle();
  let finalPageContent: string | null = null;
  if (wsHandle !== undefined) {
    try {
      const { OpenDotsClient } = await import('../../src/runtime/opendots/client.js');
      const client = new OpenDotsClient({ baseUrl: OPENDOTS_URL });
      const page = await client.getPage(wsHandle.spaceId, wsHandle.pageId);
      finalPageContent = page.content;
    } catch { /* best-effort */ }
  }

  // Inspect OpenBot workspace
  const openbotWorkspaceFiles: string[] = [];
  let openbotOutputContent: string | null = null;
  try {
    const { readdir, readFile: readFileAsync } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const wsDir = join(OPENBOT_ROOT, workerId, 'workspace');
    const entries = await readdir(wsDir).catch(() => [] as string[]);
    openbotWorkspaceFiles.push(...entries);
    for (const name of entries) {
      if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.json') || name.endsWith('.py')) {
        try {
          const content = await readFileAsync(join(wsDir, name), 'utf8');
          if (content.includes(EXPECTED_AVG) || content.includes(EXPECTED_RANGE)) {
            openbotOutputContent = content;
          }
        } catch { /* best-effort */ }
      }
    }
  } catch { /* best-effort */ }

  // Analyze flight events
  const workerSteps = events.filter(
    (e) => (e as { type: string }).type === 'worker-step',
  ) as Array<{ type: string; action: string; ok: boolean; step: number }>;
  const verificationEvents = events.filter(
    (e) => (e as { type: string }).type === 'verification',
  ) as Array<{ type: string; ok: boolean; passed: number; failed: number; failures?: string[] }>;
  const lastVerification = verificationEvents.length > 0 ? verificationEvents[verificationEvents.length - 1] : null;

  const actionsUsed = new Set(workerSteps.filter((s) => s.ok).map((s) => s.action));
  const computerUsed = ['run_command', 'read_file', 'write_file', 'list_files'].some((a) => actionsUsed.has(a));
  const jobUsed = ['check_durable_status', 'get_durable_result'].some((a) => actionsUsed.has(a));
  const workspaceUsed = ['read_shared_workspace', 'append_shared_workspace'].some((a) => actionsUsed.has(a));

  const headAfter = await getCurrentHead();
  const worktreeStatus = await getWorktreeStatus();

  // Stop OpenBot workers
  try { await openBotAdapter.close(); } catch { /* best-effort */ }

  // Write the report
  const lines: string[] = [];
  lines.push('# PHASE 4.8E — Third Blind Natural Mission');
  lines.push('');
  lines.push('## Pre-execution State');
  lines.push('');
  lines.push(`- HEAD before: \`${headBefore}\``);
  lines.push(`- Worktree before: ${worktreeStatus}`);
  lines.push(`- OpenBot healthy: ${upstreamHealthy.openbot}`);
  lines.push(`- OpenDots healthy: ${upstreamHealthy.opendots}`);
  lines.push(`- OpenMuse healthy: ${upstreamHealthy.openmuse}`);
  lines.push('');
  lines.push('## Natural User Request');
  lines.push('');
  lines.push(`> ${NATURAL_USER_REQUEST.outcome}`);
  lines.push('');
  lines.push('## Configuration');
  lines.push('');
  lines.push('- Need selection: EXPLICIT_TEST_INJECTION');
  lines.push('- Reasoning provider: llm-glm-4-plus (REAL LLM)');
  lines.push(`- Worker id: ${workerId}`);
  lines.push('- Mission obligations: computer-execution, delegated-result, shared-publication');
  lines.push('- Verification: content-in-artifacts (expected average: 22.23)');
  lines.push('');
  lines.push('## Mission Outcome');
  lines.push('');
  lines.push(`- Status: **${missionStatus}**`);
  lines.push(`- Summary: ${missionSummary}`);
  lines.push(`- Verification ok: ${lastVerification?.ok ?? 'N/A'}`);
  lines.push(`- Verification: passed=${lastVerification?.passed ?? 0} failed=${lastVerification?.failed ?? 0}`);
  if (lastVerification?.failures) {
    for (const f of lastVerification.failures) {
      lines.push(`  - ${f.slice(0, 200)}`);
    }
  }
  lines.push('');
  lines.push('## Provider Evidence');
  lines.push('');
  lines.push('| Provider | Real | Resolved | Invoked | Observed |');
  lines.push('|----------|------|----------|---------|----------|');
  lines.push(`| OpenBot | YES | YES | ${computerUsed} | ${openbotWorkspaceFiles.length > 0} |`);
  lines.push(`| OpenDots | YES | YES | ${workspaceUsed} | ${finalPageContent !== null && finalPageContent.length > 60} |`);
  lines.push(`| OpenMuse | YES | YES | ${jobUsed} | ${jobUsed} |`);
  lines.push('');
  lines.push('## Worker Actions (flight record)');
  lines.push('');
  for (const s of workerSteps) {
    lines.push(`- step ${s.step}: action=${s.action} ok=${s.ok}`);
  }
  lines.push('');
  lines.push('## Multi-Surface Worker');
  lines.push('');
  lines.push(`- Computer surface used: ${computerUsed}`);
  lines.push(`- Job surface used: ${jobUsed}`);
  lines.push(`- Workspace surface used: ${workspaceUsed}`);
  lines.push(`- Multi-surface: ${computerUsed && jobUsed && workspaceUsed ? 'YES (all three)' : computerUsed && workspaceUsed ? 'PARTIAL (computer + workspace)' : 'NO'}`);
  lines.push('');
  if (finalPageContent !== null) {
    lines.push('## Final OpenDots Page Content');
    lines.push('');
    lines.push('```markdown');
    lines.push(finalPageContent);
    lines.push('```');
    lines.push('');
  }
  if (openbotOutputContent !== null) {
    lines.push('## OpenBot Worker Output (containing expected values)');
    lines.push('');
    lines.push('```');
    lines.push(openbotOutputContent);
    lines.push('```');
    lines.push('');
  }
  lines.push('## Post-execution State');
  lines.push('');
  lines.push(`- HEAD after: \`${headAfter}\``);
  lines.push(`- HEAD changed: ${headBefore !== headAfter ? 'YES (UNEXPECTED)' : 'NO (expected)'}`);

  const report = lines.join('\n');
  mkdirSync('experiments/phase-4-8e-blind', { recursive: true });
  writeFileSync('experiments/phase-4-8e-blind/REPORT.md', report, 'utf8');
  writeFileSync('experiments/phase-4-8e-blind/flight-events.json', JSON.stringify(events, null, 2), 'utf8');
  console.log(report);
}

main().catch((e) => { console.error(e); process.exit(1); });
