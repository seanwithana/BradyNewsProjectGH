// ── State ──
let currentRuleset = null;
let editingRulesetId = null;
let audioFilePath = null;
let audioFileName = null;
let testAudioElement = null;

// ── Tab Switching ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

    if (btn.dataset.tab === 'news-feed') refreshFeed();
    if (btn.dataset.tab === 'all-news') { refreshAllNews(); refreshDiscordStatus(); }
    if (btn.dataset.tab === 'keyword-filters') refreshRulesets();
    if (btn.dataset.tab === 'llm-analysis') { populateLLMRulesetFilter(); refreshLLMQueue(); }
  });
});

// ── News Feed ──
async function refreshFeed() {
  const filters = buildFeedFilters();
  const items = await window.api.getNewsFeed(filters);
  renderFeedItems(items);
  refreshStats();
}

function buildFeedFilters() {
  const filters = {};
  const search = document.getElementById('feed-search').value.trim();
  if (search) filters.search = search;

  const ticker = document.getElementById('feed-ticker').value.trim();
  if (ticker) filters.ticker = ticker;

  const preset = document.getElementById('feed-time-preset').value;
  if (preset && preset !== 'custom') {
    const now = new Date();
    let ms;
    switch (preset) {
      case '15m': ms = 15 * 60 * 1000; break;
      case '1h':  ms = 60 * 60 * 1000; break;
      case '6h':  ms = 6 * 60 * 60 * 1000; break;
      case '12h': ms = 12 * 60 * 60 * 1000; break;
      case '1d':  ms = 24 * 60 * 60 * 1000; break;
      case '1w':  ms = 7 * 24 * 60 * 60 * 1000; break;
    }
    if (ms) filters.startTime = new Date(now - ms).toISOString().replace('T', ' ').slice(0, 19);
  } else if (preset === 'custom') {
    const st = document.getElementById('feed-start-time').value;
    const et = document.getElementById('feed-end-time').value;
    if (st) filters.startTime = st.replace('T', ' ');
    if (et) filters.endTime = et.replace('T', ' ');
  }

  const rulesetId = document.getElementById('feed-ruleset-filter').value;
  if (rulesetId) filters.rulesetId = parseInt(rulesetId);

  return filters;
}

function renderFeedItems(items) {
  const list = document.getElementById('news-feed-list');

  if (!items || items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📰</div>
        <div>No news items match your filters</div>
        <div style="font-size:12px">Create keyword rulesets in the Keyword Filters tab to start filtering news</div>
      </div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const matchedKeywords = safeParseJSON(item.matched_keywords, []);
    let text = escapeHtml(item.text);

    // Highlight matched keywords
    for (const kw of matchedKeywords) {
      const escaped = escapeRegex(kw);
      const regex = new RegExp(`(${escaped})`, 'gi');
      text = text.replace(regex, '<span class="keyword-highlight">$1</span>');
    }

    // Parse Discord-style formatting
    text = formatDiscordText(text);

    const urls = safeParseJSON(item.urls_json, []);
    const borderColor = item.color || item.ruleset_color || '#6c63ff';

    return `
      <div class="news-card" style="border-left-color: ${borderColor}">
        <div class="news-card-header">
          <div style="display:flex;gap:8px;align-items:center">
            <span class="news-card-ticker">${escapeHtml(item.ticker_symbol || 'N/A')}</span>
            ${item.market_cap_raw ? `<span class="market-cap-badge">MC: ${escapeHtml(item.market_cap_raw)}</span>` : ''}
            ${item.country_iso2 ? `<span class="country-badge">${escapeHtml(item.country_iso2)}</span>` : ''}
          </div>
          <span class="news-card-ruleset" style="background:${borderColor}22;color:${borderColor}">
            ${escapeHtml(item.ruleset_name || '')}
            ${matchedKeywords.length > 0 ? ` [${matchedKeywords.map(k => escapeHtml(k)).join(', ')}]` : ''}
          </span>
        </div>
        <div class="news-card-body">${text}</div>
        ${urls.length > 0 ? `
          <div class="news-card-urls">
            ${urls.map(u => `<a href="${escapeHtml(u)}" target="_blank">${escapeHtml(u)}</a>`).join(' ')}
          </div>` : ''}
        ${renderLLMResponse(item)}
        <div class="news-card-timestamps">
          <span>Received: ${formatTimestamp(item.received_at || item.original_timestamp)}</span>
          <span>Filtered: ${formatTimestamp(item.filtered_at)}</span>
          <span>Displayed: ${formatTimestamp(item.displayed_at)}</span>
        </div>
      </div>`;
  }).join('');
}

// ── Discord Text Formatting ──

// Discord :flag_xx: to Unicode flag emoji
const FLAG_EMOJI_MAP = {};
(function buildFlagMap() {
  // Convert 2-letter country codes to regional indicator symbols
  // :flag_us: -> 🇺🇸, :flag_il: -> 🇮🇱, etc.
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(97 + i) + String.fromCharCode(97 + j);
      const flag = String.fromCodePoint(0x1F1E6 + i) + String.fromCodePoint(0x1F1E6 + j);
      FLAG_EMOJI_MAP[code] = flag;
    }
  }
})();

