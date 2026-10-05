# Experiment 001 — Born From Goal

- **Mission:** `experiment-001-20261005T150912`
- **Status:** **SUCCESS**
- **Wall time:** 1m 27s
- **Cognitive spend:** 35 real LLM calls (93,404 prompt + 4,550 completion tokens; 0 provider failure(s)). USD cost is 0.00 because the ZAI SDK reports tokens, not dollars; tokens are the real measure here.
- **Human interventions:** 0 — the goal ran unattended.

## The goal (given, not a team)

> Audit the 10 first-party dependencies of the AgentCraft-Genesis project against the live npm registry and deliver a dependency health report that states, for every dependency, the pinned version, the latest published version, whether it is current, and a one-line recommendation for each outdated one.

No team was specified. The organization below is what Genesis designed from the goal.

## The organization Genesis designed

Rationale: Scope "standard" in domain "software-engineering" with 2 capability needs. Planned 2 specialist role(s): Software Engineer [code-execution], Documentation Writer [document-authoring]. No coordinator: fewer than 3 specialists.

| Worker | Role | Capability needs |
| --- | --- | --- |
| `software-engineer-1` | Software Engineer | code-execution |
| `documentation-writer-2` | Documentation Writer | document-authoring |

## Genomes (cognitive and tool grants)

| Worker | Tier | Grants | Own computer |
| --- | --- | --- | --- |
| `software-engineer-1` | cheap | openbot:shell-execution, openbot:workspace-files | yes |
| `documentation-writer-2` | default | openbot:workspace-files | yes |

## The work (from the flight record)

### software-engineer-1

- **Status:** success
- **Steps:** 4 (reasoning calls: 5)
- **Artifacts:** `dependency-health-report.md`
- **Summary:** I've successfully created a dependency health report for the AgentCraft-Genesis project. The report includes all 10 first-party dependencies with their pinned versions, latest versions from npm, and a clear status (current or outdated) for each. The report also includes a recommendations section for the outdated dependencies. The grep command confirms that the report contains both 'outdated' and 'current' text, which was the issue in the previous attempt.

### documentation-writer-2

- **Status:** success
- **Steps:** 5 (reasoning calls: 6)
- **Artifacts:** `dependency-health-report.md`
- **Summary:** I created a dependency health report for the AgentCraft-Genesis project. The report includes all 10 first-party dependencies with their pinned versions, latest versions, and status (current or outdated). The report is in markdown format with a table showing the dependency information and a recommendations section for outdated dependencies. However, I was unable to verify the report with the software-engineer-1 colleague as they exhausted their step budget during verification attempts.

## Worker-to-worker handoffs

- `documentation-writer-2` → `software-engineer-1`: served
- `documentation-writer-2` → `software-engineer-1`: refused/failed (worker "software-engineer-1" failed to serve the handoff: step budget of 5 exhausted before the worker finished)
- `documentation-writer-2` → `software-engineer-1`: refused/failed (worker "software-engineer-1" failed to serve the handoff: step budget of 5 exhausted before the worker finished)

## Verification (clean room, deterministic)

- **Pass 1:** FAILED — 3 passed, 1 failed
  - the report marks dependencies current or outdated explicitly: "grep -Eq 'outdated|current' artifacts/software-engineer-1/dependency-health-report.md" exited 1 (expected 0); stderr: 
- **Pass 2:** ALL PASSED — 4 passed, 0 failed

## Retries

- One bounded retry fired: The dependency health report for software-engineer-1 does not contain either 'outdated' or 'current' text, which indicates the report generation failed to properly analyze or document the dependency status.

## Mission summary (as integrated)

Software Engineer: I've successfully created a dependency health report for the AgentCraft-Genesis project. The report includes all 10 first-party dependencies with their pinned versions, latest versions from npm, and a clear status (current or outdated) for each. The report also includes a recommendations section for the outdated dependencies. The grep command confirms that the report contains both 'outdated' and 'current' text, which was the issue in the previous attempt. | Documentation Writer: I created a dependency health report for the AgentCraft-Genesis project. The report includes all 10 first-party dependencies with their pinned versions, latest versions, and status (current or outdated). The report is in markdown format with a table showing the dependency information and a recommendations section for outdated dependencies. However, I was unable to verify the report with the software-engineer-1 colleague as they exhausted their step budget during verification attempts.

## What worked

- The goal ran end-to-end unattended: understanding → organization → genomes → real OpenBot computers → real LLM work → verification → this report.
- Workers executed real commands (live npm registry queries) inside their own isolated upstream agent-computer processes — never on the host by Genesis.
- The flight record (`data/flight-records/experiment-001-20261005T150912.jsonl`) rebuilds this entire report — every claim above is read from it, not from memory.

## What to improve (observed, honestly)

- v0.1 runs specialists sequentially; parallel execution and richer coordinator decomposition are future work.
- The tier distinction maps to thinking on/off in this provider (the SDK exposes one backing model); a multi-model provider would make tiers fully distinct.
- USD cost stays 0.00: no pricing telemetry flows through the provider contract yet (tokens are tracked for real).

## Capability gaps observed

- No registry gaps: every capability need this goal produced was satisfied by a canonical owner (OpenBot shell/workspace domains).
- Browser verification was not exercised in this experiment (the goal needs no browser); the computer API surface for it is verified upstream but not yet wired to a Genesis browser check — a documented v0.1 boundary.

## Post-run analysis (evidence: the artifacts themselves)

**Which deliverable carried the mission.** Two workers delivered two reports
with the same filename. The mission passed verification on
`software-engineer-1`'s report — the one built from REAL live-registry
queries (typescript 5.9.1-pinned vs 7.0.2-latest, @types/node 24.19.1 vs
26.6.4, @ag-ui/core 1.0.1 vs 1.0.2 — all cross-checked against `npm view`
by the clean-room verifier). `documentation-writer-2`'s report was
plausible but wrong (yaml "2.6.1", typescript "5.9.3"): the writer held
only the engineer's narrative summary, which does not carry the numbers,
and the model filled the gap with invention. Both are preserved under
`artifacts/` prefixed by producer.

**What this teaches (v0.1 boundaries, honestly recorded):**

- Worker-to-worker evidence moves as REFERENCES (summaries), not file
  access — by design (TASK-011), but a summary without the data invites
  hallucinated specifics. Future: briefs should carry structured
  highlights, or the orchestrator should copy cross-referenced artifacts
  into the consumer's workspace.
- The clean-room verification earned its keep twice: it failed the
  engineer's first report (no current/outdated verdict), diagnosed,
  retried once, and passed only when the verdicts existed AND the live
  registry cross-check matched. A narrative claim of success would not
  have passed.
- Four earlier live runs failed loudly for four different real causes —
  rate-limit storms, fallback misclassification, LLM-understanding
  non-determinism, degenerate repeat loops — each now fixed and
  unit-tested. The flight records of those runs were deleted with their
  workspaces; the lessons live in the commits and in the fixes:
  provider backoff, roster in the worker prompt, loop-breaker,
  mission-first briefs, deterministic-understanding for reproducibility.
- The handoff serve budget (5 steps) bounded the engineer's serve of the
  writer's verification request — exactly the cost containment the
  handoff design intended.
