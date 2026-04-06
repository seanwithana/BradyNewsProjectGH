require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('./database');
const KeywordEngine = require('./keyword-engine');
const LLMProcessor = require('./llm-processor');
const ApiLLMProcessor = require('./api-llm-processor');
const { callAPI, getProviders } = require('./api-caller');
const { fetchAllUrls } = require('./content-fetcher');
const DiscordScraper = require('./discord-scraper');
const finvizScraper = require('./finviz-scraper');
const TruthScraper = require('./truth-scraper');
const WebScraper = require('./web-scraper');
const PuppeteerScraper = require('./puppeteer-scraper');
const SCRAPER_SOURCES = require('./scraper-sources');

let mainWindow;
let database;
let keywordEngine;
let llmProcessor;
let apiLlmProcessor;
let discordScraper;
let truthScraper;
let webScrapers = [];
let puppeteerScrapers = [];

function emit(event, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, data);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Brady News Project',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

async function initializeBackend() {
  const dbPath = path.join(__dirname, '..', 'data', 'brady-news.db');
  database = new Database(dbPath);
  database.initialize();

  keywordEngine = new KeywordEngine(database);

  // Discord scraper — connects directly to Discord gateway
  // Token loaded from .env file or config.json
  const configPath = path.join(__dirname, '..', 'config.json');
  let configToken = null;
  try {
    if (fs.existsSync(configPath)) {
      configToken = JSON.parse(fs.readFileSync(configPath, 'utf-8')).discord_bot_token;
    }
  } catch(e) {}
  // Shared function to process a news item through keyword filters
  function processNewItem(newsItem, sourceType = 'discord') {
    emit('new-item-ingested', { ticker: newsItem.ticker_symbol });

    const matches = keywordEngine.processItem(newsItem, sourceType);
    const feedEntries = [];
    for (const match of matches) {
      const feedResult = database.insertFeedEntry({
        news_item_id: newsItem.id,
        ruleset_id: match.rulesetId,
        matched_keywords: JSON.stringify(match.matchedKeywords),
        received_at: newsItem.original_timestamp,
        color: match.color,
        score_gated: match.scoringEnabled
      });
      if (feedResult && feedResult.changes > 0) {
        feedEntries.push({ newsItem, match });
      }
    }

    if (feedEntries.length > 0) {
      emit('news-feed-update', {
        count: feedEntries.length,
        entries: feedEntries.slice(0, 20).map(e => ({
          ticker: e.newsItem.ticker_symbol,
          rulesetName: e.match.rulesetName,
          matchedKeywords: e.match.matchedKeywords,
          color: e.match.color,
          audioPath: e.match.audioPath,
          text: e.newsItem.text.substring(0, 200)
        }))
      });

      // Async finviz lookup for items missing float or market cap
      const needsCap = !newsItem.market_cap_raw;
      const needsFloat = !newsItem.float_raw;
      if (newsItem.ticker_symbol && (needsCap || needsFloat)) {
        finvizScraper.enqueue(newsItem.ticker_symbol, newsItem.id, needsCap, needsFloat, (itemId, ticker, updates) => {
          database.updateNewsItemFinviz(itemId, updates);
          emit('finviz-update', { newsItemId: itemId, ticker, ...updates });
        });
      }
    }
  }

  const token = process.env.DISCORD_BOT_TOKEN || configToken;
  if (token) {
    discordScraper = new DiscordScraper(database, token, (newsItem) => {
      processNewItem(newsItem, 'discord');
    });
    discordScraper.start();

    // Backfill recent history after bot is ready
    setTimeout(() => {
      if (discordScraper) discordScraper.backfill(100);
    }, 5000);
  } else {
    const logPath = path.join(__dirname, '..', 'data', 'discord.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] WARNING: No DISCORD_BOT_TOKEN in .env — Discord scraping disabled\n`);
  }

  // LLM processor
  llmProcessor = new LLMProcessor(database, emit);
  llmProcessor.start();

  apiLlmProcessor = new ApiLLMProcessor(database, emit);
  apiLlmProcessor.start();

  // Truth Social scraper
  truthScraper = new TruthScraper((newPosts, allPosts) => {
    emit('truth-update', { newPosts, allPosts });

    // Insert each new post as a news item and run through keyword filters
    for (const post of newPosts) {
      const sourceKey = 'truth_' + post.id;
      const text = post.isRetruth && post.reblogText ? post.reblogText : post.text;
      const item = {
        source_type: 'truth',
        source_key: sourceKey,
        ticker_symbol: null,
        text: text,
        country_iso2: null,
        market_cap_raw: null,
        market_cap_value: null,
        urls_json: '[]',
        source_channels_json: '[]',
        source_message_ids_json: JSON.stringify([post.id]),
        original_timestamp: post.createdAt.replace('T', ' ').replace('Z', '').slice(0, 19)
      };
      const result = database.insertNewsItem(item);
      if (result.changes > 0) {
        const inserted = database.getNewsItemBySourceKey(sourceKey);
        if (inserted) {
          processNewItem(inserted, 'truth');
        }
      }
    }
  });
  // Truth Social scraper disabled — Cloudflare bypass requires headless browser
  // which causes resource contention with the Discord bot.
  // truthScraper.start();

  // Web scrapers — all sources from scraper-sources.js
  for (const config of SCRAPER_SOURCES) {
    const scraper = new WebScraper(config);
    scraper.onNewItems = (items, sourceKey, sourceName) => {
      for (const item of items) {
        const newsSourceKey = `web_${sourceKey}_${item.id}`.substring(0, 250);
        const newsItem = {
          source_type: sourceKey,
          source_key: newsSourceKey,
          ticker_symbol: null,
          text: item.title + (item.text && item.text !== item.title ? '\n' + item.text : ''),
          country_iso2: null,
          market_cap_raw: null,
          market_cap_value: null,
          urls_json: JSON.stringify(item.url ? [item.url] : []),
          source_channels_json: '[]',
          source_message_ids_json: JSON.stringify([item.id]),
          original_timestamp: item.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19)
        };
        const result = database.insertNewsItem(newsItem);
        if (result.changes > 0) {
          const inserted = database.getNewsItemBySourceKey(newsSourceKey);
          if (inserted) {
            processNewItem(inserted, sourceKey);
          }
        }
      }
    };
    webScrapers.push(scraper);
    scraper.start();
  }

  // Puppeteer-based scrapers for SPA sites
  function setupPuppeteerScraper(config) {
    const scraper = new PuppeteerScraper(config);
    scraper.onNewItems = (items, sourceKey, sourceName) => {
      for (const item of items) {
        const newsSourceKey = `pup_${sourceKey}_${item.id}`.substring(0, 250);
        const newsItem = {
          source_type: sourceKey,
          source_key: newsSourceKey,
          ticker_symbol: null,
          text: item.title + (item.text && item.text !== item.title ? '\n' + item.text : ''),
          country_iso2: null,
          market_cap_raw: null,
          market_cap_value: null,
          urls_json: JSON.stringify(item.url ? [item.url] : []),
          source_channels_json: '[]',
          source_message_ids_json: JSON.stringify([item.id || item.url]),
          original_timestamp: item.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19)
        };
        const result = database.insertNewsItem(newsItem);
        if (result.changes > 0) {
          const inserted = database.getNewsItemBySourceKey(newsSourceKey);
          if (inserted) processNewItem(inserted, sourceKey);
        }
      }
    };
    puppeteerScrapers.push(scraper);
    scraper.start();
  }

  // EPA News Releases (SPA — requires puppeteer)
  setupPuppeteerScraper({
    name: 'EPA News Releases',
    key: 'epa',
    sourceUrl: 'https://www.epa.gov/newsreleases/search',
    workerPath: path.join(__dirname, 'epa-worker.js'),
    parseArticleFn: (html) => {
      const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
      if (article) return article[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return '';
    }
  });

  // FAA Press Releases (SPA — requires puppeteer for both listing and articles)
  setupPuppeteerScraper({
    name: 'FAA Press Releases',
    key: 'faa',
    sourceUrl: 'https://www.faa.gov/newsroom/press_releases',
    workerPath: path.join(__dirname, 'faa-worker.js'),
    parseArticleFn: null
  });

  // SEC Press Releases (403 blocked — requires puppeteer)
  setupPuppeteerScraper({
    name: 'SEC Press Releases',
    key: 'sec',
    sourceUrl: 'https://www.sec.gov/newsroom/press-releases',
    workerPath: path.join(__dirname, 'sec-worker.js'),
    parseArticleFn: (html) => {
      const body = html.match(/class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
      if (body) return body[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return '';
    }
  });

  // DOJ Press Releases (bot challenge — requires puppeteer)
  setupPuppeteerScraper({
    name: 'DOJ Press Releases',
    key: 'doj',
    sourceUrl: 'https://www.justice.gov/news/press-releases?search_api_fulltext=+&start_date=&end_date=&sort_by=field_date',
    workerPath: path.join(__dirname, 'doj-worker.js'),
    parseArticleFn: null
  });

  // Viceroy Research (SPA with disclaimer modal — requires puppeteer)
  setupPuppeteerScraper({
    name: 'Viceroy Research',
    key: 'viceroy',
    sourceUrl: 'https://viceroyresearch.org/',
    workerPath: path.join(__dirname, 'viceroy-worker.js'),
    parseArticleFn: null
  });

  // NHTSA Press Releases (403 blocked — requires puppeteer)
  setupPuppeteerScraper({
    name: 'NHTSA Press Releases',
    key: 'nhtsa',
    sourceUrl: 'https://www.nhtsa.gov/press-releases',
    workerPath: path.join(__dirname, 'nhtsa-worker.js'),
    parseArticleFn: null
  });

  // Bonitas Research (WordPress SPA — requires puppeteer)
  setupPuppeteerScraper({
    name: 'Bonitas Research',
    key: 'bonitas',
    sourceUrl: 'https://www.bonitasresearch.com/research/',
    workerPath: path.join(__dirname, 'bonitas-worker.js'),
    parseArticleFn: null
  });

  // Kerrisdale Capital (403 blocked — puppeteer for titles)
  setupPuppeteerScraper({
    name: 'Kerrisdale Capital',
    key: 'kerrisdale',
    sourceUrl: 'https://www.kerrisdalecap.com/blog',
    workerPath: path.join(__dirname, 'kerrisdale-worker.js'),
    parseArticleFn: null
  });

  // Gotham City Research (Wix SPA — RSS for listing, puppeteer for articles)
  setupPuppeteerScraper({
    name: 'Gotham City Research',
    key: 'gothamcity',
    sourceUrl: 'https://www.gothamcityresearch.com/',
    workerPath: path.join(__dirname, 'gotham-worker.js'),
    parseArticleFn: null
  });

  // Wolfpack Research (Wix SPA — requires puppeteer)
  setupPuppeteerScraper({
    name: 'Wolfpack Research',
    key: 'wolfpack',
    sourceUrl: 'https://www.wolfpackresearch.com/items',
    workerPath: path.join(__dirname, 'wolfpack-worker.js'),
    parseArticleFn: null
  });

  // USDA Press Releases (too slow for direct HTTP — requires puppeteer)
  setupPuppeteerScraper({
    name: 'USDA Press Releases',
    key: 'usda',
    sourceUrl: 'https://www.usda.gov/about-usda/news/press-releases',
    workerPath: path.join(__dirname, 'usda-worker.js'),
    parseArticleFn: null
  });

  // BLS Releases (CPI, Employment, PPI — 403 blocked, single-page releases)
  setupPuppeteerScraper({
    name: 'BLS Economic Releases',
    key: 'bls',
    sourceUrl: 'https://www.bls.gov/news.release/cpi.htm',
    workerPath: path.join(__dirname, 'bls-worker.js'),
    parseArticleFn: null
  });
}

// ── IPC Handlers ──

// News Feed
ipcMain.handle('get-news-feed', (_, filters) => {
  return database.getNewsFeed(filters);
});

// Finviz enrichment — renderer sends items missing cap/float
ipcMain.handle('enqueue-finviz', (_, items) => {
  for (const { ticker, newsItemId, needsCap, needsFloat } of items) {
    finvizScraper.enqueue(ticker, newsItemId, needsCap, needsFloat, (itemId, t, updates) => {
      database.updateNewsItemFinviz(itemId, updates);
      emit('finviz-update', { newsItemId: itemId, ticker: t, ...updates });
    });
  }
});

ipcMain.handle('search-news', (_, query) => {
  return database.searchNews(query);
});

// Truth Social
ipcMain.handle('get-truth-posts', () => {
  return truthScraper ? truthScraper.getPosts() : [];
});

// Open URL in system browser
ipcMain.handle('open-external', (_, url) => {
  if (url && url.startsWith('http')) shell.openExternal(url);
});

// Test fetcher — runs entirely in a spawned node child process
ipcMain.handle('test-browser-fetch', (_, url) => {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    const script = `
      const https = require('https');
      const http = require('http');
      function doFetch(url, depth) {
        return new Promise((resolve, reject) => {
          if (depth > 3) return reject(new Error('Too many redirects'));
          const client = url.startsWith('https') ? https : http;
          const req = client.get(url, { timeout: 15000, headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Encoding': 'identity',
            'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1'
          }}, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume(); let loc = res.headers.location;
              if (loc.startsWith('/')) loc = new URL(loc, url).href;
              return doFetch(loc, depth+1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
            let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
      }
      doFetch(process.argv[1], 0).then(html => {
        const strats = [
          ['field--name-body', /class="[^"]*field--name-body[^"]*"[^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>/i],
          ['article-body', /class="[^"]*article[_-]?body[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i],
          ['article tag', /<article[^>]*>([\\s\\S]*?)<\\/article>/i],
          ['main tag', /<main[^>]*>([\\s\\S]*?)<\\/main>/i],
        ];
        const r = {};
        for (const [name, regex] of strats) {
          const m = html.match(regex);
          if (m) {
            const t = m[1].replace(/<script[\\s\\S]*?<\\/script>/gi,'').replace(/<style[\\s\\S]*?<\\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim();
            r[name] = { length: t.length, preview: t.substring(0,500) };
          }
        }
        process.stdout.write(JSON.stringify({ ok: true, rawLength: html.length, strategies: r }));
      }).catch(e => {
        process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
      });
    `;
    execFile('node', ['-e', script, url], { timeout: 20000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message });
      try { resolve(JSON.parse(stdout)); } catch { resolve({ ok: false, error: 'Parse error: ' + stdout.substring(0, 200) }); }
    });
  });
});

