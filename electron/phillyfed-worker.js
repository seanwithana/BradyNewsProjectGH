/**
 * Philly Fed Manufacturing Survey worker — View Full Report button is JS-rendered.
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
    send({ type: 'status', status: 'connecting', message: 'Loading Philly Fed...' });
    await page.goto('https://www.philadelphiafed.org/surveys-and-data/regional-economic-analysis/manufacturing-business-outlook-survey', { waitUntil: 'networkidle2', timeout: 30000 });
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

    // Find the View Full Report link
    const reportLink = await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const a of links) {
        if (a.textContent.includes('View the Full Report') || a.href.includes('mbos-20')) {
          return a.href;
        }
      }
      return null;
    });

    if (reportLink) {
      // Fetch the full report page
      const reportPage = await browser.newPage();
      await reportPage.goto(reportLink, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 2000));

      const text = await reportPage.evaluate(() => {
        const main = document.querySelector('main') || document.querySelector('article') || document.body;
        return main.innerText.trim();
      });
      await reportPage.close();

      if (text.length > 100) {
        // Extract title from first line
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        const title = lines.find(l => l.includes('Survey') || l.includes('Report')) || 'Philly Fed Manufacturing Survey';

        send({ type: 'status', status: 'connected', message: 'Polling OK — report found' });
        send({ type: 'items', items: [{
          url: reportLink,
          title: title.trim(),
          text: text.substring(0, 5000),
          date: new Date().toISOString()
        }] });
      } else {
        send({ type: 'status', status: 'error', message: 'Report page empty' });
      }
    } else {
      send({ type: 'status', status: 'error', message: 'View Full Report link not found' });
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
