import type { Config } from "eslint";

const config: Config = [
  {
    ignores: [".next/**", "node_modules/**"],
  },
  {
    extends: ["next"],
  },
];

export default config;
