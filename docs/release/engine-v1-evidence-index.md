# Genesis Engine v1 — Evidence Index

**Version:** 0.1.0 (Release Candidate)
**Branch:** `build/group-06-productionization`

## Current Evidence (G6-06)

| Claim | Evidence | Test/Experiment | Status |
|-------|----------|-----------------|--------|
| Clean-room reproducibility | experiments/g6-06/clean-room-reproduction.md | Clean-room clone + tests + smoke | PASS |
| Architecture baseline | experiments/g6-06/architecture-and-risk-baseline.md | Code inspection + 12 subsystems | PASS |
| P1 defects fixed | experiments/g6-06/defects-and-remediation.md | 5 P1 defects fixed + tested | PASS |
| Residual risk register | experiments/g6-06/residual-risk-register.md | 5 P2 + 1 P3 deferred to G6-07 | PASS |
| Execution mode boundary | tests/gateway/execution-mode.test.ts | 2 tests (fail-closed + dev banner) | PASS |
| Production mode fail-closed | tests/gateway/execution-mode.test.ts:production | Gateway exits 1 without providers | PASS |
| Per-artifact verified flag | tests/gateway/http-api.test.ts:API-08 | verified based on VerificationResult | PASS |
| Cross-caller A2A cancel | src/gateway/a2a-server.ts cancelTask | currentRequestCaller bridge | PASS |

## Historical Evidence (G6-04 through G6-05A-R1)

### G6-05A-R1 — Gateway Compliance
- Official A2A SDK server: experiments/g6-05a/integration-results.json
- Separate-process E2E: tests/gateway/separate-process-e2e.test.ts
- Real cancellation proof: tests/gateway/cancellation.test.ts

### G6-05A — Service Gateway
- 38 gateway tests: tests/gateway/*.test.ts
- Gateway contract: experiments/g6-05a/gateway-contract.md
- Independent client: experiments/g6-05a/independent-client.ts

### G6-05 — Final Benchmark
- 6 experiments (A-F): experiments/g6-05/
- 16 claims registry: experiments/g6-05/claims-registry.json
- Evidence ledger: experiments/g6-05/evidence-ledger.json

### G6-04 — Reproducibility
- Clean-room runs: experiments/g6-04/evidence/clean-room-run-{1,2}.json
- Reproducibility comparison: experiments/g6-04/evidence/reproducibility-comparison.json
- Failure probes: experiments/g6-04/evidence/failure-probes.json

### G6-03B — Jev Positive Causal Proof
- Real Jev decision wired into Genesis: experiments/g6-03b/evidence/positive-causal-probe.json

### G6-02 — A2A Outbound Federation
- Trust-boundary invariant: experiments/g6-02/evidence/trust-boundary-probe.json
- Outbound federation: experiments/g6-02/evidence/successful-federation.json

### G5-07 — Sealed Blind Transfer
- 4 unseen missions: experiments/academy/g5-07/aggregate-results.json
- 3 CONFIRMATORY_TRANSFER + 1 NON_APPLICABLE

### Phase 4.8E — Real Three-Pillar
- Real OpenBot + OpenDots + OpenMuse + real LLM: experiments/phase-4-8e-blind/REPORT.md

## Evidence Level Distribution

| Level | Count | Description |
|-------|-------|-------------|
| E1 | 1 | Independently reproducible (G6-04 clean-room) |
| E2 | 13 | Real observed execution |
| E3 | 25 | Controlled experimental evidence |
| E4 | 0 | Historical reported only |
| E5 | 0 | Unsupported |

## Test Counts

| Test Suite | Count | Status |
|------------|-------|--------|
| Goal compilation | 9 | PASS |
| Organization planning | 8 | PASS |
| Genome compilation | 8 | PASS |
| Worker execution | 8 | PASS |
| Verification | 6 | PASS |
| Hash-match verification | 5 | PASS |
| Learning | 41 | PASS |
| A2A outbound federation | 22 | PASS |
| Gateway HTTP API | 17 | PASS |
| Gateway A2A inbound | 7 | PASS |
| Gateway isolation | 4 | PASS |
| Gateway E2E | 4 | PASS |
| Gateway cancellation | 4 | PASS |
| Gateway separate-process E2E | 2 | PASS |
| Gateway execution mode | 2 | PASS |
| Jev decision provider | 32 | PASS |
| MCP | 4 | PASS |
| AG-UI | 16 | PASS |
| Other (mission, runtime, work) | ~235 | PASS |
| **Total** | **527 passed / 9 skipped** | **PASS** |

## Skipped Tests (9)

All 9 skipped tests are integration tests gated by `SKIP_SLOW=1` or
require external services not available in the clean-room environment.
None are silently disabled to hide failures.
