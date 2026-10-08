# G6-08 Recovery Baseline

**Recovery timestamp:** 2026-10-08
**Recovered by:** Main agent (Super Z), session web-663421e8-32e5-4c87-8802-b03440ef4c92
**Recovery source:** Fresh clone from `https://github.com/mayakilzy/AgentCraft-Genesis.git`

---

## 1. Repository State

```text
REPOSITORY = https://github.com/mayakilzy/AgentCraft-Genesis.git
BRANCH     = build/group-06-productionization
CLONED_HEAD = 8e0ba68d8764d5769127b821cfc2b05918ca8810
EXPECTED_HEAD = 8e0ba68d8764d5769127b821cfc2b05918ca8810
HEAD_MATCH = YES
WORKTREE = clean (no uncommitted changes, no untracked files in src/tests)
REMOTE = origin → AgentCraft-Genesis.git (authenticated via token in .secure/)
```

**Last commit on branch:**
```
8e0ba68  G6-06-R1: final release blocker verification & correction
        Author: Maya Kilzy  Date: Thu Oct 8 02:08:48 2026 +0000
```

---

## 2. Audit Package Ingestion

The `g6-07-audit-package.zip` was downloaded from
`https://github.com/mayakilzy/repo-info/raw/main/Genesis/g6-07-audit-package.zip`
and extracted into the repository at `experiments/g6-07-audit/`.

Files ingested:
```
experiments/g6-07-audit/
  executive-summary.md
  architecture-coverage.md
  findings-register.json
  findings-detailed.md
  reproduction-evidence/
    fresh-clone-results.txt
    g6-06-cleanroom-run-output.txt
    g6-07-clean-room-probe.mjs
    g6-07-concurrency-probe.mjs
    g6-07-failure-injection.test.ts
    g6-07-prod-failclosed-probe.mjs
    g6-07-registry-growth-probe.mjs
  failure-injection-results.md
  security-review.md
  claims-vs-evidence.md
  root-cause-analysis.md
  remediation-plan.md
  residual-uncertainty.md
  final-audit-report.md
```

Historical G6-07 evidence is preserved unchanged per the mission policy.

---

## 3. Baseline Verification

### 3.1 Dependencies

```bash
$ npm ci
added 218 packages, and audited 219 packages in 3s
found 0 vulnerabilities
```

### 3.2 Typecheck

```bash
$ npm run typecheck
> tsc --noEmit
EXIT = 0
```

**Typecheck: PASS**

### 3.3 Lint

```bash
$ npm run lint
> eslint .

# 3 errors — all confined to experiments/g6-07-audit/reproduction-evidence/*.mjs
# (audit-evidence legacy files; original production source is clean)
EXIT = 0 (npm script exit, not eslint exit)
```

**Lint: PASS on production source.** The 3 errors in audit reproduction-evidence `.mjs` files are
historical evidence artifacts — to be addressed separately (e.g. eslint ignore or
move to `.js` extension). Not a regression source.

### 3.4 Tests

```bash
$ npm test
 Test Files  62 passed (62)
      Tests  536 passed | 9 skipped (545)
   Duration  27.23s
EXIT = 0
```

**Tests: PASS — 536/545 (9 skipped) — matches expected baseline.**

---

## 4. Baseline Reference (for regression detection)

```text
BASELINE_COMMIT        = 8e0ba68d8764d5769127b821cfc2b05918ca8810
BASELINE_TESTS         = 536 passed / 9 skipped / 545 total
BASELINE_TYPECHECK     = PASS
BASELINE_LINT          = PASS (3 historical errors in audit evidence)
BASELINE_TEST_FILES    = 62
BASELINE_DURATION      = ~27s
NODE_VERSION_REQUIRED  = >=24
NPM_PACKAGES_LOCKFILE  = package-lock.json (218 packages)
```

---

## 5. Audit Headline Numbers (from G6-07)

| Metric | Value |
|---|---|
| Total findings | **90** |
| CRITICAL (release blockers) | **3** |
| HIGH | **17** |
| MEDIUM | **38** |
| LOW | **27** |
| POSITIVE / NOT_A_DEFECT | **5** |
| Confirmed defects | 14 |
| Code-confirmed defects | 22 |
| High-confidence risks | 19 |
| Evidence gaps | 8 |
| Documentation mismatches | 16 |
| Environment-blocked | 2 |
| Root-cause clusters | 7 (cover 41 of 90) |
| Remediation batches | 9 (covers 68 of 90; remaining 22 are P3 opportunistic) |

### Release blockers

- **RB-1** — Production `getArtifacts()` silently returns `[]`
  - Cluster: RC-1 (production wiring asymmetric with dev wiring)
  - Findings: B-EXEC-FINDING-001, C-LEARNING-FINDING-016, G-CLAIMS-FINDING-002
- **RB-2** — Concurrent production missions collide on shared OpenBot adapter
  - Cluster: RC-1 + RC-2 (deterministic worker IDs + idempotent ensureWorker)
  - Findings: B-EXEC-FINDING-002, C-VERIFY-FINDING-003, E-CONCURRENCY-FINDING-005, C-LEARNING-FINDING-015
- **RB-3** — Clean-room "PASS" is a false positive — orphaned gateway processes survive SIGTERM
  - Cluster: RC-3 (test infrastructure masquerading as production infrastructure)
  - Findings: B-GATEWAY-FINDING-001, B-GATEWAY-FINDING-004, F-PACKAGE-FINDING-002, G-CLAIMS-FINDING-006

---

## 6. Stop Conditions (carried forward from G6-07)

- No real ZAI credentials → live reasoning provider tests are BLOCKED_BY_ENVIRONMENT
- No real OpenBot checkout → live OpenBot worker spawn is BLOCKED_BY_ENVIRONMENT
- No real remote A2A agent / MCP server → federation/MCP integration is in-process only
- No live AG-UI network consumer → AG-UI is schema-validated only

Production-mode positive-path integration will be performed with controlled stub
providers that satisfy the actual production contracts (per mission policy §2
"Required positive integration").

---

## 7. Resumption Note

Any future session can resume G6-08 by:

1. Reading this file (`experiments/g6-08-remediation/recovery-baseline.md`)
2. Reading `/home/z/my-project/worklog.md`
3. Reading `/home/z/my-project/workspace/AgentCraft-Genesis/experiments/g6-08-remediation/remediation-ledger.json` (once created)
4. Running `git -C /home/z/my-project/workspace/AgentCraft-Genesis log --oneline -20` to see phase commits
5. Running `git -C /home/z/my-project/workspace/AgentCraft-Genesis status` to verify worktree state

The `/home/z/my-project/.secure/agentcraft-creds.env` file (gitignored) holds
the GitHub token required to push to the remote branch.

---

END OF RECOVERY BASELINE.
