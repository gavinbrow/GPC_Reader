// Usage: node e2e/screens.mjs <outdir> [view titles...]
// Opens the sample experiment and saves a screenshot of each requested view.
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'screens';
const views = process.argv.slice(3);
const url = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.getByText('Open sample (PS 30 kDa)').click();
await page.waitForSelector('.doc-tab');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/00-start.png` });
let i = 1;
for (const v of views) {
  const item = page.locator('.tree-item', { hasText: v }).first();
  if (!(await item.count())) {
    // results folder may be collapsed
    await page.locator('.tree-item', { hasText: 'Results' }).last().click();
  }
  await page.locator('.tree-item', { hasText: v }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${String(i++).padStart(2, '0')}-${v.replace(/[^a-z0-9]+/gi, '_')}.png` });
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
