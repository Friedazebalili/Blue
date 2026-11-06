// Takes a homepage screenshot of every store linked in index.html
// (each <img src="shots/<name>.jpg" data-url="...">) and saves it in shots/.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const jobs = new Map();
for (const m of html.matchAll(/<img src="(shots\/[^"]+\.jpg)" data-url="([^"]+)"/g)) jobs.set(m[1], m[2]);

const CONSENT = ['Accept', 'Accept all', 'Accept All', 'Allow all', 'Allow All', 'I agree', 'Got it', 'OK',
  'Akceptuję', 'Zaakceptuj', 'Akzeptieren', 'Alle akzeptieren', 'Godkänn', 'Acceptera', 'Accepteren', 'Aceptar'];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1600 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  locale: 'en-US',
});

async function capture(file, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    for (const name of CONSENT) {
      const btn = page.getByRole('button', { name, exact: true }).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) { await btn.click({ timeout: 1500 }).catch(() => {}); break; }
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: file, type: 'jpeg', quality: 70, timeout: 10000 });
    return true;
  } finally {
    await page.close().catch(() => {});
  }
}

const queue = [...jobs];
let ok = 0;
async function worker() {
  while (queue.length) {
    const [file, url] = queue.shift();
    const limit = new Promise((_, rej) => setTimeout(() => rej(new Error('took longer than 50s')), 50000));
    try { await Promise.race([capture(file, url), limit]); ok++; console.log('ok  ', url); }
    catch (e) { console.log('FAIL', url, String(e.message).split('\n')[0]); }
  }
}
await Promise.all(Array.from({ length: 5 }, worker));
await browser.close();
console.log(`${ok}/${jobs.size} screenshots saved`);
process.exit(0);
