/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  // The web app is the G7 Product Experience client for the Genesis Gateway.
  // It runs as a Next.js 16 app with server-side route handlers providing
  // the secure BFF proxy to the gateway.
  // No experimental features required for the controlled environment.
  turbopack: {
    // The web app has its own package-lock.json (web/package-lock.json).
    // Pin the Turbopack root to the web/ directory so Next.js does not
    // infer the parent engine repo as the workspace root.
    root: __dirname,
  },
};

export default nextConfig;
