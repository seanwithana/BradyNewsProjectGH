/**
 * Starboard Value scraper worker — JS-rendered presentations page.
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
    send({ type: 'status', status: 'connecting', message: 'Loading Starboard Value...' });
    await page.goto('https://www.starboardvalue.com/presentations/', { waitUntil: 'networkidle2', timeout: 30000 });
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
      const links = document.querySelectorAll('a[href*="wp-content/uploads"]');
      return Array.from(links).map(a => {
        const container = a.closest('div, li');
        const dateEl = container ? container.querySelector('time, .date, span') : null;
        // Get the date text from nearby elements
        const nextSibling = a.parentElement?.nextElementSibling;
        const dateText = dateEl ? dateEl.textContent.trim() : (nextSibling ? nextSibling.textContent.trim() : '');
        return {
          url: a.href,
          title: a.textContent.trim(),
          date: dateText
        };
      }).filter(i => i.title.length > 15);
    });

    if (items.length > 0) {
      send({ type: 'status', status: 'connected', message: `Polling OK — ${items.length} items` });
      send({ type: 'items', items: items.map(i => ({
        url: i.url,
        title: i.title + (i.date ? ' (' + i.date + ')' : ''),
        text: i.title + (i.date ? '\nDate: ' + i.date : '') + '\n\nPresentation PDF: ' + i.url,
        date: new Date().toISOString()
      })) });
    } else {
      send({ type: 'status', status: 'error', message: 'No items found' });
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
