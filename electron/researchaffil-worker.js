/**
 * Research Affiliates scraper worker — SPA, requires puppeteer.
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
    send({ type: 'status', status: 'connecting', message: 'Loading Research Affiliates...' });
    await page.goto('https://www.researchaffiliates.com/insights/publications', { waitUntil: 'networkidle2', timeout: 30000 });
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

    const items = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/publications/articles/"]');
      return Array.from(links).map(a => ({
        url: a.href,
        title: a.textContent.trim()
      })).filter(i => i.title.length > 15);
    });

    if (items.length > 0) {
      // Fetch newest article
      let articleText = '';
      try {
        const articlePage = await browser.newPage();
        await articlePage.goto(items[0].url, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
        articleText = await articlePage.evaluate(() => {
          const main = document.querySelector('main') || document.body;
          const text = main.innerText.trim();
          // Find content after "Key Points" or after the byline
          const idx = text.indexOf('Key Points');
          return idx > -1 ? text.substring(idx) : text;
        });
        await articlePage.close();
      } catch (e) { /* use title only */ }

      const enriched = items.map((item, i) => ({
        url: item.url,
        title: item.title,
        text: i === 0 && articleText ? articleText.substring(0, 5000) : item.title,
        date: new Date().toISOString()
      }));

      send({ type: 'status', status: 'connected', message: `Polling OK — ${enriched.length} items` });
      send({ type: 'items', items: enriched });
    } else {
      send({ type: 'status', status: 'error', message: 'No articles found' });
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