// Set scraper polling interval
ipcMain.handle('set-scraper-interval', (_, { sourceKey, intervalMs }) => {
  const scraper = webScrapers.find(s => s.key === sourceKey);
  if (scraper) {
    scraper.setPollingInterval(intervalMs);
    return true;
  }
  return false;
});

// Available sources list
ipcMain.handle('get-available-sources', () => {
  const sources = [
    { key: 'discord', name: 'Discord News Bot' },
    { key: 'truth', name: 'Trump Truth Social' },
  ];
  for (const config of SCRAPER_SOURCES) {
    sources.push({ key: config.key, name: config.name });
  }
  return sources;
});

// Scraper Health
ipcMain.handle('get-scraper-health', () => {
  const scrapers = [];
  if (discordScraper) {
    scrapers.push(discordScraper.getStatus());
  } else {
    scrapers.push({
      source: 'Discord News Bot', sourceKey: 'discord', sourceUrl: 'https://discord.com',
      status: 'disabled', message: 'No bot token configured',
      lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: '', errorCount: 0,
      latestItems: []
    });
  }
  if (truthScraper) {
    scrapers.push(truthScraper.getStatus());
  }
  for (const ws of webScrapers) {
    scrapers.push(ws.getStatus());
  }
  for (const ps of puppeteerScrapers) {
    scrapers.push(ps.getStatus());
  }
  return scrapers;
});

