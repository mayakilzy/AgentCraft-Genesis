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
 *   GENESIS_RUNTIME_PROVIDER   — openbot | memory | stub (memory only valid in development;
 *     stub is a controlled-stub for production positive-path tests, G6-08 Phase 2)
 *   OPENBOT_CHECKOUT_DIR       — when GENESIS_RUNTIME_PROVIDER=openbot
 *   OPENBOT_ROOT_DIR           — when GENESIS_RUNTIME_PROVIDER=openbot
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
import { FileConversationStore } from '../conversation/conversation-store.js';
import { FileProjectStore } from '../project/project-store.js';
import { loadMcpConfig, McpConfigError, McpConfigNotFoundError } from '../plugins/mcp-config.js';
import type { CallerIdentity, GatewayConfig } from './types.js';
import type { ReasoningProvider } from '../contracts/core.js';
import type { WorkerRuntime } from '../runtime/computer.js';
import type { ZAIReasoningOptions, ZAIReasoningProvider as ZAIReasoningProviderType } from '../providers/zai-reasoning.js';
import type { OpenBotAdapterOptions } from '../runtime/openbot/adapter.js';

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
 *
 * G6-08 (Phase 2): adds `GENESIS_REASONING_PROVIDER=stub` for controlled
 * positive-path integration tests. The stub provider writes one
 * deterministic artifact — it is NOT a real LLM, and is clearly labeled
 * in startup logs.
 */
async function buildRealReasoningProvider(): Promise<ReasoningProvider | null> {
  const provider = process.env.GENESIS_REASONING_PROVIDER;
  if (!provider) {
    console.error('FATAL: GENESIS_EXECUTION_MODE=production requires GENESIS_REASONING_PROVIDER to be set.');
    return null;
  }
  switch (provider) {
    case 'zai': {
      // The ZAI SDK resolves credentials internally (via ZAI_SDK_PATH env
      // or the default z-ai-web-dev-sdk package). There is no apiKey
      // parameter on ZAIReasoningOptions. We verify that either
      // ZAI_SDK_PATH is set or the default SDK package is available.
      const sdkPath = process.env.ZAI_SDK_PATH;
      // If ZAI_API_KEY is set, we pass it through createEnv so the SDK
      // can use it; if neither ZAI_SDK_PATH nor ZAI_API_KEY is set, fail closed.
      if (!sdkPath && !process.env.ZAI_API_KEY) {
        console.error('FATAL: GENESIS_REASONING_PROVIDER=zai requires ZAI_SDK_PATH or ZAI_API_KEY to be set.');
        return null;
      }
      try {
        const mod = await import('../providers/zai-reasoning.js') as {
          ZAIReasoningProvider: new (opts?: ZAIReasoningOptions) => ZAIReasoningProviderType;
        };
        const opts: ZAIReasoningOptions = sdkPath ? { sdkPath } : {};
        return new mod.ZAIReasoningProvider(opts);
      } catch (e) {
        console.error('FATAL: Failed to load ZAIReasoningProvider:', e instanceof Error ? e.message : e);
        return null;
      }
    }
    case 'stub': {
      // G6-08 (Phase 2): controlled-stub provider for positive-path tests.
      // NOT a real LLM — writes a fixed deterministic artifact. Clearly
      // labeled in startup logs.
      console.error('[genesis-gateway] ⚠️  USING CONTROLLED-STUB REASONING PROVIDER (not a real LLM)');
      console.error('[genesis-gateway] ⚠️  This is for integration tests only. Do NOT use in real production.');
      try {
        const mod = await import('../providers/stub-reasoning.js') as {
          StubReasoningProvider: new (opts?: {
            outputPath?: string;
            outputContent?: string;
          }) => ReasoningProvider;
        };
        const outputPath = process.env.GENESIS_STUB_OUTPUT_PATH;
        const outputContent = process.env.GENESIS_STUB_OUTPUT_CONTENT;
        const opts: { outputPath?: string; outputContent?: string } = {};
        if (outputPath !== undefined) opts.outputPath = outputPath;
        if (outputContent !== undefined) opts.outputContent = outputContent;
        return new mod.StubReasoningProvider(opts);
      } catch (e) {
        console.error('FATAL: Failed to load StubReasoningProvider:', e instanceof Error ? e.message : e);
        return null;
      }
    }
    default:
      console.error(`FATAL: Unknown GENESIS_REASONING_PROVIDER: ${provider}`);
      return null;
  }
}

