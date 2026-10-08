/**
 * G6-05A — Genesis Gateway main entry point.
 *
 * Starts the HTTP Service API and the inbound A2A server, both backed
 * by a single shared MissionService.
 *
 * Usage:
 *   npx tsx src/gateway/main.ts
 *
 * Environment variables:
 *   GENESIS_HTTP_HOST     — HTTP API host (default 127.0.0.1)
 *   GENESIS_HTTP_PORT     — HTTP API port (default 4180)
 *   GENESIS_A2A_HOST      — A2A server host (default 127.0.0.1)
 *   GENESIS_A2A_PORT      — A2A server port (default 4181)
 *   GENESIS_A2A_BASE_URL  — public base URL for the A2A AgentCard (default http://127.0.0.1:4181)
 *   GENESIS_API_KEYS      — JSON map of API key → caller config (REQUIRED, no default)
 *
 * Example GENESIS_API_KEYS:
 *   '{"test-key-1":{"callerId":"caller-a","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}'
 *
 * If GENESIS_API_KEYS is not set, the gateway refuses to start (fail-closed).
 */
import { MissionService } from './mission-service.js';
import { startHttpServer } from './http-server.js';
import { startA2AServer } from './a2a-server.js';
import type { CallerIdentity, GatewayConfig } from './types.js';

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

function main(): void {
  const config = loadConfig();
  const service = new MissionService({
    defaultMissionTimeoutMs: config.defaultMissionTimeoutMs,
  });

  const http = startHttpServer(service, config);
  const a2a = startA2AServer(service, config);

  console.error(`[genesis-gateway] HTTP API listening on ${http.url}`);
  console.error(`[genesis-gateway] A2A inbound listening on ${a2a.url}`);
  console.error(`[genesis-gateway] Agent Card at ${a2a.agentCardUrl}`);
  console.error(`[genesis-gateway] ${config.apiKeys.size} caller(s) configured.`);
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

main();
