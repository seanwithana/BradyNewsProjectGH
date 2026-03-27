class KeywordEngine {
  constructor(database) {
    this.db = database;
  }

  /**
   * Process a single news item against all enabled rulesets.
   * Returns array of { rulesetId, matchedKeywords, color } for matches.
   */
  processItem(newsItem, sourceType = 'discord') {
    const rulesets = this.db.getRulesets().filter(rs => {
      if (!rs.enabled) return false;
      const sources = (rs.sources || 'discord').split(',').map(s => s.trim());
      return sources.includes(sourceType);
    });
    const matches = [];

    for (const ruleset of rulesets) {
      const result = this.evaluateRuleset(ruleset, newsItem.text);
      if (result.matched) {
        matches.push({
          rulesetId: ruleset.id,
          rulesetName: ruleset.name,
          matchedKeywords: result.matchedKeywords,
          color: ruleset.color,
          audioPath: ruleset.audio_path,
          llmEnabled: !!ruleset.llm_enabled,
          scoringEnabled: !!ruleset.llm_scoring_enabled
        });

        // Enqueue for LLM analysis if enabled on this ruleset
        if (ruleset.llm_enabled && newsItem.id) {
          const systemPrompt = ruleset.llm_prompt || 'Analyze the following news item and provide a brief summary of its significance.';
          const outputFormat = ruleset.llm_output_format || '';
          let fullPrompt = systemPrompt;
          if (outputFormat) {
            fullPrompt += '\n\nDesired output format:\n' + outputFormat;
          }
          if (ruleset.llm_scoring_enabled && ruleset.llm_scoring_criteria) {
            fullPrompt += '\n\nScoring instructions:\n' + ruleset.llm_scoring_criteria;
            fullPrompt += '\nYou MUST include a "score" field (integer from -1000 to 1000) in your JSON response.';
          }
          fullPrompt += '\n\nNews item:\n' + newsItem.text;

          const target = ruleset.llm_target || 'local';
          if (target === 'local' || target === 'both') {
            this.db.enqueueLLM(newsItem.id, ruleset.id, fullPrompt, 'local');
          }
          if (target === 'api' || target === 'both') {
            this.db.enqueueLLM(newsItem.id, ruleset.id, fullPrompt, 'api', ruleset.llm_api_provider);
          }
        }
      }
    }

    return matches;
  }

  /**
   * Evaluate a single ruleset against text.
   * Rules are grouped by rule_group. Within a group, logic_operator determines AND/OR.
   * Groups are combined with OR (any group matching = ruleset matches).
   */
  evaluateRuleset(ruleset, text) {
    if (!ruleset.rules || ruleset.rules.length === 0) {
      return { matched: false, matchedKeywords: [] };
    }

    const textLower = text.toLowerCase();

    // Check exclusions first
    if (ruleset.exclusions && ruleset.exclusions.length > 0) {
      for (const excl of ruleset.exclusions) {
        if (textLower.includes(excl.keyword.toLowerCase())) {
          return { matched: false, matchedKeywords: [] };
        }
      }
    }

    // Group rules by rule_group
    const groups = {};
    for (const rule of ruleset.rules) {
      const g = rule.rule_group || 0;
      if (!groups[g]) groups[g] = [];
      groups[g].push(rule);
    }

    const allMatchedKeywords = [];

    // Each group is evaluated independently; any group passing = match
    for (const groupId of Object.keys(groups)) {
      const groupRules = groups[groupId];
      const operator = groupRules[0].logic_operator || 'OR';

      const groupMatched = [];
      let groupPasses = false;

      if (operator === 'AND') {
        // All rules in group must satisfy their condition
        let allMatch = true;
        for (const rule of groupRules) {
          const found = textLower.includes(rule.keyword.toLowerCase());
          const pass = rule.negate ? !found : found;
          if (pass) {
            groupMatched.push((rule.negate ? 'NOT ' : '') + rule.keyword);
          } else {
            allMatch = false;
            break;
          }
        }
        groupPasses = allMatch && groupRules.length > 0;
      } else {
        // OR: any rule satisfying its condition = group passes
        for (const rule of groupRules) {
          const found = textLower.includes(rule.keyword.toLowerCase());
          const pass = rule.negate ? !found : found;
          if (pass) {
            groupMatched.push((rule.negate ? 'NOT ' : '') + rule.keyword);
          }
        }
        groupPasses = groupMatched.length > 0;
      }

      if (groupPasses) {
        allMatchedKeywords.push(...groupMatched);
      }
    }

    // Deduplicate
    const unique = [...new Set(allMatchedKeywords)];
    return {
      matched: unique.length > 0,
      matchedKeywords: unique
    };
  }

  /**
   * Reprocess historical news items against a specific ruleset.
   */
  reprocess(rulesetId, timePeriod) {
    const ruleset = this.db.getRulesetById(rulesetId);
    if (!ruleset) return [];

    const now = new Date();
    let since;
    switch (timePeriod) {
      case '1h':  since = new Date(now - 60 * 60 * 1000); break;
      case '6h':  since = new Date(now - 6 * 60 * 60 * 1000); break;
      case '12h': since = new Date(now - 12 * 60 * 60 * 1000); break;
      case '1d':  since = new Date(now - 24 * 60 * 60 * 1000); break;
      case '1w':  since = new Date(now - 7 * 24 * 60 * 60 * 1000); break;
      default:    since = new Date(now - 24 * 60 * 60 * 1000);
    }

    const sinceStr = since.toISOString().replace('T', ' ').slice(0, 19);
    let items = this.db.getNewsItemsSince(sinceStr);
    if (!items || items.length === 0) {
      items = this.db.db.prepare('SELECT * FROM news_items ORDER BY id DESC LIMIT 500').all();
    }
    const results = [];

    for (const item of items) {
      const result = this.evaluateRuleset(ruleset, item.text);
      if (result.matched) {
        this.db.insertFeedEntry({
          news_item_id: item.id,
          ruleset_id: rulesetId,
          matched_keywords: JSON.stringify(result.matchedKeywords),
          received_at: item.original_timestamp,
          color: ruleset.color,
          score_gated: !!ruleset.llm_scoring_enabled
        });
        results.push({
          newsItemId: item.id,
          matchedKeywords: result.matchedKeywords,
          text: item.text.substring(0, 200)
        });
      }
    }

    return results;
  }
}

module.exports = KeywordEngine;
