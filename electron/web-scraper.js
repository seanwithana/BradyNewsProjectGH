const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { getBrowserFetcher } = require('./browser-fetcher');

const LOG_PATH = path.join(__dirname, '..', 'data', 'scrapers.log');

/**
 * Base web scraper class. Each source extends this with a custom parse function.
 * Handles polling, deduplication, health tracking, and keyword engine integration.
 */
class WebScraper {
  constructor({ name, key, url, interval, parseFn, parseArticleFn, headers, followRedirects }) {
    this.name = name;
    this.key = key;           // unique source key for keyword engine (e.g. 'fda', 'sec')
    this.url = url;
    this.interval = interval || 5000;
    this.parseFn = parseFn;   // (html, url) => [{ id, title, text, url, timestamp }]
    this.parseArticleFn = parseArticleFn || null; // (html, url) => string (full article text)
    this.customHeaders = headers || {};
    this.followRedirects = followRedirects !== false;

    this.running = false;
    this.seenIds = new Set();
    this.status = 'not started';
    this.statusMessage = '';
    this.lastSuccessAt = null;
    this.lastErrorAt = null;
    this.lastErrorMessage = '';
    this.itemsFetched = 0;
    this.pollCount = 0;
    this.errorCount = 0;
    this.onNewItems = null; // set by manager
    this.useBrowser = false; // auto-set to true after first 403
    this.latestItems = [];   // last few items scraped
  }

  log(msg) {
    const line = `[${new Date().toISOString()}] [${this.key}] ${msg}\n`;
    try { fs.appendFileSync(LOG_PATH, line); } catch {}
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.status = 'connecting';
    this.statusMessage = 'Starting...';
    this.log('Scraper started');
    // Stagger first poll randomly 0-5s to avoid thundering herd
    const jitter = Math.floor(Math.random() * 5000);
    setTimeout(() => this.poll(), jitter);
  }

  stop() {
    this.running = false;
    this.log('Scraper stopped');
  }

  scheduleNext(delay) {
    if (!this.running) return;
    setTimeout(() => this.poll(), delay || this.interval);
  }

  poll() {
    if (!this.running) return;
    this.pollCount++;

    const fetchFn = this.useBrowser
      ? getBrowserFetcher().fetch(this.url)
      : this.fetchPage(this.url);

    fetchFn.then(html => {
      if (!html) {
        this.recordError('Empty response');
        this.scheduleNext();
        return;
      }
      try {
        const items = this.parseFn(html, this.url);
        if (!items || !Array.isArray(items)) {
          this.recordError('Parser returned invalid data');
          this.scheduleNext();
          return;
        }
        this.status = 'connected';
        this.statusMessage = `OK — ${items.length} items parsed` + (this.useBrowser ? ' (browser)' : '');
        this.lastSuccessAt = new Date().toISOString();

        // Deduplicate
        const newItems = items.filter(item => {
          if (!item.id) return false;
          if (this.seenIds.has(item.id)) return false;
          this.seenIds.add(item.id);
          return true;
        });

        // Cap seenIds
        if (this.seenIds.size > 500) {
          const keep = new Set(items.map(i => i.id).filter(Boolean));
          this.seenIds = keep;
        }

        // Store latest items for health display
        if (items.length > 0) {
          this.latestItems = items.slice(0, 5).map(i => ({ title: i.title, url: i.url, timestamp: i.timestamp }));
        }

        if (newItems.length > 0) {
          this.itemsFetched += newItems.length;
          this.log(`${newItems.length} new item(s)`);
          // Fetch full article content for new items if parseArticleFn is defined
          if (this.parseArticleFn && this.onNewItems) {
            this.fetchArticles(newItems).then(enriched => {
              this.onNewItems(enriched, this.key, this.name);
            });
          } else if (this.onNewItems) {
            this.onNewItems(newItems, this.key, this.name);
          }
        }
        this.scheduleNext();
      } catch (e) {
        this.recordError(`Parse error: ${e.message}`);
        this.scheduleNext();
      }
    }).catch(e => {
      // On 403, switch to browser fetcher for all future polls
      if (e.message && e.message.includes('403') && !this.useBrowser) {
        this.useBrowser = true;
        this.log('Cloudflare detected — switching to browser fetcher');
        this.scheduleNext(2000); // retry quickly with browser
        return;
      }
      this.recordError(e.message + (this.useBrowser ? ' (browser)' : ''));
      if (e.message && (e.message.includes('429') || e.message.includes('403'))) {
        this.scheduleNext(Math.max(this.interval * 3, 30000));
      } else {
        this.scheduleNext();
      }
    });
  }

  async fetchArticles(items) {
    const enriched = [];
    for (const item of items) {
      if (!item.url) { enriched.push(item); continue; }
      try {
        const html = this.useBrowser
          ? await getBrowserFetcher().fetch(item.url)
          : await this.fetchPage(item.url);
        if (html) {
          const articleText = this.parseArticleFn(html, item.url);
          if (articleText && articleText.length > 0) {
            enriched.push({ ...item, text: item.title + '\n\n' + articleText });
            this.log(`Fetched article: ${item.title.substring(0, 60)}`);
          } else {
            enriched.push(item);
          }
        } else {
          enriched.push(item);
        }
      } catch (e) {
        this.log(`Article fetch failed for ${item.url}: ${e.message}`);
        enriched.push(item); // still pass through with just the title
      }
    }
    return enriched;
  }

  recordError(msg) {
    this.errorCount++;
    this.status = 'error';
    this.statusMessage = msg;
    this.lastErrorAt = new Date().toISOString();
    this.lastErrorMessage = msg;
    this.log(`Error: ${msg}`);
  }

  fetchPage(url, depth = 0) {
    return new Promise((resolve, reject) => {
      if (depth > 5) return reject(new Error('Too many redirects'));
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...this.customHeaders
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && this.followRedirects) {
          let redirect = res.headers.location;
          if (redirect.startsWith('/')) {
            const u = new URL(url);
            redirect = u.origin + redirect;
          }
          res.resume();
          return this.fetchPage(redirect, depth + 1).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  setPollingInterval(ms) {
    this.interval = Math.max(1000, ms); // minimum 1 second
    this.log(`Polling interval set to ${this.interval}ms`);
  }

  getStatus() {
    return {
      source: this.name,
      sourceKey: this.key,
      sourceUrl: this.url,
      status: this.status,
      message: this.statusMessage,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      itemsFetched: this.itemsFetched,
      pollCount: this.pollCount,
      errorCount: this.errorCount,
      latestItems: this.latestItems,
      intervalMs: this.interval
    };
  }
}

module.exports = WebScraper;
