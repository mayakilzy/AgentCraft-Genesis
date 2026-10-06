# flaky-orders — Diagnostic Analyst working analysis

Companion to DIAGNOSIS.md (the integrated deliverable). This file records
the analyst's own observations and reasoning trail, including hands-on
probes beyond the evidence bundle. The source was never modified.

## OBSERVED

- Evidence bundle (metrics.md): 12/15 suite runs FAIL (~80%) on one commit;
  failing assertion varies (accepted != 8 / final stock > 0 / rejected != 4).
- Evidence bundle (incident-logs.txt): failing runs accepted 9 (6 runs),
  10 (5 runs), 11 (1 run) against stock 8.
- Own sample (10 runs of the exact test scenario, unmodified source):
  accepted = 8,8,9,9,9,10,10,10,11,11; rejected = 12 - accepted in every
  run; final stock = 0 in every run of this sample.
- Deterministic reproduction (repro.mjs, commit 1889359): pinned latencies
  make all 12 concurrent reservations read stock 8 before any write lands:
  12 accepted, RACE REPRODUCED, exit 0, identical across executions.
- Sequential control: 5 sequential reservations against stock 3 accepted
  exactly 3 — the invariant holds when reservations do not interleave.
- Instrumented interleaving (Math.random scripted per draw; a subclass
  logging reads; no source changes): reserve A and B both read 8; B wrote
  7; a later reserve C read the fresh 7 and wrote 6; then A's long-delayed
  validation completed and wrote 8-1 = 7 — the stock value went BACK UP
  from 6 to 7 with no intervening acceptance. Final: 3 accepted, stock 7,
  where non-overlapping arithmetic would leave 5.

## INFERRED

- Every accepting reservation writes (its own read) - quantity, so the
  final stock equals the LAST landing write's stale read minus quantity —
  it is not derived from the count of acceptances. A stale-high write
  landing last both strands stock (instrumented run: stock 7 after 3
  acceptances) and, in the 12-order batch, explains the incident logs'
  final-stock > 0 failure mode that my 10-run sample did not happen to hit.
- The three assertion failures are one race seen from three angles:
  accepted > 8, final stock > 0, and rejected < 4 can co-occur, and which
  one trips first varies with the interleaving.
- The ~80% rate follows from the simulated latencies (0-2 ms in the store
  path, ~0-150 ms dispatch spread): overlap of reads before the first
  write is likely but not certain — consistent with 3/15 passing runs.

## HYPOTHESIS

- H1 (confirmed by probes): non-atomic read-check-write in
  InventoryService.reserve — concurrent readers of the same level all
  accept; stale writes land out of order.
- H2 (distinguished): a test-harness timing artifact — rejected because
  the oversell is demonstrated directly on the service classes, without
  the test runner, and the sequential control is exact.
- H3 (contradicted): initial-stock accounting error — passing runs accept
  exactly 8 and leave stock exactly 0.

## UNKNOWN

- Whether the staging cluster mentioned in source comments behaves the
  same — no staging telemetry exists in the bundle.
- The precise per-run interleavings of the 12 failing CI runs.
- Whether a real production datastore serializes writes in a way that
  masks this class of race.
- Real arrival patterns versus the simulated dispatch spread.

## RECOMMENDED CHECK

- Run repro.mjs on any environment suspected affected.
- Capture staging reserve-path telemetry before planning a fix.
- Instrument in-flight overlap at write time to confirm in vivo.
- Review compare-and-decrement semantics in the production store.

## Confidence

High for the mechanism, within the supplied evidence; staging/production
impact not established (see UNKNOWN).
