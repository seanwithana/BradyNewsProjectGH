const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Load API keys from config.json (gitignored)
function loadApiKeys() {
  try {
    const cfgPath = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      return cfg.api_keys || {};
    }
  } catch(e) {}
  return {};
}

const API_KEYS = loadApiKeys();

const PROVIDERS = {
  OpenAI: {
    models: ['gpt-5.4-mini', 'gpt-5.4'],
    webSearch: true
  },
  Gemini: {
    models: ['gemini-3.1-flash-lite-preview'],
    webSearch: true
  },
  Anthropic: {
    models: ['claude-sonnet-4-6'],
    webSearch: false
  },
  Groq: {
    models: ['openai/gpt-oss-120b'],
    webSearch: false
  },
  Mistral: {
    models: ['mistral-small-latest'],
    webSearch: true
  }
};

function getProviders() {
  return Object.entries(PROVIDERS).map(([name, info]) => ({
    name,
    models: info.models,
    webSearch: info.webSearch,
    hasKey: !!API_KEYS[name]
  }));
}

/**
 * Call an LLM API provider.
 * Returns { text, meta, error }
 */
async function callAPI(provider, model, prompt, webSearch = false) {
  const startTime = Date.now();
  try {
    let result;
    switch (provider) {
      case 'OpenAI':   result = await callOpenAI(model, prompt, webSearch); break;
      case 'Gemini':   result = await callGemini(model, prompt, webSearch); break;
      case 'Anthropic': result = await callAnthropic(model, prompt, webSearch); break;
      case 'Groq':     result = await callGroq(model, prompt, webSearch); break;
      case 'Mistral':  result = await callMistral(model, prompt, webSearch); break;
      default: return { text: null, meta: {}, error: `Unknown provider: ${provider}` };
    }
    result.meta.latency_ms = Date.now() - startTime;
    return result;
  } catch (err) {
    return { text: null, meta: { latency_ms: Date.now() - startTime }, error: err.message };
  }
}

// ── Provider implementations ──

function callOpenAI(model, prompt, webSearch) {
  const body = {
    model,
    max_completion_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  };
  if (webSearch) body.tools = [{ type: 'web_search_preview' }];

  return httpRequest({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    headers: { 'Authorization': `Bearer ${API_KEYS.OpenAI}` }
  }, body).then(({ data, headers }) => {
    const text = data.choices?.[0]?.message?.content || '';
    return {
      text,
      meta: {
        provider: 'OpenAI', model,
        processing_ms: headers['openai-processing-ms'],
        request_id: headers['x-request-id']
      }
    };
  });
}

function callAnthropic(model, prompt) {
  const body = {
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  };

  return httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: {
      'x-api-key': API_KEYS.Anthropic,
      'anthropic-version': '2023-06-01'
    }
  }, body).then(({ data }) => {
    const text = data.content?.[0]?.text || '';
    return { text, meta: { provider: 'Anthropic', model } };
  });
}

function callGemini(model, prompt, webSearch) {
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  if (webSearch) {
    body.tools = [{ google_search: {} }];
  }

  return httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${model}:generateContent?key=${API_KEYS.Gemini}`,
    headers: {}
  }, body).then(({ data }) => {
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text, meta: { provider: 'Gemini', model } };
  });
}

function callGroq(model, prompt) {
  const body = {
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  };

  return httpRequest({
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    headers: { 'Authorization': `Bearer ${API_KEYS.Groq}` }
  }, body).then(({ data }) => {
    const text = data.choices?.[0]?.message?.content || '';
    return { text, meta: { provider: 'Groq', model } };
  });
}

function callMistral(model, prompt, webSearch) {
  const body = {
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  };
  if (webSearch) body.tools = [{ type: 'web_search' }];

  return httpRequest({
    hostname: 'api.mistral.ai',
    path: '/v1/chat/completions',
    headers: { 'Authorization': `Bearer ${API_KEYS.Mistral}` }
  }, body).then(({ data }) => {
    const text = data.choices?.[0]?.message?.content || '';
    return { text, meta: { provider: 'Mistral', model } };
  });
}

// ── HTTP helper ──

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: options.hostname,
      path: options.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...options.headers
      },
      timeout: 120000
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ data: JSON.parse(data), headers: res.headers });
        } catch(e) {
          reject(new Error(`Invalid JSON response: ${data.substring(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(payload);
    req.end();
  });
}

module.exports = { callAPI, getProviders, API_KEYS };
