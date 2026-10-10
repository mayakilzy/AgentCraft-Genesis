/**
 * G7-16A — Minimal structured logger.
 *
 * Provides consistent machine-readable JSON log records for essential
 * operational events. No new dependency — uses process.stderr.write
 * with JSON.stringify. Secrets are scrubbed using the existing
 * scrubSecrets() pattern from mission-service.ts.
 *
 * Log format (one JSON object per line — JSONL):
 *   {"level":"info","timestamp":"2026-10-10T04:00:00.000Z","component":"gateway","event":"mission_accepted","message":"...","missionId":"..."}
 *
 * Levels: error, warn, info
 * Components: gateway, workspace_cleanup, history_recovery, runtime, mcp
 *
 * No raw prompts, credentials, tokens, or sensitive artifact content.
 */

// Reuse the same secret patterns from mission-service.ts to avoid duplication.
const SECRET_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /Bearer\s+[A-Za-z0-9_\-\.]+/g, label: 'Bearer token' },
  { pattern: /gh[opua]_[A-Za-z0-9_]{36,}/g, label: 'GitHub PAT' },
  { pattern: /sk-or-v1-[A-Za-z0-9_]{20,}/gi, label: 'OpenRouter key' },
  { pattern: /sk-ant-[A-Za-z0-9_\-]{20,}/g, label: 'Anthropic key' },
  { pattern: /sk-(?!or-|ant-)[A-Za-z0-9_]{20,}/g, label: 'OpenAI key' },
  { pattern: /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[=:]\s*[A-Za-z0-9\/+=_]{20,}/g, label: 'AWS secret' },
  { pattern: /(?:api_key|api-key|x-api-key)\s*[=:]\s*[A-Za-z0-9_\-]{20,}/gi, label: 'API key' },
];

function scrubSecrets(text: string, maxLength: number = 300): string {
  let scrubbed = text;
  for (const { pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubbed.slice(0, maxLength);
}

type LogLevel = 'error' | 'warn' | 'info';

/**
 * Emit a structured log record to stderr as a single JSON line.
 * @param level - error, warn, or info
 * @param component - the subsystem (gateway, workspace_cleanup, etc.)
 * @param message - human-readable description (scrubbed of secrets)
 * @param context - optional correlation identifiers (missionId, callerId, etc.)
 */
export function structuredLog(
  level: LogLevel,
  component: string,
  message: string,
  context?: Readonly<Record<string, string>>,
): void {
  const record: Record<string, unknown> = {
    level,
    timestamp: new Date().toISOString(),
    component,
    message: scrubSecrets(message, 500),
  };
  if (context !== undefined) {
    for (const [key, value] of Object.entries(context)) {
      record[key] = scrubSecrets(value, 200);
    }
  }
  try {
    process.stderr.write(JSON.stringify(record) + '\n');
  } catch {
    // If JSON serialization fails, fall back to a safe minimal record.
    process.stderr.write(`{"level":"${level}","timestamp":"${new Date().toISOString()}","component":"${component}","message":"[log serialization error]"}\n`);
  }
}

/**
 * Capture stderr lines for testing. Returns the captured lines and a cleanup function.
 * Exported for tests only.
 */
export function captureStructuredLogsForTests(): { logs: string[]; stop: () => void } {
  const logs: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  const interceptor = (chunk: string | Buffer): boolean => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed.startsWith('{')) {
        try {
          JSON.parse(trimmed);
          logs.push(trimmed);
        } catch {
          // Not a structured log line — pass through.
          original(chunk);
        }
      } else {
        original(chunk);
      }
    }
    return true;
  };
  process.stderr.write = interceptor as typeof process.stderr.write;
  return {
    logs,
    stop: () => { process.stderr.write = original; },
  };
}
