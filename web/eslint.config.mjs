// Flat ESLint config for the AgentCraft Genesis web app.
//
// Next.js 16 no longer ships a `next lint` command. We use ESLint directly
// via `npm run lint` → `eslint .`. The `eslint-config-next` package exports
// a flat-config array (verified at audit time), which we spread into our
// own flat config. This preserves all of Next.js's recommended rules
// (including the @next/next, react, react-hooks, jsx-a11y, and
// @typescript-eslint plugin rules) without requiring the removed `next lint`
// wrapper.
import nextConfig from "eslint-config-next";

/** @type {import('eslint').Linter.Config[]} */
const config = [
  // Include the entire Next.js flat config array (it already contains its
  // own ignores for .next/, out/, build/, next-env.d.ts).
  ...nextConfig,
];

export default config;
