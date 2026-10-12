/**
 * PILOT-002 R3.1 — TASK 05: Browser environment smoke test.
 *
 * Verifies that Playwright is installed and a Chromium browser can be
 * launched. Uses Playwright's supported executable resolution
 * (chromium.executablePath()) — no hardcoded build numbers.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

describe('PILOT-002 R3.1 TASK 05 — Browser environment', () => {
  it('Playwright is installed and exposes chromium', async () => {
    let chromium: { executablePath?: () => string; launch?: (opts?: object) => Promise<unknown> } | null = null;
    try {
      const mod = await import('playwright');
      chromium = mod.chromium;
    } catch {
      // Try OpenBot checkout
      try {
        const mod = await import('/tmp/openbot-test/agent-computer/node_modules/playwright');
        chromium = mod.chromium;
      } catch {
        // skipped
      }
    }
    expect(chromium).not.toBeNull();
    expect(typeof chromium!.launch).toBe('function');
  });

  it('chromium.executablePath() returns a valid path', async () => {
    let chromium: { executablePath?: () => string } | null = null;
    try {
      const mod = await import('playwright');
      chromium = mod.chromium;
    } catch {
      const mod = await import('/tmp/openbot-test/agent-computer/node_modules/playwright');
      chromium = mod.chromium;
    }
    const execPath = chromium!.executablePath?.();
    expect(execPath).toBeDefined();
    expect(execPath!.length).toBeGreaterThan(0);
    // The path should exist on disk.
    expect(existsSync(execPath!)).toBe(true);
  });

  it('can launch a headless browser and navigate to about:blank', async () => {
    let chromium: { launch?: (opts?: object) => Promise<any> } | null = null;
    try {
      const mod = await import('playwright');
      chromium = mod.chromium;
    } catch {
      const mod = await import('/tmp/openbot-test/agent-computer/node_modules/playwright');
      chromium = mod.chromium;
    }
    const browser = await chromium!.launch!({ headless: true });
    const page = await browser.newPage();
    await page.goto('about:blank');
    const title = await page.title();
    expect(title).toBe('');
    await browser.close();
  }, 15_000);
});
