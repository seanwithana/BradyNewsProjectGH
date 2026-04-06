/**
 * Child process worker for fetching and parsing web pages.
 * Runs in its own process so heavy regex/string ops don't block the main thread.
 */
const https = require('https');
const http = require('http');

function fetchPage(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 15000,
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
        return fetchPage(redirect, depth + 1).then(resolve).catch(reject);
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

function parseStrategies(html) {
  const strategies = [
    { name: 'field--name-body', regex: /class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i },
    { name: 'node__content', regex: /class="[^"]*node__content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/i },
    { name: 'press-release-content', regex: /class="[^"]*press-release-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i },
    { name: 'article-body', regex: /class="[^"]*article[_-]?body[^"]*"[^>]*>([\s\S]*?)<\/div>/i },
    { name: 'article tag', regex: /<article[^>]*>([\s\S]*?)<\/article>/i },
    { name: 'main tag', regex: /<main[^>]*>([\s\S]*?)<\/main>/i },
  ];
  const results = {};
  for (const s of strategies) {
    const m = html.match(s.regex);
    if (m) {
      const text = m[1]
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      results[s.name] = { length: text.length, preview: text.substring(0, 500) };
    }
  }
  return results;
}

process.on('message', async (msg) => {
  try {
    const html = await fetchPage(msg.url);
    if (msg.mode === 'raw') {
      // Return raw HTML for scraper use
      process.send({ ok: true, html });
    } else {
      // Return parsed strategies for test UI
      const results = parseStrategies(html);
      process.send({ ok: true, rawLength: html.length, strategies: results });
    }
  } catch (e) {
    process.send({ ok: false, error: e.message });
  }
});
