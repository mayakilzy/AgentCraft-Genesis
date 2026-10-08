/**
 * G6-08 (RC-5 / B-EXEC-FINDING-007) — Backward-compatible re-export.
 *
 * Production source now imports `MemoryComputer` and `MemoryRuntime` from
 * `src/runtime/memory-computer.ts`. This file remains as a thin re-export so
 * existing tests that import from `tests/helpers/memory-runtime.js` continue
 * to work without modification.
 *
 * New tests should import directly from `../../src/runtime/memory-computer.js`.
 */
export {
  MemoryComputer,
  MemoryRuntime,
  memoryRuntimeForTest,
} from '../../src/runtime/memory-computer.js';
