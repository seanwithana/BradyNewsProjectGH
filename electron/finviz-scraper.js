const https = require('https');

// In-memory cache: ticker -> { cap, float, ts }
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Queue to avoid hammering finviz
let queue = [];
let processing = false;
const DELAY_MS = 400; // delay between requests

function fetchFinvizData(ticker) {
  return new Promise((resolve) => {
    const url = `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}&ty=c&ta=1&p=d`;
    const req = https.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(parseFinvizPage(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function parseFinvizPage(html) {
  const result = {};

  // Market Cap — label in one <td>, value in next <td> inside <b> tag
  const mcMatch = html.match(/>Market Cap<\/td>\s*<td[^>]*>\s*<b>([^<]+)<\/b>/i);
  if (mcMatch) {
    const raw = mcMatch[1].trim();
    if (raw !== '-') {
      result.marketCapRaw = raw;
      result.marketCapValue = parseShortNumber(raw);
    }
  }

  // Float (Shs Float) — same pattern
  const floatMatch = html.match(/>Shs Float<\/td>\s*<td[^>]*>\s*<b>([^<]+)<\/b>/i);
  if (floatMatch) {
    const raw = floatMatch[1].trim();
    if (raw !== '-') {
      result.floatRaw = raw;
      result.floatValue = parseShortNumber(raw);
    }
  }

  return (result.marketCapRaw || result.floatRaw) ? result : null;
}

function parseShortNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/,/g, '').trim();
  const match = cleaned.match(/([\d.]+)\s*([KMBTkmbt])?/);
  if (!match) return null;
  let num = parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();
  if (unit === 'K') num *= 1000;
  else if (unit === 'M') num *= 1e6;
  else if (unit === 'B') num *= 1e9;
  else if (unit === 'T') num *= 1e12;
  return num;
}

function formatShortNumber(value) {
  if (!value || value <= 0) return null;
  if (value >= 1e12) return (value / 1e12).toFixed(1) + ' T';
  if (value >= 1e9) return (value / 1e9).toFixed(1) + ' B';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + ' M';
  if (value >= 1e3) return (value / 1e3).toFixed(0) + ' K';
  return value.toString();
}

function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  const { ticker, newsItemId, needsCap, needsFloat, callback } = queue.shift();

  // Check cache first
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    processing = false;
    const updates = buildUpdates(cached.data, needsCap, needsFloat);
    if (updates) callback(newsItemId, ticker, updates);
    processQueue();
    return;
  }

  fetchFinvizData(ticker).then(data => {
    if (data) {
      cache.set(ticker, { data, ts: Date.now() });
      const updates = buildUpdates(data, needsCap, needsFloat);
      if (updates) callback(newsItemId, ticker, updates);
    }
    // Delay before next request
    setTimeout(() => {
      processing = false;
      processQueue();
    }, DELAY_MS);
  });
}

function buildUpdates(data, needsCap, needsFloat) {
  if (!data) return null;
  const updates = {};
  if (needsCap && data.marketCapRaw) {
    updates.marketCapRaw = data.marketCapRaw;
    updates.marketCapValue = data.marketCapValue;
  }
  if (needsFloat && data.floatRaw) {
    updates.floatRaw = data.floatRaw;
    updates.floatValue = data.floatValue;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

/**
 * Enqueue a finviz lookup. Non-blocking — calls back when data is ready.
 * @param {string} ticker
 * @param {number} newsItemId
 * @param {boolean} needsCap - whether market cap is missing
 * @param {boolean} needsFloat - whether float is missing
 * @param {function} callback - (newsItemId, ticker, updates) => void
 */
function enqueue(ticker, newsItemId, needsCap, needsFloat, callback) {
  if (!ticker || (!needsCap && !needsFloat)) return;

  // Check cache synchronously first
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    const updates = buildUpdates(cached.data, needsCap, needsFloat);
    if (updates) {
      setImmediate(() => callback(newsItemId, ticker, updates));
    }
    return;
  }

  queue.push({ ticker, newsItemId, needsCap, needsFloat, callback });
  processQueue();
}

module.exports = { enqueue, fetchFinvizData, formatShortNumber };
