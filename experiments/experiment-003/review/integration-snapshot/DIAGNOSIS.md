# Diagnosis — flaky-orders intermittent oversell

## Root cause

The oversell is caused by an unsynchronized read-check-write sequence in
`InventoryService.reserve`: a reservation reads the available stock (an
awaited lookup with simulated 0-2 ms latency), checks it, then after a
second awaited latency writes `stock = available - quantity`. Concurrent
reservations that read the same stock level before any write lands all
pass the check and all accept.

## OBSERVED

- `evidence/metrics.md`: 12 of 15 consecutive `npm test` runs FAILED (~80%)
  on the same commit, same machine, same node version, with no code changes
  between runs; 3 runs PASSED.
- `evidence/metrics.md`: the failing assertion varies across runs between
  accepted != 8, final stock > 0, and rejected != 4.
- `evidence/incident-logs.txt`: failing runs report actual accepted values
  of 9 (6 runs), 10 (5 runs) and 11 (1 run) against stock 8.
- `src/inventory.mjs` (read in full): `reserve()` performs
  `const available = await this.lookup(item)` (simulated 0-2 ms latency),
  then the bounds check, then `await sleep(Math.random() * 2)`, then
  `this.stock[item] = available - quantity`. Nothing in the class
  serializes concurrent `reserve` calls. A source comment states that the
  same class runs in the staging cluster behind the orders API.
- Committed reproduction `flaky-orders/repro.mjs` (Reproduction Engineer,
  branch `genesis/reproduction-engineer-1`, commit 1889359; verified again
  by the Diagnostic Analyst after merging that branch): with the simulated
  latencies pinned, 12 concurrent reservations all accept — reported
  output `RACE REPRODUCED: 12 orders accepted against stock 8 (oversell 4)`,
  exit status 0, identical output on every execution (8 executions across
  two separate verifications). The reproduction modifies no source file.
- Sequential control (Diagnostic Analyst, colleague-verified): 5 sequential
  reservations against stock 3 accepted exactly 3.

## INFERRED

- The three assertion failures are one defect seen from three angles: if
  k extra reservations accept, then accepted = 8 + k, final stock = k > 0,
  and rejected = 4 - k, so any of the three assertions can be the first to
  fail in a given run — matching the varying failing assertion in the
  evidence.
- The intermittent ~80% rate follows from the simulated 0-2 ms latencies
  and the ~0-150 ms dispatch spread in `orders.mjs`: the failing
  interleaving occurs when enough reservations read the same level before
  the first write lands, which the timings make likely but not certain —
  consistent with the 3 passing runs.
- Because every accepting reservation writes `available - quantity` from
  the same stale read, the batch can over-accept while stock remains
  positive.

## HYPOTHESIS

- H1 — non-atomic read-check-write in `InventoryService.reserve` lets
  concurrent callers that read the same level all accept. Supported by the
  deterministic reproduction on the unmodified source and the exact
  sequential control.
- H2 — a test-harness timing artifact rather than a service defect.
  Distinguished: the reproduction demonstrates the oversell on the service
  classes directly, without the test runner, and passing runs are
  consistent with latency-dependent interleaving rather than a logic
  error.
- H3 — an initial-stock accounting error in the constructor. Contradicted:
  passing runs accept exactly 8 and leave stock exactly 0.

## UNKNOWN

- Whether the staging cluster mentioned in the source comments exhibits
  the same behavior — the evidence bundle contains no staging telemetry.
- The exact interleavings of the 12 failing CI runs (not recorded at the
  event level in the incident logs).
- Whether any real datastore behind the same API shape in production
  provides serialization that would mask this behavior.
- Real-world arrival patterns compared with the simulated 0-150 ms
  dispatch spread.

## RECOMMENDED CHECK

- Run the committed `flaky-orders/repro.mjs` on any environment suspected
  to be affected — it is deterministic and modifies no source file.
- Capture staging telemetry for the reserve path (concurrent reads of the
  same level) before any fix is planned.
- Add a temporary instrumented counter of in-flight reservations at the
  moment of each write to confirm the overlap in vivo.
- Review whether the production datastore offers atomic
  compare-and-decrement semantics that the in-memory class lacks.

## Confidence

High — for the mechanism, within the supplied evidence: the reproduction
is deterministic on the unmodified source, the sequential control is
exact, and the observed accepted counts (9/10/11, and 12 under pinned
latencies) are what the mechanism predicts. Whether staging or production
is affected is not established — see UNKNOWN.
