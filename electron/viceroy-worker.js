/**
 * Viceroy Research scraper worker — runs in a separate Node process.
 * Needs puppeteer to click disclaimer modal and extract report content.
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
    send({ type: 'status', status: 'connecting', message: 'Loading Viceroy Research...' });
    await page.goto('https://viceroyresearch.org/', { waitUntil: 'networkidle2', timeout: 30000 });
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

    // Get publication links
    const listings = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/publications/"]');
      return Array.from(links).map(a => ({
        url: a.href,
        title: a.textContent.trim()
      })).filter(i => i.title.length > 10);
    });

    if (listings.length > 0) {
      // Fetch full content of the newest report
      const newest = listings[0];
      let articleText = '';
      try {
        const articlePage = await browser.newPage();
        await articlePage.goto(newest.url, { waitUntil: 'networkidle2', timeout: 20000 });

        // Click disclaimer
        await articlePage.evaluate(() => {
          const modal = document.querySelector('[x-show="showModal"]');
          if (modal) {
            const btns = modal.querySelectorAll('button, a');
            for (const btn of btns) {
              if (btn.textContent.toLowerCase().includes('accept')) { btn.click(); break; }
            }
          }
        });
        await new Promise(r => setTimeout(r, 3000));

        articleText = await articlePage.evaluate(() => {
          return document.body.innerText.trim();
        });
        // Clean — remove disclaimer text
        const reportIdx = articleText.indexOf(listings[0].title.substring(0, 20));
        if (reportIdx > -1) articleText = articleText.substring(reportIdx);
        articleText = articleText.substring(0, 5000);

        await articlePage.close();
      } catch (e) {
        // Article fetch failed — use title only
      }

      const items = listings.map((l, i) => ({
        url: l.url,
        title: l.title,
        text: i === 0 && articleText ? articleText : l.title,
        date: new Date().toISOString()
      }));

      send({ type: 'status', status: 'connected', message: `Polling OK — ${items.length} items` });
      send({ type: 'items', items });
    } else {
      send({ type: 'status', status: 'error', message: 'No publications found' });
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
