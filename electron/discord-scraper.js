const { Client, GatewayIntentBits } = require('discord.js');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const LOG_PATH = path.join(__dirname, '..', 'data', 'discord.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch(e) {}
}

// Hardcoded channel IDs to monitor
const CHANNEL_IDS = new Set([
  '1422372958856413214',
  '1421992126039855266'
]);

// Ticker extraction stop words
const STOP_WORDS = new Set([
  'AM','PM','SEC','FORM','PR','MC','IO','SI','FLOAT','LINK','NAV',
  'ETF','USD','CEO','CFO','COO','CTO','IPO','FDA','AI','CEO','API',
  'EPS','GDP','LLC','INC','ETF','NYSE','GDP','THE','FOR','AND','ALL',
  'NEW','NOW','HAS','ITS','ARE','NOT','WAS','BUT','OUT','CAN','HAD'
]);

// Ticker regexes
const TICKER_PATTERNS = [
  /\*\*([A-Z]{1,5})\*\*/,                    // **TICK**
  /\$([A-Z]{1,5})\b/,                         // $TICK
  /\b([A-Z]{2,5})\s*<\s*\$/,                  // TICK < $
  /\b([A-Z]{2,5})\s*:\s/,                     // TICK :
];

class DiscordScraper {
  constructor(database, token, onNewItem) {
    this.db = database;
    this.token = token;
    this.onNewItem = onNewItem;
    this.client = null;
    this.dedupeWindowMs = 7200 * 1000; // 2 hours
  }

  start() {
    this.status = 'connecting';
    this.statusMessage = 'Connecting to Discord...';
    this.messagesReceived = 0;
    this.itemsIngested = 0;
    this.lastMessageAt = null;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    this.client.on('ready', () => {
      this.status = 'connected';
      this.statusMessage = `Connected as ${this.client.user.tag}`;
      log(`Discord bot connected as ${this.client.user.tag}`);
      log(`Bot ID: ${this.client.user.id}`);
      log(`Monitoring ${CHANNEL_IDS.size} channels: ${[...CHANNEL_IDS].join(', ')}`);
      log(`Guilds: ${this.client.guilds.cache.map(g => `${g.name} (${g.id})`).join(', ')}`);

      // Verify channel access
      for (const chId of CHANNEL_IDS) {
        const ch = this.client.channels.cache.get(chId);
        if (ch) {
          log(`Channel ${chId}: OK — #${ch.name} in ${ch.guild?.name || 'unknown guild'}`);
        } else {
          log(`Channel ${chId}: NOT FOUND — bot may not have access`);
        }
      }
    });

    this.client.on('messageCreate', (message) => {
      log(`MSG from #${message.channel.name || message.channel.id} by ${message.author.username}: ${message.content.substring(0, 80)}`);
      this.messagesReceived++;
      this.lastMessageAt = new Date().toISOString();

      if (!CHANNEL_IDS.has(message.channel.id)) {
        log(`  -> Ignored (channel not monitored)`);
        return;
      }
      if (message.author.bot && message.author.id === this.client.user.id) return;

      try {
        this.processMessage(message);
      } catch (err) {
        log(`Error processing message ${message.id}: ${err.message}`);
      }
    });

    this.client.on('messageUpdate', (_, newMessage) => {
      if (!CHANNEL_IDS.has(newMessage.channel.id)) return;
      try {
        this.processMessage(newMessage);
      } catch (err) {
        log(`Error processing edit ${newMessage.id}: ${err.message}`);
      }
    });

    this.client.on('warn', (msg) => {
      log(`Discord warning: ${msg}`);
    });

    this.client.on('disconnect', () => {
      this.status = 'disconnected';
      this.statusMessage = 'Disconnected from Discord';
      log('Discord disconnected');
    });

    this.client.on('reconnecting', () => {
      this.status = 'reconnecting';
      this.statusMessage = 'Reconnecting to Discord...';
      log('Discord reconnecting...');
    });

    this.client.on('error', (err) => {
      this.status = 'error';
      this.statusMessage = `Error: ${err.message}`;
      log(`Discord error: ${err.message}`);
    });

    log(`Attempting login with token: ${this.token.substring(0, 10)}...`);
    this.client.login(this.token).catch(err => {
      this.status = 'failed';
      this.statusMessage = `Login failed: ${err.message}`;
      log(`Discord login failed: ${err.message}`);
    });
  }

  stop() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  getStatus() {
    return {
      status: this.status || 'not started',
      message: this.statusMessage || '',
      messagesReceived: this.messagesReceived || 0,
      itemsIngested: this.itemsIngested || 0,
      lastMessageAt: this.lastMessageAt,
      channels: [...CHANNEL_IDS],
      botUser: this.client?.user ? { tag: this.client.user.tag, id: this.client.user.id } : null
    };
  }

