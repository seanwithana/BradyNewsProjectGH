const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ACCOUNT_ID = '107780257626128497'; // @realDonaldTrump
const POLL_INTERVAL = 1000; // 1 second
const LOG_PATH = path.join(__dirname, '..', 'data', 'truth.log');

class TruthScraper {
  constructor(onNewPost) {
    this.onNewPost = onNewPost;
    this.seenIds = new Set();
    this.posts = [];
    this.timer = null;
    this.running = false;
    this.fetchWin = null;
  }

  log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { fs.appendFileSync(LOG_PATH, line); } catch {}
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.log('Truth Social scraper started');

    // Create a hidden browser window for fetching (handles Cloudflare)
    this.fetchWin = new BrowserWindow({
      show: false,
      width: 400,
      height: 400,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    // First visit the site so Cloudflare cookies get set
    this.fetchWin.loadURL('https://truthsocial.com/@realDonaldTrump');
    this.fetchWin.webContents.on('did-finish-load', () => {
      this.log('Initial page loaded, starting polls');
      setTimeout(() => this.poll(), 2000);
      this.timer = setInterval(() => this.poll(), POLL_INTERVAL);
    });
    this.fetchWin.webContents.on('did-fail-load', () => {
      this.log('Initial page load failed, starting polls anyway');
      setTimeout(() => this.poll(), 5000);
      this.timer = setInterval(() => this.poll(), POLL_INTERVAL);
    });
  }

  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.fetchWin && !this.fetchWin.isDestroyed()) {
      this.fetchWin.close();
      this.fetchWin = null;
    }
    this.log('Truth Social scraper stopped');
  }

  poll() {
    if (!this.running || !this.fetchWin || this.fetchWin.isDestroyed()) return;
    const url = `https://truthsocial.com/api/v1/accounts/${ACCOUNT_ID}/statuses?limit=20&exclude_replies=true`;

    this.fetchWin.webContents.executeJavaScript(`
      fetch("${url}", { headers: { 'Accept': 'application/json' } })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(data => JSON.stringify(data))
        .catch(e => JSON.stringify({ error: e.message }))
    `).then(result => {
      try {
        const parsed = JSON.parse(result);
        if (parsed.error) {
          this.log(`Fetch error: ${parsed.error}`);
          return;
        }
        this.processPosts(parsed);
      } catch (e) {
        this.log(`Parse error: ${e.message}`);
      }
    }).catch(e => {
      this.log(`executeJS error: ${e.message}`);
    });
  }

  processPosts(apiPosts) {
    if (!Array.isArray(apiPosts)) return;

    const newPosts = [];
    for (const raw of apiPosts) {
      if (this.seenIds.has(raw.id)) continue;
      this.seenIds.add(raw.id);

      const post = {
        id: raw.id,
        text: this.stripHtml(raw.content || ''),
        htmlContent: raw.content || '',
        createdAt: raw.created_at,
        url: raw.url || `https://truthsocial.com/@realDonaldTrump/${raw.id}`,
        isRetruth: !!(raw.reblog),
        reblogAuthor: raw.reblog ? (raw.reblog.account ? raw.reblog.account.display_name || raw.reblog.account.username : null) : null,
        reblogText: raw.reblog ? this.stripHtml(raw.reblog.content || '') : null,
        mediaUrls: (raw.media_attachments || []).map(m => m.url).filter(Boolean),
        repliesCount: raw.replies_count || 0,
        reblogsCount: raw.reblogs_count || 0,
        favouritesCount: raw.favourites_count || 0
      };

      newPosts.push(post);
    }

    // Update posts list (keep latest 20)
    if (newPosts.length > 0) {
      this.posts = [...newPosts, ...this.posts]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20);

      // Remove very old IDs from seenIds to prevent unbounded growth
      if (this.seenIds.size > 200) {
        const keepIds = new Set(this.posts.map(p => p.id));
        this.seenIds = keepIds;
      }

      this.log(`${newPosts.length} new post(s) fetched`);
      this.onNewPost(newPosts, this.posts);
    }
  }

  stripHtml(html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p>/gi, '\n\n')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  getPosts() {
    return this.posts;
  }
}

module.exports = TruthScraper;
