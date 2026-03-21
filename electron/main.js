require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('./database');
const KeywordEngine = require('./keyword-engine');
const LLMProcessor = require('./llm-processor');
const ApiLLMProcessor = require('./api-llm-processor');
const { callAPI, getProviders } = require('./api-caller');
const { fetchAllUrls } = require('./content-fetcher');
const DiscordScraper = require('./discord-scraper');

let mainWindow;
let database;
let keywordEngine;
let llmProcessor;
let apiLlmProcessor;
let discordScraper;

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
      backgroundThrottling: false
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
  const token = process.env.DISCORD_BOT_TOKEN || configToken;
  if (token) {
    discordScraper = new DiscordScraper(database, token, (newsItem) => {
      // Always notify renderer of new item (for All News tab)
      emit('new-item-ingested', { ticker: newsItem.ticker_symbol });

      // Process each new item through keyword engine
      const matches = keywordEngine.processItem(newsItem);
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
      }
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
}

// ── IPC Handlers ──

// News Feed
ipcMain.handle('get-news-feed', (_, filters) => {
  return database.getNewsFeed(filters);
});

ipcMain.handle('search-news', (_, query) => {
  return database.searchNews(query);
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
  await initializeBackend();

  // Startup reprocess
  const rulesets = database.getRulesets().filter(rs => rs.enabled);
  for (const rs of rulesets) {
    keywordEngine.reprocess(rs.id, '1d');
  }

  createWindow();
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
