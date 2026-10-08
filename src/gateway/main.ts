/**
 * G6-06 — Genesis Gateway main entry point with execution mode boundary.
 *
 * Starts the HTTP Service API and the inbound A2A server, both backed
 * by a single shared MissionService.
 *
 * Execution modes (GENESIS_EXECUTION_MODE):
 *   development (default) — uses MemoryComputer + DEVELOPMENT_REASONING_FALLBACK.
 *     Suitable for local testing and CI. Logs a loud banner.
 *   production — requires real runtime + reasoning providers configured via
 *     environment variables. FAILS CLOSED if any required provider is missing.
 *     NO silent fallback to dev fixtures.
 *
 * Usage:
 *   npx tsx src/gateway/main.ts
 *
 * Environment variables:
 *   GENESIS_EXECUTION_MODE  — development | production (default: development)
 *   GENESIS_HTTP_HOST       — HTTP API host (default 127.0.0.1)
 *   GENESIS_HTTP_PORT       — HTTP API port (default 4180)
 *   GENESIS_A2A_HOST        — A2A server host (default 127.0.0.1)
 *   GENESIS_A2A_PORT        — A2A server port (default 4181)
 *   GENESIS_A2A_BASE_URL    — public base URL for the A2A AgentCard
 *   GENESIS_API_KEYS        — JSON map of API key → caller config (REQUIRED)
 *
 *   In production mode, additionally required:
 *   GENESIS_REASONING_PROVIDER — zai | (future: openrouter, etc.)
 *   ZAI_API_KEY or ZAI_SDK_PATH — when GENESIS_REASONING_PROVIDER=zai
 *   GENESIS_RUNTIME_PROVIDER   — openbot | memory (memory only valid in development)
 *   OPENBOT_ENDPOINT           — when GENESIS_RUNTIME_PROVIDER=openbot
 *
 * Example GENESIS_API_KEYS:
 *   '{"test-key-1":{"callerId":"caller-a","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}'
 *
 * If GENESIS_API_KEYS is not set, the gateway refuses to start (fail-closed).
 * If GENESIS_EXECUTION_MODE=production and required providers are missing,
 * the gateway refuses to start (fail-closed).
 */
import { MissionService } from './mission-service.js';
import { startHttpServer } from './http-server.js';
import { startA2AServer } from './a2a-server.js';
import type { CallerIdentity, GatewayConfig } from './types.js';
import type { ReasoningProvider } from '../contracts/core.js';
import type { WorkerRuntime } from '../runtime/computer.js';

type ExecutionMode = 'development' | 'production';

function loadExecutionMode(): ExecutionMode {
  const mode = process.env.GENESIS_EXECUTION_MODE ?? 'development';
  if (mode !== 'development' && mode !== 'production') {
    console.error(`FATAL: GENESIS_EXECUTION_MODE must be 'development' or 'production' (got: ${mode})`);
    process.exit(1);
  }
  return mode;
}

/**
 * Build a real reasoning provider for production mode.
 * Returns null if the required credentials are missing.
 */
async function buildRealReasoningProvider(): Promise<ReasoningProvider | null> {
  const provider = process.env.GENESIS_REASONING_PROVIDER;
  if (!provider) {
    console.error('FATAL: GENESIS_EXECUTION_MODE=production requires GENESIS_REASONING_PROVIDER to be set.');
    return null;
  }
  switch (provider) {
    case 'zai': {
      const apiKey = process.env.ZAI_API_KEY;
      const sdkPath = process.env.ZAI_SDK_PATH;
      if (!apiKey && !sdkPath) {
        console.error('FATAL: GENESIS_REASONING_PROVIDER=zai requires ZAI_API_KEY or ZAI_SDK_PATH.');
        return null;
      }
      try {
        const mod = await import('../providers/zai-reasoning.js') as {
          ZAIReasoningProvider: new (opts: { apiKey?: string; sdkPath?: string }) => ReasoningProvider;
        };
        return new mod.ZAIReasoningProvider({ apiKey, sdkPath });
      } catch (e) {
        console.error('FATAL: Failed to load ZAIReasoningProvider:', e instanceof Error ? e.message : e);
        return null;
      }
    }
    default:
      console.error(`FATAL: Unknown GENESIS_REASONING_PROVIDER: ${provider}`);
      return null;
  }
}