// Discord custom emoji name -> Unicode mapping for common ones
const DISCORD_EMOJI_MAP = {
  ':arrow_up:': '⬆️', ':arrow_down:': '⬇️', ':arrow_right:': '➡️',
  ':arrow_upper_right:': '↗️', ':arrow_lower_right:': '↘️',
  ':chart_with_upwards_trend:': '📈', ':chart_with_downwards_trend:': '📉',
  ':green_circle:': '🟢', ':red_circle:': '🔴', ':yellow_circle:': '🟡',
  ':white_check_mark:': '✅', ':x:': '❌', ':warning:': '⚠️',
  ':bulb:': '💡', ':fire:': '🔥', ':rocket:': '🚀', ':star:': '⭐',
  ':moneybag:': '💰', ':dollar:': '💵', ':money_with_wings:': '💸',
  ':bell:': '🔔', ':loudspeaker:': '📢', ':mega:': '📣',
  ':newspaper:': '📰', ':link:': '🔗', ':lock:': '🔒',
  ':clock1:': '🕐', ':clock2:': '🕑', ':clock3:': '🕒',
  ':heavy_check_mark:': '✔️', ':heavy_minus_sign:': '➖',
  ':small_red_triangle:': '🔺', ':small_red_triangle_down:': '🔻',
  ':pushpin:': '📌', ':round_pushpin:': '📍',
  ':eyes:': '👀', ':point_right:': '👉', ':point_left:': '👈',
};

function formatDiscordText(text) {
  // Discord flag emojis: :flag_xx: -> Unicode flag
  text = text.replace(/:flag_([a-z]{2}):/g, (_, code) => FLAG_EMOJI_MAP[code] || `:flag_${code}:`);

  // Discord named emojis
  for (const [name, emoji] of Object.entries(DISCORD_EMOJI_MAP)) {
    text = text.replaceAll(escapeHtml(name) || name, emoji);
  }

  // Discord timestamps: <t:1234567890:R> or <t:1234567890:f> etc.
  text = text.replace(/&lt;t:(\d+)(?::([tTdDfFR]))?&gt;/g, (_, ts, style) => {
    const date = new Date(parseInt(ts) * 1000);
    let formatted;
    switch (style) {
      case 'R': // Relative
        const diff = Date.now() - date.getTime();
        const mins = Math.floor(Math.abs(diff) / 60000);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) formatted = `${days}d ago`;
        else if (hours > 0) formatted = `${hours}h ago`;
        else formatted = `${mins}m ago`;
        break;
      case 'd': case 'D': formatted = date.toLocaleDateString(); break;
      case 't': formatted = date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); break;
      case 'T': formatted = date.toLocaleTimeString(); break;
      case 'f': formatted = date.toLocaleString([], {dateStyle:'medium',timeStyle:'short'}); break;
      case 'F': formatted = date.toLocaleString([], {dateStyle:'full',timeStyle:'short'}); break;
      default: formatted = date.toLocaleString(); break;
    }
    return `<span style="background:rgba(88,101,242,0.15);padding:1px 4px;border-radius:3px;color:#b5bac1" title="${date.toISOString()}">${formatted}</span>`;
  });

  // Discord links: [text](<url>) -> clickable link (strip angle brackets)
  text = text.replace(/\[([^\]]+)\]\(&lt;(https?:\/\/[^&]+?)&gt;\)/g,
    '<a href="$2" target="_blank" style="color:#00aff4;text-decoration:none">$1</a>');
  // Also handle [text](url) without angle brackets
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+?)\)/g,
    '<a href="$2" target="_blank" style="color:#00aff4;text-decoration:none">$1</a>');

  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* or _text_
  text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');
  // Underline: __text__
  text = text.replace(/__(.+?)__/g, '<u>$1</u>');
  // Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
  // Code block: ```text```
  text = text.replace(/```([^`]+?)```/g, '<code style="display:block;background:rgba(0,0,0,0.3);padding:8px;border-radius:4px;margin:4px 0;font-family:monospace">$1</code>');
  // Inline code: `text`
  text = text.replace(/`([^`]+?)`/g, '<code style="background:rgba(0,0,0,0.3);padding:1px 4px;border-radius:3px;font-family:monospace">$1</code>');
  // Blockquote: > text (with optional bullet *)
  text = text.replace(/^&gt; \* (.+)$/gm, '<div style="border-left:3px solid #5865f2;padding-left:8px;color:#b5bac1;margin:2px 0">• $1</div>');
  text = text.replace(/^&gt; (.+)$/gm, '<div style="border-left:3px solid #5865f2;padding-left:8px;color:#b5bac1;margin:2px 0">$1</div>');

  return text;
}

// ── LLM Response Rendering ──

function renderLLMResponse(item) {
  if (!item.llm_response) {
    if (item.llm_status === 'pending') {
      return '<div class="llm-response"><div class="llm-pending">LLM analysis pending...</div></div>';
    }
    return '';
  }

  // Try to parse as JSON first
  let data;
  try {
    data = JSON.parse(item.llm_response);
  } catch {
    // Not JSON — render as plain text
    return `<div class="llm-response"><div class="llm-text">${escapeHtml(item.llm_response)}</div></div>`;
  }

  if (typeof data !== 'object' || data === null) {
    return `<div class="llm-response"><div class="llm-text">${escapeHtml(item.llm_response)}</div></div>`;
  }

  // Render JSON fields in a readable layout
  const fields = Object.entries(data);
  if (fields.length === 0) return '';

  const html = fields.map(([key, value]) => {
    const label = formatFieldLabel(key);
    const rendered = renderFieldValue(key, value);
    return `<div class="llm-field"><span class="llm-field-label">${label}</span>${rendered}</div>`;
  }).join('');

  const modelTag = item.llm_model ? `<span class="llm-model">${escapeHtml(item.llm_model)}</span>` : '';
  const scoreTag = item.llm_score != null ? `<span class="llm-score-badge ${item.llm_score >= 0 ? 'positive' : 'negative'}">Score: ${item.llm_score}</span>` : '';

  return `<div class="llm-response"><div class="llm-header">LLM Analysis ${modelTag}${scoreTag}</div>${html}</div>`;
}