// Rulesets
ipcMain.handle('get-rulesets', () => {
  return database.getRulesets();
});

ipcMain.handle('save-ruleset', (_, ruleset) => {
  const saved = database.saveRuleset(ruleset);
  if (saved && saved.id) {
    const results = keywordEngine.reprocess(saved.id, '1d');
    if (results.length > 0) {
      emit('news-feed-update', {
        count: results.length,
        entries: results.slice(0, 20).map(r => ({
          ticker: '', rulesetName: saved.name,
          matchedKeywords: r.matchedKeywords, color: saved.color,
          audioPath: saved.audio_path, text: r.text
        }))
      });
    }
  }
  return saved;
});

ipcMain.handle('delete-ruleset', (_, id) => {
  return database.deleteRuleset(id);
});

ipcMain.handle('update-ruleset', (_, ruleset) => {
  const updated = database.updateRuleset(ruleset);
  if (updated && updated.id) {
    const results = keywordEngine.reprocess(updated.id, '1d');
    if (results.length > 0) {
      emit('news-feed-update', {
        count: results.length,
        entries: results.slice(0, 20).map(r => ({
          ticker: '', rulesetName: updated.name,
          matchedKeywords: r.matchedKeywords, color: updated.color,
          audioPath: updated.audio_path, text: r.text
        }))
      });
    }
  }
  return updated;
});