/**
 * Build a real runtime adapter for production mode.
 * Returns null if the required configuration is missing.
 *
 * In production mode, the gateway verifies that real runtime configuration
 * is present and fails closed if it is not. The actual runtime adapter
 * is constructed by the MissionService's runtimeFactory, which is injected
 * here using the environment variables. For OpenBot, the adapter requires
 * a checkout directory and root directory that are deployment-specific;
 * we verify the endpoint is present and let the factory handle construction.
 */
async function buildRealRuntime(): Promise<{ runtime: WorkerRuntime; computers: Map<string, import('../../tests/helpers/memory-runtime.js').MemoryComputer> } | null> {
  const provider = process.env.GENESIS_RUNTIME_PROVIDER;
  if (!provider) {
    console.error('FATAL: GENESIS_EXECUTION_MODE=production requires GENESIS_RUNTIME_PROVIDER to be set.');
    return null;
  }
  if (provider === 'memory') {
    console.error('FATAL: GENESIS_RUNTIME_PROVIDER=memory is not allowed in production mode.');
    return null;
  }
  if (provider === 'openbot') {
    const endpoint = process.env.OPENBOT_ENDPOINT;
    if (!endpoint) {
      console.error('FATAL: GENESIS_RUNTIME_PROVIDER=openbot requires OPENBOT_ENDPOINT.');
      return null;
    }
    // The OpenBot adapter requires checkoutDir and rootDir which are
    // deployment-specific. In production, the operator must configure these.
    // We verify the endpoint is present; the adapter is constructed lazily
    // by the runtimeFactory on first mission.
    try {
      const mod = await import('../runtime/openbot/adapter.js') as unknown as {
        OpenBotRuntimeAdapter: new (opts: Record<string, unknown>) => WorkerRuntime;
      };
      const checkoutDir = process.env.OPENBOT_CHECKOUT_DIR ?? '/tmp/openbot-checkout';
      const rootDir = process.env.OPENBOT_ROOT_DIR ?? '/tmp/openbot-root';
      const runtime = new mod.OpenBotRuntimeAdapter({
        endpoint,
        token: process.env.OPENBOT_TOKEN,
        checkoutDir,
        rootDir,
      });
      return { runtime, computers: new Map() };
    } catch (e) {
      console.error('FATAL: Failed to load OpenBotRuntimeAdapter:', e instanceof Error ? e.message : e);
      return null;
    }
  }
  console.error(`FATAL: Unknown GENESIS_RUNTIME_PROVIDER: ${provider}`);
  return null;
}

