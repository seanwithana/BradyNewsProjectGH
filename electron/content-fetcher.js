const http = require('http');
const https = require('https');

/**
 * Fetches the text content of a URL, stripping HTML tags.
 * Returns the article body text or null on failure.
 */
function fetchArticleText(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'BradyNewsProject/1.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchArticleText(res.headers.location, timeoutMs).then(resolve);
      }
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(extractText(data));
        } catch(e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Extract readable text from HTML.
 * Tries to find article content in common containers, falls back to full body.
 */
function extractText(html) {
  // Try to extract from known content containers
  const contentSelectors = [
    /class="main-text"[^>]*>([\s\S]*?)<\/div>/i,
    /class="article[_-]?(?:body|content|text)"[^>]*>([\s\S]*?)<\/div>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /class="content-container"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  ];

  let rawHtml = '';
  for (const regex of contentSelectors) {
    const match = html.match(regex);
    if (match && match[1] && match[1].length > 100) {
      rawHtml = match[1];
      break;
    }
  }

  // Fallback: use body
  if (!rawHtml) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    rawHtml = bodyMatch ? bodyMatch[1] : html;
  }

  // Strip HTML to plain text
  let text = rawHtml;
  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Convert <br> and block elements to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n');
  text = text.replace(/<(?:p|div|h[1-6]|li|tr)[^>]*>/gi, '\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&#xA9;/g, '©');
  text = text.replace(/&#x\w+;/g, '');
  text = text.replace(/&\w+;/g, '');
  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  // Truncate to avoid sending massive content to LLM
  const MAX_CHARS = 8000;
  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS) + '\n\n[Content truncated]';
  }

  return text.length > 50 ? text : null;
}

/**
 * Fetch all URLs from a JSON array string, return combined text.
 */
async function fetchAllUrls(urlsJson) {
  if (!urlsJson) return null;

  let urls;
  try {
    urls = JSON.parse(urlsJson);
  } catch(e) {
    return null;
  }

  if (!Array.isArray(urls) || urls.length === 0) return null;

  const results = await Promise.all(
    urls.filter(u => u && typeof u === 'string' && u.startsWith('http'))
      .slice(0, 3) // Max 3 URLs
      .map(u => fetchArticleText(u))
  );

  const texts = results.filter(t => t);
  if (texts.length === 0) return null;

  return texts.join('\n\n---\n\n');
}

module.exports = { fetchArticleText, fetchAllUrls };
