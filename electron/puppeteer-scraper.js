const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const LOG_PATH = path.join(__dirname, '..', 'data', 'scrapers.log');

/**
 * Scraper for SPA sites that require puppeteer to render the listing page.
 * Runs a worker script in a separate Node process.
 * Article pages are fetched with plain HTTP (no puppeteer needed).
 */
class PuppeteerScraper {
  constructor({ name, key, workerPath, parseArticleFn, sourceUrl, interval }) {
    this.name = name;
    this.key = key;
    this.workerPath = workerPath;
    this.parseArticleFn = parseArticleFn || null;
    this.sourceUrl = sourceUrl;
    this.interval = interval || 5000;
    this.running = false;
    this.child = null;
    this.seenIds = new Set();
    this.status = 'not started';
    this.statusMessage = '';
    this.lastSuccessAt = null;
    this.lastErrorAt = null;
    this.lastErrorMessage = '';
    this.itemsFetched = 0;
    this.pollCount = 0;
    this.errorCount = 0;
    this.latestItems = [];
    this.onNewItems = null;
  }

  log(msg) {
    const line = `[${new Date().toISOString()}] [${this.key}] ${msg}\n`;
    try { fs.appendFileSync(LOG_PATH, line); } catch {}
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.status = 'connecting';
    this.statusMessage = 'Launching worker...';
    this.log('Scraper started');

    this.child = spawn('node', [this.workerPath], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    this.child.on('message', (msg) => {
      if (msg.type === 'status') {
        this.status = msg.status;
        this.statusMessage = msg.message;
        this.pollCount++;
        if (msg.status === 'connected') {
          this.lastSuccessAt = new Date().toISOString();
        } else if (msg.status === 'error') {
          this.errorCount++;
          this.lastErrorAt = new Date().toISOString();
          this.lastErrorMessage = msg.message;
          this.log(`Error: ${msg.message}`);
        }
      } else if (msg.type === 'items') {
        this.processItems(msg.items, msg.sourceKey);
      }
    });

    this.child.on('exit', (code) => {
      this.log(`Worker exited with code ${code}`);
      this.child = null;
      if (this.running) {
        this.status = 'error';
        this.statusMessage = `Worker exited (${code}), restarting in 30s...`;
        setTimeout(() => { if (this.running) this.start(); }, 30000);
      }
    });

    this.child.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('DevTools') && !msg.includes('GPU') && !msg.includes('sandbox') && !msg.includes('Fontconfig')) {
        this.log(`Worker stderr: ${msg.substring(0, 200)}`);
      }
    });
  }

  stop() {
    this.running = false;
    if (this.child) {
      try { this.child.send('quit'); } catch {}
      setTimeout(() => { if (this.child) try { this.child.kill(); } catch {} }, 5000);
    }
    this.log('Scraper stopped');
  }

  async processItems(items, overrideKey) {
    if (!Array.isArray(items)) return;
    const newItems = items.filter(i => {
      if (!i.url || this.seenIds.has(i.url)) return false;
      this.seenIds.add(i.url);
      return true;
    });
    if (this.seenIds.size > 500) {
      this.seenIds = new Set(items.map(i => i.url));
    }

    // Store latest for health display
    if (items.length > 0) {
      this.latestItems = items.slice(0, 5).map(i => ({ title: i.title, url: i.url, timestamp: i.date || new Date().toISOString() }));
    }

    if (newItems.length > 0) {
      this.itemsFetched += newItems.length;
      this.log(`${newItems.length} new item(s)`);

      // Fetch article content for new items if parseArticleFn is set
      if (this.parseArticleFn && this.onNewItems) {
        const enriched = [];
        for (const item of newItems) {
          try {
            const html = await this.fetchPage(item.url);
            const articleText = this.parseArticleFn(html);
            enriched.push({
              id: item.url,
              title: item.title,
              text: articleText ? item.title + '\n\n' + articleText : item.title,
              url: item.url,
              timestamp: item.date || new Date().toISOString()
            });
          } catch (e) {
            enriched.push({ id: item.url, title: item.title, text: item.title, url: item.url, timestamp: item.date || new Date().toISOString() });
          }
        }
        this.onNewItems(enriched, overrideKey || this.key, this.name);
      } else if (this.onNewItems) {
        this.onNewItems(newItems.map(i => ({ id: i.url, title: i.title, text: i.text || i.title, url: i.url, timestamp: i.date || new Date().toISOString() })), overrideKey || this.key, this.name);
      }
    }
  }

  fetchPage(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Encoding': 'identity', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (loc.startsWith('/')) loc = new URL(loc, url).href;
          res.resume();
          return this.fetchPage(loc).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  getStatus() {
    return {
      source: this.name,
      sourceKey: this.key,
      sourceUrl: this.sourceUrl,
      status: this.status,
      message: this.statusMessage,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      itemsFetched: this.itemsFetched,
      pollCount: this.pollCount,
      errorCount: this.errorCount,
      latestItems: this.latestItems
    };
  }
}

module.exports = PuppeteerScraper;
