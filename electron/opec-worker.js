/**
 * OPEC Press Releases scraper worker — 403 blocked, SPA, requires puppeteer.
 * Listing page has "Read more" buttons linking to /pr-detail/ article pages.
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
    send({ type: 'status', status: 'connecting', message: 'Loading OPEC press releases...' });
    await page.goto('https://www.opec.org/press-releases.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
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
    await new Promise(r => setTimeout(r, 3000));

    // Get "Read more" links with their parent context for the title
    const items = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/pr-detail/"]');
      return Array.from(links).map(a => {
        const container = a.closest('div, li, article');
        const contextText = container ? container.innerText.trim() : '';
        // Title is the text before "Read more" in the container
        const titleEnd = contextText.indexOf('Read more');
        const title = titleEnd > -1 ? contextText.substring(0, titleEnd).trim() : contextText.substring(0, 150);
        return { url: a.href, title };
      }).filter(i => i.title.length > 15);
    });

    if (items.length > 0) {
      // Fetch the newest article's full content
      let newestText = '';
      try {
        const articlePage = await browser.newPage();
        await articlePage.goto(items[0].url, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
        newestText = await articlePage.evaluate(() => {
          const main = document.querySelector('main') || document.querySelector('article') || document.body;
          return main.innerText.trim();
        });
        await articlePage.close();
      } catch (e) { /* use title only */ }

      const enriched = items.map((item, i) => ({
        url: item.url,
        title: item.title,
        text: i === 0 && newestText ? newestText : item.title,
        date: new Date().toISOString()
      }));

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
