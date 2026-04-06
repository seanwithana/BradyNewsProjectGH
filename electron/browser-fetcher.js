const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const LOG_PATH = path.join(__dirname, '..', 'data', 'scrapers.log');

/**
 * Fallback fetcher for 403-blocked sites.
 * Uses Node's native https with browser-like headers.
 * Sequential queue with delays to avoid flooding.
 */
class BrowserFetcher {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.failedDomains = new Map();
  }

  log(msg) {
    const line = `[${new Date().toISOString()}] [browser-fetcher] ${msg}\n`;
    try { fs.appendFileSync(LOG_PATH, line); } catch {}
  }

  init() {
    this.log('Fetcher initialized (native https)');
  }

  fetch(url, timeoutMs = 15000) {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return Promise.reject(new Error('Invalid URL: ' + url));
    }
    const domain = new URL(url).origin;
    const lastFail = this.failedDomains.get(domain);
    if (lastFail && Date.now() - lastFail < 60000) {
      return Promise.reject(new Error('Domain on cooldown'));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ url, domain, resolve, reject, timeoutMs });
      this.processQueue();
    });
  }

  processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const { url, domain, resolve, reject, timeoutMs } = this.queue.shift();

    this._doFetch(url, timeoutMs, 0).then(html => {
      this.processing = false;
      resolve(html);
      setTimeout(() => this.processQueue(), 300);
    }).catch(e => {
      this.processing = false;
      this.failedDomains.set(domain, Date.now());
      reject(e);
      setTimeout(() => this.processQueue(), 300);
    });
  }

  _doFetch(url, timeoutMs, depth) {
    return new Promise((resolve, reject) => {
      if (depth > 5) return reject(new Error('Too many redirects'));
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirect = res.headers.location;
          if (redirect.startsWith('/')) redirect = new URL(redirect, url).href;
          res.resume();
          return this._doFetch(redirect, timeoutMs, depth + 1).then(resolve).catch(reject);
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

  destroy() {}
}

let instance = null;

function getBrowserFetcher() {
  if (!instance) {
    instance = new BrowserFetcher();
    instance.init();
  }
  return instance;
}

module.exports = { getBrowserFetcher };
