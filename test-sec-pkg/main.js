const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const outFile = path.join(__dirname, '..', 'data', 'sec-test.json');

app.on('ready', async () => {
  const win = new BrowserWindow({
    show: false, width: 800, height: 600,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  try {
    await win.loadURL('https://www.sec.gov');
    await new Promise(r => setTimeout(r, 5000));

    const result = await win.webContents.executeJavaScript(`
      fetch('https://www.sec.gov/newsroom/press-releases/2026-32-sec-highlights-financial-independence-during-financial-literacy-month')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(html => JSON.stringify({ ok: true, html: html }))
        .catch(e => JSON.stringify({ ok: false, error: e.message }))
    `);

    fs.writeFileSync(outFile, result);
  } catch (e) {
    fs.writeFileSync(outFile, JSON.stringify({ error: e.message }));
  }

  app.quit();
});
