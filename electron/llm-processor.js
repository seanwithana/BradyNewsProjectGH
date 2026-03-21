const http = require('http');
const path = require('path');
const fs = require('fs');
const { fetchAllUrls } = require('./content-fetcher');

const LOG_PATH = path.join(__dirname, '..', 'data', 'llm.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch(e) {}
}

class LLMProcessor {
  constructor(database, emitFn) {
    this.db = database;
    this.emit = emitFn;
    this.interval = null;
    this.processing = false;
    this.pollIntervalMs = 2000;

    // Ollama config — can be swapped for a cloud API later
    let config = {};
    try {
      const cfgPath = path.join(__dirname, '..', 'config.json');
      if (fs.existsSync(cfgPath)) config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    } catch(e) {}
    this.provider = 'ollama';
    this.ollamaHost = process.env.OLLAMA_HOST || config.ollama_host || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || config.ollama_model || 'qwen3:32b';
  }

  start() {
    log(`LLM processor started (provider=${this.provider}, model=${this.model})`);
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
      const pending = this.db.getPendingLLM('local', 1);
      if (pending.length === 0) {
        this.processing = false;
        return;
      }
      const item = pending[0];
      log(`Processing queue item ${item.id} (news_item=${item.news_item_id}, ruleset="${item.ruleset_name}")`);

      // Fetch linked article content and append to prompt
      let fullPrompt = item.prompt;
      if (item.urls_json) {
        log(`Fetching article content from URLs...`);
        const articleText = await fetchAllUrls(item.urls_json);
        if (articleText) {
          log(`Fetched ${articleText.length} chars of article content`);
          fullPrompt += '\n\nFull article content from linked source:\n' + articleText;
        } else {
          log(`No article content could be fetched`);
        }
      }

      const sentAt = new Date().toISOString();
      const sendStart = Date.now();
      const response = await this.callOllama(fullPrompt);
      const receivedAt = new Date().toISOString();
      const latencyMs = Date.now() - sendStart;

      if (response.error) {
        log(`ERROR: ${response.error}`);
        this.db.failLLM(item.id, response.error);
      } else {
        log(`Completed item ${item.id}, response length=${response.text.length}, latency=${latencyMs}ms`);
        let score = null;
        try {
          const json = JSON.parse(response.text);
          if (json && typeof json.score === 'number') {
            score = Math.max(-1000, Math.min(1000, Math.round(json.score)));
            log(`Extracted score: ${score}`);
          }
        } catch(e) {}
        this.db.completeLLM(item.id, response.text, this.model, score, latencyMs, sentAt, receivedAt);

        // Notify renderer
        this.emit('llm-complete', {
          newsItemId: item.news_item_id,
          rulesetId: item.ruleset_id,
          response: response.text,
          score,
          model: this.model
        });
      }
    } catch (err) {
      log(`Tick error: ${err.message}`);
    }
    this.processing = false;
  }

  callOllama(prompt) {
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 1024
        }
      });

      const url = new URL(this.ollamaHost + '/api/generate');
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 120000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              resolve({ error: json.error });
            } else {
              // Clean up response — strip thinking tags if present (qwen3)
              let text = json.response || '';
              text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
              resolve({ text });
            }
          } catch(e) {
            resolve({ error: `Invalid response: ${data.substring(0, 200)}` });
          }
        });
      });

      req.on('error', (err) => resolve({ error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Request timed out (120s)' });
      });

      req.write(payload);
      req.end();
    });
  }
}

module.exports = LLMProcessor;
