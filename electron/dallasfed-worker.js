/**
 * Dallas Fed Manufacturing Survey worker — SPA, requires puppeteer.
 * Listing page has monthly links, follows to the latest report.
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
    send({ type: 'status', status: 'connecting', message: 'Loading Dallas Fed...' });
    await page.goto('https://www.dallasfed.org/research/surveys/tmos', { waitUntil: 'networkidle2', timeout: 30000 });
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

    // Find the latest monthly report link
    const reportUrl = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/research/surveys/tmos/"]');
      const monthly = Array.from(links).filter(a => a.href.match(/\/tmos\/\d{4}\/\d{4}$/));
      return monthly.length > 0 ? monthly[monthly.length - 1].href : null;
    });

    if (reportUrl) {
      // Navigate to the latest report
      const reportPage = await browser.newPage();
      await reportPage.goto(reportUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 2000));

      const text = await reportPage.evaluate(() => {
        const body = document.body.innerText.trim();
        const idx = body.search(/Texas manufacturing|Texas factory|Growth in|Decline in/i);
        return idx > -1 ? body.substring(idx, idx + 5000) : body.substring(0, 3000);
      });
      await reportPage.close();

      if (text.length > 100) {
        const title = text.split('\n').find(l => l.trim().length > 20) || 'Dallas Fed Manufacturing Survey';
        send({ type: 'status', status: 'connected', message: 'Polling OK' });
        send({ type: 'items', items: [{
          url: reportUrl,
          title: title.trim().substring(0, 150),
          text: text,
          date: new Date().toISOString()
        }] });
      }
    } else {
      send({ type: 'status', status: 'error', message: 'No report link found' });
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
