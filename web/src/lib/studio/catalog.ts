/**
 * AgentCraft Genesis G7-05 — Studio catalog utility.
 *
 * Per G7-05 acceptance requirements:
 *   1. Use data/ownership.yaml and data/upstream-capabilities.yaml as
 *      DOCUMENTED capability sources only.
 *   2. Distinguish DOCUMENTED, INTEGRATED, and RUNTIME_VERIFIED based on
 *      evidence. Never promote a capability to RUNTIME_VERIFIED merely
 *      because it appears in YAML, a README, or source code.
 *   7. Load catalog data through an appropriately controlled server-side
 *      path. Do not expose secrets, private environment variables, or
 *      arbitrary repository filesystem access.
 *
 * INTEGRATED evidence map: hardcoded based on actual source inspection
 * of the engine repo at pinned SHA bff7b0a. Each entry maps a capability
 * domain or census ID to the source file that imports/uses it. The UI
 * shows "INTEGRATED" ONLY when this map has an entry; otherwise DOCUMENTED.
 *
 * RUNTIME_VERIFIED: requires actual runtime probing (e.g., a successful
 * A2A JSON-RPC call, an MCP tool listing, an AG-UI event emission).
 * Since the controlled environment uses dev-mode stubs (MemoryComputer +
 * DEVELOPMENT_REASONING_FALLBACK), NO capability is RUNTIME_VERIFIED.
 * Production runtime verification requires real providers + a probe —
 * out of G7-05 scope.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Status types (req #2)
// ---------------------------------------------------------------------------

export type CapabilityStatus =
  /** The capability appears in a YAML source file. This is the default. */
  | "DOCUMENTED"
  /** The capability is verified as wired into the engine source code
   * (e.g., @a2a-js/sdk is imported in src/gateway/a2a-server.ts). */
  | "INTEGRATED"
  /** The capability has been verified at runtime via an actual probe
   * (e.g., a successful A2A JSON-RPC call). NOT achievable in the
   * controlled environment. */
  | "RUNTIME_VERIFIED";

export interface CapabilityCard {
  /** Unique key (domain for ownership entries, id for census entries). */
  readonly key: string;
  /** Human-readable capability name. */
  readonly name: string;
  /** The canonical owner (e.g., 'openbot', 'a2a', 'genesis'). */
  readonly owner: string;
  /** The capability domain (from ownership.yaml) or census id (from upstream-capabilities.yaml). */
  readonly domain: string;
  /** Source file: 'data/ownership.yaml' or 'data/upstream-capabilities.yaml'. */
  readonly source: string;
  /** The upstream project providing it (from upstream-capabilities.yaml). */
  readonly upstreamProject?: string;
  /** The canonical verification URL (from upstream-capabilities.yaml). */
  readonly sourceUrl?: string;
  /** The decision: REUSE | ADAPT | DEFER | DROP_DUPLICATE | GENESIS-BUILD | etc. */
  readonly decision: string;
  /** The upstream status: shipped | template | roadmap | experimental (census only). */
  readonly upstreamStatus?: string;
  /** Future value: high | medium | low (census only). */
  readonly futureValue?: string;
  /** Honest availability status (req #2). */
  readonly status: CapabilityStatus;
  /** Evidence for the status (file path for INTEGRATED, 'YAML record' for DOCUMENTED). */
  readonly evidence: string;
  /** Engineering notes. */
  readonly notes: string;
  /** Capability needs this domain can cover (ownership only). */
  readonly satisfies?: readonly string[];
}

// ---------------------------------------------------------------------------
// INTEGRATED evidence map (req #2: based on actual source inspection)
// ---------------------------------------------------------------------------

/**
 * Map of capability keys (domain or census id) to source-code evidence.
 * An entry in this map means the capability is INTEGRATED — it's actually
 * imported/wired into the engine source code at the pinned SHA.
 *
 * Verified by source inspection of the engine repo at:
 *   branch: build/group-06-productionization
 *   HEAD:   bff7b0a6f8b4e35880a9c7453d4e6de343e4e001
 *
 * RUNTIME_VERIFIED is intentionally NEVER set here — that requires actual
 * runtime probing, which is out of scope for the controlled environment.
 */
