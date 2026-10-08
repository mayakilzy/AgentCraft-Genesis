# Genesis Engine v1 — Scope

**Version:** 0.1.0 (Release Candidate)
**Branch:** `build/group-06-productionization`
**Date:** 2026-10-08

## What Genesis Engine v1 Is

Genesis is a Goal-to-Organization Runtime. Given a goal, it builds
the AI organization needed to achieve it, executes the work, verifies
the outcome, and produces evidence.

```text
Goal → Understanding → Organization → Genome → Execution → Verification → Evidence
```

**The team does not exist until the mission does.** Genesis dynamically
composes workers and capabilities rather than requiring a fixed team.

## Capability Matrix

| Capability | Classification | Evidence |
|---|---|---|
| Goal compilation | Verified | G6-05 Exp-A: 3 distinct domains, structural variation, full coverage |
| Organization planning | Verified | G6-05 Exp-A: OrganizationPlanner produces structurally varying plans |
| Genome compilation | Verified | G6-05 Exp-A: GenomeCompiler compiles all plans with full coverage |
| Worker execution | Verified | G6-05 Exp-B: 3/3 mission successes, real worker actions |
| Real runtime integration | Limited | Phase 4.8A/E: real OpenBot proven; gateway defaults to MemoryComputer |
| Model reasoning | Limited | Experiment-001: real ZAI LLM proven; gateway defaults to DEVELOPMENT_REASONING_FALLBACK |
| Verification | Verified | G6-05 Exp-B, G6-04: clean-room verification with hash-match |
| Evidence and artifacts | Verified | G6-05 Exp-B: artifact retrieval with content verification |
| Cancellation | Verified | G6-05A-R1: AbortSignal propagation proven with long-running mission |
| Service API | Verified | G6-05A: 17 HTTP API tests, separate-process E2E |
| A2A inbound | Verified | G6-05A-R1: official @a2a-js/sdk server abstractions, 7 tests |
| A2A outbound | Verified | G6-02: 22 outbound tests, trust-boundary invariant |
| MCP | Limited | G5-01: local reference server only |
| AG-UI | Limited | G5-02: in-process consumer only |
| OpenDots collaboration | Limited | Phase 4.6/4.8E: real OpenDots proven; not in default gateway |
| OpenMuse delegation | Limited | Phase 4.8E: real OpenMuse proven; in-flight recovery not proven |
| Jev decision provider | Limited | G6-03B: real Jev proven; OPTIONAL, not production default |
| Learning and evolution | Limited | G5-06/G5-07: bounded learning under scripted conditions |
| Restart recovery | Unsupported | In-process state only; no durability across restart |

## Execution Modes

- **development** (default): MemoryComputer + DEVELOPMENT_REASONING_FALLBACK. Logs a loud banner. NOT real AI execution.
- **production**: Requires configured real reasoning + runtime providers. Fails closed if missing. NO silent fallback.

## What This Release Is NOT

- NOT generally production-certified.
- NOT an enterprise IAM system.
- NOT a UI/dashboard product.
- NOT a multi-region distributed system.
- NOT a replacement for OpenBot/OpenDots/OpenMuse.

## Release Candidate Status

This is **Engine v1 Release Candidate — Ready for G6-07 Deep Hardening.**

G6-07 will harden it. G6-08 will challenge it independently. G7 will
consume the resulting engine.

**Truth before elegance. Evidence before promotion.**
