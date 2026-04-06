/**
 * Kerrisdale Capital scraper worker — 403 blocked, requires puppeteer.
 * Reports are JS-rendered. Extracts titles with tickers.
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
    send({ type: 'status', status: 'connecting', message: 'Loading Kerrisdale Capital...' });
    await page.goto('https://www.kerrisdalecap.com/blog', { waitUntil: 'networkidle2', timeout: 30000 });
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

    // Extract report entries from page text
    const text = await page.evaluate(() => document.body.innerText.trim());

    // Parse entries: "Company (TICKER)\nThesis Title\nMONTH\nDD\nYYYY"
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const items = [];
    for (let i = 0; i < lines.length - 3; i++) {
      // Look for ticker pattern: "Company (TICKER)"
      const tickerMatch = lines[i].match(/^(.+)\s*\(([A-Z]{1,5}(?::[A-Z]+)?)\)\s*$/);
      if (tickerMatch && lines[i + 1] && lines[i + 2] && lines[i + 3]) {
        const company = tickerMatch[1].trim();
        const ticker = tickerMatch[2];
        const thesis = lines[i + 1];
        const month = lines[i + 2];
        const day = lines[i + 3];
        const year = lines[i + 4] || '';
        const date = `${month} ${day}, ${year}`.trim();
        const title = `${company} (${ticker}): ${thesis}`;
        items.push({
          url: 'https://www.kerrisdalecap.com/blog',
          title,
          text: `${title}\nDate: ${date}`,
          date: new Date().toISOString()
        });
      }
    }

    if (items.length > 0) {
      send({ type: 'status', status: 'connected', message: `Polling OK — ${items.length} items` });
      send({ type: 'items', items });
    } else {
      send({ type: 'status', status: 'error', message: 'No items parsed from page' });
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
