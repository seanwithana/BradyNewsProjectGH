/**
 * Gotham City Research scraper worker — Wix SPA, requires puppeteer.
 * Scrapes listing page directly and fetches full article text.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const POLL_INTERVAL = 5000;
let browser = null;
let listingPage = null;
let running = true;

async function init() {
  try {
    send({ type: 'status', status: 'connecting', message: 'Launching headless browser...' });
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run']
    });
    listingPage = await browser.newPage();
    send({ type: 'status', status: 'connecting', message: 'Loading Gotham City Research...' });
    await listingPage.goto('https://www.gothamcityresearch.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    // Click TOS agree button
    await listingPage.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const a of links) { if (a.textContent.includes('agree')) { a.click(); break; } }
    });
    await new Promise(r => setTimeout(r, 5000));
    await listingPage.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
    send({ type: 'status', status: 'connected', message: 'Page loaded, polling started' });
    poll();
  } catch (e) {
    send({ type: 'status', status: 'error', message: 'Init failed: ' + e.message });
    setTimeout(init, 30000);
  }
}

async function poll() {
  if (!running || !listingPage) return;
  try {
    await listingPage.reload({ waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    // Get report links from listing page
    const listings = await listingPage.evaluate(() => {
      const links = document.querySelectorAll('a');
      return Array.from(links).map(a => ({
        url: a.href,
        title: a.textContent.trim()
      })).filter(i => i.title.length > 15 && i.url.includes('gothamcityresearch.com/post/'));
    });

    if (listings.length > 0) {
      // Fetch full text of the newest report
      const newest = listings[0];
      let articleText = '';
      try {
        const articlePage = await browser.newPage();
        await articlePage.goto(newest.url, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
        articleText = await articlePage.evaluate(() => {
          const article = document.querySelector('[data-hook="post-description"]') || document.querySelector('article');
          return article ? article.innerText.trim() : '';
        });
        await articlePage.close();
      } catch (e) { /* use title only */ }

      const items = listings.map((l, i) => ({
        url: l.url,
        title: l.title,
        text: i === 0 && articleText ? articleText : l.title,
        date: new Date().toISOString()
      }));

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
