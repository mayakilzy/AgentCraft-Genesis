/**
 * PILOT-002 R3.2 — TASK 01: Reasoning Output Recovery.
 *
 * Tests that parseAction recovers from common LLM output defects:
 *   - Truncated JSON (missing closing brace)
 *   - Trailing comma
 *   - Single quotes instead of double
 *   - Extra text after the JSON object
 *   - Empty responses
 *   - Markdown fences
 *   - Valid JSON (no regression)
 *
 * Also tests that diagnoseParseFailure produces actionable feedback.
 */

import { describe, expect, it } from 'vitest';
import { WorkerAgent } from '../../src/worker/worker-agent.js';
import type { WorkerGenome } from '../../src/contracts/core.js';

// Access private methods via any-cast (test-only).
const genome: WorkerGenome = {
  identity: { id: 'se-1', displayName: 'SE' },
  role: 'SE', objective: 'x', model: 'default',
  skills: ['code-execution'], tools: ['openbot:shell-execution', 'openbot:workspace-files'],
  computer: { required: true, browser: false, shell: true, workspace: true },
  memory: 'none', budget: { maxUsd: 100, maxTier: 'default' }, autonomy: 'autonomous',
};

function makeAgent(): WorkerAgent {
  return new WorkerAgent({
    genome,
    reasoning: { name: 'stub', async reason() { return { text: '{}' }; } },
    computer: null,
    taskBrief: 'test',
    maxSteps: 5,
  });
}

describe('PILOT-002 R3.2 TASK 01 — Reasoning Output Recovery (parseAction)', () => {
  const agent = makeAgent();
  const parseAction = (text: string) => (agent as any).parseAction(text) as ReturnType<WorkerAgent['parseAction']>;
  const diagnose = (text: string) => (agent as any).diagnoseParseFailure(text) as string;

  it('parses valid JSON without regression', () => {
    const action = parseAction('{"action":"finish","summary":"done"}');
    expect(action).toBeDefined();
    expect(action!.action).toBe('finish');
  });

  it('parses JSON wrapped in markdown fences', () => {
    const action = parseAction('```json\n{"action":"finish","summary":"done"}\n```');
    expect(action).toBeDefined();
    expect(action!.action).toBe('finish');
  });

  it('repairs truncated JSON (missing closing brace)', () => {
    const action = parseAction('{"action":"finish","summary":"done"');
    expect(action).toBeDefined();
    expect(action!.action).toBe('finish');
    expect((action as any).summary).toBe('done');
  });

  it('repairs trailing comma before closing brace', () => {
    const action = parseAction('{"action":"finish","summary":"done",}');
    expect(action).toBeDefined();
    expect(action!.action).toBe('finish');
  });

  it('repairs single quotes to double quotes', () => {
    const action = parseAction("{'action':'finish','summary':'done'}");
    expect(action).toBeDefined();
    expect(action!.action).toBe('finish');
  });

  it('extracts JSON from text with trailing notes', () => {
    const action = parseAction('{"action":"finish","summary":"done"}\n\nI have completed the task.');
    expect(action).toBeDefined();
    expect(action!.action).toBe('finish');
  });

  it('repairs truncated JSON with trailing comma and missing brace', () => {
    const action = parseAction('{"action":"write_file","path":"x.js","contents":"y",');
    expect(action).toBeDefined();
    expect(action!.action).toBe('write_file');
  });

  it('returns undefined for completely invalid input (no braces)', () => {
    const action = parseAction('I cannot do this task.');
    expect(action).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    const action = parseAction('');
    expect(action).toBeUndefined();
  });

  it('returns undefined when action field is missing', () => {
    const action = parseAction('{"path":"x.js","contents":"y"}');
    expect(action).toBeUndefined();
  });
});

describe('PILOT-002 R3.2 TASK 01 — diagnoseParseFailure (actionable feedback)', () => {
  const agent = makeAgent();
  const diagnose = (text: string) => (agent as any).diagnoseParseFailure(text) as string;

  it('diagnoses empty response', () => {
    const msg = diagnose('');
    expect(msg).toContain('empty');
    expect(msg).toContain('JSON object');
  });

  it('diagnoses missing JSON object', () => {
    const msg = diagnose('I cannot help with that.');
    expect(msg).toContain('no JSON object');
    expect(msg).toContain('Reply with ONE JSON object');
  });

  it('diagnoses truncated JSON (no closing brace)', () => {
    const msg = diagnose('{"action":"finish","summary":"done"');
    expect(msg).toContain('truncated');
    expect(msg).toContain("closing '}'");
  });

  it('diagnoses missing action field', () => {
    const msg = diagnose('{"path":"x.js","contents":"y"}');
    expect(msg).toContain('missing');
    expect(msg).toContain('"action" field');
  });

  it('diagnoses general parse failure with action found', () => {
    const msg = diagnose('{"action":"finish",,}');
    expect(msg).toContain('could not be parsed');
    expect(msg).toContain('finish');
  });
});
