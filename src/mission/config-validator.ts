/**
 * G6-01 — Configuration validation.
 *
 * Section 33-35 of the G6-01 mission brief require:
 *   - "Missing required configuration should fail: early; clearly;
 *      without leaking secret values."
 *   - "Do not let a missing credential manifest later as a misleading
 *      mission failure if it can be detected at initialization."
 *   - "Keep validation provider-scoped."
 *
 * This module is the smallest reusable boundary for that requirement.
 * It is NOT a full configuration framework — it is a focused validator
 * that:
 *
 *   1. Resolves required environment variables by name.
 *   2. Throws a structured ConfigurationError (never the raw value).
 *   3. Reports which variables are missing without echoing their values.
 *   4. Records what was validated in a flight-event-friendly shape.
 *
 * Anti-bloat: one small file. No YAML/TOML parser. No schema library.
 * Genesis providers (zai-reasoning, MCP, OpenBot, OpenDots, OpenMuse)
 * declare their requirements; this validator enforces them.
 */

import type { FailureClass } from './failure-class.js';

/**
 * A structured configuration failure. The `missingVars` array contains
 * variable NAMES ONLY — never values — so the error is safe to log,
 * serialize into a flight event, or surface to a future UI. A missing
 * secret produces the same shape as a missing non-secret: there is no
 * information leak from the validation boundary.
 */
export class ConfigurationError extends Error {
  readonly failureClass: FailureClass = 'CONFIGURATION_FAILURE';
  readonly missingVars: readonly string[];

  constructor(missingVars: readonly string[], context?: string) {
    const list = missingVars.join(', ');
    const ctx = context === undefined ? '' : ` (${context})`;
    super(`missing required configuration${ctx}: ${list}`);
    this.name = 'ConfigurationError';
    this.missingVars = [...missingVars];
  }
}

/**
 * A single requirement: an environment variable that must be present and
 * non-empty for the named provider/consumer to function.
 */
export interface ConfigRequirement {
  /** Environment variable name (e.g. ZAI_API_KEY, OPENAI_API_KEY). */
  readonly envVar: string;
  /** Human-readable description (never includes the value). */
  readonly description: string;
  /**
   * Provider or consumer that needs this variable. Used to group errors
   * by provider scope (Section 35: "Keep validation provider-scoped").
   */
  readonly consumer: string;
  /**
   * When true, the variable is optional at validation time but required
   * for the consumer's specific feature. The validator records its
   * presence/absence without throwing — the consumer fails later if it
   * actually needs it. Default: false (required).
   */
  readonly optional?: boolean;
}

/** A validation result: what was checked, what passed, what failed. */
export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly checked: ReadonlyArray<{
    readonly envVar: string;
    readonly consumer: string;
    readonly present: boolean;
    readonly optional: boolean;
  }>;
  readonly missing: readonly string[];
}

/**
 * The configuration validator. Construct with the requirements for the
 * providers/consumers in this mission; call `validate()` before mission
 * execution begins. A non-OK result is a hard stop — the mission must
 * not start with a known missing configuration.
 *
 * Usage:
 *   const validator = new ConfigValidator([
 *     { envVar: 'ZAI_API_KEY', description: 'ZAI reasoning provider key', consumer: 'zai-reasoning' },
 *   ]);
 *   const result = validator.validate();
 *   if (!result.ok) throw new ConfigurationError(result.missing);
 */
export class ConfigValidator {
  private readonly requirements: readonly ConfigRequirement[];

  constructor(requirements: readonly ConfigRequirement[]) {
    this.requirements = [...requirements];
  }

  /**
   * Resolve every requirement against `process.env`. Returns a structured
   * result; never throws. Callers decide whether a non-OK result is a
   * hard stop (required vars missing) or a soft warning (optional vars
   * missing).
   */
  validate(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
    const checked = this.requirements.map((req) => {
      const raw = env[req.envVar];
      const present =
        raw !== undefined && raw !== null && raw.trim().length > 0;
      return {
        envVar: req.envVar,
        consumer: req.consumer,
        present,
        optional: req.optional ?? false,
      };
    });
    const missing = checked
      .filter((c) => !c.optional && !c.present)
      .map((c) => c.envVar);
    return {
      ok: missing.length === 0,
      checked,
      missing,
    };
  }

  /**
   * Validate and throw on missing required variables. The thrown error
   * carries variable NAMES ONLY — never values — so it is safe to record
   * in a flight event or surface in a UI.
   */
  validateOrThrow(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
    const result = this.validate(env);
    if (!result.ok) {
      throw new ConfigurationError(result.missing);
    }
    return result;
  }

  /**
   * Read a single required variable, throwing a ConfigurationError if
   * missing. Used by provider constructors that need to resolve their
   * own credentials lazily.
   */
  static requireEnv(name: string, consumer: string): string {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw.trim().length === 0) {
      throw new ConfigurationError([name], consumer);
    }
    return raw;
  }

  /**
   * Read a single optional variable. Returns undefined when absent.
   * Records nothing — this is a plain getter for optional configuration.
   */
  static optionalEnv(name: string): string | undefined {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw.trim().length === 0) {
      return undefined;
    }
    return raw;
  }
}

/**
 * The standard requirements for the Genesis providers wired into the
 * engine baseline. Missions using a subset can prune this list; missions
 * using additional providers extend it. The list is provider-scoped per
 * Section 35.
 *
 * NOTE: every entry is OPTIONAL — Genesis runs in development mode with
 * scripted reasoning (no ZAI_API_KEY needed), and production deployments
 * may use any combination of providers. The validator is for explicit
 * pre-flight checks when a mission declares it needs a specific provider.
 */
export const STANDARD_PROVIDER_REQUIREMENTS: readonly ConfigRequirement[] = [
  {
    envVar: 'ZAI_API_KEY',
    description: 'ZAI reasoning provider API key (real-LLM mode)',
    consumer: 'zai-reasoning',
    optional: true,
  },
  {
    envVar: 'OPENBOT_ENDPOINT',
    description: 'OpenBot computer runtime HTTP endpoint',
    consumer: 'openbot',
    optional: true,
  },
  {
    envVar: 'OPENDOTS_ENDPOINT',
    description: 'OpenDots collaborative workspace endpoint',
    consumer: 'opendots',
    optional: true,
  },
  {
    envVar: 'OPENMUSE_ENDPOINT',
    description: 'OpenMuse durable-delegation endpoint',
    consumer: 'openmuse',
    optional: true,
  },
];
