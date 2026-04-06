const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// Must set this as main entry for electron
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

    fs.writeFileSync(path.join(__dirname, 'data', 'sec-test.json'), result);
    process.stdout.write('OK\\n');
  } catch (e) {
    fs.writeFileSync(path.join(__dirname, 'data', 'sec-test.json'), JSON.stringify({ error: e.message }));
    process.stdout.write('Error: ' + e.message + '\\n');
  }

  app.quit();
});
