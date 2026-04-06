const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const LOG_PATH = path.join(__dirname, '..', 'data', 'truth.log');
const WORKER_PATH = path.join(__dirname, 'truth-worker.js');

/**
 * Truth Social scraper — runs puppeteer-core in a separate Node process.
 * Completely isolated from the main Electron app.
 */
class TruthScraper {
  constructor(onNewPost) {
    this.onNewPost = onNewPost;
    this.seenIds = new Set();
    this.posts = [];
    this.running = false;
    this.child = null;
    this.status = 'not started';
    this.statusMessage = '';
    this.lastSuccessAt = null;
    this.lastErrorAt = null;
    this.lastErrorMessage = '';
    this.postsFetched = 0;
    this.pollCount = 0;
    this.errorCount = 0;
  }

  log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { fs.appendFileSync(LOG_PATH, line); } catch {}
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.status = 'connecting';
    this.statusMessage = 'Launching worker...';
    this.log('Truth Social scraper started (puppeteer worker)');

    // Spawn as completely separate Node process using system node
    this.child = spawn('node', [WORKER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    this.child.on('message', (msg) => {
      if (msg.type === 'status') {
        this.status = msg.status;
        this.statusMessage = msg.message;
        this.pollCount++;
        if (msg.status === 'connected') {
          this.lastSuccessAt = new Date().toISOString();
        } else if (msg.status === 'error') {
          this.errorCount++;
          this.lastErrorAt = new Date().toISOString();
          this.lastErrorMessage = msg.message;
          this.log(`Error: ${msg.message}`);
        }
      } else if (msg.type === 'posts') {
        this.processPosts(msg.posts);
      }
    });

    this.child.on('exit', (code) => {
      this.log(`Worker exited with code ${code}`);
      this.child = null;
      if (this.running) {
        this.status = 'error';
        this.statusMessage = `Worker exited (code ${code}), restarting in 30s...`;
        setTimeout(() => { if (this.running) this.start(); }, 30000);
      }
    });

    this.child.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('DevTools') && !msg.includes('GPU') && !msg.includes('sandbox')) {
        this.log(`Worker stderr: ${msg.substring(0, 200)}`);
      }
    });
  }

  stop() {
    this.running = false;
    if (this.child) {
      try { this.child.send('quit'); } catch {}
      setTimeout(() => { if (this.child) try { this.child.kill(); } catch {} }, 5000);
    }
    this.log('Truth Social scraper stopped');
  }

  processPosts(apiPosts) {
    if (!Array.isArray(apiPosts)) return;
    const newPosts = [];
    for (const raw of apiPosts) {
      if (this.seenIds.has(raw.id)) continue;
      this.seenIds.add(raw.id);
      newPosts.push({
        id: raw.id,
        text: this.stripHtml(raw.content || ''),
        htmlContent: raw.content || '',
        createdAt: raw.created_at,
        url: raw.url || `https://truthsocial.com/@realDonaldTrump/${raw.id}`,
        isRetruth: !!(raw.reblog),
        reblogAuthor: raw.reblog?.account ? (raw.reblog.account.display_name || raw.reblog.account.username) : null,
        reblogText: raw.reblog ? this.stripHtml(raw.reblog.content || '') : null,
        mediaUrls: (raw.media_attachments || []).map(m => m.url).filter(Boolean),
        repliesCount: raw.replies_count || 0,
        reblogsCount: raw.reblogs_count || 0,
        favouritesCount: raw.favourites_count || 0
      });
    }
    if (newPosts.length > 0) {
      this.posts = [...newPosts, ...this.posts]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20);
      if (this.seenIds.size > 200) this.seenIds = new Set(this.posts.map(p => p.id));
      this.postsFetched += newPosts.length;
      this.log(`${newPosts.length} new post(s) fetched`);
      this.onNewPost(newPosts, this.posts);
    }
  }

  stripHtml(html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, '$1')
      .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n').trim();
  }

  getPosts() { return this.posts; }

  getStatus() {
    return {
      source: 'Truth Social',
      sourceKey: 'truth',
      sourceUrl: 'https://truthsocial.com/@realDonaldTrump',
      status: this.status,
      message: this.statusMessage,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      postsFetched: this.postsFetched,
      pollCount: this.pollCount,
      errorCount: this.errorCount,
      latestItems: this.posts.slice(0, 5).map(p => ({
        title: p.text.substring(0, 100), url: p.url, timestamp: p.createdAt
      }))
    };
  }
}

module.exports = TruthScraper;
