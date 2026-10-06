// Deterministic reproduction of the flaky-orders intermittent oversell.
//
// The source simulates store latency with `sleep(Math.random() * 2)` in
// InventoryService.lookup and another in reserve's validation window. The
// incident bundle shows the suite failing ~80% of runs with 9-11 orders
// accepted against stock 8 — consistent with concurrent reservations
// reading the SAME stock level before any write lands.
//
// This script pins Math.random so both simulated latencies are constant:
// every concurrent reservation then reads the same value before the first
// write commits — the failing interleaving, on demand, on the UNMODIFIED
// source (this file adds no changes to src/).

Math.random = () => 0.999;

const { InventoryService } = await import('./src/inventory.mjs');

const STOCK = 8;
const ORDERS = 12;

const inventory = new InventoryService({ widget: STOCK });
const results = await Promise.all(
  Array.from({ length: ORDERS }, () => inventory.reserve('widget', 1)),
);
const accepted = results.filter(Boolean).length;

if (accepted > STOCK) {
  console.log(
    `RACE REPRODUCED: ${accepted} orders accepted against stock ${STOCK} ` +
      `(oversell ${accepted - STOCK})`,
  );
  process.exit(0);
}

console.log(`no oversell: ${accepted} accepted against stock ${STOCK}`);
process.exit(1);
