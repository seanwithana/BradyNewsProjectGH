/**
 * All scraper source configurations.
 * Each source has a unique parser for the listing page (parseFn)
 * and a unique parser for individual articles (parseArticleFn).
 */

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveUrl(href, base) {
  if (!href) return base;
  if (href.startsWith('http')) return href;
  try { return new URL(href, base).href; } catch { return base + href; }
}

// ════════════════════════════════════════════
// SOURCE 1: FDA PRESS ANNOUNCEMENTS
// ════════════════════════════════════════════
function parseFDA(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/news-events\/press-announcements\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = 'https://www.fda.gov' + match[1];
    const rawText = stripHtml(match[2]);
    // Extract date and title (format: "March 26, 2026\n - Title")
    const parts = rawText.split(/\s*-\s*/);
    const date = parts.length > 1 ? parts[0].trim() : '';
    const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : rawText;
    if (title.length < 10) continue;
    items.push({ id: url, title, text: title, url, timestamp: date || new Date().toISOString() });
  }
  return items;
}

function parseFDAArticle(html) {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return stripHtml(articleMatch[1]);
  return '';
}

// ════════════════════════════════════════════
// SOURCE 2: SEC PRESS RELEASES
// ════════════════════════════════════════════
// SEC blocks direct HTTP (403) so we use the RSS feed for listing.
// Article pages are fetched via browser fetcher at runtime.
function parseSEC(html) {
  const items = [];
  const itemBlocks = html.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title = ((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    const link = ((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const pubDate = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '').trim();
    const desc = stripHtml((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');
    if (!title || !link) continue;
    items.push({ id: link, title, text: desc || title, url: link, timestamp: pubDate || new Date().toISOString() });
  }
  return items;
}

function parseSECArticle(html) {
  // SEC uses Drupal with field--name-body class
  const bodyMatch = html.match(/class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (bodyMatch) {
    return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

// ════════════════════════════════════════════
// SOURCE 3: CPSC RECALLS
// ════════════════════════════════════════════
function parseCPSC(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/Recalls\/\d{4}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://www.cpsc.gov' + m[1];
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseCPSCArticle(html) {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article) {
    return article[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

// ════════════════════════════════════════════
// SOURCE 4: FTC PRESS RELEASES
// ════════════════════════════════════════════
function parseFTC(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/news-events\/news\/press-releases\/\d{4}\/\d{2}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://www.ftc.gov' + m[1];
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseFTCArticle(html) {
  const body = html.match(/class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (body) {
    return body[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

// ════════════════════════════════════════════
// SOURCE 52: PHILLY FED MANUFACTURING
// ════════════════════════════════════════════
function parsePhillyFed(html) {
  const items = [];
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Find release calendar entries
  const calIdx = text.indexOf('Release Calendar');
  if (calIdx > -1) {
    const calSection = text.substring(calIdx, calIdx + 500);
    // Match entries like "Apr 16 2026 April Manufacturing Business Outlook Survey 8:30 a.m."
    const regex = /(\w{3}\s+\d{1,2}\s+\d{4})\s+(.*?(?:Survey|Report))\s+\d{1,2}:\d{2}/g;
    let m;
    while ((m = regex.exec(calSection)) !== null) {
      const date = m[1];
      const title = m[2].trim();
      const id = date + '_' + title;
      if (!items.find(i => i.id === id))
        items.push({ id, title: date + ' — ' + title, text: date + ' — ' + title, url: 'https://www.philadelphiafed.org/surveys-and-data/regional-economic-analysis/manufacturing-business-outlook-survey', timestamp: new Date().toISOString() });
    }
  }
  // Also detect if actual survey results appear (after release)
  const surveyIdx = text.search(/Manufacturing activity|current general activity index/i);
  if (surveyIdx > -1) {
    const surveyText = text.substring(surveyIdx, surveyIdx + 1000);
    items.unshift({ id: 'latest_survey', title: 'Philly Fed Manufacturing Survey — Latest Results', text: surveyText, url: 'https://www.philadelphiafed.org/surveys-and-data/regional-economic-analysis/manufacturing-business-outlook-survey', timestamp: new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 66: BANK OF CANADA
// ════════════════════════════════════════════
function parseBOC(html) {
  const items = [];
  const regex = /<a[^>]*href="(https:\/\/www\.bankofcanada\.ca\/\d{4}\/\d{2}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === m[1])) continue;
    items.push({ id: m[1], title, text: title, url: m[1], timestamp: new Date().toISOString() });
  }
  return items;
}

function parseBOCArticle(html) {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (article) return article[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000);
  return '';
}

// ════════════════════════════════════════════
// SOURCE 67: RBA MEDIA RELEASES
// ════════════════════════════════════════════
function parseRBA(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/media-releases\/\d{4}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    const url = 'https://www.rba.gov.au' + m[1];
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseRBAArticle(html) {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (article) return article[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000);
  return '';
}

// ════════════════════════════════════════════
// SOURCES 62-64: CENSUS DATA PAGES
// ════════════════════════════════════════════
function parseCensusPage(html) {
  const items = [];
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Find the release info
  const releaseMatch = text.match(/((?:The\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s+release[\s\S]{20,300}?(?:scheduled|released|rescheduled)[^.]*\.)/i);
  // Find PDF links
  const pdfs = html.match(/href="([^"]+\.pdf)"/gi) || [];
  const pdfUrl = pdfs.length > 0 ? pdfs[0].match(/"([^"]+)"/)[1] : '';
  const fullPdf = pdfUrl.startsWith('http') ? pdfUrl : (pdfUrl.startsWith('/') ? 'https://www.census.gov' + pdfUrl : '');
  const title = releaseMatch ? releaseMatch[1].replace(/\s+/g, ' ').trim().substring(0, 150) : 'Census Data Release';
  items.push({
    id: fullPdf || 'census_page',
    title,
    text: title + (fullPdf ? '\n\nReport PDF: ' + fullPdf : ''),
    url: fullPdf || 'https://www.census.gov/',
    timestamp: new Date().toISOString()
  });
  return items;
}

// ════════════════════════════════════════════
// SOURCE 65: WTO DISPUTE SETTLEMENT
// ════════════════════════════════════════════
function parseWTO(html) {
  const items = [];
  const regex = /<a[^>]*href="([^"]+)"[^>]*>([^<]*DS\d+[^<]*)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    let url = m[1];
    if (url.startsWith('/')) url = 'https://www.wto.org' + url;
    if (!items.find(i => i.id === url))
      items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 57: USDA WASDE REPORT
// ════════════════════════════════════════════
function parseWASDE(html) {
  const items = [];
  // Find WASDE PDF links — pattern: wasdeMMYY.pdf
  const regex = /href="(https:\/\/www\.usda\.gov\/oce\/commodity\/wasde\/wasde\d{4}\.pdf)"/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = m[1];
    // Extract month/year from filename: wasde0426 = April 2026
    const dateMatch = url.match(/wasde(\d{2})(\d{2})\.pdf/);
    const months = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
    let title = 'WASDE Report';
    if (dateMatch) {
      const monthNum = parseInt(dateMatch[1]);
      const year = '20' + dateMatch[2];
      title = 'WASDE Report — ' + (months[monthNum] || dateMatch[1]) + ' ' + year;
    }
    if (!items.find(i => i.id === url))
      items.push({ id: url, title, text: title + '\n\nReport PDF: ' + url, url, timestamp: new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 56: SUPREME COURT OPINIONS
// ════════════════════════════════════════════
function parseSCOTUS(html) {
  const items = [];
  // Parse table rows — each row has: R#, Date, Docket, Name, Justice, Citation
  const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  for (const row of rows.slice(1)) { // skip header
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (cells.length < 4) continue;
    const cellTexts = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
    // cells: [R#, Date, Docket, Name, ...]
    const date = cellTexts[1] || '';
    const docket = cellTexts[2] || '';
    const name = cellTexts[3] || '';
    if (!name || name.length < 3) continue;
    // Find PDF link in the row
    const pdfMatch = row.match(/href="([^"]+\.pdf)"/i);
    const pdfUrl = pdfMatch ? 'https://www.supremecourt.gov/opinions/' + pdfMatch[1].replace(/^\.\.\//, '') : '';
    const title = `${date} — ${docket} ${name}`;
    const id = docket || title;
    if (!items.find(i => i.id === id))
      items.push({ id, title, text: title + (pdfUrl ? '\n\nOpinion PDF: ' + pdfUrl : ''), url: pdfUrl || 'https://www.supremecourt.gov/opinions/slipopinion/25', timestamp: new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 53: NY FED EMPIRE STATE
// ════════════════════════════════════════════
function parseNYFed(html) {
  const items = [];
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const idx = text.indexOf('general business conditions');
  if (idx > -1) {
    const content = text.substring(Math.max(0, idx - 50), idx + 2000).trim();
    // Extract headline — e.g. "index fell seven points to -0.2"
    const headlineMatch = content.match(/(?:headline\s+)?general business conditions index\s+(?:fell|rose|increased|declined|was unchanged)[^.]+\./i);
    const title = headlineMatch ? 'Empire State Manufacturing: ' + headlineMatch[0] : 'Empire State Manufacturing Survey — Latest';
    items.push({
      id: 'https://www.newyorkfed.org/survey/empire/empiresurvey_overview',
      title,
      text: content.substring(0, 3000),
      url: 'https://www.newyorkfed.org/survey/empire/empiresurvey_overview',
      timestamp: new Date().toISOString()
    });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 51: CENSUS RETAIL SALES
// ════════════════════════════════════════════
function parseCensusRetail(html) {
  const items = [];
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Find the latest report info from page text
  const releaseMatch = text.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s+release\s+for\s+[\s\S]{20,200}?(?:scheduled|released)[^.]*\.)/i);
  const pdfMatch = html.match(/href="([^"]*marts_current\.pdf)"/i);
  const pdfUrl = pdfMatch ? 'https://www.census.gov/retail/' + pdfMatch[1].replace(/^\//, '') : '';

  const title = releaseMatch ? releaseMatch[1].replace(/\s+/g, ' ').trim() : 'Census Advance Monthly Retail Trade Report';
  items.push({
    id: pdfUrl || 'https://www.census.gov/retail/sales.html',
    title,
    text: title + (pdfUrl ? '\n\nReport PDF: ' + pdfUrl : ''),
    url: pdfUrl || 'https://www.census.gov/retail/sales.html',
    timestamp: new Date().toISOString()
  });
  return items;
}

// ════════════════════════════════════════════
// SOURCE 50: ADP EMPLOYMENT REPORT
// ════════════════════════════════════════════
function parseADP(html) {
  const items = [];
  // Extract the headline from social share meta or text
  const titleMatch = html.match(/Private employers added [\d,]+ jobs in \w+/i)
                  || html.match(/ADP National Employment Report \w+ \d{4}/i);
  // Find the PDF link
  const pdfMatch = html.match(/href="(https:\/\/adp-ri-nrip-static[^"]+\.pdf)"/i);
  const pdfUrl = pdfMatch ? pdfMatch[1] : '';
  // Get the report text from the page
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const jobsIdx = text.search(/Private employers/i);
  const reportText = jobsIdx > -1 ? text.substring(jobsIdx, jobsIdx + 1000) : '';

  if (titleMatch || pdfUrl) {
    const title = titleMatch ? titleMatch[0] : 'ADP National Employment Report';
    items.push({
      id: pdfUrl || 'https://adpemploymentreport.com/',
      title,
      text: title + '\n\n' + reportText + (pdfUrl ? '\n\nReport PDF: ' + pdfUrl : ''),
      url: pdfUrl || 'https://adpemploymentreport.com/',
      timestamp: new Date().toISOString()
    });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 48: ESA NEWSROOM
// ════════════════════════════════════════════
function parseESA(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/(?:Newsroom|Press_Releases|Science_Exploration|Applications|Enabling_Support|Space_Safety)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    const url = 'https://www.esa.int' + m[1];
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseESAArticle(html) {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (article) return article[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000);
  return '';
}

// ════════════════════════════════════════════
// SOURCE 46: NASA NEWS RELEASES
// ════════════════════════════════════════════
function parseNASA(html) {
  const items = [];
  const regex = /<a[^>]*href="(https:\/\/www\.nasa\.gov\/news-release\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === m[1])) continue;
    items.push({ id: m[1], title, text: title, url: m[1], timestamp: new Date().toISOString() });
  }
  return items;
}

function parseNASAArticle(html) {
  const entryIdx = html.indexOf('entry-content');
  if (entryIdx > -1) {
    const section = html.substring(entryIdx, entryIdx + 20000);
    const paras = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    return paras.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 20).join(' ');
  }
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main) return main[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000);
  return '';
}

// ════════════════════════════════════════════
// SOURCE 44: BANK OF ENGLAND MONETARY POLICY
// ════════════════════════════════════════════
function parseBOE(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/monetary-policy-summary-and-minutes\/\d{4}\/[^"]+)"[^>]*>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://www.bankofengland.co.uk' + m[1];
    // Extract date from URL: .../2026/march-2026
    const dateMatch = m[1].match(/(\d{4})\/([a-z]+-\d{4})/);
    const title = dateMatch ? 'MPC Decision — ' + dateMatch[2].replace('-', ' ') : 'MPC Decision';
    if (!items.find(i => i.id === url))
      items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseBOEArticle(html) {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main) {
    return main[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000);
  }
  return '';
}

// ════════════════════════════════════════════
// SOURCE 43: BANK OF JAPAN DECISIONS
// ════════════════════════════════════════════
function parseBOJ(html) {
  const items = [];
  // BOJ statements are PDF links with pattern /mpr_YYYY/kYYMMDDa.pdf
  const regex = /<a[^>]*href="([^"]*mpr_\d{4}\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    let url = m[1];
    if (url.startsWith('/')) url = 'https://www.boj.or.jp' + url;
    // Extract date from filename: k260319a.pdf -> March 19, 2026
    const dateMatch = url.match(/k(\d{2})(\d{2})(\d{2})/);
    const dateStr = dateMatch ? `20${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';
    if (title.length < 5 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title: title + (dateStr ? ' (' + dateStr + ')' : ''), text: title + '\n\nStatement PDF: ' + url, url, timestamp: dateStr || new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 42: ECB MONETARY POLICY
// ════════════════════════════════════════════
function parseECB(html) {
  const items = [];
  const regex = /<a[^>]*href="([^"]*\/press\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    let url = m[1];
    if (url.startsWith('/')) url = 'https://www.ecb.europa.eu' + url;
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseECBArticle(html) {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (article) {
    return article[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

// ════════════════════════════════════════════
// SOURCE 41: SAFKHET CAPITAL
// ════════════════════════════════════════════
function parseSafkhet(html) {
  const items = [];
  const downloads = html.match(/href="([^"]*downloads\/[^"]+)"/gi) || [];
  // Get the text section for report descriptions
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const docsIdx = text.indexOf('Documents');
  const docsSection = docsIdx > -1 ? text.substring(docsIdx, docsIdx + 2000) : '';
  // Split by "Download" to get individual report descriptions
  const parts = docsSection.split(/Download/i).filter(p => p.trim().length > 10);

  for (let i = 0; i < downloads.length; i++) {
    const url = downloads[i].match(/"([^"]+)"/)[1];
    const fullUrl = url.startsWith('//') ? 'https:' + url : url;
    const filename = decodeURIComponent(fullUrl.split('/').pop().replace(/\.[^.]+$/, '').replace(/%20/g, ' '));
    const desc = parts[i] ? parts[i].trim().substring(0, 200) : filename;
    items.push({
      id: fullUrl,
      title: desc,
      text: desc + '\n\nReport PDF: ' + fullUrl,
      url: fullUrl,
      timestamp: new Date().toISOString()
    });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 40: J CAPITAL RESEARCH
// ════════════════════════════════════════════
function parseJCapital(html) {
  const items = [];
  // Get the NEW REPORT section from homepage
  const newReportIdx = html.indexOf('NEW REPORT');
  if (newReportIdx > -1) {
    const section = html.substring(newReportIdx, newReportIdx + 3000);
    const text = stripHtml(section).substring(10).trim(); // skip "NEW REPORT" text
    const linkMatch = section.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
    const url = linkMatch ? 'https://www.jcapitalresearch.com' + linkMatch[1] : 'https://www.jcapitalresearch.com/';
    if (text.length > 20) {
      items.push({ id: url, title: text.substring(0, 150), text: text.substring(0, 1000), url, timestamp: new Date().toISOString() });
    }
  }
  // Also get report links from public-research page listing
  const regex = /<a[^>]*href="(\/[a-z][a-z0-9-]*\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    const url = 'https://www.jcapitalresearch.com' + m[1];
    if (title.length >= 2 && title.length < 30 && m[1] !== '/public-research.html' && !items.find(i => i.id === url)) {
      items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
    }
  }
  return items;
}

function parseJCapitalArticle(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Find content after the navigation
  const idx = text.indexOf('Receive Publi');
  const content = idx > -1 ? text.substring(idx + 30, idx + 3000).trim() : text.substring(0, 2000);
  // Append PDF links
  const pdfs = html.match(/href="([^"]+\.pdf)"/gi) || [];
  if (pdfs.length > 0) {
    const pdfUrls = [...new Set(pdfs.map(p => p.match(/"([^"]+)"/)[1]))];
    return content + '\n\nReport PDFs:\n' + pdfUrls.map(u => u.startsWith('http') ? u : 'https://www.jcapitalresearch.com' + u).join('\n');
  }
  return content;
}

// ════════════════════════════════════════════
// SOURCE 39: SCORPION CAPITAL
// ════════════════════════════════════════════
function parseScorpion(html) {
  const items = [];
  // Reports are h3 pairs: company (ticker) + thesis title, with nearby S3 PDF links
  const h3s = [];
  const regex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text.length > 10) h3s.push({ text, index: m.index });
  }
  // Pair company headings (contain ticker in parens) with the next heading (thesis)
  for (let i = 0; i < h3s.length; i++) {
    const tickerMatch = h3s[i].text.match(/\((?:NASDAQ|NYSE|TOKYO|TSX)?:?\s*([A-Z0-9]+)\)/i);
    if (!tickerMatch) continue;
    const company = h3s[i].text;
    const thesis = (i + 1 < h3s.length && !h3s[i+1].text.match(/\((?:NASDAQ|NYSE)/i)) ? h3s[i+1].text : '';
    // Find nearby PDF
    const nearby = html.substring(h3s[i].index, h3s[i].index + 3000);
    const pdfMatch = nearby.match(/href="(https:\/\/scorpionreports[^"]+\.pdf)"/i);
    const pdfUrl = pdfMatch ? pdfMatch[1] : '';
    const title = company + (thesis ? ': ' + thesis.substring(0, 80) : '');
    if (items.find(it => it.title === title)) continue;
    items.push({
      id: pdfUrl || ('https://scorpioncapital.com/#' + tickerMatch[1]),
      title,
      text: title + (pdfUrl ? '\n\nReport PDF: ' + pdfUrl : ''),
      url: pdfUrl || 'https://scorpioncapital.com/',
      timestamp: new Date().toISOString()
    });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 37: BMF REPORTS
// ════════════════════════════════════════════
function parseBMF(html) {
  const items = [];
  const regex = /href="(\.\/articles\/[^"]+)"/gi;
  const links = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    if (!links.includes(m[1])) links.push(m[1]);
  }
  for (const link of links) {
    const fullUrl = 'https://bmfreports.com/' + link.replace('./', '');
    const idx = html.indexOf(link);
    const nearby = html.substring(Math.max(0, idx - 500), idx + 100);
    const heading = nearby.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/gi) || [];
    const title = heading.length > 0 ? stripHtml(heading[heading.length - 1]) : link.split('/').pop().toUpperCase();
    if (title.length < 3 || items.find(i => i.id === fullUrl)) continue;
    items.push({ id: fullUrl, title, text: title, url: fullUrl, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseBMFArticle(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const idx = text.indexOf('BMF Reports');
  if (idx > -1) return text.substring(idx, idx + 5000);
  return text.substring(0, 3000);
}

// ════════════════════════════════════════════
// SOURCE 36: MORPHEUS RESEARCH
// ════════════════════════════════════════════
function parseMorpheus(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/[a-z][a-z0-9-]+\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    const url = 'https://www.morpheus-research.com' + m[1];
    if (title.length < 15 || m[1].includes('/about') || m[1].includes('/contact') || m[1].includes('/legal')
        || m[1].includes('/privacy') || m[1].includes('/cookie') || m[1].includes('/imprint')
        || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseMorpheusArticle(html) {
  const idx = html.indexOf('gh-content');
  if (idx === -1) return '';
  const section = html.substring(idx, idx + 30000);
  const paras = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  return paras.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 20).join(' ');
}

// ════════════════════════════════════════════
// SOURCE 33: GOTHAM CITY RESEARCH
// ════════════════════════════════════════════
function parseGothamCity(xml) {
  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  for (const block of blocks) {
    const title = ((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link = ((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const pubDate = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '').trim();
    if (!title || !link) continue;
    items.push({ id: link, title, text: title, url: link, timestamp: pubDate || new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 32: GLASSHOUSE RESEARCH
// ════════════════════════════════════════════
function parseGlassHouse(html) {
  const items = [];
  // Reports are in <div class="paragraph"> blocks with: date, <a> link to PDF, description
  const blocks = html.split(/<div class="paragraph"/gi);
  for (const block of blocks) {
    // Look for blocks with PDF links
    const pdfMatch = block.match(/<a[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!pdfMatch) continue;
    const pdfUrl = pdfMatch[1].startsWith('http') ? pdfMatch[1] : 'https://www.glasshouseresearch.com' + pdfMatch[1];
    const linkText = stripHtml(pdfMatch[2]);
    // Get the full block text for date and description
    const fullText = stripHtml(block);
    // Extract description (text after the link title)
    const descIdx = fullText.indexOf(linkText);
    const desc = descIdx > -1 ? fullText.substring(descIdx + linkText.length).trim() : '';
    // Extract date (text before the link) — clean up any leftover style/attribute text
    let dateText = descIdx > -1 ? fullText.substring(0, descIdx).trim() : '';
    dateText = dateText.replace(/^[^A-Za-z0-9]+/, '').replace(/style="[^"]*"/gi, '').replace(/&#\d+;/g, '').trim();
    const title = linkText || 'GlassHouse Report';
    if (title.length < 5 || items.find(i => i.id === pdfUrl)) continue;
    const cleanDate = dateText.replace(/^[^A-Za-z]+/, '').trim();
    items.push({
      id: pdfUrl,
      title: (cleanDate ? cleanDate + ' — ' : '') + title,
      text: title + (desc ? '\n' + desc : '') + '\n\nReport PDF: ' + pdfUrl,
      url: pdfUrl,
      timestamp: new Date().toISOString()
    });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 30: FUZZY PANDA RESEARCH
// ════════════════════════════════════════════
function parseFuzzyPanda(html) {
  const items = [];
  const regex = /<a[^>]*href="(https:\/\/fuzzypandaresearch\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    const url = m[1];
    if (title.length < 15 || url.includes('/author/') || url.includes('/category/') || url.includes('/tag/')
        || url.includes('/page/') || url.includes('/contact') || url.includes('/terms')
        || url === 'https://fuzzypandaresearch.com/' || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseFuzzyPandaArticle(html) {
  const entryIdx = html.indexOf('entry-content');
  if (entryIdx === -1) return '';
  const section = html.substring(entryIdx, entryIdx + 30000);
  const paras = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  let text = paras.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 20).join(' ');
  const pdfs = html.match(/href="([^"]+\.pdf)"/gi) || [];
  if (pdfs.length > 0) {
    text += '\n\nReport PDF: ' + pdfs.map(p => p.match(/"([^"]+)"/)[1]).join('\n');
  }
  return text;
}

// ════════════════════════════════════════════
// SOURCE 28: NLRB NEWS RELEASES
// ════════════════════════════════════════════
function parseNLRB(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/news-outreach\/news-story\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://www.nlrb.gov' + m[1];
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseNLRBArticle(html) {
  // NLRB uses Drupal — multiple field--name-body divs, the article body is the longest non-nav one
  const regex = /class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let m, best = '';
  while ((m = regex.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > best.length && !text.includes('Español')) best = text;
  }
  return best;
}

// ════════════════════════════════════════════
// WORDPRESS REST API PARSER (reusable for WP sites)
// ════════════════════════════════════════════
function parseWPAPI(json) {
  try {
    const posts = JSON.parse(json);
    if (!Array.isArray(posts)) return [];
    return posts.map(p => {
      const bodyText = p.content?.rendered ? p.content.rendered.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
      return {
        id: p.link || String(p.id),
        title: stripHtml(p.title?.rendered || ''),
        text: stripHtml(p.title?.rendered || '') + '\n\n' + bodyText,
        url: p.link || '',
        timestamp: p.date || new Date().toISOString()
      };
    }).filter(i => i.title.length > 2);
  } catch { return []; }
}

// ════════════════════════════════════════════
// SOURCE 24: CALCULATED RISK BLOG (Blogspot)
// ════════════════════════════════════════════
function parseCalcRisk(html) {
  const items = [];
  const regex = /<h3[^>]*class='post-title[^']*'[^>]*>\s*<a[^>]*href='([^']*)'[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = m[1];
    const title = stripHtml(m[2]);
    if (title.length < 10 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseCalcRiskArticle(html) {
  const bodyIdx = html.indexOf('post-body');
  if (bodyIdx === -1) return '';
  const section = html.substring(bodyIdx, bodyIdx + 30000);
  const paras = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  return paras.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 10 && !t.includes('CRcounter') && !t.includes('document.write')).join(' ');
}

// ════════════════════════════════════════════
// SUBSTACK PARSER (reusable for all Substack sources)
// ════════════════════════════════════════════
function parseSubstackAPI(json) {
  try {
    const posts = JSON.parse(json);
    if (!Array.isArray(posts)) return [];
    return posts.map(p => {
      const bodyText = p.body_html ? p.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
      return {
        id: p.canonical_url || p.slug,
        title: stripHtml(p.title || ''),
        text: (p.title || '') + (p.subtitle ? ' — ' + p.subtitle : '') + (bodyText ? '\n\n' + bodyText : ''),
        url: p.canonical_url || '',
        timestamp: p.post_date || new Date().toISOString()
      };
    }).filter(i => i.title.length > 2);
  } catch { return []; }
}

// ════════════════════════════════════════════
// SOURCE 22: VICEROY RESEARCH
// ════════════════════════════════════════════
function parseViceroy(html) {
  const items = [];
  const regex = /<a[^>]*href="(https:\/\/viceroyresearch\.org\/publications\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    if (title.length < 10 || items.find(i => i.id === m[1])) continue;
    items.push({ id: m[1], title, text: title, url: m[1], timestamp: new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 21: SPRUCE POINT CAPITAL RESEARCH
// ════════════════════════════════════════════
function parseSprucePoint(html) {
  const items = [];
  const regex = /href="(\/research\/[^"]+)"/gi;
  const urls = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    if (m[1] !== '/research' && !urls.includes(m[1])) urls.push(m[1]);
  }
  // Map each URL to a heading title from nearby context
  for (const url of urls) {
    const fullUrl = 'https://www.sprucepointcap.com' + url;
    const idx = html.indexOf(url);
    const nearby = html.substring(Math.max(0, idx - 500), idx + 200);
    const headings = nearby.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/gi) || [];
    const title = headings.length > 0 ? stripHtml(headings[headings.length - 1]) : url.split('/').pop().replace(/-/g, ' ');
    if (title.length < 3 || items.find(i => i.id === fullUrl)) continue;
    items.push({ id: fullUrl, title, text: title, url: fullUrl, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseSprucePointArticle(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const idx = text.search(/(?:Research Overview|forensic review|strong sell|short)/i);
  let content = idx > -1 ? text.substring(idx, idx + 3000) : text.substring(0, 2000);
  // Append PDF links
  const pdfs = html.match(/href="([^"]+\.pdf)"/gi) || [];
  if (pdfs.length > 0) {
    const pdfUrls = [...new Set(pdfs.map(p => p.match(/href="([^"]+)"/)[1]))];
    content += '\n\nReport PDF: ' + pdfUrls[0];
  }
  return content;
}

// ════════════════════════════════════════════
// SOURCE 20: GRIZZLY RESEARCH
// ════════════════════════════════════════════
function parseGrizzly(html) {
  const items = [];
  const regex = /<a[^>]*href="(https:\/\/grizzlyreports\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    const url = m[1];
    if (title.length < 15 || url.includes('/author/') || url.includes('/category/') || url.includes('/tag/')
        || url.includes('/page/') || url.includes('/news-media') || url === 'https://grizzlyreports.com/'
        || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseGrizzlyArticle(html) {
  const entryIdx = html.indexOf('entry-content');
  if (entryIdx === -1) return '';
  const section = html.substring(entryIdx, entryIdx + 30000);
  const paras = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  let text = paras.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 20).join(' ');
  // Append PDF links
  const pdfs = html.match(/href="([^"]+\.pdf)"/gi) || [];
  if (pdfs.length > 0) {
    const pdfUrls = pdfs.map(p => p.match(/href="([^"]+)"/)[1]);
    text += '\n\nReport PDFs:\n' + pdfUrls.join('\n');
  }
  return text;
}

// ════════════════════════════════════════════
// SOURCE 19: MUDDY WATERS RESEARCH
// ════════════════════════════════════════════
function parseMuddyWaters(html) {
  const items = [];
  const regex = /<a[^>]*href="(https:\/\/muddywatersresearch\.com\/research\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    if (title.length < 10 || items.find(i => i.id === m[1])) continue;
    items.push({ id: m[1], title, text: title, url: m[1], timestamp: new Date().toISOString() });
  }
  return items;
}

function parseMuddyWatersArticle(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Extract the brief description
  const idx = text.indexOf('Muddy Waters');
  const brief = idx > -1 ? text.substring(idx, idx + 500).trim() : '';
  // Find PDF link
  const pdfMatch = html.match(/href="([^"]+\.pdf)"/i);
  const pdf = pdfMatch ? pdfMatch[1] : '';
  return brief + (pdf ? '\n\nFull Report PDF: ' + pdf : '');
}

// ════════════════════════════════════════════
// SOURCE 18: CITRON RESEARCH
// ════════════════════════════════════════════
function parseCitron(html) {
  const items = [];
  // Extract report titles from headings
  const headings = html.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/gi) || [];
  for (const h of headings) {
    const title = stripHtml(h);
    if (title.length < 10 || title.includes('Wall Street') || title.includes('Menu')) continue;
    // Check for nearby PDF link
    const hIdx = html.indexOf(h);
    const nearby = html.substring(hIdx, hIdx + 2000);
    const pdfMatch = nearby.match(/href="([^"]+\.pdf)"/i);
    const pdfUrl = pdfMatch ? pdfMatch[1] : null;
    const url = pdfUrl || 'https://citronresearch.com/';
    const text = pdfUrl ? title + '\n\nFull Report PDF: ' + pdfUrl : title;
    if (!items.find(i => i.title === title))
      items.push({ id: url, title, text, url, timestamp: new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 17: HUNTERBROOK MEDIA
// ════════════════════════════════════════════
function parseHunterbrook(json) {
  try {
    const posts = JSON.parse(json);
    if (!Array.isArray(posts)) return [];
    return posts.map(p => ({
      id: p.link,
      title: stripHtml(p.title.rendered),
      text: stripHtml(p.title.rendered) + '\n\n' + (p.content ? p.content.rendered.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''),
      url: p.link,
      timestamp: p.date || new Date().toISOString()
    }));
  } catch { return []; }
}

// ════════════════════════════════════════════
// SOURCE 16: WOLF STREET
// ════════════════════════════════════════════
function parseWolfStreet(html) {
  const items = [];
  const regex = /<a[^>]*href="(https:\/\/wolfstreet\.com\/\d{4}\/\d{2}\/\d{2}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = stripHtml(m[2]);
    if (title.length < 20 || title.includes('Commenting') || title.includes('About') || items.find(i => i.id === m[1])) continue;
    items.push({ id: m[1], title, text: title, url: m[1], timestamp: new Date().toISOString() });
  }
  return items;
}

function parseWolfStreetArticle(html) {
  const entryIdx = html.indexOf('entry-content');
  if (entryIdx === -1) return '';
  const section = html.substring(entryIdx, entryIdx + 30000);
  const paras = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  return paras.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 20).join(' ');
}

// ════════════════════════════════════════════
// SOURCE 15: BEA CURRENT RELEASES
// ════════════════════════════════════════════
function parseBEA(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/news\/\d{4}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://www.bea.gov' + m[1];
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseBEAArticle(html) {
  const body = html.match(/class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (body) return body[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

// ════════════════════════════════════════════
// SOURCE 13: FCC HEADLINES
// ════════════════════════════════════════════
function parseFCC(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/document\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://www.fcc.gov' + m[1];
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

// ════════════════════════════════════════════
// SOURCE 11: WHITE HOUSE BRIEFING ROOM
// ════════════════════════════════════════════
function parseWhiteHouse(html) {
  const items = [];
  const regex = /<a[^>]*href="(https:\/\/www\.whitehouse\.gov\/briefings-statements\/\d{4}\/\d{2}\/[^"]+)"[^>]*>([^<]{10,})<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const title = m[2].trim();
    if (title.length < 10 || items.find(i => i.id === m[1])) continue;
    items.push({ id: m[1], title, text: title, url: m[1], timestamp: new Date().toISOString() });
  }
  return items;
}

function parseWhiteHouseArticle(html) {
  // Extract paragraphs after the entry-content section
  const entryIdx = html.indexOf('entry-content');
  if (entryIdx === -1) return '';
  const section = html.substring(entryIdx, entryIdx + 20000);
  const paras = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  return paras.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 10).join(' ');
}

// ════════════════════════════════════════════
// SOURCE 10: USTR PRESS RELEASES
// ════════════════════════════════════════════
function parseUSTR(html) {
  const items = [];
  // USTR uses both /about/ and /about-us/ URL patterns
  const regex = /<a[^>]*href="(\/about(?:-us)?\/policy-offices\/press-office\/press-releases\/\d{4}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://ustr.gov' + m[1];
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseUSTRArticle(html) {
  const body = html.match(/class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (body) return body[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

// ════════════════════════════════════════════
// SOURCE 9: TREASURY PRESS RELEASES
// ════════════════════════════════════════════
function parseTreasury(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/news\/press-releases\/[a-z]{2}\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://home.treasury.gov' + m[1];
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseTreasuryArticle(html) {
  const body = html.match(/class="[^"]*field--name-field-news-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (body) return body[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

// ════════════════════════════════════════════
// SOURCE 6: OSHA NEWS RELEASES
// ════════════════════════════════════════════
function parseOSHA(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/news\/newsreleases\/[^"]+\/\d{8})"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://www.osha.gov' + m[1];
    const title = stripHtml(m[2]);
    if (title.length < 15 || items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: new Date().toISOString() });
  }
  return items;
}

function parseOSHAArticle(html) {
  const body = html.match(/class="[^"]*field--name-field-press-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (body) return body[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const fallback = html.match(/class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (fallback) return fallback[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

// ════════════════════════════════════════════
// SOURCE 5: EIA WEEKLY PETROLEUM
// ════════════════════════════════════════════
function parseEIA(html) {
  const items = [];
  const regex = /<a[^>]*href="(\/petroleum\/supply\/weekly\/archive\/\d{4}\/[^"]+\.php)"[^>]*>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = 'https://www.eia.gov' + m[1];
    // Extract date from URL: .../2026_04_01/wpsr_2026_04_01.php
    const dateMatch = m[1].match(/(\d{4})_(\d{2})_(\d{2})/);
    const dateStr = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';
    const title = `Weekly Petroleum Status Report — ${dateStr}`;
    if (items.find(i => i.id === url)) continue;
    items.push({ id: url, title, text: title, url, timestamp: dateStr || new Date().toISOString() });
  }
  return items;
}

function parseEIAArticle(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Extract highlights section
  const idx = text.indexOf('Highlights');
  if (idx > -1) return text.substring(idx, idx + 2000);
  return text.substring(0, 2000);
}

// ════════════════════════════════════════════

const SOURCES = [
  {
    name: 'FDA Press Announcements',
    key: 'fda',
    url: 'https://www.fda.gov/news-events/fda-newsroom/press-announcements',
    interval: 5000,
    parseFn: parseFDA,
    parseArticleFn: parseFDAArticle
  },
  // SEC Press Releases — handled by puppeteer worker in main.js
  {
    name: 'CPSC Recalls',
    key: 'cpsc',
    url: 'https://www.cpsc.gov/Recalls',
    interval: 5000,
    parseFn: parseCPSC,
    parseArticleFn: parseCPSCArticle
  },
  {
    name: 'FTC Press Releases',
    key: 'ftc',
    url: 'https://www.ftc.gov/news-events/news/press-releases',
    interval: 5000,
    parseFn: parseFTC,
    parseArticleFn: parseFTCArticle
  },
  {
    name: 'EIA Weekly Petroleum',
    key: 'eia',
    url: 'https://www.eia.gov/petroleum/supply/weekly/',
    interval: 5000,
    parseFn: parseEIA,
    parseArticleFn: parseEIAArticle
  },
  {
    name: 'OSHA News Releases',
    key: 'osha',
    url: 'https://www.osha.gov/news/newsreleases',
    interval: 5000,
    parseFn: parseOSHA,
    parseArticleFn: parseOSHAArticle
  },
  {
    name: 'Treasury Press Releases',
    key: 'treasury',
    url: 'https://home.treasury.gov/news/press-releases',
    interval: 5000,
    parseFn: parseTreasury,
    parseArticleFn: parseTreasuryArticle
  },
  {
    name: 'USTR Press Releases',
    key: 'ustr',
    url: 'https://ustr.gov/about-us/policy-offices/press-office/press-releases',
    interval: 5000,
    parseFn: parseUSTR,
    parseArticleFn: parseUSTRArticle
  },
  {
    name: 'White House Briefing Room',
    key: 'whitehouse',
    url: 'https://www.whitehouse.gov/briefings-statements/',
    interval: 5000,
    parseFn: parseWhiteHouse,
    parseArticleFn: parseWhiteHouseArticle
  },
  {
    name: 'FCC Headlines',
    key: 'fcc',
    url: 'https://www.fcc.gov/news-events/headlines',
    interval: 5000,
    parseFn: parseFCC,
    parseArticleFn: null
  },
  {
    name: 'BEA Current Releases',
    key: 'bea',
    url: 'https://www.bea.gov/news/current-releases',
    interval: 5000,
    parseFn: parseBEA,
    parseArticleFn: parseBEAArticle
  },
  {
    name: 'Wolf Street',
    key: 'wolfstreet',
    url: 'https://wolfstreet.com/',
    interval: 5000,
    parseFn: parseWolfStreet,
    parseArticleFn: parseWolfStreetArticle
  },
  {
    name: 'Hunterbrook Media',
    key: 'hunterbrook',
    url: 'https://hntrbrk.com/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content',
    interval: 5000,
    parseFn: parseWPAPI,
    parseArticleFn: null,
    headers: { 'Accept': 'application/json' }
  },
  {
    name: 'Citron Research',
    key: 'citron',
    url: 'https://citronresearch.com/',
    interval: 5000,
    parseFn: parseCitron,
    parseArticleFn: null
  },
  {
    name: 'Muddy Waters Research',
    key: 'muddywaters',
    url: 'https://muddywatersresearch.com/',
    interval: 5000,
    parseFn: parseMuddyWaters,
    parseArticleFn: parseMuddyWatersArticle
  },
  {
    name: 'Grizzly Research',
    key: 'grizzly',
    url: 'https://grizzlyreports.com/',
    interval: 5000,
    parseFn: parseGrizzly,
    parseArticleFn: parseGrizzlyArticle
  },
  {
    name: 'Spruce Point Capital',
    key: 'sprucepoint',
    url: 'https://www.sprucepointcap.com/research',
    interval: 5000,
    parseFn: parseSprucePoint,
    parseArticleFn: parseSprucePointArticle
  },
  // Viceroy Research — handled by puppeteer worker in main.js
  {
    name: 'BearCave (Edwin Dorsey)',
    key: 'bearcave',
    url: 'https://thebearcave.substack.com/api/v1/posts?limit=10',
    interval: 5000,
    parseFn: parseSubstackAPI,
    parseArticleFn: null,
    headers: { 'Accept': 'application/json' }
  },
  {
    name: 'Calculated Risk (Economic Weekly)',
    key: 'calcrisk',
    url: 'https://economicweekly.substack.com/api/v1/posts?limit=10',
    interval: 5000,
    parseFn: parseSubstackAPI,
    parseArticleFn: null,
    headers: { 'Accept': 'application/json' }
  },
  {
    name: 'ProPublica',
    key: 'propublica',
    url: 'https://www.propublica.org/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content',
    interval: 5000,
    parseFn: parseWPAPI,
    parseArticleFn: null,
    headers: { 'Accept': 'application/json' }
  },
  {
    name: 'Econbrowser',
    key: 'econbrowser',
    url: 'https://econbrowser.com/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content',
    interval: 5000,
    parseFn: parseWPAPI,
    parseArticleFn: null,
    headers: { 'Accept': 'application/json' }
  },
  {
    name: 'NLRB News Releases',
    key: 'nlrb',
    url: 'https://www.nlrb.gov/news-publications/news/news-releases',
    interval: 5000,
    parseFn: parseNLRB,
    parseArticleFn: parseNLRBArticle
  },
  {
    name: 'Fuzzy Panda Research',
    key: 'fuzzypanda',
    url: 'https://fuzzypandaresearch.com/',
    interval: 5000,
    parseFn: parseFuzzyPanda,
    parseArticleFn: parseFuzzyPandaArticle
  },
  {
    name: 'GlassHouse Research',
    key: 'glasshouse',
    url: 'https://www.glasshouseresearch.com/research.html',
    interval: 5000,
    parseFn: parseGlassHouse,
    parseArticleFn: null
  },
  // Gotham City Research — handled by puppeteer worker in main.js
  {
    name: 'Morpheus Research',
    key: 'morpheus',
    url: 'https://www.morpheus-research.com/',
    interval: 5000,
    parseFn: parseMorpheus,
    parseArticleFn: parseMorpheusArticle
  },
  {
    name: 'BMF Reports',
    key: 'bmf',
    url: 'https://bmfreports.com/',
    interval: 5000,
    parseFn: parseBMF,
    parseArticleFn: parseBMFArticle
  },
  {
    name: 'Scorpion Capital',
    key: 'scorpion',
    url: 'https://scorpioncapital.com/',
    interval: 5000,
    parseFn: parseScorpion,
    parseArticleFn: null
  },
  {
    name: 'J Capital Research',
    key: 'jcapital',
    url: 'https://www.jcapitalresearch.com/',
    interval: 5000,
    parseFn: parseJCapital,
    parseArticleFn: parseJCapitalArticle
  },
  {
    name: 'SAFKHET Capital',
    key: 'safkhet',
    url: 'https://safkhetcapital.com/market-advocacy',
    interval: 5000,
    parseFn: parseSafkhet,
    parseArticleFn: null
  },
  // ── SUBSTACK SHORT SELLER / RESEARCH SOURCES ──
  { name: 'Intelligent Speculator', key: 'intspec', url: 'https://intelligentspeculations.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Capybara Research', key: 'capybara', url: 'https://capybara.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Fourier Transform Research', key: 'fourier', url: 'https://fouriertransform.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Bleecker Street Research', key: 'bleecker', url: 'https://bleeckerstreet.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Manatee Research', key: 'manatee', url: 'https://manatee.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Black Mamba Research', key: 'blackmamba', url: 'https://blackmamba.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'On the Impossible', key: 'onimpossible', url: 'https://impossible.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Ragnarok Research', key: 'ragnarok', url: 'https://ragnarokresearch.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: "Martin's Newsletter", key: 'martins', url: 'https://martinsnewsletter.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Minus Cherry', key: 'minuscherry', url: 'https://minuscherry.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'ManBearChicken', key: 'manbearchicken', url: 'https://manbearchicken.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Guasty Winds', key: 'guastywinds', url: 'https://guastywinds.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Undefined Mystic', key: 'undefinedmystic', url: 'https://undefinedmystic.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Sunshine Research', key: 'sunshine', url: 'https://sunshineresearch.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Whitelight Capital', key: 'whitelight', url: 'https://whitelightcapital.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Brevarthan Research', key: 'brevarthan', url: 'https://brevarthanresearch.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'A Failure to Communicate', key: 'failcomm', url: 'https://afailuretocommunicate.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Herb Greenberg', key: 'herb_greenberg', url: 'https://www.herbgreenberg.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Citrini Research', key: 'citrini', url: 'https://www.citriniresearch.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'The Nexus Files', key: 'nexusfiles', url: 'https://thenexusfiles.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Pelican Way Research', key: 'pelicanway', url: 'https://pelicanwayresearch.substack.com/api/v1/posts?limit=10', interval: 5000, parseFn: parseSubstackAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  // ── WORDPRESS API SOURCES ──
  { name: 'White Diamond Research', key: 'whitediamond', url: 'https://whitediamondresearch.com/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content', interval: 5000, parseFn: parseWPAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'The Big Picture (Ritholtz)', key: 'ritholtz', url: 'https://ritholtz.com/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content', interval: 5000, parseFn: parseWPAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Liberty Street Economics', key: 'liberty_st', url: 'https://libertystreeteconomics.newyorkfed.org/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content', interval: 5000, parseFn: parseWPAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  // ── BLOGSPOT SOURCE ──
  {
    name: 'Clark Street Value',
    key: 'clarkstreet',
    url: 'https://clarkstreetvalue.blogspot.com/',
    interval: 5000,
    parseFn: parseCalcRisk,
    parseArticleFn: parseCalcRiskArticle
  },
  // ── ACTIVIST INVESTORS (WordPress API) ──
  { name: 'Trian Partners', key: 'trian', url: 'https://trianpartners.com/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content', interval: 5000, parseFn: parseWPAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Elliott Letters', key: 'elliott', url: 'https://elliottletters.com/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content', interval: 5000, parseFn: parseWPAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'UAW News', key: 'uaw', url: 'https://uaw.org/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content', interval: 5000, parseFn: parseWPAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  { name: 'Teamsters Press', key: 'teamsters', url: 'https://teamster.org/wp-json/wp/v2/posts?per_page=10&_fields=id,title,link,date,content', interval: 5000, parseFn: parseWPAPI, parseArticleFn: null, headers: { 'Accept': 'application/json' } },
  // Philly Fed Manufacturing — handled by puppeteer worker in main.js
  // ── SOURCE 57: USDA WASDE REPORT ──
  {
    name: 'USDA WASDE Report',
    key: 'usda_wasde',
    url: 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report',
    interval: 5000,
    parseFn: parseWASDE,
    parseArticleFn: null
  },
  // ── SOURCE 56: SUPREME COURT OPINIONS ──
  {
    name: 'Supreme Court Opinions',
    key: 'scotus',
    url: 'https://www.supremecourt.gov/opinions/slipopinion/25',
    interval: 5000,
    parseFn: parseSCOTUS,
    parseArticleFn: null
  },
  // ── SOURCE 53: NY FED EMPIRE STATE ──
  {
    name: 'NY Fed Empire State',
    key: 'ny_fed',
    url: 'https://www.newyorkfed.org/survey/empire/empiresurvey_overview',
    interval: 5000,
    parseFn: parseNYFed,
    parseArticleFn: null
  },
  // ── SOURCE 51: CENSUS RETAIL SALES ──
  {
    name: 'Census Retail Sales',
    key: 'census_retail',
    url: 'https://www.census.gov/retail/sales.html',
    interval: 5000,
    parseFn: parseCensusRetail,
    parseArticleFn: null
  },
  // ── SOURCE 50: ADP EMPLOYMENT REPORT ──
  {
    name: 'ADP Employment Report',
    key: 'adp',
    url: 'https://adpemploymentreport.com/',
    interval: 5000,
    parseFn: parseADP,
    parseArticleFn: null
  },
  // ── SOURCE 48: ESA NEWSROOM ──
  {
    name: 'ESA Newsroom',
    key: 'esa',
    url: 'https://www.esa.int/Newsroom',
    interval: 5000,
    parseFn: parseESA,
    parseArticleFn: parseESAArticle
  },
  // ── SOURCE 46: NASA NEWS RELEASES ──
  {
    name: 'NASA News Releases',
    key: 'nasa',
    url: 'https://www.nasa.gov/2026-news-releases/',
    interval: 5000,
    parseFn: parseNASA,
    parseArticleFn: parseNASAArticle
  },
  // ── SOURCE 44: BANK OF ENGLAND MONETARY POLICY ──
  {
    name: 'Bank of England Policy',
    key: 'boe',
    url: 'https://www.bankofengland.co.uk/monetary-policy',
    interval: 5000,
    parseFn: parseBOE,
    parseArticleFn: parseBOEArticle
  },
  // ── SOURCE 43: BANK OF JAPAN DECISIONS ──
  {
    name: 'Bank of Japan Decisions',
    key: 'boj',
    url: 'https://www.boj.or.jp/en/mopo/mpmdeci/state_2026/index.htm',
    interval: 5000,
    parseFn: parseBOJ,
    parseArticleFn: null
  },
  // ── SOURCE 42: ECB MONETARY POLICY ──
  {
    name: 'ECB Monetary Policy',
    key: 'ecb',
    url: 'https://www.ecb.europa.eu/press/govcdec/mopo/html/index.en.html',
    interval: 5000,
    parseFn: parseECB,
    parseArticleFn: parseECBArticle
  },
  // ── SOURCES 62-65: CENSUS DATA + WTO ──
  {
    name: 'Census New Home Sales',
    key: 'census_newhomes',
    url: 'https://www.census.gov/construction/nrs/current/index.html',
    interval: 5000,
    parseFn: parseCensusPage,
    parseArticleFn: null
  },
  {
    name: 'Census Housing Starts',
    key: 'census_starts',
    url: 'https://www.census.gov/construction/nrc/index.html',
    interval: 5000,
    parseFn: parseCensusPage,
    parseArticleFn: null
  },
  {
    name: 'Census Durable Goods',
    key: 'census_durables',
    url: 'https://www.census.gov/manufacturing/m3/adv/current/index.html',
    interval: 5000,
    parseFn: parseCensusPage,
    parseArticleFn: null
  },
  {
    name: 'WTO Dispute Settlement',
    key: 'wto',
    url: 'https://www.wto.org/english/tratop_e/dispu_e/dispu_e.htm',
    interval: 5000,
    parseFn: parseWTO,
    parseArticleFn: null
  },
  // ── SOURCES 66-67: BANK OF CANADA + RBA ──
  {
    name: 'Bank of Canada',
    key: 'boc',
    url: 'https://www.bankofcanada.ca/press/',
    interval: 5000,
    parseFn: parseBOC,
    parseArticleFn: parseBOCArticle
  },
  {
    name: 'RBA Media Releases',
    key: 'rba',
    url: 'https://www.rba.gov.au/media-releases/',
    interval: 5000,
    parseFn: parseRBA,
    parseArticleFn: parseRBAArticle
  },
];

module.exports = SOURCES;