/**
 * G6-08 (RB-2) — Build a per-mission runtime FACTORY for production mode.
 *
 * Returns null if the required configuration is missing (fail-closed).
 *
 * The factory is invoked once per mission and constructs a FRESH
 * `OpenBotRuntimeAdapter` with a per-mission rootDir subdirectory
 * (`${baseRootDir}/${missionId}/`). This guarantees:
 *   - Each mission owns its own adapter (no shared internal `computers` Map).
 *   - Each mission's worker workspace directories are isolated at the
 *     filesystem level — no cross-mission data contamination even when
 *     two missions use the same deterministic worker IDs
 *     (`generalist-worker-1`, `mission-verifier-1`, etc.).
 *   - Each mission's workers can be stopped independently (Mission A's
 *     stopWorker does not affect Mission B).
 *
 * Validation of `OPENBOT_CHECKOUT_DIR` and `OPENBOT_ROOT_DIR` happens
 * up-front, before any mission is accepted — production mode fails closed
 * at startup if either is missing.
 */
async function buildRealRuntimeFactory(): Promise<((ctx: { missionId: string }) => { runtime: WorkerRuntime }) | null> {
  const provider = process.env.GENESIS_RUNTIME_PROVIDER;
  if (!provider) {
    console.error('FATAL: GENESIS_EXECUTION_MODE=production requires GENESIS_RUNTIME_PROVIDER to be set.');
    return null;
  }
  if (provider === 'memory') {
    console.error('FATAL: GENESIS_RUNTIME_PROVIDER=memory is not allowed in production mode.');
    return null;
  }
  if (provider === 'stub') {
    // G6-08 (Phase 2): controlled-stub runtime for positive-path tests.
    // Constructs a fresh MemoryRuntime per mission (which implements
    // ArtifactsProvider). Clearly labeled — NOT for real production.
    console.error('[genesis-gateway] ⚠️  USING CONTROLLED-STUB RUNTIME PROVIDER (MemoryRuntime, not real OpenBot)');
    console.error('[genesis-gateway] ⚠️  This is for integration tests only. Do NOT use in real production.');
    try {
      await import('../runtime/memory-computer.js');
    } catch (e) {
      console.error('FATAL: Failed to load MemoryRuntime module:', e instanceof Error ? e.message : e);
      return null;
    }
    const memoryRuntimeCtor = (await import('../runtime/memory-computer.js') as {
      MemoryRuntime: new () => WorkerRuntime;
    }).MemoryRuntime;
    // Per-mission factory: returns a FRESH MemoryRuntime for each mission.
    // MemoryRuntime implements ArtifactsProvider, so the gateway's
    // getArtifacts() retrieves genuine (in-memory) artifacts.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return (_ctx: { missionId: string }): { runtime: WorkerRuntime } => {
      return { runtime: new memoryRuntimeCtor() };
    };
  }
  if (provider === 'openbot') {
    // The OpenBot adapter spawns the OpenBot process locally — it does
    // NOT connect to an external endpoint. It requires:
    //   checkoutDir: path to the local OpenBot repo checkout
    //   rootDir: temp directory for per-worker workspaces
    const checkoutDir = process.env.OPENBOT_CHECKOUT_DIR;
    if (!checkoutDir) {
      console.error('FATAL: GENESIS_RUNTIME_PROVIDER=openbot requires OPENBOT_CHECKOUT_DIR (path to the local OpenBot checkout).');
      return null;
    }
    const rootDir = process.env.OPENBOT_ROOT_DIR;
    if (!rootDir) {
      console.error('FATAL: GENESIS_RUNTIME_PROVIDER=openbot requires OPENBOT_ROOT_DIR (directory for per-worker workspaces).');
      return null;
    }
    // Verify the adapter module loads AND cache its constructor — the
    // factory closure below is synchronous, so it cannot await import().
    try {
      await loadOpenBotAdapterCtor();
    } catch (e) {
      console.error('FATAL: Failed to load OpenBotRuntimeAdapter module:', e instanceof Error ? e.message : e);
      return null;
    }
    // Capture locally so the closure sees a non-null reference.
    const OpenBotRuntimeAdapterCtor = openBotAdapterCtor!;
    // Return a per-mission factory.
    return (ctx: { missionId: string }): { runtime: WorkerRuntime } => {
      // Per-mission rootDir subdirectory — isolates worker workspaces.
      // The adapter creates this lazily inside startComputerProcess.
      const missionRootDir = `${rootDir}/${ctx.missionId}`;
      const opts: OpenBotAdapterOptions = {
        checkoutDir,
        rootDir: missionRootDir,
      };
      return { runtime: new OpenBotRuntimeAdapterCtor(opts) };
    };
  }
  console.error(`FATAL: Unknown GENESIS_RUNTIME_PROVIDER: ${provider}`);
  return null;
}