function formatFieldLabel(key) {
  // snake_case/camelCase -> Title Case
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function renderFieldValue(key, value) {
  if (value === null || value === undefined) {
    return '<span class="llm-field-value llm-muted">N/A</span>';
  }

  // Arrays — render as tag list or bullet list
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="llm-field-value llm-muted">None</span>';
    // Short string arrays → tags
    if (value.every(v => typeof v === 'string' && v.length < 60)) {
      return `<span class="llm-field-value">${value.map(v => `<span class="llm-tag">${escapeHtml(v)}</span>`).join('')}</span>`;
    }
    // Longer items → bullet list
    return `<ul class="llm-list">${value.map(v => `<li>${escapeHtml(String(v))}</li>`).join('')}</ul>`;
  }

  // Nested objects — render as sub-fields
  if (typeof value === 'object') {
    const subFields = Object.entries(value).map(([k, v]) =>
      `<span class="llm-sub-field"><span class="llm-sub-label">${formatFieldLabel(k)}:</span> ${escapeHtml(String(v))}</span>`
    ).join('');
    return `<div class="llm-field-value">${subFields}</div>`;
  }

  // Booleans
  if (typeof value === 'boolean') {
    return `<span class="llm-field-value">${value ? '✓ Yes' : '✗ No'}</span>`;
  }

  // Numbers — check for score-like fields
  if (typeof value === 'number') {
    const keyLower = key.toLowerCase();
    if (keyLower.includes('score') || keyLower.includes('rating') || keyLower.includes('confidence')) {
      return `<span class="llm-field-value">${renderScoreBar(value, key)}</span>`;
    }
    return `<span class="llm-field-value">${value}</span>`;
  }

  // Sentiment-like strings — color code them
  const strValue = String(value);
  const lower = strValue.toLowerCase();
  if (['bullish', 'positive', 'buy', 'strong buy'].includes(lower)) {
    return `<span class="llm-field-value llm-sentiment-positive">${escapeHtml(strValue)}</span>`;
  }
  if (['bearish', 'negative', 'sell', 'strong sell'].includes(lower)) {
    return `<span class="llm-field-value llm-sentiment-negative">${escapeHtml(strValue)}</span>`;
  }
  if (['neutral', 'hold', 'mixed'].includes(lower)) {
    return `<span class="llm-field-value llm-sentiment-neutral">${escapeHtml(strValue)}</span>`;
  }

  return `<span class="llm-field-value">${escapeHtml(strValue)}</span>`;
}

function renderScoreBar(value, key) {
  // Determine max from field name or assume 10
  let max = 10;
  if (key.toLowerCase().includes('100') || value > 10) max = 100;
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color = pct >= 70 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#f87171';
  return `<span class="llm-score">${value}/${max}</span>
    <span class="llm-score-bar"><span class="llm-score-fill" style="width:${pct}%;background:${color}"></span></span>`;
}

// ── All News Tab ──

