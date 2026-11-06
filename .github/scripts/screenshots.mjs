// Takes a desktop screenshot of every store linked in index.html
// (each <img src="shots/<name>.jpg" data-url="...">) and saves it in shots/.
// The browser window is a normal 1440x900 desktop screen; the image also
// includes the page below the first screen so cards can scroll on hover.
import { chromium } from 'playwright';
import { readFileSync, rmSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const jobs = new Map();
for (const m of html.matchAll(/<img src="(shots\/[^"]+\.jpg)" data-url="([^"]+)"/g)) jobs.set(m[1], m[2]);

const W = 1440, H = 900, SHOT_H = 2000;
const CONSENT = ['Accept', 'Accept all', 'Accept All', 'Allow all', 'Allow All', 'I agree', 'Got it', 'OK',
  'Akceptuję', 'Zaakceptuj', 'Akzeptieren', 'Alle akzeptieren', 'Godkänn', 'Acceptera', 'Accepteren', 'Aceptar'];
const BLOCKED = /checking your browser|verify you are human|are you a robot|attention required|access denied|just a moment/i;

// Real Google Chrome plays video banners (H.264); fall back to bundled Chromium.
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  locale: 'en-US',
});

// Hide popups, newsletter modals, chat bubbles and cookie banners.
// Never hides <html>, <body>, the header, or anything that holds the page's main content.
async function hideOverlays(page) {
  await page.evaluate(({ W, H }) => {
    const main = document.querySelector('main, #MainContent, [role="main"]');
    const safe = el => el === document.documentElement || el === document.body ||
      el.closest('header') || (main && (el === main || el.contains(main) || main.contains(el)));
    const hide = el => el.style.setProperty('display', 'none', 'important');
    const sel = '[role="dialog"],[aria-modal="true"],[class*="klaviyo"],[id*="klaviyo"],[id*="smile-ui"],[class*="popup"],[id*="popup"],[class*="Popup"],[class*="cookie"],[id*="cookie"],[class*="consent"],[id*="consent"],[id*="shopify-chat"],[class*="chat-widget"],iframe[title*="chat" i],iframe[id*="launcher"]';
    document.querySelectorAll(sel).forEach(el => {
      if (safe(el)) return;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || el.matches('[role="dialog"],[aria-modal="true"],iframe') || el.closest('[style*="position: fixed"]')) hide(el);
    });
    // Other fixed layers covering a big part of the screen (overlays, backdrops)
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position !== 'fixed' || safe(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > W * H * 0.25) hide(el);
    }
    for (const el of [document.documentElement, document.body]) el.style.setProperty('overflow', 'visible', 'important');
  }, { W, H });
}

async function capture(file, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
    if (BLOCKED.test(await page.title()) || BLOCKED.test(await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || ''))) {
      throw new Error('site showed a bot check');
    }
    for (const name of CONSENT) {
      const btn = page.getByRole('button', { name, exact: true }).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) { await btn.click({ timeout: 1500 }).catch(() => {}); break; }
    }
    // Scroll down slowly so lazy images load, then back to the top
    for (let y = 0; y <= SHOT_H; y += 400) { await page.mouse.wheel(0, 400); await page.waitForTimeout(250); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape').catch(() => {});
    await hideOverlays(page);
    await page.waitForTimeout(2500); // let hero animations and sliders settle
    await hideOverlays(page);
    const height = Math.min(SHOT_H, await page.evaluate(() => document.documentElement.scrollHeight));
    await page.screenshot({ path: file, type: 'jpeg', quality: 72, fullPage: true,
      clip: { x: 0, y: 0, width: W, height: Math.max(H, height) }, timeout: 15000 });
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
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      const limit = new Promise((_, rej) => setTimeout(() => rej(new Error('took longer than 90s')), 90000));
      try { await Promise.race([capture(file, url), limit]); done = true; ok++; console.log('ok  ', url); }
      catch (e) {
        console.log(attempt === 1 && !/bot check/.test(e.message) ? 'retry' : 'FAIL', url, String(e.message).split('\n')[0]);
        if (/bot check/.test(e.message)) { rmSync(file, { force: true }); break; }
      }
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
await browser.close();
console.log(`${ok}/${jobs.size} screenshots saved`);
process.exit(0);
