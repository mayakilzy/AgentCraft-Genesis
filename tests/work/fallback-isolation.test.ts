import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DevelopmentFallbackProvider } from '../../experiments/experiment-003/dev-fallback.js';
import type { WorkerGenome } from '../../src/contracts/core.js';
import {
  MissionHandoffs,
  type HandoffParticipant,
} from '../../src/worker/handoff.js';
import { WorkerAgent } from '../../src/worker/worker-agent.js';

/**
 * TASK-022A — FALLBACK INSTANCE ISOLATION, pinned against the real boundary.
 *
 * The invariant under test (the property the Experiment 003 independent
 * review found broken):
 *
 *   implicit cross-instance memory   = forbidden
 *   explicit Genesis communication   = allowed
 *   same-instance continuity         = preserved
 *
 * These tests do NOT inspect prompt strings to decide isolation and they do
 * NOT call provider methods directly. They run REAL WorkerAgents against the
 * REAL DevelopmentFallbackProvider file journal, and serve the journal the
 * way the real fallback actor does: a deterministic actor whose complete
 * knowledge for any request is the request file itself plus every file in
 * the journal DIRECTORY that request lives in. That directory IS the
 * fallback context/session boundary — whatever is not in it is unreachable,
 * and a compliant actor cannot know it.
 *
 * Under the contaminated (pre-TASK-022A) design every instance shared ONE
 * journal directory, so the actor serving worker B could read worker A's
 * requests: the marker leaked and these tests FAIL. Under the remediated
 * design each logical instance journals into its own directory, so the same
 * actor model cannot see A's context: the tests PASS. The test is therefore
 * a genuine regression detector for the actual boundary, not a prompt grep.
 */

const SESSION_CODE = /session code word: (KAPPA_\d+)/;

interface PendingRequest {
  /** The journal directory this request lives in — the actor's whole world. */
  readonly dir: string;
  readonly seq: number;
  readonly prompt: string;
  readonly path: string;
}

/** Every unanswered request under the mission queue root, recursive. */
function findPending(root: string): PendingRequest[] {
  const out: PendingRequest[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const match = /^req-(\d{4})\.json$/.exec(entry.name);
      if (match === null) continue;
      const raw = JSON.parse(readFileSync(full, 'utf8')) as {
        prompt: string;
      };
      out.push({
        dir,
        seq: Number(match[1]),
        prompt: raw.prompt,
        path: full,
      });
    }
  };
  walk(root);
  return out.sort((a, b) => a.seq - b.seq);
}

/**
 * The actor's complete visible context for one request: every file in the
 * request's journal directory (its own request, this instance's earlier
 * requests and responses). Nothing outside that directory is read — that is
 * the per-instance epistemic boundary a compliant fallback actor respects.
 */
function visibleContext(req: PendingRequest): string {
  let text = '';
  for (const entry of readdirSync(req.dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    text += `${readFileSync(join(req.dir, entry.name), 'utf8')}\n`;
  }
  return text;
}

type ActorPolicy = (req: PendingRequest, context: string) => string;

/**
 * Run a real agent (or mission action) to completion while a deterministic
 * fallback actor serves every request the journal produces, exactly the way
 * the human actor served Experiment 003: read request, write response file.
 * Returns the action's result plus every journal directory served.
 */
async function runWithActor<T>(
  root: string,
  action: () => Promise<T>,
  policy: ActorPolicy,
): Promise<{ result: T; dirs: string[] }> {
  const served = new Set<string>();
  const dirs: string[] = [];
  const run = action();
  let settled = false;
  run.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const deadline = Date.now() + 30_000;
  while (!settled) {
    if (Date.now() > deadline) {
      throw new Error('test fallback actor loop timed out');
    }
    let progress = false;
    for (const req of findPending(root)) {
      if (served.has(req.path)) continue;
      served.add(req.path);
      if (!dirs.includes(req.dir)) dirs.push(req.dir);
      const answer = policy(req, visibleContext(req));
      writeFileSync(
        join(req.dir, `resp-${String(req.seq).padStart(4, '0')}.txt`),
        answer,
        'utf8',
      );
      progress = true;
    }
    await new Promise((resolve) => setTimeout(resolve, progress ? 5 : 10));
  }
  return { result: await run, dirs };
}

function dirContains(dir: string, pattern: RegExp): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (pattern.test(readFileSync(join(dir, entry.name), 'utf8'))) return true;
  }
  return false;
}