const INTEGRATED_EVIDENCE: Readonly<Record<string, string>> = {
  // Protocols (verified via package.json + actual imports)
  "external-agent-interop":
    "src/gateway/a2a-server.ts (imports @a2a-js/sdk; src/runtime/federation/service.ts)",
  "agent-ui-lifecycle":
    "src/agui/event-bridge.ts (imports @ag-ui/core)",
  "tools-resources":
    "src/runtime/mcp/capability-provider.ts (imports @modelcontextprotocol/sdk)",

  // Execution runtime adapters (verified via source inspection)
  "computer-container":
    "src/runtime/openbot/adapter.ts (OpenBotRuntimeAdapter; adapter only — real runtime requires production mode)",
  "browser-chromium":
    "src/runtime/openbot/adapter.ts (browser spec in WorkerGenome.computer.browser)",
  "shell-execution":
    "src/runtime/openbot/adapter.ts (shell spec in WorkerGenome.computer.shell)",
  "workspace-files":
    "src/runtime/openbot/adapter.ts (workspace spec in WorkerGenome.computer.workspace)",
  "computer-supervisor":
    "src/runtime/openbot/adapter.ts (ensureWorker/stopWorker via RuntimeAdapter interface)",

  // Genesis first-party (verified via source inspection)
  "goal-compiler":
    "src/goal/goal-compiler.ts",
  "organization-planner":
    "src/organization/organization-planner.ts",
  "genome-compiler":
    "src/genome/genome-compiler.ts",
  "cognitive-resource-router":
    "src/routing/cognitive-router.ts + src/routing/decision-provider.ts",
  "software-engineering-coordination":
    "src/work/dev-runtime.ts + src/work/integration-manager.ts + src/work/git-workspace.ts",
  "organizational-learning":
    "src/learning/ (deferred to Phase 3 per ownership.yaml notes; source exists but not wired to gateway v1)",

  // Adapters for deferred/durable capabilities
  "durable-jobs-plans-checkpoints":
    "src/runtime/openmuse/adapter.ts (adapter only; not wired to gateway v1)",
  "specialist-workspaces":
    "src/runtime/opendots/adapter.ts (adapter only; not wired to gateway v1)",
};

/**
 * Determine the status of a capability based on its key.
 *
 * Per req #2: Never promote to RUNTIME_VERIFIED merely because it appears
 * in YAML, README, or source code. RUNTIME_VERIFIED requires actual
 * runtime probing, which is NOT performed in the controlled environment.
 *
 * Returns:
 *   - INTEGRATED if the key is in INTEGRATED_EVIDENCE (verified source wiring)
 *   - DOCUMENTED otherwise (appears in YAML only)
 *   - RUNTIME_VERIFIED is NEVER returned by this function (would require
 *     runtime probing — out of scope)
 */
export function determineStatus(key: string): {
  status: CapabilityStatus;
  evidence: string;
} {
  const sourceEvidence = INTEGRATED_EVIDENCE[key];
  if (sourceEvidence) {
    return {
      status: "INTEGRATED",
      evidence: sourceEvidence,
    };
  }
  return {
    status: "DOCUMENTED",
    evidence: "YAML record only (no source-code wiring verified)",
  };
}

// ---------------------------------------------------------------------------
// Controlled YAML loading (req #7)
// ---------------------------------------------------------------------------

/**
 * Load and parse the two YAML files from a controlled path.
 *
 * Per req #7: Do not expose secrets, private environment variables, or
 * arbitrary repository filesystem access. The file paths are FIXED —
 * the function does NOT accept user input for the path.
 *
 * The function reads from:
 *   <dataDir>/ownership.yaml
 *   <dataDir>/upstream-capabilities.yaml
 *
 * where <dataDir> defaults to process.cwd() + '/data'.
 */
