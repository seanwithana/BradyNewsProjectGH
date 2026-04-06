/**
 * Wolfpack Research scraper worker — Wix SPA, requires puppeteer.
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
    send({ type: 'status', status: 'connecting', message: 'Loading Wolfpack Research...' });
    await page.goto('https://www.wolfpackresearch.com/items', { waitUntil: 'networkidle2', timeout: 30000 });
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
      const readMoreLinks = document.querySelectorAll('a[href*="/items/"]');
      return Array.from(readMoreLinks).map(a => {
        const container = a.closest('div[class]')?.parentElement || a.parentElement;
        const allText = container ? container.innerText.trim() : '';
        const titleEnd = allText.indexOf('Wolfpack Is') !== -1 ? allText.indexOf('Wolfpack Is') : (allText.indexOf('Read More') !== -1 ? allText.indexOf('Read More') : allText.length);
        const title = allText.substring(0, Math.min(titleEnd, 200)).trim();
        return { url: a.href, title };
      }).filter(i => i.title.length > 10 && i.url.includes('/items/'));
    });

    if (items.length > 0) {
      send({ type: 'status', status: 'connected', message: `Polling OK — ${items.length} items` });
      send({ type: 'items', items: items.map(i => ({ ...i, date: new Date().toISOString() })) });
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