  processMessage(message) {
    const text = message.content;
    if (!text || text.length < 5) return;

    // Split multi-segment messages (separated by double newline or ** ** dividers)
    const segments = text.split(/\n\s*\*\*\s*\*\*\s*\n|\n{2,}/).filter(s => s.trim().length > 10);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i].trim();
      this.processSegment(segment, message, i);
    }
  }

  processSegment(text, message, segmentIndex) {
    const ticker = this.extractTicker(text);
    const urls = this.extractUrls(text, message);
    const country = this.extractCountry(text);
    const marketCap = this.extractMarketCap(text);
    const dedupeKey = this.buildDedupeKey(ticker, text, message.id, segmentIndex);

    const now = new Date().toISOString();

    const item = {
      source_type: 'discord',
      source_key: dedupeKey,
      ticker_symbol: ticker,
      text: text,
      country_iso2: country,
      market_cap_raw: marketCap.raw,
      market_cap_value: marketCap.value,
      urls_json: JSON.stringify(urls),
      source_channels_json: JSON.stringify([message.channel.id]),
      source_message_ids_json: JSON.stringify([message.id]),
      original_timestamp: now,
      raw_json: JSON.stringify({
        message_id: message.id,
        channel_id: message.channel.id,
        author_id: message.author.id,
        author_name: message.author.username,
        timestamp: message.createdTimestamp,
        segment_index: segmentIndex
      })
    };

    const result = this.db.insertNewsItem(item);
    if (result.changes > 0) {
      this.itemsIngested++;
      const inserted = this.db.getNewsItemBySourceKey(dedupeKey);
      if (inserted) {
        log(`New item #${this.itemsIngested}: ${ticker || 'N/A'} - ${text.substring(0, 80)}`);
        this.onNewItem(inserted);
      }
    } else {
      // Update timestamp on existing item
      this.db.db.prepare(
        'UPDATE news_items SET original_timestamp = ? WHERE source_key = ?'
      ).run(now, dedupeKey);
    }
  }

  extractTicker(text) {
    for (const pattern of TICKER_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const ticker = match[1].toUpperCase();
        if (!STOP_WORDS.has(ticker) && ticker.length >= 1) {
          return ticker;
        }
      }
    }
    return null;
  }

  extractUrls(text, message) {
    const urls = new Set();

    // URLs from text
    const urlRegex = /https?:\/\/[^\s<>)\]]+/g;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      urls.add(match[0].replace(/[>)]+$/, ''));
    }

    // URLs from embeds
    if (message.embeds) {
      for (const embed of message.embeds) {
        if (embed.url) urls.add(embed.url);
        if (embed.author?.url) urls.add(embed.author.url);
      }
    }

    // URLs from attachments
    if (message.attachments) {
      for (const [, att] of message.attachments) {
        if (att.url) urls.add(att.url);
      }
    }

    return [...urls];
  }

  extractCountry(text) {
    // :flag_xx: format
    const flagMatch = text.match(/:flag_([a-z]{2}):/);
    if (flagMatch) return flagMatch[1].toUpperCase();

    // Unicode flag emoji (regional indicators)
    const flagEmojiRegex = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
    const emojiMatch = text.match(flagEmojiRegex);
    if (emojiMatch) {
      const chars = [...emojiMatch[0]];
      if (chars.length === 2) {
        const a = chars[0].codePointAt(0) - 0x1F1E6;
        const b = chars[1].codePointAt(0) - 0x1F1E6;
        if (a >= 0 && a < 26 && b >= 0 && b < 26) {
          return String.fromCharCode(65 + a) + String.fromCharCode(65 + b);
        }
      }
    }

    return null;
  }

  extractMarketCap(text) {
    // Match patterns like: `78.1 M` or MC: 78.1 M or market cap patterns
    const mcPatterns = [
      /`\s*([\d,.]+)\s*([KMBkmb])\s*`/,
      /\bMC\b[:\s]*([\d,.]+)\s*([KMBkmb])/i,
      /market\s*cap[:\s]*([\d,.]+)\s*([KMBkmb])/i,
    ];

    for (const pattern of mcPatterns) {
      const match = text.match(pattern);
      if (match) {
        const num = parseFloat(match[1].replace(/,/g, ''));
        const mult = match[2].toUpperCase();
        const multipliers = { 'K': 1e3, 'M': 1e6, 'B': 1e9 };
        const value = num * (multipliers[mult] || 1);
        return { raw: `${match[1]} ${match[2].toUpperCase()}`, value };
      }
    }

    return { raw: null, value: null };
  }

  buildDedupeKey(ticker, text, messageId, segmentIndex) {
    const normalized = text.toLowerCase()
      .replace(/:flag_\w+:/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const input = [ticker || '', normalized, messageId, segmentIndex].join('|');
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /**
   * Backfill recent history from monitored channels.
   */
  async backfill(limit = 200) {
    if (!this.client || !this.client.isReady()) {
      log('Cannot backfill: client not ready');
      return;
    }

    for (const channelId of CHANNEL_IDS) {
      try {
        const channel = await this.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) continue;

        log(`Backfilling ${limit} messages from channel ${channelId}...`);
        const messages = await channel.messages.fetch({ limit: Math.min(limit, 100) });

        let count = 0;
        for (const [, message] of messages) {
          try {
            this.processMessage(message);
            count++;
          } catch(e) {}
        }
        log(`Backfilled ${count} messages from channel ${channelId}`);
      } catch (err) {
        log(`Backfill error for channel ${channelId}: ${err.message}`);
      }
    }
  }
}

module.exports = DiscordScraper;
