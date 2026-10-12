/**
 * PILOT-002 R3.1/R3.2 — TASK 05: Browser environment smoke test.
 *
 * Verifies Playwright is installed and a Chromium browser can be launched.
 * Uses the project's Playwright (which matches the installed browsers).
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

describe('PILOT-002 R3.2 TASK 04/05 — Browser environment', () => {
  it('project Playwright is installed and exposes chromium', async () => {
    const mod = await import('playwright');
    expect(mod.chromium).toBeDefined();
    expect(typeof mod.chromium.launch).toBe('function');
  });

  it('chromium.executablePath() returns a valid existing path', async () => {
    const mod = await import('playwright');
    const execPath = mod.chromium.executablePath();
    expect(execPath).toBeDefined();
    expect(execPath.length).toBeGreaterThan(0);
    expect(existsSync(execPath)).toBe(true);
  });

  it('can launch a headless browser and navigate to about:blank', async () => {
    const mod = await import('playwright');
    const browser = await mod.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('about:blank');
    const title = await page.title();
    expect(title).toBe('');
    await browser.close();
  }, 15_000);
});