async function refreshAllNews() {
  const filters = {};
  const search = document.getElementById('allnews-search').value.trim();
  if (search) filters.search = search;
  const ticker = document.getElementById('allnews-ticker').value.trim();
  if (ticker) filters.ticker = ticker;
  const preset = document.getElementById('allnews-time-preset').value;
  if (preset) {
    const ms = { '1h': 3600000, '6h': 21600000, '1d': 86400000, '1w': 604800000 }[preset];
    if (ms) filters.startTime = new Date(Date.now() - ms).toISOString().replace('T', ' ').slice(0, 19);
  }

  const items = await window.api.getAllNews(filters);
  const list = document.getElementById('all-news-list');

  if (!items || items.length === 0) {
    list.innerHTML = `<div class="empty-state"><div>No news items collected yet</div><div style="font-size:12px">Waiting for Discord scraper to receive messages...</div></div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    let text = escapeHtml(item.text);
    text = formatDiscordText(text);
    const urls = safeParseJSON(item.urls_json, []);

    return `
      <div class="news-card" style="border-left-color: var(--accent)">
        <div class="news-card-header">
          <div style="display:flex;gap:8px;align-items:center">
            <span class="news-card-ticker">${escapeHtml(item.ticker_symbol || 'N/A')}</span>
            ${item.market_cap_raw ? `<span class="market-cap-badge">MC: ${escapeHtml(item.market_cap_raw)}</span>` : ''}
            ${item.country_iso2 ? `<span class="country-badge">${escapeHtml(item.country_iso2)}</span>` : ''}
          </div>
          <span style="font-size:11px;color:var(--text-muted)">${escapeHtml(item.source_type || '')}</span>
        </div>
        <div class="news-card-body">${text}</div>
        ${urls.length > 0 ? `<div class="news-card-urls">${urls.map(u => `<a href="${escapeHtml(u)}" target="_blank">${escapeHtml(u)}</a>`).join(' ')}</div>` : ''}
        <div class="news-card-timestamps">
          <span>Received: ${formatTimestamp(item.original_timestamp)}</span>
          <span>Ingested: ${formatTimestamp(item.ingested_at)}</span>
        </div>
      </div>`;
  }).join('');
}

async function refreshDiscordStatus() {
  const s = await window.api.getDiscordStatus();
  const bar = document.getElementById('discord-status-bar');
  bar.innerHTML = `
    <span class="discord-status-dot ${s.status}"></span>
    <span class="discord-status-label">${escapeHtml(s.message || s.status)}</span>
    <div class="discord-status-stats">
      <span>Messages seen: <strong>${s.messagesReceived}</strong></span>
      <span>Items ingested: <strong>${s.itemsIngested}</strong></span>
      ${s.lastMessageAt ? `<span>Last msg: ${formatTimestamp(s.lastMessageAt)}</span>` : ''}
      ${s.botUser ? `<span>Bot: ${escapeHtml(s.botUser.tag)}</span>` : ''}
    </div>
  `;
}

document.getElementById('allnews-refresh').addEventListener('click', () => { refreshAllNews(); refreshDiscordStatus(); });
document.getElementById('allnews-search-btn').addEventListener('click', refreshAllNews);
document.getElementById('allnews-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') refreshAllNews(); });
document.getElementById('allnews-time-preset').addEventListener('change', refreshAllNews);

// ── Keyword Filters ──
async function refreshRulesets() {
  const rulesets = await window.api.getRulesets();
  renderRulesetsList(rulesets);
  populateRulesetFilter(rulesets);
}

function renderRulesetsList(rulesets) {
  const list = document.getElementById('rulesets-list');

  if (!rulesets || rulesets.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding:30px">
        <div>No rulesets yet</div>
        <div style="font-size:12px">Click "+ New Ruleset" to create one</div>
      </div>`;
    return;
  }

  list.innerHTML = rulesets.map(rs => `
    <div class="ruleset-item ${editingRulesetId === rs.id ? 'active' : ''}" data-id="${rs.id}">
      <div class="ruleset-item-name">
        <span class="ruleset-item-color" style="background:${rs.color}"></span>
        ${escapeHtml(rs.name)}
      </div>
      <div class="ruleset-item-info">
        <span>${rs.rules ? rs.rules.length : 0} rules</span>
        <span>${rs.exclusions ? rs.exclusions.length : 0} exclusions</span>
        ${rs.audio_name ? '<span>🔊</span>' : ''}
      </div>
      <div class="ruleset-item-actions">
        <label class="switch toggle-ruleset-switch" data-id="${rs.id}">
          <input type="checkbox" ${rs.enabled ? 'checked' : ''} />
          <span class="slider"></span>
        </label>
        <button class="btn btn-small btn-danger delete-ruleset-btn" data-id="${rs.id}">Delete</button>
      </div>
    </div>
  `).join('');

  // Click to edit (ignore clicks on toggle/delete)
  list.querySelectorAll('.ruleset-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-ruleset-btn')) return;
      if (e.target.closest('.toggle-ruleset-switch')) return;
      const id = parseInt(el.dataset.id);
      const rs = rulesets.find(r => r.id === id);
      if (rs) openEditor(rs);
    });
  });

  // Toggle enabled
  list.querySelectorAll('.toggle-ruleset-switch input').forEach(input => {
    input.addEventListener('change', async (e) => {
      e.stopPropagation();
      const id = parseInt(input.closest('.toggle-ruleset-switch').dataset.id);
      await window.api.toggleRuleset(id, input.checked);
    });
  });

  // Delete
  list.querySelectorAll('.delete-ruleset-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const confirmed = await window.api.confirmDialog('Delete this ruleset?');
      if (confirmed) {
        await window.api.deleteRuleset(id);
        if (editingRulesetId === id) closeEditor();
        refreshRulesets();
      }
    });
  });
}

function openEditor(ruleset = null) {
  const editor = document.getElementById('ruleset-editor');
  editor.style.display = 'flex';

  if (ruleset) {
    editingRulesetId = ruleset.id;
    document.getElementById('editor-title').textContent = 'Edit Ruleset';
    document.getElementById('ruleset-name').value = ruleset.name;
    document.getElementById('ruleset-color').value = ruleset.color || '#ff6b6b';
    document.getElementById('color-preview').style.background = ruleset.color || '#ff6b6b';
    audioFilePath = ruleset.audio_path;
    audioFileName = ruleset.audio_name;
    updateAudioUI();

    renderRuleGroups(ruleset.rules || []);
    renderExclusions(ruleset.exclusions || []);
    setLLMUI(!!ruleset.llm_enabled, ruleset.llm_prompt || '', ruleset.llm_output_format || '',
      !!ruleset.llm_scoring_enabled, ruleset.llm_scoring_criteria || '', ruleset.llm_scoring_threshold || 0);
  } else {
    editingRulesetId = null;
    document.getElementById('editor-title').textContent = 'New Ruleset';
    document.getElementById('ruleset-name').value = '';
    document.getElementById('ruleset-color').value = '#ff6b6b';
    document.getElementById('color-preview').style.background = '#ff6b6b';
    audioFilePath = null;
    audioFileName = null;
    updateAudioUI();
    renderRuleGroups([]);
    renderExclusions([]);
    setLLMUI(false, '', '', false, '', 0);
  }

  // Update active state
  document.querySelectorAll('.ruleset-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.id) === editingRulesetId);
  });
}

function closeEditor() {
  document.getElementById('ruleset-editor').style.display = 'none';
  editingRulesetId = null;
  document.querySelectorAll('.ruleset-item').forEach(el => el.classList.remove('active'));
}

