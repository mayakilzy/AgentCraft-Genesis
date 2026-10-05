import { describe, expect, it } from 'vitest';

import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
  WorkerGenome,
} from '../../src/contracts/core.js';
import type { WorkerComputer } from '../../src/runtime/computer.js';
import { WorkerAgent } from '../../src/worker/worker-agent.js';

/**
 * TASK-010: the worker loop itself, exercised with a scripted reasoning
 * provider (deterministic action scripts) over an in-memory computer. The
 * LIVE pairing of this loop with the real OpenBot runtime and a real LLM is
 * the gated integration test and Experiment 001.
 */

/** A reasoning provider that replays a fixed script of model replies. */
class ScriptedReasoning implements ReasoningProvider {
  readonly name = 'scripted';
  private replies: readonly string[];

  constructor(replies: readonly string[]) {
    this.replies = replies;
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    expect(this.replies.length).toBeGreaterThan(0);
    const [next, ...rest] = this.replies;
    this.replies = rest;
    this.seen.push(input);
    return { text: next };
  }

  readonly seen: ReasoningInput[] = [];
}

/** In-memory computer double. */
function memoryComputer(): WorkerComputer & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async exec(command) {
      return {
        command,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        elapsedMs: 1,
      };
    },
    async writeFile(path, contents) {
      files.set(path, contents);
      return { path, bytes: contents.length, appended: false };
    },
    async readFile(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no file at ${path}`);
      return { path, text, bytes: text.length, truncated: false };
    },
    async listFiles() {
      return [...files.keys()].map((path) => ({ path, kind: 'file' as const }));
    },
  };
}

function genome(overrides: Partial<WorkerGenome> = {}): WorkerGenome {
  return {
    identity: { id: 'scripted-worker-1', displayName: 'Scripted Worker' },
    role: 'Scripted Worker',
    objective: 'test the worker loop',
    model: 'cheap',
    skills: ['code-execution'],
    tools: ['openbot:shell-execution', 'openbot:workspace-files'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'none',
    budget: { maxUsd: 1, maxTier: 'default' },
    autonomy: 'autonomous',
    ...overrides,
  };
}

describe('WorkerAgent — the acting loop', () => {
  it('executes a real smoke mission: write a file, run a command, finish with evidence', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'report.md', contents: '# Report\nborn from goal' }),
      JSON.stringify({ action: 'run_command', command: 'wc -l report.md' }),
      JSON.stringify({
        action: 'finish',
        summary: 'Wrote report.md and verified it.',
        artifacts: ['report.md'],
      }),
    ]);

    const events: string[] = [];
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: 'Produce report.md',
      onEvent: (event) => events.push(event.type),
    }).run();

    expect(result.status).toBe('success');
    expect(result.summary).toContain('report.md');
    expect(result.artifacts).toEqual(['report.md']);
    expect(computer.files.get('report.md')).toContain('born from goal');
    expect(result.steps).toBe(2);
    expect(result.reasoningCalls).toBe(3);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      kind: 'artifact',
      location: 'scripted-worker-1:report.md',
    });
    // Reasoning was asked at the genome's tier.
    expect(reasoning.seen.every((input) => input.tier === 'cheap')).toBe(true);
    expect(events).toEqual([
      'worker-started',
      'worker-step',
      'worker-step',
      'worker-finished',
    ]);
  });

  it('refuses actions the genome does not grant and records the refusal', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'run_command', command: 'rm -rf /' }),
      JSON.stringify({
        action: 'finish',
        summary: 'No shell grant; nothing to run.',
      }),
    ]);

    const result = await new WorkerAgent({
      genome: genome({ tools: ['openbot:workspace-files'] }),
      reasoning,
      computer,
      taskBrief: 'Try to run a command without the shell grant',
    }).run();

    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toContain('openbot:shell-execution');
    expect(result.status).toBe('success'); // finished honestly, refused loudly
  });

  it('fails loudly after repeated unparseable replies', async () => {
    const reasoning = new ScriptedReasoning([
      'I will first check the workspace, then…',
      'Sure! Let me think about what to do next…',
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer: memoryComputer(),
      taskBrief: 'anything',
    }).run();
    expect(result.status).toBe('failure');
    expect(result.summary).toContain('valid action');
  });

  it('fails loudly when the step budget is exhausted', async () => {
    const loop = JSON.stringify({ action: 'list_files', path: '.' });
    const reasoning = new ScriptedReasoning(Array(6).fill(loop));
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer: memoryComputer(),
      taskBrief: 'never finishes',
      maxSteps: 5,
    }).run();
    expect(result.status).toBe('failure');
    expect(result.summary).toContain('step budget');
    expect(result.steps).toBe(5);
  });

  it('rejects artifacts that do not exist — no silent success', async () => {
    const reasoning = new ScriptedReasoning([
      JSON.stringify({
        action: 'finish',
        summary: 'Done.',
        artifacts: ['phantom.md'],
      }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer: memoryComputer(),
      taskBrief: 'claim a file that was never written',
    }).run();
    expect(result.status).toBe('failure');
    expect(result.refusals[0]).toContain('phantom.md');
    expect(result.artifacts).toEqual([]);
  });

  it('treats computer errors as failed observations, not crashes', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'read_file', path: 'missing.txt' }),
      JSON.stringify({ action: 'finish', summary: 'File was missing.' }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: 'read a missing file',
    }).run();
    expect(result.status).toBe('success');
    expect(result.steps).toBe(1);
  });

  it('supports abort mid-loop', async () => {
    const controller = new AbortController();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'list_files', path: '.' }),
      JSON.stringify({ action: 'finish', summary: 'late' }),
    ]);
    controller.abort();
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer: memoryComputer(),
      taskBrief: 'aborted before starting',
      signal: controller.signal,
    }).run();
    expect(result.status).toBe('failure');
    expect(result.summary).toContain('aborted');
  });
});
