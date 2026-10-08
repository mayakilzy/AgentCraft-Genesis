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
    ],
  },
  ...tseslint.configs.recommended,
);
