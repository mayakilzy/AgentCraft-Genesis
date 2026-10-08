# AgentCraft Genesis — G7 Product Experience (Web UI)

The `web/` directory contains the Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui
client for the Genesis Gateway. It is the G7 Product Experience deliverable.

## Stack rationale

Per `01_MASTER_GLM_EXECUTION_PROMPT.md` §Startup check 3: "If a framework is already
present, reuse it unless an evidence-based reason requires otherwise. If absent,
choose the smallest maintainable TypeScript web stack compatible with repo tooling."

The engine repo is TypeScript + Node 24 + Vitest, with no existing frontend. Next.js 16
is chosen because:

1. **TypeScript-native** — aligns with the repo's TS 5.9.3 ESM stack.
2. **Server-side Route Handlers** provide a minimal secure BFF proxy (R02 CRITICAL).
   The gateway uses Bearer API key auth; the API key MUST NOT reach the browser.
3. **shadcn/ui** provides accessible, keyboard-first primitives via Radix UI — no
   custom design system needed (per 01_MASTER §Rules: "Do not build an entire custom
   design system if standard primitives suffice").
4. **Tailwind CSS 4** gives responsive, accessible, RTL-ready styling without a
   charting/graph library (per 01_MASTER §Rules: "no new state framework, charting
   engine or graph library unless demonstrated necessary").
5. **Single-app deploy** — not a monorepo restructuring (per 01_MASTER §Startup 3:
   "Prefer one frontend app, not a monorepo restructuring").

## Layout

```
web/src/
  app/
    api/genesis/[...path]/route.ts   # Secure BFF proxy (server-side)
    globals.css                       # Calm Enterprise palette tokens
    layout.tsx                        # Root layout (RTL-ready, viewport)
    page.tsx                          # Single-page shell with 6 sections
  components/genesis/
    AppShell.tsx                      # Persistent responsive nav + connection state
    ConnectionStatus.tsx              # Gateway /health polling
    EnvironmentStatus.tsx             # Controlled-test banner (permanent)
    MissionBreadcrumb.tsx            # Active mission pill + last-observed
    EmptyState.tsx                    # Honest loading/empty/error/disconnected
    sections/Sections.tsx             # Six section placeholders (filled by G7-02..06)
  lib/genesis/
    types.ts                          # Verified gateway contract types
    client.ts                         # Typed UI adapter (only verified operations)
    store.ts                          # Zustand store (nav + connection + missions)
```

## Verified gateway capability matrix

See `../evidence/gateway-capability-matrix.json` for the full SUPPORTED / PARTIAL /
ABSENT / BLOCKED inventory, with source file + line references.

Summary:
- **SUPPORTED (7)**: health, ready, create_mission, read_mission, cancel_mission,
  get_terminal_result, list_artifacts
- **PARTIAL (4)**: observe_events (100-event cap), list_workers_genomes (events-only),
  metrics_insights (per-mission only), replay_events (client-side navigation)
- **ABSENT (3)**: list_missions (no server endpoint), capability_discovery,
  approvals_HITL (UI hides these controls)

## Browser auth strategy

The UI NEVER calls the gateway directly. All calls go through `/api/genesis/[...path]`
which attaches the Bearer Authorization header from `process.env.GENESIS_API_KEY`
(server-side only — never serialized to the client bundle).

`GENESIS_API_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js guarantees it stays
server-side. The proxy also redacts obvious secret sentinels (GitHub PATs, OpenAI
keys, Authorization headers, env var leaks) from any error body before returning
to the client — defense-in-depth on top of the gateway's G6-09C scrubbing.

## Controlled-demo mode

`NEXT_PUBLIC_GENESIS_MODE=controlled` (default) shows a permanent visible banner:
"Controlled test environment — not a live production provider." Per
`10_OPERATOR_DECISIONS.md`: GLM may be used for development and controlled reasoning
substitution; this is NOT evidence of live ZAI/OpenBot integration.

Switch to `live` ONLY when the gateway is running in production execution mode with
real reasoning + runtime providers configured (see
`src/gateway/main.ts` §Execution modes).

## Running locally

The `web/` directory uses the same `package.json` scripts as the parent Next.js
project (`bun run dev`, `bun run lint`). In the sandbox preview environment, the
Next.js app at the project root (outside this repo) is what the preview exposes;
this `web/` directory is the same source code, version-controlled alongside the
engine.

To run the gateway for end-to-end testing (controlled mode):

```bash
# In the repo root (NOT web/):
GENESIS_API_KEYS='{"g7-controlled-key-local":{"callerId":"g7-ui","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}' \
GENESIS_EXECUTION_MODE=development \
npx tsx src/gateway/main.ts
```

The gateway listens on `http://127.0.0.1:4180`. The UI's `/api/genesis/health`
proxy will return 200 once the gateway is up.
