/**
 * CFTC Commitments of Traders scraper worker — Cloudflare blocked, requires puppeteer.
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
    send({ type: 'status', status: 'connecting', message: 'Loading CFTC COT...' });
    await page.goto('https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm', { waitUntil: 'networkidle2', timeout: 30000 });
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

    const result = await page.evaluate(() => {
      const text = document.body.innerText;
      const dateMatch = text.match(/Reports Dated\s+([\w\s,]+\d{4})/i);
      const date = dateMatch ? dateMatch[1].trim() : '';
      return { date };
    });

    if (result.date) {
      send({ type: 'status', status: 'connected', message: `Polling OK — ${result.date}` });
      send({ type: 'items', items: [{
        url: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm',
        title: 'CFTC Commitments of Traders — Reports Dated ' + result.date,
        text: 'CFTC COT weekly position data released. Reports Dated ' + result.date + '. Includes Agriculture, Petroleum, Financial, and other commodity positions by commercial/speculator categories.',
        date: new Date().toISOString()
      }] });
    } else {
      send({ type: 'status', status: 'error', message: 'Report date not found' });
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
