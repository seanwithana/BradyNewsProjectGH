/**
 * BLS scraper worker — monitors CPI, Employment, and PPI release pages.
 * These are single-page releases that update monthly. Detects new data by content hash.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const crypto = require('crypto');
puppeteer.use(StealthPlugin());

const POLL_INTERVAL = 5000;
const PAGES = [
  { url: 'https://www.bls.gov/news.release/cpi.htm', key: 'bls_cpi', name: 'BLS CPI Release' },
  { url: 'https://www.bls.gov/news.release/empsit.nr0.htm', key: 'bls_nfp', name: 'BLS Employment Situation' },
  { url: 'https://www.bls.gov/news.release/ppi.htm', key: 'bls_ppi', name: 'BLS PPI Release' },
];

let browser = null;
let page = null;
let running = true;
let lastHashes = {};

async function init() {
  try {
    send({ type: 'status', status: 'connecting', message: 'Launching headless browser...' });
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run']
    });
    page = await browser.newPage();
    send({ type: 'status', status: 'connected', message: 'Browser ready, polling started' });
    poll();
  } catch (e) {
    send({ type: 'status', status: 'error', message: 'Init failed: ' + e.message });
    setTimeout(init, 30000);
  }
}

async function poll() {
  if (!running || !page) return;
  try {
    for (const pg of PAGES) {
      if (!running) return;
      await page.goto(pg.url, { waitUntil: 'networkidle2', timeout: 20000 });
      const text = await page.evaluate(() => {
        const main = document.querySelector('#main-content') || document.body;
        return main.innerText.trim().substring(0, 5000);
      });

      const hash = crypto.createHash('md5').update(text).digest('hex');
      if (lastHashes[pg.key] && lastHashes[pg.key] !== hash) {
        // Content changed — new release
        send({ type: 'items', sourceKey: pg.key, items: [{
          url: pg.url,
          title: pg.name + ' — Updated',
          text: text.substring(0, 3000),
          date: new Date().toISOString()
        }] });
      } else if (!lastHashes[pg.key]) {
        // First poll — send current content
        send({ type: 'items', sourceKey: pg.key, items: [{
          url: pg.url,
          title: pg.name,
          text: text.substring(0, 3000),
          date: new Date().toISOString()
        }] });
      }
      lastHashes[pg.key] = hash;
    }
    send({ type: 'status', status: 'connected', message: `Polling OK — ${PAGES.length} pages monitored` });
  } catch (e) {
    send({ type: 'status', status: 'error', message: e.message });
  }
  setTimeout(poll, POLL_INTERVAL);
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