ipcMain.handle('toggle-ruleset', (_, { id, enabled }) => {
  database.db.prepare('UPDATE keyword_rulesets SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?').run(enabled ? 1 : 0, id);
  return database.getRulesetById(id);
});

// Audio file upload
ipcMain.handle('select-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'] }
    ]
  });
  if (result.canceled) return null;

  const srcPath = result.filePaths[0];
  const fileName = `audio_${Date.now()}_${path.basename(srcPath)}`;
  const destPath = path.join(__dirname, '..', 'data', 'audio', fileName);
  fs.copyFileSync(srcPath, destPath);
  return { path: destPath, name: path.basename(srcPath) };
});

// Reprocess
ipcMain.handle('reprocess-news', async (_, { rulesetId, timePeriod }) => {
  const results = keywordEngine.reprocess(rulesetId, timePeriod);
  emit('reprocess-complete', { rulesetId, count: results.length });
  return results;
});

// Dialogs
ipcMain.handle('alert-dialog', async (_, message) => {
  await dialog.showMessageBox(mainWindow, { type: 'info', buttons: ['OK'], message });
});

ipcMain.handle('confirm-dialog', async (_, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question', buttons: ['Cancel', 'Delete'], defaultId: 0, cancelId: 0, message
  });
  return result.response === 1;
});

