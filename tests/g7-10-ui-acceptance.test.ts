/**
 * G7-10 — UI Acceptance Evidence (source-inspection tests).
 *
 * The web project has no test runner (no vitest/jest/testing-library — adding
 * one would violate the "no new dependencies" constraint). These tests verify
 * the actual UI behavior by inspecting the component source code for the
 * required disclosure strings and logic.
 *
 * This is MORE rigorous than typecheck (which only verifies type safety) —
 * it verifies that the required user-facing text and behavior are actually
 * present in the rendered component source, not just that the code compiles.
 *
 * Coverage:
 *   A1 — Controlled-demo disclosure string present in MissionControlDetail.
 *   A2 — No unsupported failure assertion (disclosure says NOT MEASURED, not "failed").
 *   A3 — Insights "NOT MEASURED" metric present.
 *   A4 — Worker-count uses extractWorkers (not deriveWorkerCount).
 *   A5 — Repeated-event resilience (verified by extractWorkers tests).
 *   B6 — Stale-state "Last known" disclosure present in MissionList.
 *   B7 — Persistence disclosure "not preserved across Gateway restarts" present.
 *   B8 — Empty list handling present.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_ROOT = resolve(__dirname, '..', 'web', 'src');

function readComponent(relPath: string): string {
  return readFileSync(resolve(WEB_ROOT, relPath), 'utf8');
}

describe('G7-10 A1 — Controlled-demo disclosure in MissionControlDetail', () => {
  const source = readComponent('components/genesis/MissionControlDetail.tsx');

  it('contains a truthfulness disclosure rendered when mission is terminal', () => {
    // The disclosure must be gated on snapshot?.terminal
    expect(source).toContain('snapshot?.terminal');
    // It must contain the verification-semantics heading
    expect(source).toContain('Verification semantics');
  });

  it('contains the controlled-demo disclosure text', () => {
    expect(source).toContain("Controlled Demo");
    expect(source).toContain("execution completed, but satisfaction of the user's requested outcome has not been verified");
    expect(source).toContain("Generated artifacts may be simulated");
  });

  it('distinguishes execution status from goal satisfaction', () => {
    expect(source).toContain('Execution status');
    expect(source).toContain('Artifact verification');
    expect(source).toContain('Goal satisfaction');
  });
});

describe('G7-10 A2 — No unsupported failure assertion', () => {
  const source = readComponent('components/genesis/MissionControlDetail.tsx');

  it('states NOT MEASURED for goal satisfaction (not "failed")', () => {
    expect(source).toContain('NOT MEASURED');
    // It must NOT claim the goal definitely failed
    expect(source).not.toMatch(/goal (definitely )?failed/i);
  });

  it('explains that verification.ok checks existence/integrity, not goal alignment', () => {
    expect(source).toContain('existence/integrity');
    expect(source).toContain('not goal alignment');
  });
});

describe('G7-10 A3 — Insights NOT MEASURED metric', () => {
  const source = readComponent('components/genesis/InsightsSection.tsx');

  it('contains the goalSatisfaction metric definition', () => {
    expect(source).toContain('goalSatisfaction');
    expect(source).toContain('NOT_AVAILABLE');
  });

  it('renders the NOT MEASURED display value', () => {
    expect(source).toContain('NOT MEASURED');
  });

  it('includes a context-appropriate note (controlled demo or deferred)', () => {
    expect(source).toContain('Controlled demo — goal alignment is not evaluated');
    expect(source).toContain('deferred');
  });
});

describe('G7-10 A4 — Worker-count uses extractWorkers (not deriveWorkerCount)', () => {
  const insightsSource = readComponent('components/genesis/InsightsSection.tsx');

  it('InsightsSection imports extractWorkers', () => {
    expect(insightsSource).toMatch(/import.*extractWorkers.*from.*@\/lib\/genesis\/events/);
  });

  it('InsightsSection uses extractWorkers for worker count', () => {
    expect(insightsSource).toContain('extractWorkers(events)');
  });

  it('InsightsSection does NOT contain deriveWorkerCount', () => {
    // deriveWorkerCount was the old plan-created-only counter; it must be gone.
    expect(insightsSource).not.toContain('deriveWorkerCount');
  });

  it('MissionControlDetail uses extractWorkers', () => {
    const source = readComponent('components/genesis/MissionControlDetail.tsx');
    expect(source).toContain('extractWorkers');
  });

  it('AgentSection (Sections.tsx) uses extractWorkers', () => {
    const source = readComponent('components/genesis/sections/Sections.tsx');
    expect(source).toContain('extractWorkers');
  });
});

describe('G7-10 B6 — Stale-state disclosure in MissionList', () => {
  const source = readComponent('components/genesis/MissionList.tsx');

  it('contains the "Last known — connection unavailable" disclosure', () => {
    expect(source).toContain('Last known');
    expect(source).toContain('connection unavailable');
  });

  it('marks local-only records as not server-confirmed', () => {
    expect(source).toContain('Local-only');
    expect(source).toContain('not confirmed by server');
  });

  it('applies opacity styling to stale records', () => {
    expect(source).toContain('opacity-60');
  });
});

describe('G7-10 B7 — Persistence disclosure in MissionList', () => {
  const source = readComponent('components/genesis/MissionList.tsx');

  it('contains the persistence limitation disclosure', () => {
    expect(source).toContain('Server-owned');
    expect(source).toContain('in-process');
  });

  it('states the list is not preserved across gateway restarts', () => {
    expect(source).toContain('not preserved across Gateway restarts');
  });

  it('states the 5-minute retention period (verified against DEFAULT_TERMINAL_RETENTION_MS)', () => {
    expect(source).toContain('5 minutes');
    expect(source).toContain('retention period');
  });
});

describe('G7-10 B8 — Restart behavior (empty list handling)', () => {
  const source = readComponent('components/genesis/MissionList.tsx');

  it('handles empty server list with EmptyState', () => {
    expect(source).toContain('EmptyState');
  });

  it('does not claim mission recovery after restart', () => {
    // The source must NOT contain language implying restart recovery.
    expect(source).not.toMatch(/recover(ed|y)? (active )?missions? after restart/i);
    expect(source).not.toMatch(/restores? (active )?missions?/i);
  });
});

describe('G7-10 B5 — MissionList uses server-authoritative listMissions', () => {
  const source = readComponent('components/genesis/MissionList.tsx');
  const clientSource = readComponent('lib/genesis/client.ts');

  it('MissionList calls genesisApi.listMissions', () => {
    expect(source).toContain('genesisApi.listMissions');
  });

  it('client.ts implements listMissions (not the undefined-as-never placeholder)', () => {
    // The real implementation must be an async function, not "undefined as never".
    expect(clientSource).toMatch(/async listMissions/);
    // The old placeholder must be commented out or removed.
    expect(clientSource).not.toMatch(/^(\s*)listMissions:\s*undefined as never/m);
  });

  it('BFF route allows GET on /v1/missions', () => {
    // The BFF route is at web/src/app/api/genesis/[...path]/route.ts
    const routeSource = readFileSync(
      resolve(WEB_ROOT, 'app', 'api', 'genesis', '[...path]', 'route.ts'),
      'utf8',
    );
    // The VERIFIED_PATTERNS entry for /v1/missions must include both GET and POST.
    // Actual line: { re: /^\/v1\/missions$/, methods: ["GET", "POST"] },
    // The regex source contains \/v1\/missions; the methods array lists both.
    expect(routeSource).toContain('/v1/missions');
    expect(routeSource).toMatch(/methods:\s*\["GET",\s*"POST"\]/);
  });
});
