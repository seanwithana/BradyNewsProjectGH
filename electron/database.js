const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class BradyDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  initialize() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.createTables();
    this.migrate();
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS news_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_key TEXT NOT NULL UNIQUE,
        ticker_symbol TEXT,
        text TEXT NOT NULL,
        country_iso2 TEXT,
        market_cap_raw TEXT,
        market_cap_value REAL,
        urls_json TEXT,
        source_channels_json TEXT,
        source_message_ids_json TEXT,
        original_timestamp TEXT NOT NULL,
        ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
        raw_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_news_items_source ON news_items(source_type, source_key);
      CREATE INDEX IF NOT EXISTS idx_news_items_timestamp ON news_items(original_timestamp);
      CREATE INDEX IF NOT EXISTS idx_news_items_ticker ON news_items(ticker_symbol);

      CREATE TABLE IF NOT EXISTS keyword_rulesets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#ffffff',
        audio_path TEXT,
        audio_name TEXT,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS keyword_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ruleset_id INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        logic_operator TEXT DEFAULT 'OR',
        rule_group INTEGER DEFAULT 0,
        negate INTEGER DEFAULT 0,
        FOREIGN KEY (ruleset_id) REFERENCES keyword_rulesets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS exclusion_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ruleset_id INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        FOREIGN KEY (ruleset_id) REFERENCES keyword_rulesets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS news_feed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        news_item_id INTEGER NOT NULL,
        ruleset_id INTEGER NOT NULL,
        matched_keywords TEXT,
        received_at TEXT NOT NULL,
        filtered_at TEXT NOT NULL DEFAULT (datetime('now')),
        displayed_at TEXT,
        color TEXT,
        FOREIGN KEY (news_item_id) REFERENCES news_items(id),
        FOREIGN KEY (ruleset_id) REFERENCES keyword_rulesets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_news_feed_displayed ON news_feed(displayed_at);
      CREATE INDEX IF NOT EXISTS idx_news_feed_item ON news_feed(news_item_id);
    `);
  }

  migrate() {
    const ruleCols = this.db.prepare("PRAGMA table_info(keyword_rules)").all();
    if (!ruleCols.find(c => c.name === 'negate')) {
      this.db.exec("ALTER TABLE keyword_rules ADD COLUMN negate INTEGER DEFAULT 0");
    }

    const rsCols = this.db.prepare("PRAGMA table_info(keyword_rulesets)").all();
    if (!rsCols.find(c => c.name === 'llm_enabled')) {
      this.db.exec("ALTER TABLE keyword_rulesets ADD COLUMN llm_enabled INTEGER DEFAULT 0");
      this.db.exec("ALTER TABLE keyword_rulesets ADD COLUMN llm_prompt TEXT");
    }
    if (!rsCols.find(c => c.name === 'llm_output_format')) {
      this.db.exec("ALTER TABLE keyword_rulesets ADD COLUMN llm_output_format TEXT");
    }
    if (!rsCols.find(c => c.name === 'llm_scoring_enabled')) {
      this.db.exec("ALTER TABLE keyword_rulesets ADD COLUMN llm_scoring_enabled INTEGER DEFAULT 0");
      this.db.exec("ALTER TABLE keyword_rulesets ADD COLUMN llm_scoring_criteria TEXT");
      this.db.exec("ALTER TABLE keyword_rulesets ADD COLUMN llm_scoring_threshold INTEGER DEFAULT 0");
    }

    // LLM queue table for items pending/completed LLM analysis
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        news_item_id INTEGER NOT NULL,
        ruleset_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        prompt TEXT,
        response TEXT,
        model TEXT,
        llm_score INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        error TEXT,
        FOREIGN KEY (news_item_id) REFERENCES news_items(id),
        FOREIGN KEY (ruleset_id) REFERENCES keyword_rulesets(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_llm_queue_status ON llm_queue(status);
    `);

    const lqCols = this.db.prepare("PRAGMA table_info(llm_queue)").all();
    if (lqCols.length > 0 && !lqCols.find(c => c.name === 'llm_score')) {
      this.db.exec("ALTER TABLE llm_queue ADD COLUMN llm_score INTEGER");
    }

    // Add score_pending column to news_feed for gating
    const nfCols = this.db.prepare("PRAGMA table_info(news_feed)").all();
    if (!nfCols.find(c => c.name === 'score_gated')) {
      this.db.exec("ALTER TABLE news_feed ADD COLUMN score_gated INTEGER DEFAULT 0");
      this.db.exec("ALTER TABLE news_feed ADD COLUMN llm_score INTEGER");
    }

  }

  // ── News Items ──

  insertNewsItem(item) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO news_items
        (source_type, source_key, ticker_symbol, text, country_iso2,
         market_cap_raw, market_cap_value, urls_json, source_channels_json,
         source_message_ids_json, original_timestamp, ingested_at, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `);
    return stmt.run(
      item.source_type, item.source_key, item.ticker_symbol, item.text,
      item.country_iso2, item.market_cap_raw, item.market_cap_value,
      item.urls_json, item.source_channels_json, item.source_message_ids_json,
      item.original_timestamp, item.raw_json || null
    );
  }

  getNewsItemBySourceKey(sourceKey) {
    return this.db.prepare('SELECT * FROM news_items WHERE source_key = ?').get(sourceKey);
  }

  getLatestTimestamp(sourceType) {
    const row = this.db.prepare(
      'SELECT MAX(original_timestamp) as latest FROM news_items WHERE source_type = ?'
    ).get(sourceType);
    return row ? row.latest : null;
  }

  getNewsItemsSince(timestamp) {
    return this.db.prepare(
      'SELECT * FROM news_items WHERE original_timestamp >= ? ORDER BY original_timestamp DESC'
    ).all(timestamp);
  }

  // ── Rulesets ──

  getRulesets() {
    const rulesets = this.db.prepare('SELECT * FROM keyword_rulesets ORDER BY created_at DESC').all();
    for (const rs of rulesets) {
      rs.rules = this.db.prepare('SELECT * FROM keyword_rules WHERE ruleset_id = ? ORDER BY rule_group, id').all(rs.id);
      rs.exclusions = this.db.prepare('SELECT * FROM exclusion_rules WHERE ruleset_id = ?').all(rs.id);
    }
    return rulesets;
  }

  saveRuleset(ruleset) {
    const insertRuleset = this.db.prepare(`
      INSERT INTO keyword_rulesets (name, color, audio_path, audio_name, enabled, llm_enabled, llm_prompt, llm_output_format, llm_scoring_enabled, llm_scoring_criteria, llm_scoring_threshold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRule = this.db.prepare(`
      INSERT INTO keyword_rules (ruleset_id, keyword, logic_operator, rule_group, negate)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertExclusion = this.db.prepare(`
      INSERT INTO exclusion_rules (ruleset_id, keyword) VALUES (?, ?)
    `);

    const txn = this.db.transaction(() => {
      const result = insertRuleset.run(
        ruleset.name, ruleset.color || '#ffffff',
        ruleset.audio_path || null, ruleset.audio_name || null,
        ruleset.enabled !== false ? 1 : 0,
        ruleset.llm_enabled ? 1 : 0, ruleset.llm_prompt || null,
        ruleset.llm_output_format || null,
        ruleset.llm_scoring_enabled ? 1 : 0,
        ruleset.llm_scoring_criteria || null,
        ruleset.llm_scoring_threshold || 0
      );
      const rulesetId = result.lastInsertRowid;

      if (ruleset.rules) {
        for (const rule of ruleset.rules) {
          insertRule.run(rulesetId, rule.keyword, rule.logic_operator || 'OR', rule.rule_group || 0, rule.negate ? 1 : 0);
        }
      }
      if (ruleset.exclusions) {
        for (const excl of ruleset.exclusions) {
          insertExclusion.run(rulesetId, excl.keyword);
        }
      }
      return rulesetId;
    });

    const rulesetId = txn();
    return this.getRulesetById(rulesetId);
  }

  updateRuleset(ruleset) {
    const txn = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE keyword_rulesets SET name=?, color=?, audio_path=?, audio_name=?, enabled=?,
        llm_enabled=?, llm_prompt=?, llm_output_format=?,
        llm_scoring_enabled=?, llm_scoring_criteria=?, llm_scoring_threshold=?,
        updated_at=datetime('now')
        WHERE id=?
      `).run(ruleset.name, ruleset.color, ruleset.audio_path, ruleset.audio_name, ruleset.enabled ? 1 : 0,
        ruleset.llm_enabled ? 1 : 0, ruleset.llm_prompt || null, ruleset.llm_output_format || null,
        ruleset.llm_scoring_enabled ? 1 : 0, ruleset.llm_scoring_criteria || null,
        ruleset.llm_scoring_threshold || 0, ruleset.id);

      this.db.prepare('DELETE FROM keyword_rules WHERE ruleset_id=?').run(ruleset.id);
      this.db.prepare('DELETE FROM exclusion_rules WHERE ruleset_id=?').run(ruleset.id);

      if (ruleset.rules) {
        const insertRule = this.db.prepare(
          'INSERT INTO keyword_rules (ruleset_id, keyword, logic_operator, rule_group) VALUES (?, ?, ?, ?)'
        );
        for (const rule of ruleset.rules) {
          insertRule.run(ruleset.id, rule.keyword, rule.logic_operator || 'OR', rule.rule_group || 0, rule.negate ? 1 : 0);
        }
      }
      if (ruleset.exclusions) {
        const insertExcl = this.db.prepare('INSERT INTO exclusion_rules (ruleset_id, keyword) VALUES (?, ?)');
        for (const excl of ruleset.exclusions) {
          insertExcl.run(ruleset.id, excl.keyword);
        }
      }
    });
    txn();
    return this.getRulesetById(ruleset.id);
  }

  getRulesetById(id) {
    const rs = this.db.prepare('SELECT * FROM keyword_rulesets WHERE id = ?').get(id);
    if (!rs) return null;
    rs.rules = this.db.prepare('SELECT * FROM keyword_rules WHERE ruleset_id = ? ORDER BY rule_group, id').all(id);
    rs.exclusions = this.db.prepare('SELECT * FROM exclusion_rules WHERE ruleset_id = ?').all(id);
    return rs;
  }

  deleteRuleset(id) {
    this.db.prepare('DELETE FROM news_feed WHERE ruleset_id = ?').run(id);
    this.db.prepare('DELETE FROM keyword_rulesets WHERE id = ?').run(id);
    return true;
  }

  // ── News Feed ──

  insertFeedEntry(entry) {
    const existing = this.db.prepare(
      'SELECT id FROM news_feed WHERE news_item_id = ? AND ruleset_id = ?'
    ).get(entry.news_item_id, entry.ruleset_id);
    if (existing) return existing;

    return this.db.prepare(`
      INSERT INTO news_feed (news_item_id, ruleset_id, matched_keywords, received_at, filtered_at, displayed_at, color, score_gated)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?)
    `).run(entry.news_item_id, entry.ruleset_id, entry.matched_keywords, entry.received_at, entry.color, entry.score_gated ? 1 : 0);
  }

  // ── LLM Queue ──

  enqueueLLM(newsItemId, rulesetId, prompt) {
    const existing = this.db.prepare(
      'SELECT id FROM llm_queue WHERE news_item_id = ? AND ruleset_id = ?'
    ).get(newsItemId, rulesetId);
    if (existing) return existing;

    return this.db.prepare(`
      INSERT INTO llm_queue (news_item_id, ruleset_id, prompt, status)
      VALUES (?, ?, ?, 'pending')
    `).run(newsItemId, rulesetId, prompt);
  }

  getLLMQueue(filters = {}) {
    let where = ['1=1'];
    let params = [];
    if (filters.status) { where.push('lq.status = ?'); params.push(filters.status); }
    if (filters.rulesetId) { where.push('lq.ruleset_id = ?'); params.push(filters.rulesetId); }
    const limit = filters.limit || 200;
    return this.db.prepare(`
      SELECT lq.*, ni.text as news_text, ni.ticker_symbol, ni.urls_json,
             ni.original_timestamp, kr.name as ruleset_name, kr.color as ruleset_color
      FROM llm_queue lq
      JOIN news_items ni ON lq.news_item_id = ni.id
      JOIN keyword_rulesets kr ON lq.ruleset_id = kr.id
      WHERE ${where.join(' AND ')}
      ORDER BY lq.created_at DESC
      LIMIT ?
    `).all(...params, limit);
  }

  getLLMStats() {
    const pending = this.db.prepare("SELECT COUNT(*) as c FROM llm_queue WHERE status='pending'").get().c;
    const completed = this.db.prepare("SELECT COUNT(*) as c FROM llm_queue WHERE status='completed'").get().c;
    const failed = this.db.prepare("SELECT COUNT(*) as c FROM llm_queue WHERE status='failed'").get().c;
    return { pending, completed, failed, total: pending + completed + failed };
  }

  getPendingLLM(limit = 50) {
    return this.db.prepare(`
      SELECT lq.*, ni.text, ni.ticker_symbol, ni.urls_json, kr.name as ruleset_name
      FROM llm_queue lq
      JOIN news_items ni ON lq.news_item_id = ni.id
      JOIN keyword_rulesets kr ON lq.ruleset_id = kr.id
      WHERE lq.status = 'pending'
      ORDER BY lq.created_at ASC
      LIMIT ?
    `).all(limit);
  }

  completeLLM(id, response, model, score = null) {
    this.db.prepare(`
      UPDATE llm_queue SET status='completed', response=?, model=?, llm_score=?, completed_at=datetime('now')
      WHERE id=?
    `).run(response, model, score, id);

    // If scoring is enabled on the ruleset, update the news_feed entry
    if (score !== null) {
      const queueItem = this.db.prepare('SELECT news_item_id, ruleset_id FROM llm_queue WHERE id=?').get(id);
      if (queueItem) {
        this.db.prepare(
          'UPDATE news_feed SET score_gated=1, llm_score=? WHERE news_item_id=? AND ruleset_id=?'
        ).run(score, queueItem.news_item_id, queueItem.ruleset_id);
      }
    }
  }

  failLLM(id, error) {
    this.db.prepare(`
      UPDATE llm_queue SET status='failed', error=?, completed_at=datetime('now')
      WHERE id=?
    `).run(error, id);
  }

  getLLMResult(newsItemId) {
    return this.db.prepare(
      'SELECT * FROM llm_queue WHERE news_item_id = ? AND status = \'completed\' ORDER BY completed_at DESC LIMIT 1'
    ).get(newsItemId);
  }

  // ── News Feed ──

  getNewsFeed(filters = {}) {
    let where = ['1=1'];
    let params = [];

    if (filters.search) {
      where.push('ni.text LIKE ?');
      params.push(`%${filters.search}%`);
    }
    if (filters.startTime) {
      where.push('ni.original_timestamp >= ?');
      params.push(filters.startTime);
    }
    if (filters.endTime) {
      where.push('ni.original_timestamp <= ?');
      params.push(filters.endTime);
    }
    if (filters.rulesetId) {
      where.push('nf.ruleset_id = ?');
      params.push(filters.rulesetId);
    }
    if (filters.ticker) {
      where.push('ni.ticker_symbol LIKE ?');
      params.push(`%${filters.ticker}%`);
    }

    // Score gating: if scoring is enabled on a ruleset, only show items that meet the threshold.
    // Items with score_gated=1 but NULL llm_score are still waiting for scoring — hide them.
    // Items with score_gated=0 have no scoring requirement — always show.
    where.push('(nf.score_gated = 0 OR (nf.llm_score IS NOT NULL AND nf.llm_score >= kr.llm_scoring_threshold))');

    const limit = filters.limit || 200;
    const offset = filters.offset || 0;

    const sql = `
      SELECT nf.*, ni.source_type, ni.ticker_symbol, ni.text, ni.country_iso2,
             ni.market_cap_raw, ni.market_cap_value, ni.urls_json,
             ni.source_channels_json, ni.source_message_ids_json,
             ni.original_timestamp, ni.ingested_at,
             kr.name as ruleset_name, kr.color as ruleset_color, kr.audio_path,
             kr.llm_scoring_enabled, kr.llm_scoring_threshold,
             lq.response as llm_response, lq.status as llm_status, lq.model as llm_model,
             lq.llm_score as llm_score
      FROM news_feed nf
      JOIN news_items ni ON nf.news_item_id = ni.id
      JOIN keyword_rulesets kr ON nf.ruleset_id = kr.id
      LEFT JOIN llm_queue lq ON lq.news_item_id = ni.id AND lq.ruleset_id = nf.ruleset_id
      WHERE ${where.join(' AND ')}
      ORDER BY nf.filtered_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);
    return this.db.prepare(sql).all(...params);
  }

  searchNews(query) {
    return this.db.prepare(`
      SELECT nf.*, ni.source_type, ni.ticker_symbol, ni.text, ni.country_iso2,
             ni.market_cap_raw, ni.urls_json, ni.original_timestamp, ni.ingested_at,
             kr.name as ruleset_name, kr.color as ruleset_color,
             lq.response as llm_response, lq.status as llm_status, lq.model as llm_model
      FROM news_feed nf
      JOIN news_items ni ON nf.news_item_id = ni.id
      LEFT JOIN llm_queue lq ON lq.news_item_id = ni.id AND lq.ruleset_id = nf.ruleset_id
      JOIN keyword_rulesets kr ON nf.ruleset_id = kr.id
      WHERE ni.text LIKE ?
      ORDER BY nf.filtered_at DESC
      LIMIT 200
    `).all(`%${query}%`);
  }

  getStats() {
    const totalItems = this.db.prepare('SELECT COUNT(*) as count FROM news_items').get().count;
    const feedItems = this.db.prepare('SELECT COUNT(*) as count FROM news_feed').get().count;
    const rulesets = this.db.prepare('SELECT COUNT(*) as count FROM keyword_rulesets').get().count;
    return { totalItems, feedItems, rulesets };
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = BradyDatabase;