let nextGroupId = 0;

function renderRuleGroups(rules) {
  const container = document.getElementById('rule-groups-container');
  container.innerHTML = '';
  nextGroupId = 0;

  // Group rules by rule_group
  const groups = {};
  for (const r of rules) {
    const g = r.rule_group || 0;
    if (!groups[g]) groups[g] = { logic: r.logic_operator || 'OR', keywords: [] };
    groups[g].keywords.push({ keyword: r.keyword, negate: !!r.negate });
  }

  const groupIds = Object.keys(groups);
  if (groupIds.length === 0) return;

  groupIds.forEach((gId, idx) => {
    const group = groups[gId];
    addGroupElement(container, group.logic, group.keywords);
    if (idx < groupIds.length - 1) {
      addOrDivider(container);
    }
  });
}

function wireNegateBtn(btn) {
  btn.addEventListener('click', () => {
    const isNegate = btn.classList.toggle('active');
    btn.textContent = isNegate ? 'NOT' : 'IS';
  });
}

function addGroupElement(container, logic = 'OR', keywords = [{ keyword: '', negate: false }]) {
  const groupId = nextGroupId++;
  const div = document.createElement('div');
  div.className = 'rule-group';
  div.dataset.groupId = groupId;

  // Normalize keywords to objects
  const kwItems = keywords.map(kw =>
    typeof kw === 'string' ? { keyword: kw, negate: false } : kw
  );

  div.innerHTML = `
    <div class="rule-group-header">
      <span class="group-label">Group ${groupId + 1}</span>
      <select class="group-logic">
        <option value="OR" ${logic === 'OR' ? 'selected' : ''}>OR (any keyword)</option>
        <option value="AND" ${logic === 'AND' ? 'selected' : ''}>AND (all keywords)</option>
      </select>
      <button class="btn btn-small btn-primary add-keyword-btn">+ Keyword</button>
      <button class="btn btn-small btn-danger remove-group-btn">Remove Group</button>
    </div>
    <div class="rule-group-keywords">
      ${kwItems.map(kw => `
        <div class="rule-row">
          <button class="btn btn-small negate-btn ${kw.negate ? 'active' : ''}">${kw.negate ? 'NOT' : 'IS'}</button>
          <input type="text" value="${escapeHtml(kw.keyword)}" placeholder="Keyword..." class="rule-keyword" />
          <button class="btn btn-danger remove-rule-btn">×</button>
        </div>
      `).join('')}
    </div>
  `;

  // Wire up negate buttons
  div.querySelectorAll('.negate-btn').forEach(btn => wireNegateBtn(btn));

  // Wire up buttons
  div.querySelector('.add-keyword-btn').addEventListener('click', () => {
    const kwContainer = div.querySelector('.rule-group-keywords');
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <button class="btn btn-small negate-btn">IS</button>
      <input type="text" value="" placeholder="Keyword..." class="rule-keyword" />
      <button class="btn btn-danger remove-rule-btn">×</button>
    `;
    wireNegateBtn(row.querySelector('.negate-btn'));
    row.querySelector('.remove-rule-btn').addEventListener('click', () => row.remove());
    kwContainer.appendChild(row);
    row.querySelector('input').focus();
  });

  div.querySelector('.remove-group-btn').addEventListener('click', () => {
    // Also remove the OR divider before or after this group
    const prev = div.previousElementSibling;
    const next = div.nextElementSibling;
    if (prev && prev.classList.contains('rule-group-or-divider')) {
      prev.remove();
    } else if (next && next.classList.contains('rule-group-or-divider')) {
      next.remove();
    }
    div.remove();
  });

  div.querySelectorAll('.remove-rule-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.rule-row').remove());
  });

  container.appendChild(div);
}

function addOrDivider(container) {
  const divider = document.createElement('div');
  divider.className = 'rule-group-or-divider';
  divider.textContent = '— OR —';
  container.appendChild(divider);
}

function renderExclusions(exclusions) {
  const list = document.getElementById('exclusions-list');
  list.innerHTML = exclusions.map((e, i) => `
    <div class="rule-row" data-index="${i}">
      <input type="text" value="${escapeHtml(e.keyword)}" placeholder="Exclusion keyword..." class="exclusion-keyword" />
      <button class="btn btn-danger remove-exclusion-btn">×</button>
    </div>
  `).join('');

  list.querySelectorAll('.remove-exclusion-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.rule-row').remove());
  });
}

function collectRulesetFromForm() {
  const name = document.getElementById('ruleset-name').value.trim();
  if (!name) { window.api.alertDialog('Please enter a ruleset name'); return null; }

  const color = document.getElementById('ruleset-color').value;
  // Enabled is controlled by the toggle on the card, not the editor.
  // When editing, preserve current state; when creating, default to enabled.
  let enabled = true;
  if (editingRulesetId) {
    const toggle = document.querySelector(`.toggle-ruleset-switch[data-id="${editingRulesetId}"] input`);
    enabled = toggle ? toggle.checked : true;
  }

  const rules = [];
  document.querySelectorAll('#rule-groups-container .rule-group').forEach((groupEl, groupIndex) => {
    const logic = groupEl.querySelector('.group-logic').value;
    groupEl.querySelectorAll('.rule-row').forEach(row => {
      const input = row.querySelector('.rule-keyword');
      const negateBtn = row.querySelector('.negate-btn');
      const kw = input ? input.value.trim() : '';
      const negate = negateBtn ? negateBtn.classList.contains('active') : false;
      if (kw) rules.push({ keyword: kw, logic_operator: logic, rule_group: groupIndex, negate });
    });
  });

  const exclusions = [];
  document.querySelectorAll('#exclusions-list .rule-row').forEach(row => {
    const kw = row.querySelector('.exclusion-keyword').value.trim();
    if (kw) exclusions.push({ keyword: kw });
  });

  const llmEnabled = document.getElementById('llm-enabled').checked;
  const llmPrompt = document.getElementById('llm-prompt').value.trim();
  const llmOutputFormat = document.getElementById('llm-output-format').value.trim();
  const llmScoringEnabled = document.getElementById('llm-scoring-enabled').checked;
  const llmScoringCriteria = document.getElementById('llm-scoring-criteria').value.trim();
  const llmScoringThreshold = parseInt(document.getElementById('llm-scoring-threshold').value) || 0;

  return {
    id: editingRulesetId,
    name, color, enabled,
    audio_path: audioFilePath,
    audio_name: audioFileName,
    llm_enabled: llmEnabled,
    llm_prompt: llmPrompt || null,
    llm_output_format: llmOutputFormat || null,
    llm_scoring_enabled: llmScoringEnabled,
    llm_scoring_criteria: llmScoringCriteria || null,
    llm_scoring_threshold: llmScoringThreshold,
    rules, exclusions
  };
}

function setLLMUI(enabled, prompt, outputFormat, scoringEnabled, scoringCriteria, scoringThreshold) {
  document.getElementById('llm-enabled').checked = enabled;
  document.getElementById('llm-prompt').value = prompt;
  document.getElementById('llm-output-format').value = outputFormat;
  document.getElementById('llm-options').style.display = enabled ? '' : 'none';
  document.getElementById('llm-scoring-enabled').checked = scoringEnabled;
  document.getElementById('llm-scoring-criteria').value = scoringCriteria;
  document.getElementById('llm-scoring-threshold').value = scoringThreshold;
  document.getElementById('llm-threshold-value').textContent = scoringThreshold;
  document.getElementById('llm-scoring-options').style.display = scoringEnabled ? '' : 'none';
  updateThresholdColor(scoringThreshold);
}

function updateAudioUI() {
  document.getElementById('audio-file-name').textContent = audioFileName || 'No file selected';
  document.getElementById('clear-audio-btn').style.display = audioFilePath ? '' : 'none';
  document.getElementById('test-audio-btn').style.display = audioFilePath ? '' : 'none';
}

function populateRulesetFilter(rulesets) {
  const select = document.getElementById('feed-ruleset-filter');
  const current = select.value;
  select.innerHTML = '<option value="">All rulesets</option>' +
    rulesets.map(rs => `<option value="${rs.id}">${escapeHtml(rs.name)}</option>`).join('');
  select.value = current;
}

// ── Event Listeners ──

// Add ruleset
document.getElementById('add-ruleset-btn').addEventListener('click', () => openEditor());
document.getElementById('cancel-ruleset-btn').addEventListener('click', closeEditor);

// Auto-save: debounced save on any editor input change for existing rulesets
let autoSaveTimer = null;
function scheduleAutoSave() {
  if (!editingRulesetId) return; // Only auto-save for existing rulesets
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    const data = collectRulesetFromForm();
    if (data && data.name) {
      await window.api.updateRuleset(data);
      refreshRulesets();
    }
  }, 1000);
}

// Attach auto-save to all editor inputs
document.getElementById('ruleset-editor').addEventListener('input', scheduleAutoSave);
document.getElementById('ruleset-editor').addEventListener('change', scheduleAutoSave);

// Save ruleset (explicit save button)
document.getElementById('save-ruleset-btn').addEventListener('click', async () => {
  clearTimeout(autoSaveTimer);
  const data = collectRulesetFromForm();
  if (!data) return;

  if (editingRulesetId) {
    await window.api.updateRuleset(data);
  } else {
    const saved = await window.api.saveRuleset(data);
    if (saved) editingRulesetId = saved.id;
  }
  refreshRulesets();
  closeEditor();
});

// Add group
document.getElementById('add-group-btn').addEventListener('click', () => {
  const container = document.getElementById('rule-groups-container');
  // Add OR divider if there are already groups
  if (container.querySelector('.rule-group')) {
    addOrDivider(container);
  }
  addGroupElement(container, 'OR', ['']);
  // Focus the new keyword input
  const inputs = container.querySelectorAll('.rule-keyword');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
});

// Add exclusion
document.getElementById('add-exclusion-btn').addEventListener('click', () => {
  const list = document.getElementById('exclusions-list');
  const row = document.createElement('div');
  row.className = 'rule-row';
  row.innerHTML = `
    <input type="text" value="" placeholder="Exclusion keyword..." class="exclusion-keyword" />
    <button class="btn btn-danger remove-exclusion-btn">×</button>
  `;
  row.querySelector('.remove-exclusion-btn').addEventListener('click', () => row.remove());
  list.appendChild(row);
  row.querySelector('input').focus();
});

// Color picker
document.getElementById('ruleset-color').addEventListener('input', (e) => {
  document.getElementById('color-preview').style.background = e.target.value;
});

// LLM toggle
document.getElementById('llm-enabled').addEventListener('change', (e) => {
  document.getElementById('llm-options').style.display = e.target.checked ? '' : 'none';
});

// LLM Scoring toggle
document.getElementById('llm-scoring-enabled').addEventListener('change', (e) => {
  document.getElementById('llm-scoring-options').style.display = e.target.checked ? '' : 'none';
});

// LLM Scoring threshold slider
document.getElementById('llm-scoring-threshold').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  document.getElementById('llm-threshold-value').textContent = val;
  updateThresholdColor(val);
});

function updateThresholdColor(val) {
  const badge = document.getElementById('llm-threshold-value');
  if (val > 0) { badge.style.color = '#4ade80'; }
  else if (val < 0) { badge.style.color = '#f87171'; }
  else { badge.style.color = 'var(--text-primary)'; }
}

// Audio
document.getElementById('select-audio-btn').addEventListener('click', async () => {
  const result = await window.api.selectAudioFile();
  if (result) {
    audioFilePath = result.path;
    audioFileName = result.name;
    updateAudioUI();
  }
});

document.getElementById('clear-audio-btn').addEventListener('click', () => {
  audioFilePath = null;
  audioFileName = null;
  updateAudioUI();
});

document.getElementById('test-audio-btn').addEventListener('click', () => {
  if (audioFilePath) playAudio(audioFilePath);
});

// Time filter
document.getElementById('feed-time-preset').addEventListener('change', (e) => {
  const custom = e.target.value === 'custom';
  document.getElementById('feed-start-time').classList.toggle('hidden', !custom);
  document.getElementById('feed-end-time').classList.toggle('hidden', !custom);
});

// Search
document.getElementById('feed-search-btn').addEventListener('click', refreshFeed);
document.getElementById('feed-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') refreshFeed();
});
document.getElementById('feed-clear-btn').addEventListener('click', () => {
  document.getElementById('feed-search').value = '';
  document.getElementById('feed-ticker').value = '';
  document.getElementById('feed-time-preset').value = '';
  document.getElementById('feed-start-time').value = '';
  document.getElementById('feed-end-time').value = '';
  document.getElementById('feed-start-time').classList.add('hidden');
  document.getElementById('feed-end-time').classList.add('hidden');
  document.getElementById('feed-ruleset-filter').value = '';
  refreshFeed();
});
document.getElementById('feed-refresh').addEventListener('click', refreshFeed);

// Reprocess
document.getElementById('reprocess-btn').addEventListener('click', async () => {
  if (!editingRulesetId) {
    window.api.alertDialog('Save the ruleset first before reprocessing');
    return;
  }
  const period = document.getElementById('reprocess-period').value;
  document.getElementById('reprocess-status').textContent = 'Reprocessing...';
  const results = await window.api.reprocessNews({ rulesetId: editingRulesetId, timePeriod: period });
  document.getElementById('reprocess-status').textContent = `Done! ${results.length} items matched.`;
  setTimeout(() => { document.getElementById('reprocess-status').textContent = ''; }, 5000);
});

// ── LLM Analysis Tab ──

let selectedLLMItemId = null;

async function refreshLLMQueue() {
  const statusFilter = document.getElementById('llm-status-filter').value;
  const rulesetFilter = document.getElementById('llm-ruleset-filter').value;
  const filters = {};
  if (statusFilter) filters.status = statusFilter;
  if (rulesetFilter) filters.rulesetId = parseInt(rulesetFilter);

  const items = await window.api.getLLMQueue(filters);
  renderLLMQueue(items);
  refreshLLMStats();
}

function renderLLMQueue(items) {
  const list = document.getElementById('llm-queue-list');

  if (!items || items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div>No LLM queue items</div>
        <div style="font-size:12px">Enable LLM Analysis on a ruleset to start processing</div>
      </div>`;
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="llm-queue-item status-${item.status} ${selectedLLMItemId === item.id ? 'active' : ''}" data-id="${item.id}">
      <div class="llm-queue-item-body">
        <div class="llm-queue-item-header">
          <span class="llm-queue-item-ticker">${escapeHtml(item.ticker_symbol || '')}</span>
          <span class="llm-queue-status-badge ${item.status}">${item.status}</span>
          ${item.llm_score != null ? `<span class="llm-score-badge ${item.llm_score >= 0 ? 'positive' : 'negative'}">Score: ${item.llm_score}</span>` : ''}
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${escapeHtml(item.ruleset_name || '')}</span>
        </div>
        <div class="llm-queue-item-preview">${escapeHtml((item.news_text || '').substring(0, 120))}</div>
        <div class="llm-queue-item-meta">
          <span>Queued: ${formatTimestamp(item.created_at)}</span>
          ${item.completed_at ? `<span>Done: ${formatTimestamp(item.completed_at)}</span>` : ''}
          ${item.model ? `<span>${escapeHtml(item.model)}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.llm-queue-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt(el.dataset.id);
      const item = items.find(i => i.id === id);
      if (item) {
        selectedLLMItemId = id;
        list.querySelectorAll('.llm-queue-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        renderLLMDetail(item);
      }
    });
  });
}

function renderLLMDetail(item) {
  const panel = document.getElementById('llm-detail-panel');

  const statusBadge = `<span class="llm-queue-status-badge ${item.status}">${item.status}</span>`;
  const scoreBadge = item.llm_score != null ? `<span class="llm-score-badge ${item.llm_score >= 0 ? 'positive' : 'negative'}">Score: ${item.llm_score}</span>` : '';

  let responseHtml = '';
  if (item.status === 'completed' && item.response) {
    // Try to render JSON nicely
    let parsed;
    try { parsed = JSON.parse(item.response); } catch(e) {}
    if (parsed && typeof parsed === 'object') {
      const fields = Object.entries(parsed).map(([key, value]) => {
        const label = formatFieldLabel(key);
        const rendered = renderFieldValue(key, value);
        return `<div class="llm-field"><span class="llm-field-label">${label}</span>${rendered}</div>`;
      }).join('');
      responseHtml = `<div class="llm-response" style="margin:0">${fields}</div>`;
    } else {
      responseHtml = `<div class="llm-detail-response">${escapeHtml(item.response)}</div>`;
    }
  } else if (item.status === 'failed') {
    responseHtml = `<div class="llm-detail-error">${escapeHtml(item.error || 'Unknown error')}</div>`;
  } else if (item.status === 'pending') {
    responseHtml = `<div style="color:var(--warning);font-style:italic;padding:10px">Waiting to be processed...</div>`;
  }

  panel.innerHTML = `
    <div class="llm-detail-header">
      <h3>${escapeHtml(item.ticker_symbol || 'Unknown')} — ${escapeHtml(item.ruleset_name || '')} ${statusBadge} ${scoreBadge}</h3>
      <div style="font-size:11px;color:var(--text-muted);display:flex;gap:12px;margin-top:4px">
        <span>Queued: ${formatTimestamp(item.created_at)}</span>
        ${item.completed_at ? `<span>Completed: ${formatTimestamp(item.completed_at)}</span>` : ''}
        ${item.model ? `<span>Model: ${escapeHtml(item.model)}</span>` : ''}
      </div>
    </div>

    <div class="llm-detail-section">
      <div class="llm-detail-section-title">News Item</div>
      <div class="llm-detail-news">${escapeHtml(item.news_text || '')}</div>
    </div>

    <div class="llm-detail-section">
      <div class="llm-detail-section-title">LLM Response</div>
      ${responseHtml}
    </div>

    <div class="llm-detail-section">
      <div class="llm-detail-section-title">Prompt Sent</div>
      <div class="llm-detail-prompt">${escapeHtml(item.prompt || '')}</div>
    </div>
  `;
}

async function refreshLLMStats() {
  const stats = await window.api.getLLMStats();
  document.getElementById('stat-llm').textContent = `${stats.pending} pending / ${stats.completed} done`;
}

// Populate ruleset filter in LLM tab
async function populateLLMRulesetFilter() {
  const rulesets = await window.api.getRulesets();
  const select = document.getElementById('llm-ruleset-filter');
  const current = select.value;
  select.innerHTML = '<option value="">All rulesets</option>' +
    rulesets.map(rs => `<option value="${rs.id}">${escapeHtml(rs.name)}</option>`).join('');
  select.value = current;
}

document.getElementById('llm-refresh-btn').addEventListener('click', refreshLLMQueue);
document.getElementById('llm-status-filter').addEventListener('change', refreshLLMQueue);
document.getElementById('llm-ruleset-filter').addEventListener('change', refreshLLMQueue);

// ── Real-time Updates ──
window.api.onNewsFeedUpdate((data) => {
  // Play audio for first match that has audio
  if (data.entries) {
    for (const entry of data.entries) {
      if (entry.audioPath) {
        playAudio(entry.audioPath);
        break;
      }
    }
  }

  // Refresh feed if on that tab
  if (document.querySelector('.tab-btn[data-tab="news-feed"]').classList.contains('active')) {
    refreshFeed();
  }
  refreshStats();
});

window.api.onReprocessComplete((data) => {
  document.getElementById('reprocess-status').textContent = `Reprocess complete: ${data.count} matches found`;
});

window.api.onLLMComplete(() => {
  if (document.querySelector('.tab-btn[data-tab="news-feed"]').classList.contains('active')) {
    refreshFeed();
  }
  if (document.querySelector('.tab-btn[data-tab="llm-analysis"]').classList.contains('active')) {
    refreshLLMQueue();
  }
  refreshLLMStats();
});

window.api.onNewItemIngested(() => {
  refreshStats();
  if (document.querySelector('.tab-btn[data-tab="all-news"]').classList.contains('active')) {
    refreshAllNews();
    refreshDiscordStatus();
  }
  if (document.querySelector('.tab-btn[data-tab="news-feed"]').classList.contains('active')) {
    refreshFeed();
  }
});

// ── Utilities ──
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str) || fallback; }
  catch { return fallback; }
}

function formatTimestamp(ts) {
  if (!ts) return 'N/A';
  try {
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    return d.toLocaleString();
  } catch { return ts; }
}

async function playAudio(filePath) {
  try {
    const dataUrl = await window.api.getAudioData(filePath);
    if (!dataUrl) return;
    const audio = document.getElementById('alert-audio');
    audio.src = dataUrl;
    audio.load();
    audio.play().catch(err => console.error('Audio play error:', err));
  } catch (err) {
    console.error('Audio load error:', err);
  }
}

async function refreshStats() {
  const stats = await window.api.getStats();
  document.getElementById('stat-total').textContent = `${stats.totalItems} items`;
  document.getElementById('stat-feed').textContent = `${stats.feedItems} in feed`;
  document.getElementById('stat-rulesets').textContent = `${stats.rulesets} rulesets`;
}

// ── Init ──
refreshFeed();
refreshRulesets();
refreshStats();
refreshLLMStats();

// Auto-refresh discord status every 5s when All News tab is active
setInterval(() => {
  if (document.querySelector('.tab-btn[data-tab="all-news"]').classList.contains('active')) {
    refreshDiscordStatus();
  }
}, 5000);