export function loadCatalog(dataDir?: string): {
  ownership: readonly CapabilityCard[];
  census: readonly CapabilityCard[];
  errors: readonly string[];
} {
  const dir = dataDir ?? join(process.cwd(), "data");
  const errors: string[] = [];

  // --- ownership.yaml ---
  let ownership: CapabilityCard[] = [];
  try {
    const ownershipPath = join(dir, "ownership.yaml");
    const ownershipText = readFileSync(ownershipPath, "utf8");
    const parsed = parseYaml(ownershipText) as {
      baseline?: string;
      ownership?: ReadonlyArray<{
        domain?: string;
        description?: string;
        canonical_owner?: string;
        decision?: string;
        satisfies?: readonly string[];
        notes?: string;
      }>;
    } | null;

    if (parsed && Array.isArray(parsed.ownership)) {
      const seen = new Set<string>();
      for (const entry of parsed.ownership) {
        // Validate required fields.
        if (typeof entry.domain !== "string" || entry.domain.length === 0) {
          errors.push(
            `ownership.yaml: entry missing required 'domain' field — skipped`,
          );
          continue;
        }
        if (typeof entry.canonical_owner !== "string") {
          errors.push(
            `ownership.yaml: entry '${entry.domain}' missing 'canonical_owner' — skipped`,
          );
          continue;
        }
        // Duplicate detection.
        if (seen.has(entry.domain)) {
          errors.push(
            `ownership.yaml: duplicate domain '${entry.domain}' — first occurrence kept`,
          );
          continue;
        }
        seen.add(entry.domain);

        const { status, evidence } = determineStatus(entry.domain);
        ownership.push({
          key: entry.domain,
          name: entry.description ?? entry.domain,
          owner: entry.canonical_owner,
          domain: entry.domain,
          source: "data/ownership.yaml",
          decision: entry.decision ?? "UNKNOWN",
          status,
          evidence,
          notes: entry.notes ?? "",
          satisfies: entry.satisfies ?? [],
        });
      }
    } else {
      errors.push("ownership.yaml: missing or invalid 'ownership' array");
    }
  } catch (e) {
    errors.push(
      `ownership.yaml: could not load — ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // --- upstream-capabilities.yaml ---
  let census: CapabilityCard[] = [];
  try {
    const censusPath = join(dir, "upstream-capabilities.yaml");
    const censusText = readFileSync(censusPath, "utf8");
    const parsed = parseYaml(censusText) as {
      census?: ReadonlyArray<{
        id?: string;
        capability?: string;
        source?: string;
        source_url?: string;
        status?: string;
        genesis_decision?: string;
        canonical_owner?: string;
        notes?: string;
        future_value?: string;
      }>;
    } | null;

    if (parsed && Array.isArray(parsed.census)) {
      const seen = new Set<string>();
      for (const entry of parsed.census) {
        if (typeof entry.id !== "string" || entry.id.length === 0) {
          errors.push(
            "upstream-capabilities.yaml: entry missing required 'id' field — skipped",
          );
          continue;
        }
        if (typeof entry.canonical_owner !== "string") {
          errors.push(
            `upstream-capabilities.yaml: entry '${entry.id}' missing 'canonical_owner' — skipped`,
          );
          continue;
        }
        if (seen.has(entry.id)) {
          errors.push(
            `upstream-capabilities.yaml: duplicate id '${entry.id}' — first occurrence kept`,
          );
          continue;
        }
        seen.add(entry.id);

        const { status, evidence } = determineStatus(entry.id);
        census.push({
          key: entry.id,
          name: entry.capability ?? entry.id,
          owner: entry.canonical_owner,
          domain: entry.id,
          source: "data/upstream-capabilities.yaml",
          upstreamProject: entry.source,
          sourceUrl: entry.source_url,
          decision: entry.genesis_decision ?? "UNKNOWN",
          upstreamStatus: entry.status,
          futureValue: entry.future_value,
          status,
          evidence,
          notes: entry.notes ?? "",
        });
      }
    } else {
      errors.push(
        "upstream-capabilities.yaml: missing or invalid 'census' array",
      );
    }
  } catch (e) {
    errors.push(
      `upstream-capabilities.yaml: could not load — ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return { ownership, census, errors };
}
