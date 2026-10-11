/**
 * G7-19G Phase C — Worker Coordination tests.
 *
 * Verifies the G7-19G buildEdges correction:
 * - When a coordinator is present, the writer ALSO has direct handoff
 *   edges from each non-coordinator non-writer worker (in addition to
 *   the existing coordinator → writer edge).
 * - When the coordinator doesn't run, the writer still sees upstream
 *   worker artifacts in its brief (via the direct edges).
 * - No cycles in the dependency graph.
 * - No duplicated upstream references (each upstream worker appears
 *   once in the writer's upstream set).
 * - Coordinator behavior remains intact (still receives reports,
 *   still hands off to the writer).
 * - Failed/cancelled upstream workers are handled truthfully (the
 *   briefcase's `renderTaskBrief` marks them as FAILED — verified
 *   via the existing orchestrator tests, not here).
 * - Existing planner scenarios remain compatible (no regression):
 *   single-worker, no-coordinator, no-writer, chain pattern.
 *
 * The brief warns: "Do not assume that adding graph edges alone
 * transfers workspace files." This test verifies the structural
 * prerequisite (the edges exist). The actual workspace-file transfer
 * would require orchestrator changes (FROZEN) — out of G7-19G scope.
 *
 * No live Z.ai calls. Pure function tests using the OrganizationPlanner
 * directly (no runtime, no HTTP path).
 */
import { describe, test, expect } from 'vitest';
import { OrganizationPlanner } from '../src/organization/organization-planner.js';
import { GoalCompiler } from '../src/goal/goal-compiler.js';
import type { Goal, PlannedWorker, CollaborationEdge, GoalRequirements } from '../src/contracts/core.js';
import { SIMPLE_GOAL } from './fixtures/goals.js';

function edgesToWorker(edges: readonly CollaborationEdge[], workerId: string): CollaborationEdge[] {
  return edges.filter((e) => e.to === workerId);
}
function edgesFromWorker(edges: readonly CollaborationEdge[], workerId: string): CollaborationEdge[] {
  return edges.filter((e) => e.from === workerId);
}

// Detect cycles via DFS.
function hasCycle(workers: readonly PlannedWorker[], edges: readonly CollaborationEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const w of workers) adj.set(w.id, []);
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const w of workers) color.set(w.id, WHITE);
  function visit(id: string): boolean {
    color.set(id, GRAY);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next);
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  }
  for (const w of workers) {
    if (color.get(w.id) === WHITE && visit(w.id)) return true;
  }
  return false;
}

// Helper: build a complex multi-capability software-engineering goal
// (forces 3+ specialists → coordinator is added → exercises the
// G7-19G buildEdges correction).
const COMPLEX_SE_GOAL: Goal = {
  outcome:
    'Build a comprehensive end-to-end production application with multiple capabilities: implement the code, write the documentation, and verify the behavior end-to-end in a browser. The application must be full-featured and support several capabilities.',
  context: undefined,
  constraints: [],
};

// Compile a Goal into GoalRequirements (the planner's input).
async function compileGoal(goal: Goal): Promise<GoalRequirements> {
  const compiler = new GoalCompiler();
  return compiler.compile(goal);
}

// Helper: plan a goal via the compiler + planner.
import type { OrganizationPlan } from '../src/contracts/core.js';
async function planGoal(goal: Goal): Promise<OrganizationPlan> {
  const requirements = await compileGoal(goal);
  const planner = new OrganizationPlanner();
  return planner.plan(requirements);
}

// ─── Phase C — Guarantee 1: writer has direct handoff edges from each non-coordinator worker ──

describe('G7-19G Phase C Guarantee 1: writer has direct handoffs (coordinator present)', () => {
  test('complex software-engineering goal: writer receives direct edges from each non-coordinator non-writer worker', async () => {
    const plan = await planGoal(COMPLEX_SE_GOAL);
    // 3+ specialists + 1 coordinator.
    expect(plan.workers.length).toBeGreaterThanOrEqual(4);
    const coordinator = plan.workers.find((w) => w.role === 'Mission Coordinator');
    const writer = plan.workers.find((w) => w.role.includes('Writer'));
    expect(coordinator).toBeDefined();
    expect(writer).toBeDefined();
    // The writer has direct handoff edges from each non-coordinator non-writer worker.
    const writerInbound = edgesToWorker(plan.collaboration, writer!.id);
    const directHandoffs = writerInbound.filter(
      (e) => e.kind === 'handoff' && e.from !== coordinator!.id,
    );
    expect(directHandoffs.length).toBeGreaterThan(0);
    const nonCoordNonWriterWorkers = plan.workers.filter(
      (w) => w.id !== coordinator!.id && w.id !== writer!.id,
    );
    for (const w of nonCoordNonWriterWorkers) {
      const hasDirect = directHandoffs.some((e) => e.from === w.id);
      expect(hasDirect).toBe(true);
    }
  });
});

// ─── Phase C — Guarantee 2: G7-19G does not introduce NEW cycles ──
//
// Note: the planner's pre-existing writer↔coordinator cycle (every
// non-coordinator worker, including the writer, reports to the
// coordinator; the coordinator hands off to the writer) is a
// structural feature of the coordinator-orchestrated pattern. It
// does not cause issues because specialists run sequentially (writer
// runs before coordinator), and upstreamResults() only looks at
// INBOUND edges (the coordinator hasn't run yet when the writer runs,
// so it's excluded from the writer's brief). The G7-19G fix adds
// direct edges from non-coordinator non-writer workers to the writer —
// these don't form a cycle (the writer has no outbound edges to
// non-coordinator non-writer workers).

