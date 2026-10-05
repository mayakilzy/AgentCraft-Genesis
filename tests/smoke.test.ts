import { describe, expect, it } from 'vitest';

import {
  GENESIS_ENGINEERING_RULE,
  GENESIS_MOTTO,
  GENESIS_VERSION,
} from '../src/index.js';

describe('repository smoke', () => {
  it('exposes the Genesis entrypoint constants', () => {
    expect(GENESIS_VERSION).toBe('0.1.0');
    expect(GENESIS_MOTTO).toBe('Large in capability, small in code.');
    expect(GENESIS_ENGINEERING_RULE).toContain('REUSE');
    expect(GENESIS_ENGINEERING_RULE.endsWith('BUILD')).toBe(true);
  });
});
