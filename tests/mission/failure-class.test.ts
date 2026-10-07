import { describe, it, expect } from 'vitest';
import {
  classifyError,
  isRetryable,
  failureSummary,
  FAILURE_CLASSES,
  type FailureClass,
} from '../../src/mission/failure-class.js';

describe('G6-01 failure-class — Section 13 taxonomy', () => {
  it('exposes exactly the eleven classes from Section 13', () => {
    expect(FAILURE_CLASSES).toEqual([
      'PROVIDER_FAILURE',
      'RUNTIME_FAILURE',
      'WORKER_FAILURE',
      'TOOL_FAILURE',
      'VERIFICATION_FAILURE',
      'TIMEOUT',
      'CANCELLED',
      'BUDGET_EXHAUSTED',
      'CONFIGURATION_FAILURE',
      'RECOVERY_FAILURE',
      'UNKNOWN_FAILURE',
    ]);
  });

  it('classifies AbortError as CANCELLED', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(classifyError(err)).toBe('CANCELLED');
  });

  it('classifies timeout messages as TIMEOUT', () => {
    expect(classifyError(new Error('Operation timed out'))).toBe('TIMEOUT');
    expect(classifyError(new Error('ETIMEDOUT connection refused'))).toBe('TIMEOUT');
  });

  it('classifies HTTP 429 / rate limit as PROVIDER_FAILURE', () => {
    expect(classifyError(new Error('status 429 Too Many Requests'))).toBe('PROVIDER_FAILURE');
    expect(classifyError(new Error('rate limit exceeded'))).toBe('PROVIDER_FAILURE');
  });

  it('classifies network errors as PROVIDER_FAILURE', () => {
    expect(classifyError(new Error('ECONNREFUSED 127.0.0.1:443'))).toBe('PROVIDER_FAILURE');
    expect(classifyError(new Error('ECONNRESET socket hang up'))).toBe('PROVIDER_FAILURE');
    expect(classifyError(new Error('ENOTFOUND api.example.com'))).toBe('PROVIDER_FAILURE');
    expect(classifyError(new Error('service unavailable'))).toBe('PROVIDER_FAILURE');
  });

  it('classifies empty completion as PROVIDER_FAILURE (zai-reasoning contract)', () => {
    expect(classifyError(new Error('empty completion from the ZAI provider'))).toBe('PROVIDER_FAILURE');
  });

  it('classifies configuration errors as CONFIGURATION_FAILURE', () => {
    expect(classifyError(new Error('missing required env ZAI_API_KEY'))).toBe('CONFIGURATION_FAILURE');
    expect(classifyError(new Error('api_key not set'))).toBe('CONFIGURATION_FAILURE');
  });

  it('classifies tool-grant errors as TOOL_FAILURE', () => {
    expect(classifyError(new Error('action call_tool not granted mcp:sum'))).toBe('TOOL_FAILURE');
    expect(classifyError(new Error('unauthorized MCP tool invocation'))).toBe('TOOL_FAILURE');
  });

  it('falls back to UNKNOWN_FAILURE for unclassifiable errors', () => {
    expect(classifyError(new Error('something weird happened'))).toBe('UNKNOWN_FAILURE');
    expect(classifyError(null)).toBe('UNKNOWN_FAILURE');
    expect(classifyError(undefined)).toBe('UNKNOWN_FAILURE');
    expect(classifyError('a plain string error')).toBe('UNKNOWN_FAILURE');
  });

  it('marks transient failures as retryable and structural failures as terminal', () => {
    const retryable: FailureClass[] = [
      'PROVIDER_FAILURE',
      'RUNTIME_FAILURE',
      'TOOL_FAILURE',
      'TIMEOUT',
      'UNKNOWN_FAILURE',
    ];
    for (const cls of retryable) {
      expect(isRetryable(cls)).toBe(true);
    }
    const terminal: FailureClass[] = [
      'WORKER_FAILURE',
      'VERIFICATION_FAILURE',
      'CANCELLED',
      'BUDGET_EXHAUSTED',
      'CONFIGURATION_FAILURE',
      'RECOVERY_FAILURE',
    ];
    for (const cls of terminal) {
      expect(isRetryable(cls)).toBe(false);
    }
  });

  it('builds a one-line summary from multiple failures', () => {
    const summary = failureSummary([
      { class: 'PROVIDER_FAILURE', message: 'connection refused' },
      { class: 'TIMEOUT', message: 'reasoning call exceeded 30s' },
    ]);
    expect(summary).toBe('PROVIDER_FAILURE: connection refused | TIMEOUT: reasoning call exceeded 30s');
  });

  it('returns empty summary for no failures', () => {
    expect(failureSummary([])).toBe('');
  });

  it('truncates long failure messages to 160 chars', () => {
    const longMessage = 'x'.repeat(300);
    const summary = failureSummary([
      { class: 'UNKNOWN_FAILURE', message: longMessage },
    ]);
    expect(summary.length).toBeLessThan(300);
    expect(summary).toContain('UNKNOWN_FAILURE');
  });
});
