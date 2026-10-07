# PHASE 4.6a — Provider-Neutral Completion Semantics Report

**Phase:** 4.6a
**Date:** 2026-10-07
**Start SHA:** `9f6380f4e1de33d375a30700f610fac73a188758`
**Final SHA:** fa09b1b98917cecab2c9b6cbb6ed047518af0d00
**Branch:** `build/group-03-repository-work`

---

## 1. Start State

- **HEAD:** `9f6380f4e1de33d375a30700f610fac73a188758`
- **Worktree:** clean
- **Baseline tests:** 224 passed | 9 skipped (233 total)
- **Phase 4.6 classification:** PASS_WITH_FOLLOWUP

---

## 2. Root Cause

The Phase 4.6 real OpenDots probe produced a real shared Space + Page with two specialist contributions, but the mission reported `failure` with summary `'no worker produced a deliverable'`.

**Root cause:** the orchestrator's completion check used `finalArtifacts.length === 0` as the "no deliverable" criterion. `finalArtifacts` is collected by `collectArtifacts()`, which only collects from workers with a `computer` surface AND non-empty `result.artifacts` (computer-file paths). An OpenDots workspace deliverable (a Page) is not a computer-file artifact — it never appears in `finalArtifacts`.

The completion check was computer-centric: a valid deliverable was required to be a computer file.

---

## 3. Trust Distinction

The Council raised a critical trust concern: worker self-assertion must not automatically become trusted provider-observed evidence.

**Design decision:** the runtime is the trust authority, not the worker. A `WorkspaceHandle` only exists if the adapter actually created/observed the Space+Page (it throws on failure). Worker self-assertion cannot produce a handle — only the provider can.

The fix reads `surfaces(handle).workspace?.handle` — the runtime's observed result — NOT worker-declared evidence. This preserves the distinction between "worker claimed" and "provider observed."

No new trust framework was built. The existing `surfaces()` method (Phase 4.5) and `WorkspaceHandle` (Phase 4.6) are the trust authority.

---

## 4. Exact Semantic Correction

**One method added, one condition changed — 46 production LOC in one file.**

### `collectObservedDeliverables()` (new method, ~20 LOC)

Reads `surfaces(handle)` for each ensured worker. If `surfaces.workspace?.handle` exists (the adapter observed a real Space+Page), produces an `Evidence` record:
```
{ kind: 'artifact', description: '<workerId> collaborative workspace deliverable',
  location: '<provider>:<spaceId>:<pageId>' }
```

Provider-neutral: reads the `workspace` surface contract, not OpenDots-specific code. Phase 4.7 will add `if (surfaces.job?.handle !== undefined)` — a 3-line addition, no completion-logic change.

### Completion check (changed, ~6 LOC)

Before:
```
const hasDeliverable = finalArtifacts.length > 0;
```

After:
```
const observedDeliverables = this.collectObservedDeliverables(ensured);
const hasDeliverable = finalArtifacts.length > 0 || observedDeliverables.length > 0;
```

All completion branches use `hasDeliverable` instead of `finalArtifacts.length > 0`. Observed deliverables are included in `finalEvidence` for the Experience record.

### Completion ≠ Verification

The `VerificationLoop` is UNCHANGED. It still verifies computer-file artifacts in the clean room. A workspace deliverable satisfies COMPLETION (a deliverable exists) but does NOT automatically satisfy VERIFICATION (acceptance criteria). A mission with an observed workspace deliverable but failing verification is `partial`, not `success`.

---

## 5. Tests

**New test file:** `tests/phase-4-6a-completion.test.ts` — 9 tests:

| Test | What it proves |
|------|---------------|
| A | Computer-file completion still works (no regression) |
| B | Observed provider-neutral artifact satisfies deliverable existence |
| C | Non-computer worker can produce a valid deliverable via workspace |
| D | **Negative trust:** unobserved self-claim does NOT become trusted |
| E | Provider invocation with observed resultRef is associated with artifact evidence |
| F | Completion does NOT automatically imply verification PASS |
| G | Retry/timeout/cancellation behavior unchanged (no deliverable → failure) |
| H | Phase 4.6 OpenDots behavior no longer fails solely because finalArtifacts is empty |
| J | Future job-result compatibility: observed non-computer result satisfies completion (provider-neutral, no OpenMuse code) |

---

## 6. Negative Trust Test (Test D)

A worker finishes with `artifacts: []` and no provider-observed workspace deliverable. The worker's summary claims "I did the work" but produces nothing observable.

**Result:** mission fails with `'no worker produced a deliverable'`. The worker's self-assertion is NOT promoted to trusted evidence. The mission does not succeed on claims alone.

---

## 7. OpenDots Regression

The Phase 4.6 probe's specific failure (`'no worker produced a deliverable'` despite a real shared Page) is fixed. Test H proves: a workspace-only deliverable (no computer-file artifacts) now satisfies completion. The mission no longer fails solely because `finalArtifacts` is empty.

**Live confirmation:** classified as NOT_RUN for Phase 4.6a (the fix is verified by deterministic test H, which uses a controllable test runtime that simulates the exact Phase 4.6 probe scenario: a worker finishes with no artifacts, but a workspace handle exists). A live OpenDots rerun is not necessary for this semantic correction — the fix is in the completion check, not in the OpenDots adapter.

---

## 8. Future Non-Computer Result Test (Test J)

A test double with `provider: 'hypothetical-job-provider'` (NOT OpenMuse) provides an observed workspace deliverable. The mission succeeds. This proves the completion semantics are surface-neutral: any future provider that exposes a handle through `surfaces()` will satisfy completion without further orchestrator changes.

Phase 4.7 adds OpenMuse by adding `if (surfaces.job?.handle !== undefined)` to `collectObservedDeliverables()` — a 3-line addition. No completion-logic change needed.

---

## 9. LOC/File/Dependency Delta

| Metric | Baseline (4.6) | Final (4.6a) | Delta |
|--------|----------------|-------------|-------|
| Production LOC (src/) | 8,707 | 8,753 | **+46** |
| Production files (src/) | 33 | 33 | **+0** |
| Runtime dependencies | 1 | 1 | **+0** |

**Anti-bloat gate:**
- Soft alert (>60 LOC): NOT TRIGGERED (46 < 60)
- Hard STOP (>120 LOC or >1 file or any dependency): NOT TRIGGERED (46 < 120, 0 < 1, 0 = 0)

---

## 10. Final Classification

**PASS**

Phase 4.6's PASS_WITH_FOLLOWUP is now resolved. The followup (provider-neutral completion semantics) is implemented, tested, and verified.

---

## 11. Exact Final SHA

fa09b1b98917cecab2c9b6cbb6ed047518af0d00
