import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConfigValidator,
  ConfigurationError,
  STANDARD_PROVIDER_REQUIREMENTS,
} from '../../src/mission/config-validator.js';

describe('G6-01 config-validator — Section 33-35 secret detection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all env vars we test against
    delete process.env.ZAI_API_KEY;
    delete process.env.OPENBOT_ENDPOINT;
    delete process.env.OPENDOTS_ENDPOINT;
    delete process.env.OPENMUSE_ENDPOINT;
  });

  afterEach(() => {
    // Restore
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it('returns ok=true when all required env vars are present', () => {
    process.env.ZAI_API_KEY = 'sk-test-key-value';
    const validator = new ConfigValidator([
      { envVar: 'ZAI_API_KEY', description: 'test key', consumer: 'test' },
    ]);
    const result = validator.validate();
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.checked).toHaveLength(1);
    expect(result.checked[0].present).toBe(true);
  });

  it('returns ok=false and lists missing required env vars by NAME only', () => {
    process.env.ZAI_API_KEY = 'sk-test-key-value';
    const validator = new ConfigValidator([
      { envVar: 'ZAI_API_KEY', description: 'test key', consumer: 'test' },
      { envVar: 'MISSING_VAR', description: 'always missing', consumer: 'test' },
    ]);
    const result = validator.validate();
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['MISSING_VAR']);
    // Names only — no values leak
    expect(JSON.stringify(result)).not.toContain('sk-test');
  });

  it('treats empty/whitespace strings as missing', () => {
    process.env.ZAI_API_KEY = '   ';
    const validator = new ConfigValidator([
      { envVar: 'ZAI_API_KEY', description: 'test key', consumer: 'test' },
    ]);
    const result = validator.validate();
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['ZAI_API_KEY']);
  });

  it('does not throw for optional missing vars', () => {
    const validator = new ConfigValidator([
      { envVar: 'ZAI_API_KEY', description: 'test key', consumer: 'test', optional: true },
    ]);
    const result = validator.validate();
    expect(result.ok).toBe(true); // optional missing is OK
    expect(result.checked[0].present).toBe(false);
    expect(result.checked[0].optional).toBe(true);
  });

  it('throws ConfigurationError on validateOrThrow when required vars are missing', () => {
    const validator = new ConfigValidator([
      { envVar: 'MISSING_VAR_A', description: 'missing', consumer: 'test' },
      { envVar: 'MISSING_VAR_B', description: 'missing', consumer: 'test' },
    ]);
    expect(() => validator.validateOrThrow()).toThrow(ConfigurationError);
    try {
      validator.validateOrThrow();
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const cfgErr = error as ConfigurationError;
      expect(cfgErr.failureClass).toBe('CONFIGURATION_FAILURE');
      expect(cfgErr.missingVars).toEqual(['MISSING_VAR_A', 'MISSING_VAR_B']);
      // The error message must NOT contain any secret value — only names.
      expect(cfgErr.message).toContain('MISSING_VAR_A');
      expect(cfgErr.message).toContain('MISSING_VAR_B');
      expect(cfgErr.message).not.toContain('password');
      expect(cfgErr.message).not.toContain('secret value');
    }
  });

  it('ConfigValidator.requireEnv throws on missing without leaking value', () => {
    expect(() => ConfigValidator.requireEnv('TOTALLY_MISSING_VAR', 'test-consumer')).toThrow(
      ConfigurationError,
    );
    process.env.TOTALLY_PRESENT_VAR = 'some-secret-value';
    const value = ConfigValidator.requireEnv('TOTALLY_PRESENT_VAR', 'test-consumer');
    expect(value).toBe('some-secret-value');
    delete process.env.TOTALLY_PRESENT_VAR;
  });

  it('ConfigValidator.optionalEnv returns undefined for missing vars', () => {
    expect(ConfigValidator.optionalEnv('TOTALLY_MISSING_VAR')).toBeUndefined();
    process.env.TOTALLY_PRESENT_OPTIONAL = 'value';
    expect(ConfigValidator.optionalEnv('TOTALLY_PRESENT_OPTIONAL')).toBe('value');
    delete process.env.TOTALLY_PRESENT_OPTIONAL;
  });

  it('STANDARD_PROVIDER_REQUIREMENTS marks all entries as optional', () => {
    // Genesis runs in dev mode with scripted reasoning — none of the
    // provider env vars are strictly required.
    for (const req of STANDARD_PROVIDER_REQUIREMENTS) {
      expect(req.optional).toBe(true);
    }
    // The standard list covers the four production providers
    const consumers = STANDARD_PROVIDER_REQUIREMENTS.map((r) => r.consumer);
    expect(consumers).toContain('zai-reasoning');
    expect(consumers).toContain('openbot');
    expect(consumers).toContain('opendots');
    expect(consumers).toContain('openmuse');
  });
});
