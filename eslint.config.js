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
    ],
  },
  ...tseslint.configs.recommended,
);