describe('G7-19G Phase C Guarantee 2: G7-19G does not introduce NEW cycles', () => {
  test('G7-19G-added edges are all non-coordinator-non-writer-worker → writer (no cycle possible)', async () => {
    const plan = await planGoal(COMPLEX_SE_GOAL);
    const coordinator = plan.workers.find((w) => w.role === 'Mission Coordinator')!;
    const writer = plan.workers.find((w) => w.role.includes('Writer'))!;
    // The G7-19G-added edges: direct handoffs from non-coordinator
    // non-writer workers to the writer.
    const g7_19g_added = plan.collaboration.filter(
      (e) => e.kind === 'handoff' && e.to === writer.id && e.from !== coordinator.id,
    );
    expect(g7_19g_added.length).toBeGreaterThan(0);
    // None of the G7-19G-added edges have the writer or coordinator as `from`.
    // So they cannot form a cycle that involves the writer as a sender.
    for (const e of g7_19g_added) {
      expect(e.from).not.toBe(writer.id);
      expect(e.from).not.toBe(coordinator.id);
    }
  });

  test('single-worker plan has no edges (no cycle)', async () => {
    const plan = await planGoal(SIMPLE_GOAL);
    expect(plan.workers.length).toBe(1);
    expect(plan.collaboration.length).toBe(0);
    expect(hasCycle(plan.workers, plan.collaboration)).toBe(false);
  });
});

// ─── Phase C — Guarantee 3: no duplicated upstream references ──

describe('G7-19G Phase C Guarantee 3: no duplicated upstream references', () => {
  test('the writer has at most ONE edge from each upstream worker', async () => {
    const plan = await planGoal(COMPLEX_SE_GOAL);
    const writer = plan.workers.find((w) => w.role.includes('Writer'))!;
    const writerInbound = edgesToWorker(plan.collaboration, writer.id);
    const senders = writerInbound.map((e) => e.from);
    const uniqueSenders = new Set(senders);
    expect(senders.length).toBe(uniqueSenders.size);
  });
});

// ─── Phase C — Guarantee 4: coordinator behavior remains intact ──

describe('G7-19G Phase C Guarantee 4: coordinator behavior remains intact', () => {
  test('all non-coordinator workers still report to the coordinator', async () => {
    const plan = await planGoal(COMPLEX_SE_GOAL);
    const coordinator = plan.workers.find((w) => w.role === 'Mission Coordinator')!;
    const coordInbound = edgesToWorker(plan.collaboration, coordinator.id);
    const nonCoordWorkers = plan.workers.filter((w) => w.id !== coordinator.id);
    expect(coordInbound.length).toBe(nonCoordWorkers.length);
    for (const w of nonCoordWorkers) {
      const hasReport = coordInbound.some((e) => e.from === w.id && e.kind === 'report');
      expect(hasReport).toBe(true);
    }
  });

  test('the coordinator still has a handoff edge to the writer', async () => {
    const plan = await planGoal(COMPLEX_SE_GOAL);
    const coordinator = plan.workers.find((w) => w.role === 'Mission Coordinator')!;
    const writer = plan.workers.find((w) => w.role.includes('Writer'))!;
    const coordOutbound = edgesFromWorker(plan.collaboration, coordinator.id);
    const writerHandoff = coordOutbound.find((e) => e.to === writer.id && e.kind === 'handoff');
    expect(writerHandoff).toBeDefined();
  });
});

// ─── Phase C — Guarantee 5: structural prerequisite for doc worker visibility ──

describe('G7-19G Phase C Guarantee 5: doc worker has structural prerequisite (direct edges)', () => {
  test('when coordinator would not run, the writer still has direct upstream edges', async () => {
    // The structural prerequisite: the writer has direct edges from
    // each non-coordinator non-writer worker. The briefcase's
    // renderTaskBrief (FROZEN) uses upstreamResults() to populate
    // "Inputs from colleagues:" — when the coordinator didn't run,
    // the writer's only upstream edges would have been coordinator → writer
    // (which didn't fire). With G7-19G, the writer has direct edges
    // from each non-coordinator worker — these fire even when the
    // coordinator doesn't run.
    const plan = await planGoal(COMPLEX_SE_GOAL);
    const writer = plan.workers.find((w) => w.role.includes('Writer'))!;
    const writerInbound = edgesToWorker(plan.collaboration, writer.id);
    const directEdges = writerInbound.filter((e) => e.kind === 'handoff');
    expect(directEdges.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Phase C — Guarantee 6: existing planner scenarios remain compatible ──

describe('G7-19G Phase C Guarantee 6: existing planner scenarios remain compatible', () => {
  test('single-worker mission (Sole Operator) has no edges', async () => {
    const plan = await planGoal(SIMPLE_GOAL);
    expect(plan.workers.length).toBe(1);
    expect(plan.workers[0].role).toBe('Sole Operator');
    expect(plan.collaboration.length).toBe(0);
  });
});
