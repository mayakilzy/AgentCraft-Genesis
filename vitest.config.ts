import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The project's tests live in tests/. experiments/**/.runs hold preserved
    // mission evidence — including the target repositories' own node:test
    // files, which are data, not suites (observed live: `vitest run` failed
    // on Experiment 002's committed evidence before this restriction).
    include: ['tests/**/*.test.ts'],
  },
});
