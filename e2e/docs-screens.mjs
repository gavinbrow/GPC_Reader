// Regenerates the screenshots in docs/screenshots (dev server must be running).
// Usage: node e2e/docs-screens.mjs [outdir]
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'docs/screenshots';
const url = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.getByText('Open sample (PS 30 kDa)').click();
await page.waitForSelector('.doc-tab');
await page.waitForTimeout(600);
const tree = async (label) => {
  const item = page.locator('.tree-item', { hasText: label }).first();
  if (!(await item.count())) await page.locator('.tree-item', { hasText: 'Results' }).last().click();
  await page.locator('.tree-item', { hasText: label }).first().click();
  await page.waitForTimeout(600);
};
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const ok = async () => {
  await page.locator('.view-buttons button', { hasText: 'OK' }).last().click();
  await page.waitForTimeout(400);
};

await shot('basic-collection');
// Calibrate on the standard: alignment, then normalization.
await tree('Alignment');
await page.locator('.view-toolbar button', { hasText: /^Align/ }).first().click();
await page.waitForTimeout(500);
await shot('alignment');
await ok();
await tree('Normalization');
await page.locator('.view-toolbar button', { hasText: /^Normalize/ }).first().click();
await page.waitForTimeout(500);
await shot('normalization');
await ok();
await tree('Baselines');
await shot('baselines');
await tree('Peaks');
await shot('peaks');
await tree('Molar Mass & Radius from LS');
await shot('molar-mass');
await tree('Results Fitting');
await page.locator('.doc:visible .view-toolbar select').nth(1).selectOption('Polynomial');
await page.waitForTimeout(500);
await shot('results-fitting');
await ok();
await tree('Distribution Analysis');
await shot('distribution');
await tree('Viscometry');
await shot('viscometry');
await tree('Report');
await shot('report');
await tree('Configuration');
await shot('configuration');
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
