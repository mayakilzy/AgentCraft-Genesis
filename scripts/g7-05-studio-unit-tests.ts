/**
 * AgentCraft Genesis G7-05 — Studio catalog unit tests.
 *
 * Tests the catalog loading + status determination directly (without HTTP).
 *
 * Run: npx tsx scripts/g7-05-studio-unit-tests.ts
 */

import {
  determineStatus,
  loadCatalog,
  type CapabilityCard,
} from "../src/lib/studio/catalog";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(r: TestResult) {
  results.push(r);
  const mark = r.pass ? "✓" : "✗";
  console.log(`${mark}  ${r.id}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

// U1: determineStatus for INTEGRATED capability (goal-compiler)
function test_integratedStatus() {
  const result = determineStatus("goal-compiler");
  record({
    id: "U1",
    name: "determineStatus('goal-compiler') → INTEGRATED (source wiring verified)",
    pass: result.status === "INTEGRATED" && result.evidence.includes("src/goal/goal-compiler.ts"),
    detail: `status=${result.status}, evidence=${result.evidence.slice(0, 50)}…`,
  });
}

// U2: determineStatus for DOCUMENTED-only capability (specialist-workspaces)
function test_documentedStatus() {
  const result = determineStatus("opendots.specialist-identity");
  record({
    id: "U2",
    name: "determineStatus('opendots.specialist-identity') → DOCUMENTED (YAML only)",
    pass: result.status === "DOCUMENTED" && result.evidence.includes("YAML record only"),
    detail: `status=${result.status}`,
  });
}

// U3: determineStatus NEVER returns RUNTIME_VERIFIED (req #2 critical)
function test_neverRuntimeVerified() {
  // Test all keys that might be in the INTEGRATED map + some that aren't.
  const keys = [
    "goal-compiler",
    "external-agent-interop",
    "computer-container",
    "opendots.specialist-identity",
    "intelligence.rich-threads",
    "nonexistent-key",
  ];
  const anyRuntimeVerified = keys.some((k) => determineStatus(k).status === "RUNTIME_VERIFIED");
  record({
    id: "U3",
    name: "determineStatus NEVER returns RUNTIME_VERIFIED (req #2 critical)",
    pass: !anyRuntimeVerified,
    detail: `checked ${keys.length} keys; none returned RUNTIME_VERIFIED`,
  });
}

// U4: loadCatalog from the real data/ directory
function test_loadRealCatalog() {
  const { ownership, census, errors } = loadCatalog();
  record({
    id: "U4",
    name: "loadCatalog() from real data/ directory — both files load",
    pass: ownership.length > 0 && census.length > 0 && errors.length === 0,
    detail: `ownership=${ownership.length}, census=${census.length}, errors=${errors.length}`,
  });
}

// U5: ownership entries have required fields
function test_ownershipFields() {
  const { ownership } = loadCatalog();
  const allHaveFields = ownership.every(
    (c) =>
      c.key.length > 0 &&
      c.owner.length > 0 &&
      c.domain.length > 0 &&
      c.source === "data/ownership.yaml" &&
      c.decision.length > 0 &&
      (c.status === "DOCUMENTED" || c.status === "INTEGRATED") &&
      c.evidence.length > 0,
  );
  record({
    id: "U5",
    name: "All ownership entries have required fields (key/owner/domain/source/decision/status/evidence)",
    pass: allHaveFields,
    detail: `checked ${ownership.length} entries`,
  });
}

// U6: census entries have required fields
function test_censusFields() {
  const { census } = loadCatalog();
  const allHaveFields = census.every(
    (c) =>
      c.key.length > 0 &&
      c.owner.length > 0 &&
      c.domain.length > 0 &&
      c.source === "data/upstream-capabilities.yaml" &&
      c.decision.length > 0 &&
      (c.status === "DOCUMENTED" || c.status === "INTEGRATED") &&
      c.evidence.length > 0,
  );
  record({
    id: "U6",
    name: "All census entries have required fields",
    pass: allHaveFields,
    detail: `checked ${census.length} entries`,
  });
}

// U7: status counts are consistent
function test_statusCounts() {
  const { ownership, census } = loadCatalog();
  const all = [...ownership, ...census];
  const documentedCount = all.filter((c) => c.status === "DOCUMENTED").length;
  const integratedCount = all.filter((c) => c.status === "INTEGRATED").length;
  const runtimeVerifiedCount = all.filter((c) => c.status === "RUNTIME_VERIFIED").length;
  record({
    id: "U7",
    name: "Status counts: documented > 0, integrated > 0, runtime_verified = 0",
    pass: documentedCount > 0 && integratedCount > 0 && runtimeVerifiedCount === 0,
    detail: `documented=${documentedCount}, integrated=${integratedCount}, runtime_verified=${runtimeVerifiedCount}`,
  });
}

// U8: malformed YAML — missing 'ownership' array
function test_malformedYaml() {
  const tmpDir = join(tmpdir(), `g7-05-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    writeFileSync(
      join(tmpDir, "ownership.yaml"),
      "baseline: 2026-01-01\n# no ownership array\n",
    );
    writeFileSync(
      join(tmpDir, "upstream-capabilities.yaml"),
      "census:\n  - id: test.one\n    capability: Test\n    canonical_owner: test\n",
    );
    const { ownership, census, errors } = loadCatalog(tmpDir);
    record({
      id: "U8",
      name: "Malformed YAML (missing 'ownership' array) → error recorded",
      pass: ownership.length === 0 && errors.length > 0 && errors.some((e) => e.includes("missing or invalid 'ownership'")),
      detail: `ownership=${ownership.length}, errors=${errors.length}`,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// U9: missing fields — entry without 'domain'
function test_missingFields() {
  const tmpDir = join(tmpdir(), `g7-05-test-missing-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    writeFileSync(
      join(tmpDir, "ownership.yaml"),
      `baseline: 2026-01-01
ownership:
  - description: Missing domain field
    canonical_owner: test
    decision: REUSE
  - domain: valid-entry
    description: Valid
    canonical_owner: test
    decision: REUSE
`,
    );
    writeFileSync(
      join(tmpDir, "upstream-capabilities.yaml"),
      "census: []\n",
    );
    const { ownership, errors } = loadCatalog(tmpDir);
    record({
      id: "U9",
      name: "Entry missing 'domain' field → skipped + error recorded",
      pass: ownership.length === 1 && errors.some((e) => e.includes("missing required 'domain'")),
      detail: `ownership=${ownership.length}, errors=${errors.length}`,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// U10: duplicate records — same domain twice
function test_duplicateRecords() {
  const tmpDir = join(tmpdir(), `g7-05-test-dup-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    writeFileSync(
      join(tmpDir, "ownership.yaml"),
      `baseline: 2026-01-01
ownership:
  - domain: duplicate-domain
    description: First
    canonical_owner: test
    decision: REUSE
  - domain: duplicate-domain
    description: Second (duplicate)
    canonical_owner: test
    decision: REUSE
`,
    );
    writeFileSync(join(tmpDir, "upstream-capabilities.yaml"), "census: []\n");
    const { ownership, errors } = loadCatalog(tmpDir);
    record({
      id: "U10",
      name: "Duplicate domain → first kept, error recorded",
      pass: ownership.length === 1 && errors.some((e) => e.includes("duplicate domain")),
      detail: `ownership=${ownership.length}, errors=${errors.length}`,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// U11: unavailable source — missing YAML file
function test_unavailableSource() {
  const tmpDir = join(tmpdir(), `g7-05-test-missing-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    // Don't create the YAML files — loadCatalog should return errors.
    const { ownership, census, errors } = loadCatalog(tmpDir);
    record({
      id: "U11",
      name: "Unavailable source (missing YAML file) → error recorded, empty arrays",
      pass: ownership.length === 0 && census.length === 0 && errors.length >= 2,
      detail: `ownership=${ownership.length}, census=${census.length}, errors=${errors.length}`,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// U12: missing 'canonical_owner' field → skipped + error
function test_missingOwner() {
  const tmpDir = join(tmpdir(), `g7-05-test-no-owner-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    writeFileSync(
      join(tmpDir, "ownership.yaml"),
      `baseline: 2026-01-01
ownership:
  - domain: no-owner
    description: Missing canonical_owner
    decision: REUSE
`,
    );
    writeFileSync(join(tmpDir, "upstream-capabilities.yaml"), "census: []\n");
    const { ownership, errors } = loadCatalog(tmpDir);
    record({
      id: "U12",
      name: "Entry missing 'canonical_owner' → skipped + error recorded",
      pass: ownership.length === 0 && errors.some((e) => e.includes("missing 'canonical_owner'")),
      detail: `ownership=${ownership.length}, errors=${errors.length}`,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// U13: unsupported capability status claim — never INTEGRATED from YAML appearance
function test_noYamlPromotionToIntegrated() {
  // A capability that appears in YAML but has NO source-code wiring should
  // be DOCUMENTED, NOT INTEGRATED. The 'intelligence.rich-threads' census
  // entry is shipped in CopilotKit Intelligence but NOT imported in the
  // Genesis engine source — so it should be DOCUMENTED.
  const { census } = loadCatalog();
  const richThreads = census.find((c) => c.key === "intelligence.rich-threads");
  record({
    id: "U13",
    name: "YAML-only capability (intelligence.rich-threads) → DOCUMENTED, NOT INTEGRATED",
    pass: richThreads?.status === "DOCUMENTED",
    detail: `status=${richThreads?.status}`,
  });
}

// U14: total count > 30 (sanity check — the YAMLs have ~17 ownership + ~35 census entries)
function test_totalCount() {
  const { ownership, census } = loadCatalog();
  const total = ownership.length + census.length;
  record({
    id: "U14",
    name: "Total capability count is reasonable (>40)",
    pass: total > 40,
    detail: `total=${total} (ownership=${ownership.length} + census=${census.length})`,
  });
}

// U15: all INTEGRATED capabilities have a source-file evidence string
function test_integratedEvidence() {
  const { ownership, census } = loadCatalog();
  const all = [...ownership, ...census];
  const integrated = all.filter((c) => c.status === "INTEGRATED");
  const allHaveEvidence = integrated.every(
    (c) => c.evidence.includes("src/") || c.evidence.includes("verified"),
  );
  record({
    id: "U15",
    name: "All INTEGRATED capabilities have source-file evidence",
    pass: integrated.length > 0 && allHaveEvidence,
    detail: `integrated=${integrated.length}, all_have_evidence=${allHaveEvidence}`,
  });
}

function main() {
  console.log("\nAgentCraft Genesis G7-05 — Studio Catalog Unit Tests\n");

  test_integratedStatus();
  test_documentedStatus();
  test_neverRuntimeVerified();
  test_loadRealCatalog();
  test_ownershipFields();
  test_censusFields();
  test_statusCounts();
  test_malformedYaml();
  test_missingFields();
  test_duplicateRecords();
  test_unavailableSource();
  test_missingOwner();
  test_noYamlPromotionToIntegrated();
  test_totalCount();
  test_integratedEvidence();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
