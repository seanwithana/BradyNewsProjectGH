/**
 * Truth Social scraper worker — runs in a separate Node process.
 * Uses puppeteer-extra with stealth plugin to bypass Cloudflare.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const ACCOUNT_ID = '107780257626128497';
const POLL_INTERVAL = 15000;  // 15 seconds
const BACKOFF_INTERVAL = 60000;

let browser = null;
let page = null;
let running = true;

async function init() {
  try {
    send({ type: 'status', status: 'connecting', message: 'Launching headless browser...' });

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
             '--disable-extensions', '--no-first-run', '--disable-default-apps']
    });
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    send({ type: 'status', status: 'connecting', message: 'Loading Truth Social...' });
    await page.goto('https://truthsocial.com/@realDonaldTrump', { waitUntil: 'networkidle2', timeout: 30000 });

    send({ type: 'status', status: 'connected', message: 'Cloudflare session ready' });
    poll();
  } catch (e) {
    send({ type: 'status', status: 'error', message: 'Init failed: ' + e.message });
    setTimeout(init, 30000);
  }
}

async function poll() {
  if (!running || !page) return;

  try {
    const url = `https://truthsocial.com/api/v1/accounts/${ACCOUNT_ID}/statuses?limit=20&exclude_replies=true`;
    const result = await page.evaluate(async (fetchUrl) => {
      try {
        const r = await fetch(fetchUrl, { headers: { 'Accept': 'application/json' } });
        if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
        const data = await r.json();
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, url);

    if (result.ok) {
      send({ type: 'status', status: 'connected', message: 'Polling OK' });
      send({ type: 'posts', posts: result.data });
      setTimeout(poll, POLL_INTERVAL);
    } else {
      send({ type: 'status', status: 'error', message: result.error });
      setTimeout(poll, result.error.includes('429') ? BACKOFF_INTERVAL : POLL_INTERVAL);
    }
  } catch (e) {
    send({ type: 'status', status: 'error', message: e.message });
    setTimeout(poll, POLL_INTERVAL);
  }
}

function send(msg) {
  try { process.send(msg); } catch {}
}

process.on('message', async (msg) => {
  if (msg === 'quit') {
    running = false;
    if (browser) await browser.close();
    process.exit(0);
  }
});

init();
