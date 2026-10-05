import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * TASK-003 — Canonical Ownership Gate.
 *
 * A small, deliberate gate that keeps the ownership registry sound:
 *   1. every census capability has exactly one canonical owner;
 *   2. no domain in the ownership registry is registered twice (duplicate owners);
 *   3. OpenBot is the canonical computer/browser/shell/workspace baseline;
 *   4. every mission-level capability need is covered by a REUSE/ADAPT domain;
 *   5. machine-readable baselines stay valid JSON/YAML with required keys.
 */

const OWNERSHIP_PATH = 'data/ownership.yaml';
const CENSUS_PATH = 'data/upstream-capabilities.yaml';
const DEPENDENCY_BASELINE_PATH = 'data/dependency-baseline.json';

const KNOWN_OWNERS = new Set([
  'openbot',
  'openmuse',
  'opendots',
  'copilotkit-intelligence',
  'ag-ui',
  'mcp',
  'a2a',
  'genesis',
]);

const KNOWN_NEEDS = [
  'web-research',
  'code-execution',
  'document-authoring',
  'data-analysis',
  'browser-verification',
] as const;

const DECISIONS = new Set([
  'REUSE',
  'ADAPT',
  'DEFER',
  'DROP_DUPLICATE',
  'GENESIS-BUILD',
]);

interface OwnershipEntry {
  domain: string;
  description: string;
  canonical_owner: string;
  decision: string;
  satisfies: string[];
  notes: string;
}

interface CensusEntry {
  id: string;
  capability: string;
  source: string;
  source_url: string;
  status: string;
  genesis_decision: string;
  canonical_owner: string;
  notes: string;
  future_value: string;
}

function loadOwnership(): { baseline: string; ownership: OwnershipEntry[] } {
  return parse(readFileSync(OWNERSHIP_PATH, 'utf8')) as {
    baseline: string;
    ownership: OwnershipEntry[];
  };
}

function loadCensus(): { census: CensusEntry[] } {
  return parse(readFileSync(CENSUS_PATH, 'utf8')) as { census: CensusEntry[] };
}

describe('canonical ownership gate (TASK-003)', () => {
  it('registers every capability domain exactly once — no duplicate canonical owners', () => {
    const { ownership } = loadOwnership();
    expect(ownership.length).toBeGreaterThan(0);

    const domains = ownership.map((entry) => entry.domain);
    const duplicates = domains.filter(
      (domain, index) => domains.indexOf(domain) !== index,
    );
    expect(duplicates).toEqual([]);

    for (const entry of ownership) {
      expect(entry.description, `${entry.domain} needs a description`).toBeTruthy();
      expect(entry.notes, `${entry.domain} needs notes`).toBeTruthy();
      expect(KNOWN_OWNERS.has(entry.canonical_owner)).toBe(true);
      expect(DECISIONS.has(entry.decision)).toBe(true);
      expect(Array.isArray(entry.satisfies)).toBe(true);
    }
  });

  it('locks OpenBot as the canonical computer/browser/shell/workspace baseline', () => {
    const { ownership } = loadOwnership();
    const ownerOf = (domain: string): string => {
      const match = ownership.find((entry) => entry.domain === domain);
      expect(match, `domain ${domain} must exist`).toBeDefined();
      return match!.canonical_owner;
    };

    expect(ownerOf('computer-container')).toBe('openbot');
    expect(ownerOf('browser-chromium')).toBe('openbot');
    expect(ownerOf('shell-execution')).toBe('openbot');
    expect(ownerOf('workspace-files')).toBe('openbot');
    expect(ownerOf('computer-supervisor')).toBe('openbot');
  });

  it('keeps exactly one non-deferred owner covering each known mission capability need', () => {
    const { ownership } = loadOwnership();
    const active = ownership.filter(
      (entry) => entry.decision === 'REUSE' || entry.decision === 'ADAPT',
    );

    for (const need of KNOWN_NEEDS) {
      const covering = active.filter((entry) => entry.satisfies.includes(need));
      expect(
        covering.length,
        `need "${need}" must be covered by at least one REUSE/ADAPT domain`,
      ).toBeGreaterThan(0);
      // Every covering domain must point at the same canonical owner for this need,
      // so no need can ever be satisfied by two competing owners.
      const owners = new Set(covering.map((entry) => entry.canonical_owner));
      expect(owners.size, `need "${need}" has competing owners`).toBe(1);
    }
  });

  it('keeps the census consistent with the ownership vocabulary', () => {
    const { census } = loadCensus();
    const sources = new Set(census.map((entry) => entry.source));
    expect(sources).toEqual(
      new Set(['OpenBot', 'OpenMuse', 'OpenDots', 'CopilotKit Intelligence']),
    );

    const ids = census.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of census) {
      expect(entry.source_url).toMatch(/^https:\/\//);
      expect(['shipped', 'template', 'roadmap', 'experimental']).toContain(entry.status);
      expect(
        [
          'REUSE',
          'REUSE_PATTERN',
          'ADAPT',
          'DEFER',
          'DROP_DUPLICATE',
          'EXTEND',
        ],
      ).toContain(entry.genesis_decision);
      expect(entry.future_value).toMatch(/^(high|medium|low)$/);
    }
  });

  it('drops the known upstream duplicate in favor of the canonical runtime', () => {
    const { census } = loadCensus();
    const duplicate = census.find(
      (entry) => entry.id === 'openmuse.native-computer-browser',
    );
    expect(duplicate).toBeDefined();
    expect(duplicate!.genesis_decision).toBe('DROP_DUPLICATE');
    expect(duplicate!.canonical_owner).toBe('OpenBot');
  });

  it('keeps the machine-readable dependency baseline parseable and complete', () => {
    const baseline = JSON.parse(
      readFileSync(DEPENDENCY_BASELINE_PATH, 'utf8'),
    ) as Record<string, unknown>;
    expect(baseline['baseline_date']).toBe('2026-10-05');
    expect(Object.keys(baseline['upstreams'] as object)).toHaveLength(4);
    expect(Object.keys(baseline['protocols'] as object)).toHaveLength(3);
    expect(Array.isArray(baseline['watch_items'])).toBe(true);
  });
});
