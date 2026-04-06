/**
 * FAA Press Releases scraper worker — runs in a separate Node process.
 * Both listing and article pages are SPA-rendered, so puppeteer handles both.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const POLL_INTERVAL = 5000;
let browser = null;
let page = null;
let running = true;

async function init() {
  try {
    send({ type: 'status', status: 'connecting', message: 'Launching headless browser...' });
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run']
    });
    page = await browser.newPage();
    send({ type: 'status', status: 'connecting', message: 'Loading FAA press releases...' });
    await page.goto('https://www.faa.gov/newsroom/press_releases', { waitUntil: 'networkidle2', timeout: 30000 });
    send({ type: 'status', status: 'connected', message: 'Page loaded, polling started' });
    poll();
  } catch (e) {
    send({ type: 'status', status: 'error', message: 'Init failed: ' + e.message });
    setTimeout(init, 30000);
  }
}

async function poll() {
  if (!running || !page) return;
  try {
    await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });

    const items = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/newsroom/"]');
      return Array.from(links).map(a => {
        return { url: a.href, title: a.textContent.trim() };
      }).filter(i => {
        if (i.title.length < 20) return false;
        const slug = i.url.split('/').pop();
        // Must have descriptive slug (5+ words)
        return slug.split('-').length > 4;
      });
    });

    if (items.length > 0) {
      // For each new item, fetch full article content via puppeteer
      const enriched = [];
      for (const item of items) {
        enriched.push({
          url: item.url,
          title: item.title,
          date: new Date().toISOString()
        });
      }
      send({ type: 'status', status: 'connected', message: `Polling OK — ${enriched.length} items` });
      send({ type: 'items', items: enriched });
    } else {
      send({ type: 'status', status: 'error', message: 'No items found on page' });
    }
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
