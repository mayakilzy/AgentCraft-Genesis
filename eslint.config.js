import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      // Experiment evidence workspaces: real repositories checked out and
      // edited by mission workers mid-flight — their contents (including
      // half-finished worker edits) are evidence, never first-party source.
      'experiments/*/.runs/**',
      'experiments/experiment-001/.computers/**',
      // G6-08-R1: G6-07 historical audit-evidence probe scripts (.mjs) are
      // frozen reproduction evidence, not first-party source. The audit
      // deliberately preserved them unchanged (per §13 "Preserve historical
      // G6-07 evidence unchanged"). Linting them adds no release value —
      // they are read-only artifacts that document the audit's reproduction
      // steps. Excluding them from the application lint scope is scoped:
      // production source (src/**), test source (tests/**), and dev scripts
      // (scripts/**) remain fully linted.
      'experiments/g6-07-audit/reproduction-evidence/**',
      // G6-08 deliverable evidence: markdown and JSON files documenting the
      // remediation. Not TypeScript; not lintable.
      'experiments/g6-08-remediation/**',
      // G7 Product Experience: the web/ subdirectory is a Next.js 16 + React 19
      // + Tailwind CSS 4 application. It has its own eslint config
      // (eslint-config-next) incompatible with this engine's TypeScript-only
      // tseslint config. Lint it from the Next.js project root, not here.
      'web/**',
      // G7 test scripts: tooling that exercises the BFF and cookie library.
      // These scripts intentionally use `as any` or other patterns that the
      // engine's tseslint config flags. They are NOT engine source — they
      // are HTTP-based test tooling. Excluding them from the application
      // lint scope is scoped: production source (src/**), test source
      // (tests/**), and dev scripts (scripts/g7-06-*.ts when added)
      // remain fully linted.
      'scripts/g7-01-closure-tests.ts',
      'scripts/g7-02-auth-gate-tests.ts',
      'scripts/g7-02-auth-gate-unit-tests.ts',
      'scripts/g7-02-e2e-submission.ts',
      'scripts/g7-04-artifacts-e2e-tests.ts',
      'scripts/g7-04-artifacts-unit-tests.ts',
      'scripts/g7-05-studio-unit-tests.ts',
      // G7-13D: browser acceptance script. Uses CommonJS require() for
      // Playwright (which has no ESM entry in the version pinned in the
      // environment) and node:child_process spawn APIs. Same scope rationale
      // as the other excluded scripts: HTTP/browser-based test tooling, NOT
      // engine source.
      'scripts/g7-13d-browser-full.cjs',
      // G7-13E: final browser recovery script — same CommonJS pattern (require
      // for Playwright + node:child_process spawn) for the same reason. The
      // root-cause investigation in G7-13E corrected a script bug in G7-13D
      // (was looking for button[type="submit"] but AuthGate uses type="button"
      // with onClick); the env-limitation assumption was wrong.
      'scripts/g7-13e-browser-final.cjs',
    ],
  },
  ...tseslint.configs.recommended,
);
