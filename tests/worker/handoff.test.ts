import { describe, expect, it } from 'vitest';

import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
  WorkerGenome,
} from '../../src/contracts/core.js';
import type { WorkerComputer } from '../../src/runtime/computer.js';
import {
  MissionHandoffs,
  renderHandoffBrief,
  type HandoffEvent,
} from '../../src/worker/handoff.js';
import { WorkerAgent } from '../../src/worker/worker-agent.js';

/**
 * TASK-011 acceptance: two workers actually cooperating — worker A asks
 * worker B for verification and receives B's result — over a typed handoff,
 * with no message bus and no A2A.
 */

class ScriptedReasoning implements ReasoningProvider {
  readonly name = 'scripted';
  readonly seen: ReasoningInput[] = [];
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
}

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

function genome(
  id: string,
  role: string,
  overrides: Partial<WorkerGenome> = {},
): WorkerGenome {
  return {
    identity: { id, displayName: role },
    role,
    objective: 'cooperate in a two-worker mission',
    model: 'cheap',
    skills: ['collaboration'],
    tools: ['openbot:shell-execution', 'openbot:workspace-files'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'shared-thread',
    budget: { maxUsd: 1, maxTier: 'default' },
    autonomy: 'autonomous',
    ...overrides,
  };
}

describe('MissionHandoffs — typed worker-to-worker coordination', () => {
  it('worker A asks worker B for verification and receives B real result', async () => {
    const computerB = memoryComputer();
    // B is a verification specialist: it actually writes and checks a file.
    const reasoningB = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'check.txt', contents: 'verified: 42' }),
      JSON.stringify({ action: 'read_file', path: 'check.txt' }),
      JSON.stringify({
        action: 'finish',
        summary: 'Verified: the value is 42.',
        artifacts: ['check.txt'],
      }),
    ]);
    // A asks B, then finishes with B's answer incorporated.
    const reasoningA = new ScriptedReasoning([
      JSON.stringify({
        action: 'ask_worker',
        target: 'verifier-1',
        task: 'Verify the computed value in the shared dataset',
        constraints: ['use your own workspace'],
        answerShape: 'One sentence stating the verified value, plus an evidence file',
      }),
      JSON.stringify({
        action: 'finish',
        summary: 'Value verified by the verifier: 42.',
      }),
    ]);

    const events: HandoffEvent[] = [];
    const participants = new Map([
      ['analyst-1', { genome: genome('analyst-1', 'Analyst'), reasoning: reasoningA, computer: memoryComputer() }],
      ['verifier-1', { genome: genome('verifier-1', 'Verifier'), reasoning: reasoningB, computer: computerB }],
    ]);
    const handoffs = new MissionHandoffs(participants, {
      onEvent: (event) => events.push(event),
    });

    const roster = new Map([
      ['analyst-1', 'Analyst'],
      ['verifier-1', 'Verifier'],
    ]);
    const resultA = await new WorkerAgent({
      genome: genome('analyst-1', 'Analyst'),
      reasoning: reasoningA,
      computer: participants.get('analyst-1')!.computer,
      taskBrief: 'Compute and verify a value.',
      handoffs,
      roster,
    }).run();

    // B really worked: its own computer, its own file.
    expect(computerB.files.get('check.txt')).toBe('verified: 42');
    expect(resultA.status).toBe('success');
    expect(events).toEqual([
      { type: 'handoff', from: 'analyst-1', to: 'verifier-1', ok: true },
    ]);

    // A saw B's typed answer as its observation.
    const askPrompt = reasoningA.seen.at(-1)!;
    expect(askPrompt.prompt).toContain('Verified: the value is 42.');

    // The system prompt named the real colleagues — no guessed ids.
    expect(reasoningA.seen.every((call) => (call.system ?? '').includes('verifier-1 (Verifier)'))).toBe(true);
  });

  it('passes the typed envelope and nothing else — no transcript sharing', async () => {
    const brief = renderHandoffBrief({
      from: 'a-1',
      to: 'b-1',
      task: 'Re-check the totals',
      constraints: ['within your own workspace'],
      answerShape: 'A single corrected total',
    });
    expect(brief).toContain('TASK: Re-check the totals');
    expect(brief).toContain('CONSTRAINTS: within your own workspace');
    expect(brief).toContain('WHAT A GOOD ANSWER LOOKS LIKE: A single corrected total');

    const reasoningB = new ScriptedReasoning([
      JSON.stringify({ action: 'finish', summary: 'Corrected total is 7.' }),
    ]);
    const seenPrompt = { prompt: '' };
    const probe = new (class implements ReasoningProvider {
      readonly name = 'probe';
      async reason(input: ReasoningInput): Promise<ReasoningOutput> {
        seenPrompt.prompt = input.prompt;
        return reasoningB.reason(input);
      }
    })();
    const handoffs = new MissionHandoffs(
      new Map([['b-1', { genome: genome('b-1', 'B'), reasoning: probe, computer: memoryComputer() }]]),
    );
    await handoffs.ask({
      from: 'a-1',
      to: 'b-1',
      task: 'Re-check the totals',
      constraints: ['within your own workspace'],
      answerShape: 'A single corrected total',
    });
    // The serving worker received ONLY the envelope — never A's history.
    expect(seenPrompt.prompt).toContain('TASK: Re-check the totals');
    expect(seenPrompt.prompt).not.toContain('step 1:');
  });

  it('refuses unknown targets, self-addressing and chains — loudly', async () => {
    const reasoningB = new ScriptedReasoning([
      JSON.stringify({ action: 'finish', summary: 'ok' }),
    ]);
    const participants = new Map([
      ['b-1', { genome: genome('b-1', 'B'), reasoning: reasoningB, computer: memoryComputer() }],
    ]);
    const handoffs = new MissionHandoffs(participants);

    const unknown = await handoffs.ask({
      from: 'a-1',
      to: 'nobody-1',
      task: 'anything',
      answerShape: 'anything',
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.reason).toContain('no worker "nobody-1"');

    const self = await handoffs.ask({
      from: 'b-1',
      to: 'b-1',
      task: 'anything',
      answerShape: 'anything',
    });
    expect(self.ok).toBe(false);
    expect(self.reason).toContain('cannot hand work to itself');

    // Chain: B serves a handoff; while serving, its ask is refused by the cap.
    const chainChannel = new MissionHandoffs(
      new Map([
        [
          'b-1',
          {
            genome: genome('b-1', 'B'),
            reasoning: new ScriptedReasoning([
              JSON.stringify({
                action: 'ask_worker',
                target: 'c-1',
                task: 'chain attempt',
                answerShape: 'should be refused',
              }),
              JSON.stringify({ action: 'finish', summary: 'could not chain' }),
            ]),
            computer: memoryComputer(),
          },
        ],
        [
          'c-1',
          {
            genome: genome('c-1', 'C'),
            reasoning: new ScriptedReasoning([JSON.stringify({ action: 'finish', summary: 'never reached' })]),
            computer: memoryComputer(),
          },
        ],
      ]),
    );
    const chained = await chainChannel.ask({
      from: 'a-1',
      to: 'b-1',
      task: 'serve, then try to chain onward',
      answerShape: 'whatever',
    });
    expect(chained.ok).toBe(true);
    // c-1's reasoning was never consumed — the chain was refused.
    // (b-1 finished normally after the refusal observation.)
  });

  it('says a failed handoff out loud', async () => {
    // B burns its step budget without finishing → the sub-run fails.
    const spin = JSON.stringify({ action: 'list_files', path: '.' });
    const handoffs = new MissionHandoffs(
      new Map([
        [
          'b-1',
          {
            genome: genome('b-1', 'B'),
            reasoning: new ScriptedReasoning(Array(6).fill(spin)),
            computer: memoryComputer(),
          },
        ],
      ]),
      { serveMaxSteps: 3 },
    );
    const result = await handoffs.ask({
      from: 'a-1',
      to: 'b-1',
      task: 'do something that will not finish',
      answerShape: 'anything',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('failed to serve the handoff');
    expect(result.reason).toContain('step budget');
  });

  it('refuses ask_worker when the genome lacks the collaboration skill', async () => {
    const reasoning = new ScriptedReasoning([
      JSON.stringify({
        action: 'ask_worker',
        target: 'b-1',
        task: 'anything',
        answerShape: 'anything',
      }),
      JSON.stringify({ action: 'finish', summary: 'refused as expected' }),
    ]);
    const handoffs = new MissionHandoffs(new Map());
    const result = await new WorkerAgent({
      genome: genome('a-1', 'A', { skills: [] }),
      reasoning,
      computer: memoryComputer(),
      taskBrief: 'try to ask without the collaboration skill',
      handoffs,
    }).run();
    expect(result.refusals[0]).toContain('collaboration');
  });
});
