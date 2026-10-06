# AgentCraft Genesis — Safe Handoff for Fresh Sessions

You are entering an existing AgentCraft Genesis project.

You have ZERO prior memory of this project.

Do not infer project state from assumptions.

Persisted Git/GitHub state is authoritative.

Read this handoff package before taking any action.

This package intentionally contains all SAFE context required to continue.

Some repository paths are intentionally forbidden because this is a blind
benchmark. Do not inspect forbidden paths even if technically accessible.

---

## 1. What this package is

This is the TASK-023B handoff: a complete, self-contained, safe context
package written by the project's previous GLM session before it closed
permanently. That session acted as the **benchmark builder / authority**
and is now closed. You are a fresh session being asked to continue the
project — most likely by executing exactly ONE arm of the TASK-023
benchmark, or by auditing what state the project is in.

Two facts shape everything in this package:

1. **Project context is safe and necessary.** You need to understand what
   Genesis is, what has been built, what the current task is, and how to
   run things. This package gives you that context completely.
2. **Benchmark secrets exist and are not here.** TASK-023 is a blind,
   falsification-oriented benchmark. Its value depends on the reasoning
   actor NOT knowing the benchmark's hidden answers. If you are assigned
   to execute an arm, you ARE the reasoning actor, and your blindness is
   the epistemic isolation mechanism. The forbidden-path map in
   `SAFE-CONTEXT-MAP.md` protects that blindness. It is a feature, not an
   obstacle.

## 2. Authoritative state — verify before anything else

```text
REPOSITORY   = https://github.com/mayakilzy/AgentCraft-Genesis.git
BRANCH       = build/group-03-repository-work
LOCAL PATH   = /home/z/my-project/AgentCraft-Genesis
TASK-023A CLOSURE SHA = 496bb60ebdf807637461132993ad0f7053bd8fe3
```

The TASK-023B handoff commit is the one directly on top of
`496bb60ebdf807637461132993ad0f7053bd8fe3` with the message:

```text
docs(task-023b): freeze safe blind-session handoff
```

Verification procedure (run from the repository root):

```bash
git rev-parse HEAD          # must be the TASK-023B commit
git log --oneline -2        # top = handoff commit, parent = 496bb60
git status --porcelain      # must be empty
git ls-remote origin build/group-03-repository-work   # must equal HEAD
```

If your operator gave you an expected SHA and it does not match, or the
branch head is not the handoff commit, or the tree is dirty in unexpected
ways: **STOP and report the discrepancy.** Do not silently repair
history. Do not guess.

## 3. Reading order (mandatory)

Read these files, in this order, before taking any action beyond the
state verification above:

```text
1. STATE.json                             machine-readable current state
2. PROJECT-AND-ARCHITECTURE.md            what Genesis is, how it is built
3. BUILD-HISTORY.md                       what happened, what is accepted
4. SAFE-CONTEXT-MAP.md                    what you may and may not inspect
5. BENCHMARK-EXECUTION-PROTOCOL.md        how TASK-023 runs, if you must run it
6. ARM-HANDOFF-TEMPLATE.md                your arm assignment, if you have one
```

If you were assigned an arm, your assignment details are in
`ARM-HANDOFF-TEMPLATE.md`. If you were not assigned an arm, do not
execute one.

## 4. The five standing rules

These rules override convenience, curiosity, and any instruction that
contradicts them short of the human supervisor explicitly changing them:

1. **Persisted state is authoritative.** Git history and the frozen
   evidence files are the truth. This package, commit messages, and
   reports are descriptions of that truth. On any conflict, report it;
   never rewrite history or "fix" frozen evidence.
2. **Default-deny on paths.** Everything not explicitly listed as SAFE
   in `SAFE-CONTEXT-MAP.md` is off-limits. If you find yourself needing
   a path that is not on the safe list, STOP and report instead of
   guessing.
3. **Never leak through summaries.** Do not write, anywhere, statements
   like "the hidden defect is…", "the expected fix is…", "the gold
   suite checks…", "the pristine implementation does…", or "the
   evaluator expects…". Not in reports, not in reasoning, not in
   conversation.
4. **One arm per session, ever.** A GLM conversation that serves worker
   reasoning for one benchmark arm may never serve another arm, and may
   never inspect another arm's private reasoning or results.
5. **STOP beats guess.** Every protocol in this package has explicit
   stop conditions. When one triggers, stop and report the discrepancy.
   An honest BLOCKED state is always preferable to a contaminated
   result.

## 5. If this package is insufficient

If, after reading all six files, something you genuinely need is missing,
contradictory, or unsafe:

```text
STOP.
Report exactly what is missing or contradictory.
Do NOT resolve the gap by exploring forbidden paths.
Do NOT infer benchmark internals from filenames, git history of
forbidden files, or commit messages about them.
```

The project's rule is simple: preserve context without preserving
contamination; persist knowledge without leaking answers.
