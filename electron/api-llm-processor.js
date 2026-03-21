const path = require('path');
const fs = require('fs');
const { callAPI } = require('./api-caller');
const { fetchAllUrls } = require('./content-fetcher');

const LOG_PATH = path.join(__dirname, '..', 'data', 'api-llm.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch(e) {}
}

class ApiLLMProcessor {
  constructor(database, emitFn) {
    this.db = database;
    this.emit = emitFn;
    this.interval = null;
    this.processing = false;
    this.pollIntervalMs = 2000;
  }

  start() {
    log('API LLM processor started');
    this.interval = setInterval(() => this.tick(), this.pollIntervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async tick() {
    if (this.processing) return;
    this.processing = true;
    try {
      const pending = this.db.getPendingLLM('api', 1);
      if (pending.length === 0) {
        this.processing = false;
        return;
      }
      const item = pending[0];
      const provider = item.api_provider;
      if (!provider) {
        log(`ERROR: No API provider set for queue item ${item.id}`);
        this.db.failLLM(item.id, 'No API provider configured');
        this.processing = false;
        return;
      }

      // Parse provider|model format
      const [providerName, model] = provider.includes('|') ? provider.split('|') : [provider, null];
      if (!model) {
        log(`ERROR: No model specified for provider ${providerName}, item ${item.id}`);
        this.db.failLLM(item.id, `No model specified for provider ${providerName}`);
        this.processing = false;
        return;
      }

      log(`Processing API item ${item.id} (${providerName}/${model}, news=${item.news_item_id}, ruleset="${item.ruleset_name}")`);

      // Fetch article content
      let fullPrompt = item.prompt;
      if (item.urls_json) {
        log('Fetching article content...');
        const articleText = await fetchAllUrls(item.urls_json);
        if (articleText) {
          log(`Fetched ${articleText.length} chars`);
          fullPrompt += '\n\nFull article content from linked source:\n' + articleText;
        }
      }

      const sentAt = new Date().toISOString();
      const sendStart = Date.now();
      log(`Sending to ${providerName} ${model} (${fullPrompt.length} chars)...`);

      const result = await callAPI(providerName, model, fullPrompt, false);

      const receivedAt = new Date().toISOString();
      const latencyMs = Date.now() - sendStart;

      if (result.error) {
        log(`ERROR from ${providerName}: ${result.error} (${latencyMs}ms)`);
        this.db.failLLM(item.id, result.error);
      } else {
        log(`Completed item ${item.id} from ${providerName}/${model}: ${result.text.length} chars, ${latencyMs}ms`);

        let score = null;
        try {
          const json = JSON.parse(result.text);
          if (json && typeof json.score === 'number') {
            score = Math.max(-1000, Math.min(1000, Math.round(json.score)));
            log(`Extracted score: ${score}`);
          }
        } catch(e) {}

        this.db.completeLLM(
          item.id, result.text, `${providerName}/${model}`, score,
          latencyMs, sentAt, receivedAt
        );

        this.emit('llm-complete', {
          newsItemId: item.news_item_id,
          rulesetId: item.ruleset_id,
          response: result.text,
          score,
          model: `${providerName}/${model}`,
          target: 'api',
          latencyMs,
          sentAt,
          receivedAt
        });
      }
    } catch (err) {
      log(`Tick error: ${err.message}`);
    }
    this.processing = false;
  }
}

module.exports = ApiLLMProcessor;