// Audio playback
ipcMain.handle('get-audio-data', (_, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma' };
    const mime = mimeMap[ext] || 'audio/mpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (err) {
    return null;
  }
});

// LLM Queue
ipcMain.handle('get-llm-queue', (_, filters) => {
  return database.getLLMQueue(filters || {});
});

ipcMain.handle('get-llm-stats', () => {
  return database.getLLMStats();
});

ipcMain.handle('get-llm-result', (_, newsItemId) => {
  return database.getLLMResult(newsItemId);
});

// Discord status
ipcMain.handle('get-discord-status', () => {
  if (discordScraper) return discordScraper.getStatus();
  return { status: 'disabled', message: 'No bot token configured', messagesReceived: 0, itemsIngested: 0 };
});

// All News
ipcMain.handle('get-all-news', (_, filters) => {
  return database.getAllNewsItems(filters || {});
});

// API Testing
ipcMain.handle('get-api-providers', () => {
  return getProviders();
});

ipcMain.handle('extract-article-content', async (_, urlsJson) => {
  const text = await fetchAllUrls(urlsJson);
  return text;
});

ipcMain.handle('get-api-testing-items', () => {
  return database.db.prepare(`
    SELECT nf.id as feed_id, nf.news_item_id, nf.ruleset_id, nf.matched_keywords, nf.filtered_at,
           ni.ticker_symbol, ni.text, ni.urls_json, ni.original_timestamp,
           kr.name as ruleset_name, kr.color as ruleset_color,
           kr.llm_enabled, kr.llm_prompt, kr.llm_output_format,
           kr.llm_scoring_enabled, kr.llm_scoring_criteria
    FROM news_feed nf
    JOIN news_items ni ON nf.news_item_id = ni.id
    JOIN keyword_rulesets kr ON nf.ruleset_id = kr.id
    ORDER BY nf.filtered_at DESC
    LIMIT 100
  `).all();
});

ipcMain.handle('call-api', async (_, { provider, model, prompt, webSearch }) => {
  return await callAPI(provider, model, prompt, webSearch);
});

// Stats
ipcMain.handle('get-stats', () => {
  return database.getStats();
});

app.whenReady().then(async () => {
  createWindow();
  await initializeBackend();


  // Startup reprocess
  const rulesets = database.getRulesets().filter(rs => rs.enabled);
  for (const rs of rulesets) {
    keywordEngine.reprocess(rs.id, '1d');
  }

});

app.on('window-all-closed', () => {
  if (discordScraper) discordScraper.stop();
  if (llmProcessor) llmProcessor.stop();
  if (apiLlmProcessor) apiLlmProcessor.stop();
  if (database) database.close();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
