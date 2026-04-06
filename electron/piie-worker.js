/**
 * Peterson Institute (PIIE) scraper worker — article pages have Cloudflare.
 * Listing page works with direct HTTP but articles need puppeteer.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');
puppeteer.use(StealthPlugin());

const POLL_INTERVAL = 5000;
let browser = null;
let running = true;

function fetchListing() {
  return new Promise((resolve, reject) => {
    https.get('https://www.piie.com/blogs', { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Encoding': 'identity' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        // Only match blog links inside teaser__title elements (skip menu/nav links)
        const regex = /class="teaser__title"[^>]*>[\s\S]*?<a[^>]*href="(\/blogs\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const items = [];
        let m;
        while ((m = regex.exec(d)) !== null) {
          const title = m[2].replace(/<[^>]+>/g, '').trim();
          if (title.length > 15 && !items.find(i => i.url === m[1]))
            items.push({ url: 'https://www.piie.com' + m[1], title });
        }
        resolve(items);
      });
    }).on('error', reject);
  });
}

async function init() {
  try {
    send({ type: 'status', status: 'connecting', message: 'Launching headless browser...' });
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run']
    });
    send({ type: 'status', status: 'connected', message: 'Browser ready, polling started' });
    poll();
  } catch (e) {
    send({ type: 'status', status: 'error', message: 'Init failed: ' + e.message });
    setTimeout(init, 30000);
  }
}

async function poll() {
  if (!running) return;
  try {
    const listings = await fetchListing();

    if (listings.length > 0) {
      // Fetch newest article via puppeteer
      let articleText = '';
      try {
        const page = await browser.newPage();
        await page.goto(listings[0].url, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
        articleText = await page.evaluate(() => {
          const article = document.querySelector('article') || document.querySelector('main') || document.body;
          return article.innerText.trim();
        });
        await page.close();
      } catch (e) { /* use title only */ }

      const items = listings.map((l, i) => ({
        url: l.url,
        title: l.title,
        text: i === 0 && articleText ? articleText.substring(0, 5000) : l.title,
        date: new Date().toISOString()
      }));

      send({ type: 'status', status: 'connected', message: `Polling OK — ${items.length} items` });
      send({ type: 'items', items });
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
