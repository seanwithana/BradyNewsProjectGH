/**
 * EPA News Releases scraper worker — runs in a separate Node process.
 * Uses puppeteer-extra with stealth plugin to render the SPA search page.
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
    send({ type: 'status', status: 'connecting', message: 'Loading EPA search page...' });
    await page.goto('https://www.epa.gov/newsreleases/search', { waitUntil: 'networkidle2', timeout: 30000 });
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
    // Reload to get fresh results
    await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });

    const items = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/newsreleases/"]');
      return Array.from(links).map(a => {
        const dateEl = a.closest('li, article, .views-row, div')?.querySelector('time, .date, [datetime]');
        return {
          url: a.href,
          title: a.textContent.trim(),
          date: dateEl ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim()) : ''
        };
      }).filter(i => i.title.length > 15 && !i.url.includes('/search') && i.url.includes('/newsreleases/'));
    });

    if (items.length > 0) {
      send({ type: 'status', status: 'connected', message: `Polling OK — ${items.length} items` });
      send({ type: 'items', items });
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
