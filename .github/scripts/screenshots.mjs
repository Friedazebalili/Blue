// Takes a homepage screenshot of every store linked in index.html
// (each <img data-url="..." src="shots/<name>.jpg">) and saves it in shots/.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const jobs = new Map();
for (const m of html.matchAll(/<img src="(shots\/[^"]+\.jpg)" data-url="([^"]+)"/g)) jobs.set(m[1], m[2]);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1600 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  locale: 'en-US',
});
let failed = 0;
for (const [file, url] of jobs) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // Close common cookie / newsletter popups so the homepage is visible
    for (const label of ['Accept', 'Accept all', 'Accept All', 'Allow all', 'I agree', 'Got it', 'OK', 'Close', 'Akceptuję', 'Akzeptieren', 'Alle akzeptieren', 'Godkänn', 'Accepteren', 'Aceptar']) {
      const btn = page.getByRole('button', { name: label, exact: true }).first();
      if (await btn.isVisible().catch(() => false)) await btn.click({ timeout: 2000 }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: file, type: 'jpeg', quality: 70 });
    console.log('ok  ', url);
  } catch (e) {
    failed++;
    console.log('FAIL', url, String(e.message).split('\n')[0]);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(`${jobs.size - failed}/${jobs.size} screenshots saved`);