// Cache the OpenBotRuntimeAdapter constructor synchronously after the
// async factory has validated it can be imported. The factory closure
// below is synchronous, so it cannot await import(); we resolve the
// constructor once during startup and reuse it for every mission.
let openBotAdapterCtor: (new (opts: OpenBotAdapterOptions) => WorkerRuntime) | null = null;
async function loadOpenBotAdapterCtor(): Promise<new (opts: OpenBotAdapterOptions) => WorkerRuntime> {
  if (openBotAdapterCtor !== null) return openBotAdapterCtor;
  const mod = await import('../runtime/openbot/adapter.js') as {
    OpenBotRuntimeAdapter: new (opts: OpenBotAdapterOptions) => WorkerRuntime;
  };
  openBotAdapterCtor = mod.OpenBotRuntimeAdapter;
  return mod.OpenBotRuntimeAdapter;
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
    defaultMissionTimeoutMs: 180_000,
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

  // G7-14: MCP server config. Fail-closed if env var set but file missing/malformed.
  // Loaded BEFORE the MissionService construction so mcpServers can be passed.
  let mcpServers: readonly import('../plugins/mcp-config.js').McpServerConfig[] = [];
  try {
    const mcpConfig = loadMcpConfig();
    if (mcpConfig !== null) {
      mcpServers = mcpConfig.servers;
      console.error(`[genesis-gateway] MCP config: ${mcpServers.length} server(s) from ${mcpConfig.sourcePath}`);
      for (const s of mcpServers) {
        console.error(`[genesis-gateway]   MCP: "${s.name}" (${s.transport.kind}) grants: ${s.grants.join(', ')}`);
      }
    } else {
      console.error('[genesis-gateway] No MCP config (GENESIS_MCP_SERVERS_CONFIG not set).');
    }
  } catch (e) {
    if (e instanceof McpConfigNotFoundError || e instanceof McpConfigError) {
      console.error(`FATAL: ${e.message}`); process.exit(1);
    }
    throw e;
  }

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
    const runtimeFactory = await buildRealRuntimeFactory();
    if (runtimeFactory === null) {
      console.error('FATAL: Production mode requires a configured runtime provider.');
      console.error('Set GENESIS_RUNTIME_PROVIDER and the corresponding OPENBOT_CHECKOUT_DIR / OPENBOT_ROOT_DIR.');
      process.exit(1);
    }
    service = new MissionService({
      defaultMissionTimeoutMs: config.defaultMissionTimeoutMs,
      runtimeFactory: runtimeFactory,
      reasoningFactory: () => reasoning,
      mcpServers,
    });
  } else {
    console.error('[genesis-gateway] EXECUTION MODE: development');
    console.error('[genesis-gateway] ⚠️  USING DEVELOPMENT FIXTURES: MemoryComputer + DEVELOPMENT_REASONING_FALLBACK');
    console.error('[genesis-gateway] ⚠️  This is NOT real AI execution. Do NOT use in production.');
    service = new MissionService({
      defaultMissionTimeoutMs: config.defaultMissionTimeoutMs,
      mcpServers,
    });
  }

  const conversationStore = new FileConversationStore();
  const projectStore = new FileProjectStore();

  const http = startHttpServer(service, config, conversationStore, projectStore, mcpServers);
  const a2a = await startA2AServer(service, config);

  console.error(`[genesis-gateway] HTTP API listening on ${http.url}`);
  console.error(`[genesis-gateway] A2A inbound listening on ${a2a.url}`);
  console.error(`[genesis-gateway] Agent Card at ${a2a.agentCardUrl}`);
  console.error(`[genesis-gateway] A2A server uses official @a2a-js/sdk server abstractions.`);
  console.error(`[genesis-gateway] ${config.apiKeys.size} caller(s) configured.`);
  console.error(`[genesis-gateway] Execution mode: ${mode}`);
  console.error('[genesis-gateway] In-process mission state; no durability across restart.');
  console.error('[genesis-gateway] Conversations are durable (JSONL on disk).');
  console.error('[genesis-gateway] Projects are durable (atomic JSON on disk).');

  // G6-08-R1 (B-EXEC-FINDING-003): graceful shutdown of active missions and
  // their owned OpenBot workers. The handler is idempotent (guarded by a
  // `shuttingDown` flag) and bounded by a deadline. It does NOT call
  // process.exit(0) unconditionally — it exits 0 only if shutdown is clean,
  // otherwise exits 1 so the operator can investigate orphaned workers.
  let shutdownInProgress = false;
  let shutdownCompleted = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shutdownCompleted) return;  // already torn down
    if (shutdownInProgress) return;  // deduplicate concurrent SIGTERM/SIGINT
    shutdownInProgress = true;
    console.error(`[genesis-gateway] received ${signal}, shutting down...`);
    // Stop accepting new connections immediately.
    http.server.close();
    a2a.server.close();
    // Drain active missions and close runtime adapters. Bounded deadline.
    // The internal shutdown() method cancels each active mission's controller,
    // awaits the orchestrator's finally{} (which calls runtime.stopWorker()
    // per ensured worker), then calls runtime.close() as a safety net.
    try {
      const result = await service.shutdown(10_000);
      console.error(
        `[genesis-gateway] shutdown: ${result.activeMissionsDrained} drained, ` +
        `${result.activeMissionsTimedOut} timed out, ` +
        `${result.runtimeAdaptersClosed} runtimes closed, ` +
        `${result.runtimeAdapterCloseErrors} close errors ` +
        `(elapsed ${result.elapsedMs}ms)`,
      );
      if (result.activeMissionsTimedOut > 0) {
        console.error('[genesis-gateway] WARNING: some missions did not drain within the deadline');
        for (const p of result.perMission) {
          if (p.timedOut) {
            console.error(`[genesis-gateway]   timed out: ${p.missionId} (final status: ${p.finalStatus})`);
          }
        }
      }
      if (result.runtimeAdapterCloseErrors > 0) {
        console.error('[genesis-gateway] WARNING: some runtime adapters failed to close');
        for (const p of result.perRuntime) {
          if (p.closeError !== undefined) {
            console.error(`[genesis-gateway]   ${p.runtimeName} (mission ${p.missionId}): ${p.closeError}`);
          }
        }
      }
      shutdownCompleted = true;
      // Exit code reflects cleanup outcome: 0 if clean, 1 if any timedOut or close errors.
      // This ensures the operator can detect orphaned worker processes via the
      // nonzero exit code and investigate.
      process.exit(result.clean ? 0 : 1);
    } catch (e) {
      console.error('[genesis-gateway] shutdown threw:', e instanceof Error ? e.message : e);
      shutdownCompleted = true;
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

await main();
