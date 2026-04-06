const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetch(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': UA }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) {
          const u = new URL(url);
          loc = u.origin + loc;
        }
        res.resume();
        return resolve(fetch(loc, maxRedirects - 1));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Save raw HTML for inspection
async function fetchAndSave(key, url) {
  try {
    console.log(`Fetching ${key}: ${url}`);
    const html = await fetch(url);
    const dir = path.join(__dirname, 'temp-html');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key}.html`), html);
    console.log(`  OK ${key}: ${html.length} bytes`);
    return { key, url, html, error: null };
  } catch (e) {
    console.log(`  FAIL ${key}: ${e.message}`);
    return { key, url, html: '', error: e.message };
  }
}

const sites = {
  fda:        'https://www.fda.gov/news-events/fda-newsroom/press-announcements',
  sec:        'https://www.sec.gov/newsroom/press-releases',
  cpsc:       'https://www.cpsc.gov/Recalls',
  ftc:        'https://www.ftc.gov/news-events/news/press-releases',
  doj:        'https://www.justice.gov/opa/pr',
  osha:       'https://www.osha.gov/news/newsreleases',
  faa:        'https://www.faa.gov/newsroom/press_releases',
  epa:        'https://www.epa.gov/newsroom',
  nhtsa:      'https://www.nhtsa.gov/recalls',
  fcc:        'https://www.fcc.gov/news-events/headlines',
  treasury:   'https://home.treasury.gov/news/press-releases',
  ustr:       'https://ustr.gov/about-us/policy-offices/press-office/press-releases',
  whitehouse: 'https://www.whitehouse.gov/briefing-room/',
  eia:        'https://www.eia.gov/petroleum/supply/weekly/',
  bea:        'https://www.bea.gov/news/current-releases',
  bls_cpi:    'https://www.bls.gov/news.release/cpi.htm',
  bls_empsit: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  wolfstreet: 'https://wolfstreet.com/',
  calcrisks:  'https://www.calculatedriskblog.com/',
  econbrowser:'https://econbrowser.com/',
};

(async () => {
  const results = await Promise.allSettled(
    Object.entries(sites).map(([k, u]) => fetchAndSave(k, u))
  );
  const fetched = results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
  console.log('\n=== FETCH SUMMARY ===');
  for (const f of fetched) {
    console.log(`${f.key}: ${f.error ? 'FAIL: ' + f.error : f.html.length + ' bytes'}`);
  }
})();