function loadConfig(): GatewayConfig {
  const apiKeysRaw = process.env.GENESIS_API_KEYS;
  if (!apiKeysRaw || apiKeysRaw.trim().length === 0) {
    console.error('FATAL: GENESIS_API_KEYS environment variable is required.');
    console.error('The gateway refuses to start without configured API keys (fail-closed).');
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(apiKeysRaw);
  } catch (e) {
    console.error('FATAL: GENESIS_API_KEYS is not valid JSON:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (parsed === null || typeof parsed !== 'object') {
    console.error('FATAL: GENESIS_API_KEYS must be a JSON object mapping keys to caller configs.');
    process.exit(1);
  }

  const apiKeys = new Map<string, CallerIdentity>();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') {
      console.error(`FATAL: caller config for key "${key.slice(0, 4)}..." is not an object`);
      process.exit(1);
    }
    const cfg = value as Record<string, unknown>;
    const callerId = cfg.callerId;
    if (typeof callerId !== 'string' || callerId.length === 0) {
      console.error(`FATAL: caller config for key "${key.slice(0, 4)}..." missing callerId`);
      process.exit(1);
    }
    apiKeys.set(key, {
      callerId,
      allowedOperations: Array.isArray(cfg.allowedOperations)
        ? cfg.allowedOperations.filter((o): o is string => typeof o === 'string')
        : ['mission:submit'],
      maxActiveMissions: typeof cfg.maxActiveMissions === 'number' ? cfg.maxActiveMissions : 5,
      maxMissionTimeoutMs: typeof cfg.maxMissionTimeoutMs === 'number' ? cfg.maxMissionTimeoutMs : 60_000,
    });
  }

  if (apiKeys.size === 0) {
    console.error('FATAL: GENESIS_API_KEYS contains no valid entries.');
    process.exit(1);
  }

  const httpHost = process.env.GENESIS_HTTP_HOST ?? '127.0.0.1';
  const httpPort = parseInt(process.env.GENESIS_HTTP_PORT ?? '4180', 10);
  const a2aHost = process.env.GENESIS_A2A_HOST ?? '127.0.0.1';
  const a2aPort = parseInt(process.env.GENESIS_A2A_PORT ?? '4181', 10);
  const a2aBaseUrl = process.env.GENESIS_A2A_BASE_URL ?? `http://${a2aHost}:${a2aPort}`;

  return {
    apiKeys,
    httpHost,
    httpPort,
    a2aHost,
    a2aPort,
    a2aBaseUrl,
    defaultMissionTimeoutMs: 60_000,
    maxRequestBodyBytes: 1_000_000,
    maxEventsPerResponse: 100,
    agentName: process.env.GENESIS_AGENT_NAME ?? 'AgentCraft Genesis Gateway',
    agentDescription:
      process.env.GENESIS_AGENT_DESCRIPTION ??
      'Genesis Engine gateway: accepts a goal, builds the organization, executes the work, and returns a verified result. Reachable via HTTP API and inbound A2A.',
  };
}

async function main(): Promise<void> {
  const mode = loadExecutionMode();
  const config = loadConfig();

  // Build the MissionService with execution-mode-appropriate providers.
  let service: MissionService;

  if (mode === 'production') {
    console.error('[genesis-gateway] EXECUTION MODE: production (real providers required)');
    const reasoning = await buildRealReasoningProvider();
    if (reasoning === null) {
      console.error('FATAL: Production mode requires a configured reasoning provider.');
      console.error('Set GENESIS_REASONING_PROVIDER and the corresponding credential environment variable.');
      process.exit(1);
    }
    const runtimeBuild = await buildRealRuntime();
    if (runtimeBuild === null) {
      console.error('FATAL: Production mode requires a configured runtime provider.');
      console.error('Set GENESIS_RUNTIME_PROVIDER and the corresponding endpoint/credential.');
      process.exit(1);
    }
    // In production, wire the real providers. No fallback to dev fixtures.
    service = new MissionService({
      defaultMissionTimeoutMs: config.defaultMissionTimeoutMs,
      runtimeFactory: () => ({ runtime: runtimeBuild.runtime, computers: runtimeBuild.computers }),
      reasoningFactory: () => reasoning,
    });
  } else {
    // Development mode: use dev fixtures, but log a loud banner.
    console.error('[genesis-gateway] EXECUTION MODE: development');
    console.error('[genesis-gateway] ⚠️  USING DEVELOPMENT FIXTURES: MemoryComputer + DEVELOPMENT_REASONING_FALLBACK');
    console.error('[genesis-gateway] ⚠️  This is NOT real AI execution. Do NOT use in production.');
    service = new MissionService({
      defaultMissionTimeoutMs: config.defaultMissionTimeoutMs,
    });
  }

  const http = startHttpServer(service, config);
  const a2a = await startA2AServer(service, config);

  console.error(`[genesis-gateway] HTTP API listening on ${http.url}`);
  console.error(`[genesis-gateway] A2A inbound listening on ${a2a.url}`);
  console.error(`[genesis-gateway] Agent Card at ${a2a.agentCardUrl}`);
  console.error(`[genesis-gateway] A2A server uses official @a2a-js/sdk server abstractions.`);
  console.error(`[genesis-gateway] ${config.apiKeys.size} caller(s) configured.`);
  console.error(`[genesis-gateway] Execution mode: ${mode}`);
  console.error('[genesis-gateway] In-process state; no durability across restart.');

  // Graceful shutdown.
  const shutdown = (signal: string): void => {
    console.error(`[genesis-gateway] received ${signal}, shutting down...`);
    http.server.close();
    a2a.server.close();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

await main();