/** Root-level journal files (mission-scope calls only — no worker calls). */
function rootLevelRequestFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(done-)?req-\d{4}\.json$/.test(entry.name))
    .map((entry) => entry.name);
}

function genome(id: string, displayName: string, skills: readonly string[] = []): WorkerGenome {
  return {
    identity: { id, displayName },
    role: 'Test Worker',
    objective: 'Exercise the fallback instance boundary',
    model: 'cheap',
    skills,
    tools: [],
    computer: { required: false, browser: false, shell: false, workspace: false },
    memory: 'none',
    budget: { maxUsd: 0, maxTier: 'cheap' },
    autonomy: 'autonomous',
  };
}

function newProvider(root: string): DevelopmentFallbackProvider {
  return new DevelopmentFallbackProvider({
    queueDir: root,
    missionId: 'test-mission',
    waitTimeoutMs: 10_000,
    pollIntervalMs: 10,
  });
}

const FINISH = (summary: string): string =>
  JSON.stringify({ action: 'finish', summary });

describe('fallback instance isolation (TASK-022A)', () => {
  it(
    'implicit cross-instance memory is impossible: a marker given to instance A ' +
      'cannot surface in worker B or in a second instance of A',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'fallback-iso-'));
      const provider = newProvider(root);

      // --- Worker Instance A: legitimately receives the private marker.
      const agentA = new WorkerAgent({
        genome: genome('worker-alpha', 'Alpha'),
        reasoning: provider,
        computer: null,
        taskBrief:
          'Mission materials (private to you): the secret marker is ' +
          'ALPHA_PRIVATE_FACT_7F31. Finish immediately with a summary that ' +
          'quotes the secret marker.',
      });
      const runA = await runWithActor(root, () => agentA.run(), (_req, ctx) => {
        const match = /ALPHA_PRIVATE_FACT_[0-9A-F]+/.exec(ctx);
        return FINISH(`Registered secret marker ${match?.[0] ?? 'MISSING'}`);
      });
      // A reasons from its marker — it was supplied to THIS instance.
      expect(runA.result.summary).toContain('ALPHA_PRIVATE_FACT_7F31');
      expect(runA.result.status).toBe('success');
      // A's journal directory is where the marker legitimately lives.
      expect(runA.dirs).toHaveLength(1);
      expect(dirContains(runA.dirs[0], /ALPHA_PRIVATE_FACT_[0-9A-F]+/)).toBe(true);

      // --- Worker Instance B: a DIFFERENT worker in the same mission,
      // sharing the same fallback provider. Its materials do NOT contain
      // the marker. The actor answers from B's journal directory only.
      const probeBrief =
        'A different worker in this mission was given a secret marker. ' +
        'Your own materials do not contain it. If you know the marker, ' +
        'finish with summary "LEAKED: <the marker>". If you do not, finish ' +
        'with exactly "MARKER UNKNOWN".';
      const agentB = new WorkerAgent({
        genome: genome('worker-beta', 'Beta'),
        reasoning: provider,
        computer: null,
        taskBrief: probeBrief,
      });
      const runB = await runWithActor(root, () => agentB.run(), (_req, ctx) => {
        const match = /ALPHA_PRIVATE_FACT_[0-9A-F]+/.exec(ctx);
        return FINISH(match === null ? 'MARKER UNKNOWN' : `LEAKED: ${match[0]}`);
      });
      expect(runB.result.summary).toBe('MARKER UNKNOWN');
      // B's complete epistemic context (its journal directory) has no trace
      // of A's marker, and B's context is NOT A's context.
      expect(dirContains(runB.dirs[0], /ALPHA_PRIVATE_FACT_[0-9A-F]+/)).toBe(false);
      expect(runB.dirs[0]).not.toBe(runA.dirs[0]);

      // --- Worker Instance A2: a SECOND logical instance of the SAME
      // worker genome (the Experiment 003 handoff shape). Fresh instance:
      // exactly the context Genesis gives it, nothing remembered from A.
      const agentA2 = new WorkerAgent({
        genome: genome('worker-alpha', 'Alpha'),
        reasoning: provider,
        computer: null,
        taskBrief: probeBrief,
      });
      const runA2 = await runWithActor(root, () => agentA2.run(), (_req, ctx) => {
        const match = /ALPHA_PRIVATE_FACT_[0-9A-F]+/.exec(ctx);
        return FINISH(match === null ? 'MARKER UNKNOWN' : `LEAKED: ${match[0]}`);
      });
      expect(runA2.result.summary).toBe('MARKER UNKNOWN');
      expect(dirContains(runA2.dirs[0], /ALPHA_PRIVATE_FACT_[0-9A-F]+/)).toBe(false);
      expect(runA2.dirs[0]).not.toBe(runA.dirs[0]);

      // --- Structural audit of the real boundary:
      //   exactly ONE instance directory holds the marker (A's),
      //   no other instance directory does, and
      //   no worker request was journaled at the mission root.
      const instanceDirs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('instance-'))
        .map((entry) => join(root, entry.name));
      expect(instanceDirs).toHaveLength(3);
      expect(instanceDirs.filter((dir) => dirContains(dir, /ALPHA_PRIVATE_FACT_[0-9A-F]+/))).toHaveLength(1);
      expect(rootLevelRequestFiles(root)).toEqual([]);

      // Mission-total usage still aggregates across the isolated instances.
      expect(provider.currentUsage().calls).toBe(3);
    },
    60_000,
  );

  it(
    'explicit Genesis communication still crosses the boundary: a fact sent ' +
      'through ask_worker reaches the isolated serving instance',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'fallback-comms-'));
      const provider = newProvider(root);

      const participants = new Map<string, HandoffParticipant>([
        [
          'worker-alpha',
          { genome: genome('worker-alpha', 'Alpha', ['collaboration']), reasoning: provider, computer: null },
        ],
        [
          'worker-beta',
          { genome: genome('worker-beta', 'Beta'), reasoning: provider, computer: null },
        ],
      ]);
      const handoffs = new MissionHandoffs(participants);
      const roster = new Map<string, string>([
        ['worker-alpha', 'Test Worker'],
        ['worker-beta', 'Test Worker'],
      ]);

      const agentA = new WorkerAgent({
        genome: genome('worker-alpha', 'Alpha', ['collaboration']),
        reasoning: provider,
        computer: null,
        taskBrief:
          'Send the shared fact to your colleague worker-beta through ' +
          'ask_worker (the task text must contain the fact), then finish ' +
          'with a summary quoting their answer. The shared fact is ' +
          'SHARED_FACT_BETA_42.',
        handoffs,
        roster,
      });

      let betaAnswer = '';
      let betaDir = '';
      const runA = await runWithActor(root, () => agentA.run(), (req, ctx) => {
        // The handoff-served instance (worker B) receives a fresh context
        // whose only input is the typed envelope — exactly what Genesis
        // explicitly sent. The fact is THERE because A put it in the task.
        if (req.prompt.includes('A colleague worker has asked you for help')) {
          betaDir = req.dir;
          const match = /SHARED_FACT_BETA_\d+/.exec(ctx);
          betaAnswer = `Confirmed the shared fact: ${match?.[0] ?? 'MISSING'}`;
          return FINISH(betaAnswer);
        }
        // A's follow-up: the colleague's answer arrived as an observation.
        if (req.prompt.includes('"ok":true')) {
          const match = /SHARED_FACT_BETA_\d+/.exec(ctx);
          return FINISH(`Colleague confirmed the shared fact ${match?.[0] ?? 'MISSING'}`);
        }
        // A's first step: send the fact through the explicit channel. The
        // value comes from A's own visible context (its brief), not from
        // the test closing over the literal.
        const fact = /SHARED_FACT_BETA_\d+/.exec(ctx)?.[0] ?? 'SHARED_FACT_BETA_MISSING';
        return JSON.stringify({
          action: 'ask_worker',
          target: 'worker-beta',
          task: `Please confirm the shared fact ${fact} by finishing with a summary that quotes it.`,
          answerShape: 'One sentence containing the shared fact.',
        });
      });

      // B — a fresh, isolated instance — CAN use what was explicitly sent.
      expect(betaAnswer).toContain('SHARED_FACT_BETA_42');
      // The fact reached B through the handoff envelope (B's journal holds
      // it because it was SUPPLIED), and A's summary reflects the answer.
      expect(betaDir).not.toBe('');
      expect(dirContains(betaDir, /SHARED_FACT_BETA_\d+/)).toBe(true);
      expect(runA.result.summary).toContain('SHARED_FACT_BETA_42');
      expect(runA.result.status).toBe('success');
      // Explicit supply does not blur the boundary: A and the handoff-served
      // B still journal into distinct instance contexts (two dirs were
      // served during A's run — A's own and B's fresh serving instance).
      expect(runA.dirs).toHaveLength(2);
      expect(runA.dirs).toContain(betaDir);
      const alphaDir = runA.dirs.find((dir) => dir !== betaDir);
      expect(alphaDir).toBeDefined();
      expect(alphaDir).not.toBe(betaDir);
      expect(provider.currentUsage().calls).toBe(3);
    },
    60_000,
  );

  it(
    'same-instance continuity is preserved: repeated calls of ONE instance ' +
      'keep their private session history',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'fallback-cont-'));
      const provider = newProvider(root);

      const agent = new WorkerAgent({
        genome: genome('worker-gamma', 'Gamma'),
        reasoning: provider,
        computer: null,
        taskBrief:
          'Two-step session protocol. (1) On your FIRST prompt, reply with ' +
          'the plain text: WAIT (not JSON). (2) On your NEXT prompt, finish ' +
          'with a summary that includes the session code word from your ' +
          'first exchange this session.',
      });

      const run = await runWithActor(root, () => agent.run(), (_req, ctx) => {
        const prior = SESSION_CODE.exec(ctx);
        if (prior !== null) {
          return FINISH(`Session code word recovered: ${prior[1]}`);
        }
        // First exchange: the actor establishes a code word of its own —
        // deliberately NOT valid JSON, so the value never enters the
        // worker's scratchpad and exists only in this instance's journal.
        return 'WAIT — session code word: KAPPA_58';
      });

      // The code word was recoverable ONLY from this instance's journal
      // (its first response file): same-instance continuity through the
      // real fallback boundary.
      expect(run.result.summary).toBe('Session code word recovered: KAPPA_58');
      expect(run.result.status).toBe('success');

      // Both calls of this instance journaled into ONE context, in order.
      expect(run.dirs).toHaveLength(1);
      const dir = run.dirs[0];
      expect(existsSync(join(dir, 'done-req-0001.json'))).toBe(true);
      expect(existsSync(join(dir, 'done-req-0002.json'))).toBe(true);
      expect(existsSync(join(dir, 'done-resp-0001.txt'))).toBe(true);

      // Rigor: the code word appears in NO request prompt — continuity
      // came from the instance journal, not from the prompts themselves.
      for (const name of ['done-req-0001.json', 'done-req-0002.json']) {
        const prompt = (JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
          prompt: string;
        }).prompt;
        expect(prompt).not.toContain('KAPPA_58');
      }
      expect(provider.currentUsage().calls).toBe(2);
    },
    60_000,
  );
});
