// fetch-sites.js — Fetch all 20 short-seller sites and dump raw HTML for inspection
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetch(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error('Redirect with no location'));
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return resolve(fetch(next, maxRedirects - 1));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, html: data, finalUrl: url }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const sites = [
  { key: 'citron', url: 'https://citronresearch.com/' },
  { key: 'muddywaters', url: 'https://muddywatersresearch.com/' },
  { key: 'grizzly', url: 'https://grizzlyreports.com/' },
  { key: 'viceroy', url: 'https://viceroyresearch.org/' },
  { key: 'wolfpack', url: 'https://www.wolfpackresearch.com/' },
  { key: 'glasshouse', url: 'https://www.glasshouseresearch.com/' },
  { key: 'sprucepoint', url: 'https://www.sprucepointcap.com/research' },
  { key: 'gothamcity', url: 'https://www.gothamcityresearch.com/' },
  { key: 'morpheus', url: 'https://www.morpheus-research.com/' },
  { key: 'bmf', url: 'https://bmfreports.com/' },
  { key: 'bonitas', url: 'https://www.bonitasresearch.com/' },
  { key: 'fuzzypanda', url: 'https://fuzzypandaresearch.com/' },
  { key: 'scorpion', url: 'https://scorpioncapital.com/' },
  { key: 'blueorca', url: 'https://www.blueorcacapital.com/' },
  { key: 'kerrisdale', url: 'https://www.kerrisdalecap.com/' },
  { key: 'iceberg', url: 'https://www.iceberg-research.com/' },
  { key: 'jcapital', url: 'https://www.jcapitalresearch.com/' },
  { key: 'safkhet', url: 'https://safkhetcapital.com/market-advocacy' },
  { key: 'whitediamond', url: 'https://whitediamondresearch.com/' },
  { key: 'culper', url: 'https://culperresearch.com/about-us/' },
];

(async () => {
  const outDir = path.join(__dirname, 'html-dumps');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  for (const site of sites) {
    try {
      console.log(`Fetching ${site.key}: ${site.url}`);
      const { status, html } = await fetch(site.url);
      fs.writeFileSync(path.join(outDir, `${site.key}.html`), html, 'utf8');
      console.log(`  => ${status}, ${html.length} bytes`);
    } catch (e) {
      console.log(`  => ERROR: ${e.message}`);
      fs.writeFileSync(path.join(outDir, `${site.key}.html`), `ERROR: ${e.message}`, 'utf8');
    }
  }
  console.log('Done fetching all sites.');
})();
