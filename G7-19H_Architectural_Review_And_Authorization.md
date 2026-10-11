# G7-19H — Architectural Review & Authorization Recommendations

**Reviewer:** GLM (acting as architectural reviewer + app-repair expert per user's explicit delegation)
**Date:** 2026-10-11
**Baseline reviewed:** G7-19H final HEAD `0438f237dad3bc4e24ee151c053f76861f88f39a` (post-push)
**Source documents:**
- `G7-19H_Live_Acceptance_And_Collaboration_Report.md` (§10 findings)
- `evidence/g7-19h/gate-summary.json` (gate-level verdicts)
- `evidence/g7-19h/mission-events.json` (runtime behavior)
- `evidence/g7-19h/artifacts-response.json` (worker outputs)
- `evidence/g7-19h/gate-e-clean-room-acceptance.json` (independent test transcripts)
- `evidence/g7-19h/control-fixed-test-transcript.txt` (control experiment)

**Scope of this review:** Analyze the 6 findings documented in G7-19H §10, propose concrete fixes (with code sketches), classify severity, and recommend an authorization decision for a follow-up task. **This review does NOT implement any fixes** — it produces proposals only. No source files were modified during this review.

---

## 1. Reviewer Mandate

The G7-19H brief said: *"After delivering G7-19H: STOP. Do not implement fixes discovered during the mission. Await architectural review and explicit authorization."*

The user has explicitly delegated the architectural review step to GLM (acting as both architectural reviewer and app-repair expert). This document is the architectural review. It contains:

1. Severity classification of each finding.
2. Root-cause analysis (deeper than the G7-19H surface description).
3. Concrete fix proposals with code sketches (marked `PROPOSAL — NOT IMPLEMENTED`).
4. Implementation cost + frozen-contract impact assessment.
5. Authorization recommendation per finding.
6. A recommended follow-up task scope (proposed as **G7-19I**, NOT G7-20).

**Nothing in this review modifies source files.** All code sketches are illustrative proposals for the next task to implement — pending the user's explicit confirmation.

---

## 2. Severity Classification

| # | Finding | Severity | Frozen Impact | Fix Cost | Authorization |
|---|---|---|---|---|---|
| 1 | Recurring `package.json` test-script syntax defect (`node --test test/` breaks in Node v24) | **HIGH** — blocks independent acceptance | none (gateway-layer diagnostic) | SMALL | AUTHORIZED (diagnostic) |
| 2 | Caller-supplied `command`-type check — clean-room pathing asymmetry | **MEDIUM** — caller footgun | none (gateway-layer `buildChecks` change) | SMALL | AUTHORIZED |
| 3 | Duplicate-production pattern persists (3 of 4 workers produced the full app) | **HIGH** — 3× token waste | none for diagnostic; FROZEN for proper fix | SMALL (diagnostic) / LARGE (proper fix) | PARTIAL — diagnostic authorized; proper fix needs discussion |
| 4 | Verification event not propagated to mission snapshot | **LOW** — data is available via events endpoint | none (gateway-layer snapshot extension) | SMALL | AUTHORIZED |
| 5 | `generalist-worker-3` produced nothing (missing `openbot:workspace-files` grant claim) | **MEDIUM** — broken worker; token waste | unknown until investigation | SMALL (investigation) | AUTHORIZED for investigation |
| 6 | Z.ai 429 rate-limit contributed to timeout | **LOW** — environmental, not a defect | none | NONE | NO ACTION — environmental |

---

## 3. Finding-by-Finding Analysis

### 3.1 Finding #1 — Recurring `package.json` test-script syntax defect

#### 3.1.1 Recap (from G7-19H §10.1)

Across two consecutive live production missions (G7-19E and G7-19H), the Z.ai GLM-4-Plus reasoning provider systematically generates `package.json` files with:

```json
{
  "scripts": {
    "test": "node --test test/"
  }
}
```

In Node v22+, `node --test test/` is interpreted as **"run the module at path `test/`"** — `test/` is treated as a module specifier, not a directory glob. Node attempts to resolve `test/` as a CommonJS module, fails with `Cannot find module '.../test'`, and exits non-zero. The CLI application logic itself is sound (all 5 functional checks pass), but `npm test` fails immediately. The G7-19H control experiment proved this: changing `"node --test test/"` → `"node --test"` makes 8/8 tests pass in 487 ms.

#### 3.1.2 Root cause (deeper)

The defect has two layers:

- **(Layer A — model behavior)** The Z.ai GLM-4-Plus model has a learned prior that `"node --test test/"` is the correct test-script syntax. This prior was likely formed from Node v18-v20 documentation/examples where `--test` did accept directory paths. The model does not know that Node v22+ changed this behavior. The brief in G7-19H explicitly said "Use Node.js >= 20 standard library ONLY" — but did not specify the correct `npm test` script syntax.

- **(Layer B — system design)** Genesis does not validate the produced `package.json` test script before verification. The verifier runs `npm test` (or `sh -c "cd artifacts/<workerId> && npm test"` via auto-add), which fails because of the broken script. The structural floor (file existence) and content-in-artifacts checks pass — but the executable acceptance fails. The failure is **truthful** (G7-19F working as designed), but the **root cause** (broken script) is not surfaced to the caller in the response.

#### 3.1.3 Proposed fix (three layers, ordered by recommendation strength)

**Layer A fix — strengthen the brief (worker-side, fragile but cheap):**

Add an explicit instruction to the mission context. In the G7-19H driver's `MISSION_CONTEXT`, the brief listed file structure requirements but did not specify the correct `npm test` script syntax. Add:

```
package.json — scripts.test MUST be exactly "node --test" (NO argument).
Do NOT use "node --test test/" — this syntax breaks in Node v22+ because
--test interprets the next argument as a module path, not a directory.
```

This is fragile (depends on the LLM following the instruction), but it is cheap and addresses the model's prior directly. **Cost: 2 lines of brief text. Risk: LLM may still deviate.**

**Layer B1 fix — gateway-side diagnostic (recommended, non-blocking):**

Add a new module `src/runtime/package-script-diagnostics.ts` that scans produced `package.json` files for known-broken test-script patterns. Emit a diagnostic in the artifacts response.

```typescript
// PROPOSAL — NOT IMPLEMENTED
// New file: src/runtime/package-script-diagnostics.ts

export interface PackageScriptDiagnostic {
  readonly severity: 'warn' | 'error';
  readonly code: string;          // e.g., 'BREAKING_NODE_V22_TEST_SCRIPT'
  readonly message: string;
  readonly workerId: string;
  readonly path: string;          // 'package.json'
  readonly observedScript: string;
  readonly recommendedScript: string;
}

const KNOWN_BROKEN_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly code: string;
  readonly recommended: string;
  readonly message: string;
}> = [
  {
    // "node --test test/" or "node --test test" — interpreted as module path in Node v22+
    pattern: /^node\s+--test\s+test\/?$/,
    code: 'BREAKING_NODE_V22_TEST_SCRIPT',
    recommended: 'node --test',
    message: 'package.json scripts.test uses "node --test test/" which is interpreted as a module path in Node v22+. Use "node --test" (no argument) to auto-discover test files.',
  },
];

export async function diagnosePackageJsonTestScript(
  artifacts: ReadonlyArray<{
    workerId: string;
    paths: readonly string[];
    readFile: (path: string) => Promise<string>;
  }>,
): Promise<PackageScriptDiagnostic[]> {
  const diagnostics: PackageScriptDiagnostic[] = [];
  for (const source of artifacts) {
    if (!source.paths.includes('package.json')) continue;
    try {
      const content = await source.readFile('package.json');
      const pkg = JSON.parse(content);
      const testScript = pkg?.scripts?.test;
      if (typeof testScript !== 'string') continue;
      for (const p of KNOWN_BROKEN_PATTERNS) {
        if (p.pattern.test(testScript.trim())) {
          diagnostics.push({
            severity: 'warn',
            code: p.code,
            message: p.message,
            workerId: source.workerId,
            path: 'package.json',
            observedScript: testScript,
            recommendedScript: p.recommended,
          });
        }
      }
    } catch {
      // JSON parse error or read failure — skip (other checks will catch this)
    }
  }
  return diagnostics;
}
```

Wire it into `MissionService.getArtifacts()`:

```typescript
// PROPOSAL — NOT IMPLEMENTED
// In src/gateway/mission-service.ts, in the getArtifacts() method that
// builds the artifacts response:
const scriptDiagnostics = await diagnosePackageJsonTestScript(
  artifacts.map(a => ({
    workerId: a.workerId,
    paths: a.paths,
    readFile: (p) => a.computer.readFile(p),
  })),
);
// Include in the response:
return {
  missionId,
  artifacts: [...],
  verifiedPackageSelection: [...],
  // NEW:
  scriptDiagnostics: scriptDiagnostics.length > 0 ? scriptDiagnostics : undefined,
};
```

**Cost:** ~80 lines new module + ~10 lines wiring in `mission-service.ts`. **Frozen impact:** none. **Risk:** low — diagnostic only, does not modify worker output or verification outcome.

**Layer B3 alternative — sentinel check (NOT recommended):**

Emit an additional `command: 'node --test'` check (bypassing the worker's broken npm script) to verify the test files themselves work. This masks the worker's defect — verification would pass even though the worker's `package.json` is broken. **Rejected** — it violates the principle that verification should reflect the actual user experience (running `npm test`).

#### 3.1.4 Authorization

**AUTHORIZED for Layer A + Layer B1.** Both are gateway-layer / brief-layer fixes with no frozen-contract impact. Layer B1 makes the defect visible in the response, enabling callers to diagnose without a separate clean-room run.

---

### 3.2 Finding #2 — Caller-supplied `command`-type check — clean-room pathing asymmetry

#### 3.2.1 Recap (from G7-19H §10.2)

The G7-19F auto-add path emits per-worker `sh -c "cd artifacts/<workerId> && <command>"` checks that run in the correct clean-room subdirectory. However, when the caller supplies an explicit `command: 'npm test'` (matching the canonical phrase), the `command` branch in `buildChecks` (`src/gateway/mission-service.ts:1996-2016`) propagates the command as-is. It runs in the verifier workspace root, where no `package.json` exists. The check fails honestly (ENOENT), but the caller cannot safely address the per-worker clean-room layout without knowing the worker ID in advance.

This is an asymmetry: `file`-kind and `hash-match`-kind caller checks auto-expand to per-source clean-room paths (lines 1944-1995 of `mission-service.ts`), but `command`-kind does not.

#### 3.2.2 Root cause

When G7-19F added the `command`-kind branch, it followed the principle "the caller is responsible for crafting a command that works in the verifier's clean-room layout". This is documented in the comment at lines 2003-2007:

```
// The caller is responsible for crafting a command that works in the
// verifier's clean-room layout (e.g., `sh -c "cd artifacts/<workerId>
// && npm test"`). The auto-add path (below) handles the common case;
// this branch handles caller-supplied explicit checks.
```

The asymmetry is intentional (caller-supplied commands are passed through verbatim), but it creates a footgun: callers naturally write `command: 'npm test'` (without the `cd artifacts/<workerId>/` prefix), expecting it to work. The auto-add path was designed to handle the common case, but the matching-phrase suppression (`isMentionCovered`) means the auto-add does NOT fire when the caller supplies a matching command — so the caller's bare command runs in the wrong directory.

#### 3.2.3 Proposed fix — mirror the auto-expansion for canonical-matching caller commands

Extend the `command`-kind branch in `buildChecks` to detect when the caller-supplied command matches a canonical executable mention (e.g., `npm test`). If so, expand it to per-worker checks (reusing the existing `buildAutoAddedCommandChecks` logic). The mention is still "covered" (so auto-add does not double-fire), but the expansion happens in the `command` branch.

```typescript
// PROPOSAL — NOT IMPLEMENTED
// In src/gateway/mission-service.ts, buildChecks(), the `command` branch:

} else if (c.kind === 'command') {
  // G7-19I proposed: if the caller-supplied command matches a canonical
  // executable mention (e.g., 'npm test'), expand to per-worker checks
  // mirroring the auto-add path. This closes the clean-room pathing
  // asymmetry: caller-supplied commands now run in the correct
  // per-worker subdirectory, just like auto-added commands.
  //
  // Non-canonical commands (e.g., 'echo hello') are propagated as-is —
  // the caller is presumed to know the workspace layout for custom commands.
  const goalTextForDetection = goalText ?? '';
  const mentions = goalTextForDetection.length > 0
    ? detectExecutableMentions(goalTextForDetection)
    : [];
  const matchingMention = mentions.find(m => m.command === c.command);

  if (matchingMention && context.artifacts.length > 0) {
    // Expand to per-worker checks. Reuse buildAutoAddedCommandChecks
    // to inherit the sentinel-fallback behavior (when no worker produced
    // the requiredFile, a sentinel always-fail check is emitted).
    const expanded = buildAutoAddedCommandChecks(
      matchingMention,
      context.artifacts.map(s => ({ workerId: s.workerId, paths: s.paths })),
    );
    for (const exp of expanded) {
      // Preserve caller-supplied expectExit/expectOutput* if present;
      // otherwise use the mention's defaults.
      checks.push({
        kind: 'command',
        label: `${c.label} — ${exp.label.includes(' — ')
          ? exp.label.split(' — ').slice(-1)[0]
          : exp.label}`,
        command: exp.command,
        ...(c.expectExit !== undefined ? { expectExit: c.expectExit } : {}),
        ...(c.expectOutputIncludes !== undefined ? { expectOutputIncludes: c.expectOutputIncludes } : {}),
        ...(c.expectOutputExcludes !== undefined ? { expectOutputExcludes: c.expectOutputExcludes } : {}),
      });
    }
  } else {
    // Non-canonical or no matching mention — propagate as-is (current behavior).
    checks.push({
      kind: 'command',
      label: c.label,
      command: c.command,
      ...(c.expectExit !== undefined ? { expectExit: c.expectExit } : {}),
      ...(c.expectOutputIncludes !== undefined ? { expectOutputIncludes: c.expectOutputIncludes } : {}),
      ...(c.expectOutputExcludes !== undefined ? { expectOutputExcludes: c.expectOutputExcludes } : {}),
    });
  }
}
```

#### 3.2.4 Test plan

New integration tests in `tests/gateway/g7-19i-command-expansion.test.ts`:

1. Caller supplies `command: 'npm test'` + goal text mentions "npm test" → verify per-worker checks emitted (one per worker that produced `package.json`).
2. Caller supplies `command: 'npm test'` + goal text does NOT mention "npm test" → verify propagated as-is (no expansion).
3. Caller supplies `command: 'echo hello'` (non-canonical) → verify propagated as-is.
4. Caller supplies `command: 'npm test'` + no worker produced `package.json` → verify sentinel check emitted.
5. Caller supplies `command: 'npm test'` + workers produced `package.json` → verify each expanded check uses `sh -c "cd artifacts/<workerId> && npm test"`.

#### 3.2.5 Authorization

**AUTHORIZED.** Small, targeted change to the non-frozen `buildChecks` method. Mirrors the existing auto-expansion pattern for `file`/`hash-match`. No frozen-contract impact. Adds deterministic tests.

---

### 3.3 Finding #3 — Duplicate-production pattern persists

#### 3.3.1 Recap (from G7-19H §10.3)

In G7-19E, two specialists (software-engineer-1 and documentation-writer-2) produced duplicate complete applications. G7-19F documented this as a worker-coordination defect. G7-19G added direct handoff edges to give the writer upstream context. In G7-19H, **3 of 4 workers** (software-engineer-1, documentation-writer-2, verification-engineer-4) independently produced the complete 5-file application with byte-identical `package.json` (hash `45acbbf10e9861d3...`) but different src/README/test content. The duplicate-production pattern persists despite G7-19G.

#### 3.3.2 Root cause (deeper)

The G7-19G fix added graph edges from each non-coordinator non-writer worker to the writer. This means the writer's brief **mentions** the upstream workers' produced files. However:

1. **Edges give context, not file access.** The writer's brief says "software-engineer-1 produced `package.json`, `README.md`, `src/index.js`, `src/store.js`, `test/app.test.js`" — but the writer's OpenBot workspace does NOT contain those files. The writer cannot `read_file` them. It can only produce its own version.

2. **The brief instruction is ambiguous.** The mission outcome says "Build a 5-file CLI app" and lists all 5 files. The documentation-writer's brief presumably echoes this outcome (with upstream context appended). The writer interprets "Build a 5-file CLI app" as "produce all 5 files" — not "produce only README.md, since the software engineer already produced the code".

3. **The documentation-writer role's capability set includes `document-authoring`, but the brief asks for application code.** The planner assigns the writer because the mission has a `document-authoring` capability need. But the brief instructs the writer to produce the full app — which is a `code-execution` task, not a `document-authoring` task. This is a brief-construction defect.

#### 3.3.3 Proposed fix (three layers, ordered by recommendation strength)

**Layer A fix — strengthen role briefs (worker-side, fragile):**

Modify the role definitions in `src/organization/organization-planner.ts` (NON-FROZEN) to explicitly scope each role's deliverables:

```typescript
// PROPOSAL — NOT IMPLEMENTED
// In src/organization/organization-planner.ts, the role catalog:

const ROLE_CATALOG = {
  'Software Engineer': {
    // ... existing fields ...
    deliverableScope: 'src/*.js, test/*.test.js, package.json — application code and tests only',
    nonDeliverableScope: 'README.md, docs/*.md — documentation is the Documentation Writer\'s responsibility',
  },
  'Documentation Writer': {
    // ... existing fields ...
    deliverableScope: 'README.md, docs/*.md — documentation only',
    nonDeliverableScope: 'src/*.js, test/*.test.js, package.json — code is the Software Engineer\'s responsibility',
  },
  // ...
};
```

Then include these scope hints in each worker's brief. This is fragile (LLM may still deviate), but it directly addresses the brief ambiguity.

**Layer B fix — gateway-side duplicate-production diagnostic (recommended):**

Add a new module `src/runtime/duplicate-production-diagnostics.ts` that detects post-execution duplicate production via content hashes.

```typescript
// PROPOSAL — NOT IMPLEMENTED
// New file: src/runtime/duplicate-production-diagnostics.ts

export interface DuplicateProductionDiagnostic {
  readonly severity: 'warn';
  readonly code: string;  // 'DUPLICATE_PRODUCTION'
  readonly message: string;
  readonly duplicateWorkers: readonly string[];
  readonly sharedFilePath: string;
  readonly sharedContentHash: string;
}

export function detectDuplicateProduction(
  artifacts: ReadonlyArray<{
    workerId: string;
    path: string;
    contentHash: string;
  }>,
): DuplicateProductionDiagnostic[] {
  // Group artifacts by path. For each path produced by >1 worker with
  // IDENTICAL content hashes, emit a duplicate-production diagnostic.
  // (Different hashes for the same path → conflict, already handled by G7-19A.)
  const byPath = new Map<string, typeof artifacts>();
  for (const a of artifacts) {
    if (!byPath.has(a.path)) byPath.set(a.path, []);
    byPath.get(a.path)!.push(a);
  }
  const diagnostics: DuplicateProductionDiagnostic[] = [];
  for (const [path, sources] of byPath) {
    if (sources.length < 2) continue;
    // Group by contentHash
    const byHash = new Map<string, typeof sources>();
    for (const s of sources) {
      if (!byHash.has(s.contentHash)) byHash.set(s.contentHash, []);
      byHash.get(s.contentHash)!.push(s);
    }
    for (const [hash, dups] of byHash) {
      if (dups.length < 2) continue;
      diagnostics.push({
        severity: 'warn',
        code: 'DUPLICATE_PRODUCTION',
        message: `${dups.length} workers produced byte-identical "${path}" independently. ` +
          `Token waste: ${(dups.length - 1) * 100 / dups.length}% redundant work for this file. ` +
          `Workers: ${dups.map(d => d.workerId).join(', ')}`,
        duplicateWorkers: dups.map(d => d.workerId),
        sharedFilePath: path,
        sharedContentHash: hash,
      });
    }
  }
  return diagnostics;
}
```

Wire into `MissionService.getArtifacts()`:

```typescript
// PROPOSAL — NOT IMPLEMENTED
const duplicateDiagnostics = detectDuplicateProduction(
  artifacts.map(a => ({
    workerId: a.workerId,
    path: a.path,
    contentHash: a.contentHash,
  })),
);
// Include in the response:
return {
  missionId,
  artifacts: [...],
  verifiedPackageSelection: [...],
  // NEW:
  duplicateProductionDiagnostics: duplicateDiagnostics.length > 0
    ? duplicateDiagnostics
    : undefined,
};
```

**Layer C fix — proper fix (FROZEN, OUT OF SCOPE):**

The proper fix is to modify the orchestrator (FROZEN `src/mission/orchestrator.ts`) to share file access across workers via the direct handoff edges. When worker B has an inbound edge from worker A, worker B's workspace should contain symlinks or copies of worker A's produced files. This would let the documentation-writer `read_file` the software-engineer's `src/store.js` and write only the README.

**This requires a frozen-contract exception** — explicitly out of scope per the G7-19H brief.

#### 3.3.4 Authorization

- **Layer A + Layer B: AUTHORIZED** — gateway-layer diagnostic + non-frozen role-catalog change. No frozen-contract impact.
- **Layer C: NOT AUTHORIZED** — requires frozen-contract exception. Document for future architectural discussion.

---

### 3.4 Finding #4 — Verification event not propagated to mission snapshot

#### 3.4.1 Recap (from G7-19H §10.4)

The `verification` event (with `ok`, `passed`, `failed`) is present in `mission-events.json` (seq=39), but the `mission-snapshot.json` `result` field does not include a `verification` sub-object. The verification data is available via `GET /v1/missions/{id}/events`, but consumers reading only the snapshot miss it.

#### 3.4.2 Root cause

`MissionResult` is defined in `src/contracts/core.ts:348` (FROZEN) as:

```typescript
export interface MissionResult {
  readonly status: 'success' | 'partial' | 'failure';
  readonly summary: string;
  readonly evidence: readonly Evidence[];
  readonly cost: MissionCost;
}
```

It does NOT include a `verification` field. The `toSnapshot()` method in `src/gateway/mission-service.ts:1611` (NON-FROZEN) builds the snapshot from `MissionRuntime` and copies `rt.result` directly — so the snapshot inherits the frozen `MissionResult` shape.

The verification event IS captured in `MissionRuntime` (as a flight event), and the gateway has a `extractVerificationResult()` helper (line 1501) that reads it from the flight recorder. But the snapshot does not surface it.

#### 3.4.3 Proposed fix — add `verification` field to `MissionSnapshot` (NON-FROZEN gateway types)

Add an optional `verification` field to `MissionSnapshot` in `src/gateway/types.ts` (NON-FROZEN). Populate it in `toSnapshot()` from the runtime's flight events.

```typescript
// PROPOSAL — NOT IMPLEMENTED
// In src/gateway/types.ts, the MissionSnapshot interface:

export interface MissionSnapshot {
  // ... existing fields ...
  readonly result?: MissionResult;
  // ... existing fields ...

  // G7-19I proposed: surface the verification result in the snapshot.
  // Optional for backward compatibility — pre-G7-19I consumers ignore it.
  readonly verification?: {
    readonly ok: boolean;
    readonly passed: number;
    readonly failed: number;
    readonly summary?: string;
    readonly failures?: readonly string[];
  };
}
```

```typescript
// PROPOSAL — NOT IMPLEMENTED
// In src/gateway/mission-service.ts, toSnapshot():

private toSnapshot(rt: MissionRuntime): MissionSnapshot {
  // ... existing logic ...

  // G7-19I proposed: extract verification result from flight events
  const verificationResult = this.extractVerificationResult(rt);

  return {
    // ... existing fields ...
    ...(verificationResult !== undefined ? { verification: verificationResult } : {}),
  };
}
```

#### 3.4.4 Frozen-contract impact

**NONE.** `MissionResult` (frozen) is unchanged. The new `verification` field lives on `MissionSnapshot` (transport type, non-frozen). It is optional, so existing consumers are not broken.

#### 3.4.5 Authorization

**AUTHORIZED.** Small, additive change to non-frozen gateway types. No frozen-contract impact. Backward-compatible.

---

### 3.5 Finding #5 — `generalist-worker-3` produced nothing

#### 3.5.1 Recap (from G7-19H §10.5)

The generalist-worker-3 worker ran 1 step (`list_files` returning `ok=false`) and produced 0 files. Its `worker-finished` summary claims: "I don't have the required permissions to list files in the workspace. I need the 'openbot:workspace-files' grant to proceed." The other 3 workers produced files successfully using the same runtime.

#### 3.5.2 Root cause (hypothesis — requires investigation)

The `WorkerGenome` (defined in `src/contracts/core.ts:297`, FROZEN) has an `upstreamGrants` field (line 304) listing "<owner>:<domain>" registry keys. The OpenBot adapter (`src/runtime/openbot/adapter.ts`) maps these grants to OpenBot capabilities.

The "Generalist Worker" role is assigned the `data-analysis` capability. The hypothesis is that `data-analysis` does NOT include `openbot:workspace-files` grant (which is required for `list_files`), while `code-execution` (Software Engineer) and `browser-verification` (Verification Engineer) DO include it. The documentation-writer-2 worker did not need `list_files` (it produced files directly), so its lack of the grant did not surface.

**This is a hypothesis.** Confirmation requires:
1. Reading the role catalog in `src/organization/organization-planner.ts:136` (NON-FROZEN) to see the Generalist Worker's capability needs.
2. Reading the OpenBot adapter's grant-to-capability mapping in `src/runtime/openbot/adapter.ts` (NON-FROZEN).
3. Tracing which grants `data-analysis` triggers.
4. Confirming that `list_files` requires `openbot:workspace-files`.

#### 3.5.3 Proposed investigation (read-only, G7-19I phase 1)

No code changes proposed yet. The investigation is:

1. Grep `src/runtime/openbot/adapter.ts` for `workspace-files` and trace its origin.
2. Grep `src/organization/organization-planner.ts` for the role catalog and capability-to-grant mapping.
3. Identify the gap: which capability need → which grants → which OpenBot actions.
4. Propose a fix in `src/organization/organization-planner.ts` (NON-FROZEN) or `src/runtime/openbot/adapter.ts` (NON-FROZEN) — whichever is the correct layer.

#### 3.5.4 Authorization

**AUTHORIZED for investigation (read-only).** Fix proposal after investigation, pending user confirmation.

---

### 3.6 Finding #6 — Z.ai 429 rate-limit contributed to timeout

#### 3.6.1 Recap (from G7-19H §10.6)

The gateway log shows multiple `Failed to make API request: Error: API request failed with status 429` messages during mission execution. The Z.ai provider retried per its backoff schedule and eventually succeeded for most calls, but the cumulative retry latency likely contributed to hitting the 540 s timeout. The verification-engineer-4 worker ultimately failed with `failureClass: "CANCELLED"` because its reasoning provider retries were exhausted.

#### 3.6.2 Root cause

Environmental. Z.ai API rate limits are a production reality, not a Genesis defect.

#### 3.6.3 Proposed action

**NO ACTION.** This is an environmental constraint. Possible mitigations (NOT proposed for G7-19I):

- Increase `DEFAULT_RETRY_BACKOFF_MS` in `src/providers/zai-reasoning.ts` (NON-FROZEN) — but this would make missions slower, not faster.
- Lower `GENESIS_MAX_WORKER_STEPS` to reduce concurrent demand — but the brief forbids "arbitrarily increase worker-step or mission-timeout limits", and lowering steps would reduce mission quality.
- Add a circuit breaker that aborts a mission early if N consecutive 429s occur — but this is a behavioral change that needs separate discussion.

**Recommendation:** Document in the operations guide that Z.ai 429 rate limits are a known production condition. Mission timeouts caused by rate limits should be retried with a longer `MISSION_TIMEOUT_MS` OR scheduled during off-peak hours. This is an operational concern, not a code change.

#### 3.6.4 Authorization

**NO ACTION.** Environmental constraint, documented for awareness.

---

## 4. Recommended Next Task: G7-19I (NOT G7-20)

The user's G7-19H brief said: *"Do not begin G7-20."* The brief also said: *"Await architectural review and explicit authorization."* This review IS the architectural review. As architectural reviewer, I propose a follow-up task **G7-19I** — NOT G7-20 — with the scope below.

### 4.1 Proposed G7-19I scope

**G7-19I — Targeted Acceptance & Coordination Diagnostics**

| Phase | Finding | Action | Layer | Frozen impact |
|---|---|---|---|---|
| 1 | #5 | Read-only investigation of Generalist Worker grant gap | NON-FROZEN (read-only) | none |
| 2 | #1 (Layer B1) | Implement `package-script-diagnostics.ts` module + wire into `getArtifacts()` | NON-FROZEN (new file + wiring) | none |
| 3 | #2 | Extend `command`-kind branch in `buildChecks` to auto-expand canonical-matching caller commands | NON-FROZEN (`mission-service.ts`) | none |
| 4 | #3 (Layer B) | Implement `duplicate-production-diagnostics.ts` module + wire into `getArtifacts()` | NON-FROZEN (new file + wiring) | none |
| 5 | #4 | Add optional `verification` field to `MissionSnapshot` (gateway types) + populate in `toSnapshot()` | NON-FROZEN (`gateway/types.ts`, `mission-service.ts`) | none |
| 6 | #1 (Layer A) | Strengthen the brief template (worker-side) for future missions — add explicit `node --test` syntax requirement | NON-FROZEN (brief template) | none |
| 7 | #3 (Layer A) | Strengthen role briefs in `organization-planner.ts` to scope deliverables per role | NON-FROZEN (`organization-planner.ts`) | none |
| 8 | #5 fix | Implement the grant-gap fix (after phase 1 investigation confirms the root cause) | NON-FROZEN (location TBD) | none |

### 4.2 Constraints for G7-19I

1. **NO live mission.** Test all changes with `MemoryRuntime` + scripted reasoning provider (deterministic, fast, no Z.ai calls).
2. **NO frozen-contract modifications.** All changes in non-frozen gateway/runtime layer.
3. **All 1074 existing tests must pass** + new tests for each phase.
4. **No `--amend`** — follow the established main-commit + post-push `final-head.json` convention.
5. **STOP after G7-19I.** Await explicit user authorization before any further task.

### 4.3 Explicitly OUT OF SCOPE for G7-19I

- Finding #3 Layer C (frozen-contract orchestrator change for real file access across workers)
- Finding #6 (Z.ai 429 rate-limit — environmental)
- G7-20 (NOT AUTHORIZED per original brief)
- Any live production mission

### 4.4 Estimated G7-19I size

- ~250 lines of new module code (`package-script-diagnostics.ts` + `duplicate-production-diagnostics.ts`)
- ~50 lines of modifications to `mission-service.ts` (`buildChecks` command branch + `getArtifacts()` wiring + `toSnapshot()` verification field)
- ~30 lines of modifications to `gateway/types.ts` (`MissionSnapshot.verification` field)
- ~20 lines of modifications to `organization-planner.ts` (role deliverable scopes)
- ~400 lines of new tests (5 test files, ~80 lines each)
- ~2000-word G7-19I report

**Total: ~750 lines of code + report. "SMALL IN CODE. LARGE IN CAPABILITY."**

---

## 5. Authorization Matrix

| Finding | Layer | Proposed Action | Authorized? | Frozen Impact |
|---|---|---|---|---|
| #1 | A (brief) | Strengthen brief with explicit `node --test` syntax | ✅ AUTHORIZED | none |
| #1 | B1 (diagnostic) | New `package-script-diagnostics.ts` module + wiring | ✅ AUTHORIZED | none |
| #1 | B3 (sentinel) | Bypass worker's broken script with `node --test` check | ❌ REJECTED — masks defect | — |
| #2 | gateway | Auto-expand canonical-matching caller `command` checks | ✅ AUTHORIZED | none |
| #3 | A (role briefs) | Strengthen role deliverable scopes | ✅ AUTHORIZED | none |
| #3 | B (diagnostic) | New `duplicate-production-diagnostics.ts` module + wiring | ✅ AUTHORIZED | none |
| #3 | C (frozen orchestrator) | Share file access across workers via edges | ❌ NOT AUTHORIZED — frozen | requires exception |
| #4 | gateway types | Add `verification` field to `MissionSnapshot` | ✅ AUTHORIZED | none |
| #5 | investigation | Read-only investigation of grant gap | ✅ AUTHORIZED (investigation) | none |
| #5 | fix | Implement grant-gap fix (location TBD) | ⏳ PENDING investigation | TBD |
| #6 | — | Document as environmental constraint | ✅ NO ACTION | none |
| G7-19I | all above | Targeted fixes, no live mission, no frozen changes | ✅ AUTHORIZED (proposed) | none |
| G7-20 | — | (not proposed) | ❌ NOT AUTHORIZED | — |

---

## 6. Stop

This architectural review is complete. **No source files were modified** — only this review document was written.

**As architectural reviewer, I authorize G7-19I** with the scope in §4.1, subject to the constraints in §4.2 and the explicit exclusions in §4.3.

**The user must explicitly confirm** before G7-19I begins. Without explicit confirmation, no further work is authorized.

After G7-19I is delivered (if authorized):
- **STOP.**
- Do not begin G7-20.
- Await the next architectural review and explicit authorization.

---

## Guiding Principle (reaffirmed)

**SMALL IN CODE. LARGE IN CAPABILITY.**

The G7-19H findings revealed that Genesis's verification infrastructure works correctly and reports failures truthfully — but the workers' output does not meet the acceptance bar. G7-19I proposes **small, targeted, non-frozen diagnostics and brief improvements** that will:

1. Make the recurring `package.json` syntax defect **visible** in the response (Layer B1 diagnostic).
2. Close the caller-supplied command pathing **asymmetry** (Finding #2 fix).
3. Make the duplicate-production pattern **visible** in the response (Layer B diagnostic).
4. Surface verification results in the snapshot for **convenience** (Finding #4 fix).
5. Strengthen briefs and role scopes to **reduce** worker-side defects (Layer A fixes).

None of these changes claim to "fix" the underlying model behavior (Z.ai will still generate `node --test test/` unless the brief stops it). None of these changes modify frozen contracts. None of these changes launch a live mission.

**The outcome will be supported by evidence** — new deterministic tests for each phase, plus the existing 1074-test regression suite must still pass.

**Awaiting explicit user confirmation before G7-19I begins.**
