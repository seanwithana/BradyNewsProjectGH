/**
 * WHO Newsroom scraper worker — fully SPA, requires puppeteer.
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
    send({ type: 'status', status: 'connecting', message: 'Loading WHO news...' });
    await page.goto('https://www.who.int/news', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
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
    await new Promise(r => setTimeout(r, 2000));

    const items = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/news/item/"]');
      return Array.from(links).map(a => ({
        url: a.href,
        title: a.textContent.trim()
      })).filter(i => i.title.length > 15 && !i.title.match(/^\d+ \w+ \d{4}$/));
    });

    if (items.length > 0) {
      // Deduplicate
      const unique = [];
      for (const i of items) {
        if (!unique.find(u => u.url === i.url)) unique.push(i);
      }
      send({ type: 'status', status: 'connected', message: `Polling OK — ${unique.length} items` });
      send({ type: 'items', items: unique.map(i => ({ ...i, date: new Date().toISOString() })) });
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
