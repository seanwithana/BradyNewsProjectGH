/**
 * Atlanta Fed GDPNow scraper worker — SPA, estimate is JS-rendered.
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
    send({ type: 'status', status: 'connecting', message: 'Loading Atlanta Fed GDPNow...' });
    await page.goto('https://www.atlantafed.org/research-and-data/data/gdpnow', { waitUntil: 'networkidle2', timeout: 30000 });
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

    const result = await page.evaluate(() => {
      const text = document.body.innerText;
      // Find the estimate percentage
      const lines = text.split('\n').filter(l => l.trim().match(/^-?\d+\.?\d*%$/));
      const estimate = lines.length > 0 ? lines[0].trim() : null;
      // Find the date
      const dateMatch = text.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})/);
      const date = dateMatch ? dateMatch[1] : '';
      // Find next update
      const nextMatch = text.match(/Next update:\s*([\w\s,]+\d{4})/);
      const next = nextMatch ? nextMatch[1].trim() : '';
      return { estimate, date, next };
    });

    if (result.estimate) {
      const title = `GDPNow Estimate: ${result.estimate} (${result.date})`;
      const text = `Atlanta Fed GDPNow model estimate of real GDP growth: ${result.estimate}\nAs of: ${result.date}\nNext update: ${result.next}`;
      send({ type: 'status', status: 'connected', message: `Polling OK — ${result.estimate}` });
      send({ type: 'items', items: [{
        url: 'https://www.atlantafed.org/research-and-data/data/gdpnow',
        title, text, date: new Date().toISOString()
      }] });
    } else {
      send({ type: 'status', status: 'error', message: 'Estimate not found on page' });
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
