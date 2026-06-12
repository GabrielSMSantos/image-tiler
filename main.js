const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const https = require('https');

let mainWindow;

const MATRIZES_DIR = path.join(__dirname, 'matrizes');
if (!fs.existsSync(MATRIZES_DIR)) fs.mkdirSync(MATRIZES_DIR, { recursive: true });

function createWindow() {
  console.log('[main] createWindow called');
  mainWindow = new BrowserWindow({
    width: 1200, height: 780, minWidth: 960, minHeight: 620,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Image Tiler',
    backgroundColor: '#0d0d0d',
    show: false
  });
  console.log('[main] BrowserWindow created, loading file...');
  mainWindow.loadFile('src/index.html');
  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error('[main] did-fail-load:', code, desc, url);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] did-finish-load OK');
  });
  mainWindow.webContents.on('preload-error', (e, preloadPath, err) => {
    console.error('[main] preload-error:', preloadPath, err.message);
  });
  mainWindow.webContents.on('console-message', (e, level, msg, line, src) => {
    if (level >= 2) console.error('[renderer]', msg, 'line:' + line);
    else console.log('[renderer]', msg);
  });
  mainWindow.once('ready-to-show', () => {
    console.log('[main] ready-to-show, showing window');
    mainWindow.show();
  });
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

app.on('ready', () => { console.log('[main] app ready'); });
app.on('window-all-closed', () => { console.log('[main] all windows closed'); app.quit(); });
app.on('render-process-gone', (e, wc, details) => { console.error('[main] render-process-gone:', JSON.stringify(details)); });
app.on('child-process-gone', (e, details) => { console.error('[main] child-process-gone:', JSON.stringify(details)); });

app.whenReady().then(() => {
  console.log('[main] whenReady fired, creating window...');
  createWindow();
});

// ── PDF ────────────────────────────────────────────────────────────────────
ipcMain.handle('save-pdf', async (e, pdfBytes) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar PDF',
    defaultPath: path.join(os.homedir(), 'Desktop', 'imagens_impressao.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { success: false };
  try { fs.writeFileSync(filePath, Buffer.from(pdfBytes)); return { success: true, filePath }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('print-pdf', async (e, pdfBytes) => {
  return new Promise(resolve => {
    let win, tmpPath, settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (win && !win.isDestroyed()) win.destroy();
      if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
      resolve(result);
    };
    try {
      tmpPath = path.join(os.tmpdir(), `imagetiler-print-${Date.now()}.pdf`);
      fs.writeFileSync(tmpPath, Buffer.from(pdfBytes));
      // plugins:true is required so Electron's built-in PDF viewer renders the file
      win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, plugins: true } });
      win.webContents.once('did-finish-load', () => {
        win.webContents.print({ silent: false, printBackground: true }, (ok, err) => {
          finish(ok ? { success: true } : { success: false, error: err || 'Cancelado.' });
        });
      });
      win.webContents.once('did-fail-load', (ev, code, desc) => {
        finish({ success: false, error: `Falha ao carregar PDF: ${desc} (${code})` });
      });
      win.loadURL(`file://${tmpPath}`);
      setTimeout(() => finish({ success: false, error: 'Timeout.' }), 15000);
    } catch (err) { finish({ success: false, error: err.message }); }
  });
});

// ── UPDATE CHECK ───────────────────────────────────────────────────────────
const UPDATE_REPO = 'GabrielSMSantos/image-tiler';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'image-tiler-app', 'Accept': 'application/vnd.github+json' }
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Timeout.')));
  });
}

// Compares dotted-numeric versions. Returns >0 if a > b, <0 if a < b, 0 if equal.
function compareVersions(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  try {
    const release = await fetchJSON(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    if (!latestVersion) return { success: false, currentVersion, error: 'Sem tag de versao.' };
    return {
      success: true,
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      url: release.html_url || `https://github.com/${UPDATE_REPO}/releases`
    };
  } catch (err) {
    return { success: false, currentVersion, error: err.message };
  }
});

ipcMain.handle('open-external', async (e, url) => {
  try {
    if (!/^https:\/\/github\.com\/GabrielSMSantos\/image-tiler(\/|$)/i.test(url)) {
      return { success: false, error: 'URL nao permitida.' };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── MATRIZES ───────────────────────────────────────────────────────────────

// Find the image file for a matrix (supports .svg, .png, .jpg, .jpeg)
function findMatrixFile(id) {
  for (const ext of ['.svg', '.png', '.jpg', '.jpeg']) {
    const p = path.join(MATRIZES_DIR, id + ext);
    if (fs.existsSync(p)) return { filePath: p, ext };
  }
  return null;
}

ipcMain.handle('list-matrices', async () => {
  try {
    const files    = fs.readdirSync(MATRIZES_DIR);
    const matrices = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id       = f.replace('.json', '');
      const jsonPath = path.join(MATRIZES_DIR, id + '.json');
      const found    = findMatrixFile(id);
      if (!found) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const isSvg = found.ext === '.svg';
        let thumb;
        if (isSvg) {
          // For SVG thumbnails encode as base64 SVG data URL
          thumb = 'data:image/svg+xml;base64,' + fs.readFileSync(found.filePath).toString('base64');
        } else {
          const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
          thumb = `data:${mimeMap[found.ext]};base64,` + fs.readFileSync(found.filePath).toString('base64');
        }
        matrices.push({
          id,
          name:        meta.name,
          thumbnail:   thumb,
          format:      isSvg ? 'svg' : 'raster',
          layers:      meta.layers     || [],
          svgContent:  meta.svgContent || null,  // edited SVG XML stored in JSON
          createdAt:   meta.createdAt  || 0,
          presetName:  meta.presetName || null,
          coordVersion: meta.coordVersion || 1
        });
      } catch(e) {}
    }
    matrices.sort((a, b) => b.createdAt - a.createdAt);
    return { success: true, matrices };
  } catch (err) { return { success: false, error: err.message }; }
});

// Save new matrix — copies source file, detects format
ipcMain.handle('save-matrix', async (e, { id, name, srcPath, layers }) => {
  try {
    const srcExt   = path.extname(srcPath).toLowerCase();
    const isSvg    = srcExt === '.svg';
    const destExt  = isSvg ? '.svg' : srcExt || '.png';
    const filePath = path.join(MATRIZES_DIR, id + destExt);
    const jsonPath = path.join(MATRIZES_DIR, id + '.json');
    fs.copyFileSync(srcPath, filePath);
    const meta = {
      name,
      format:      isSvg ? 'svg' : 'raster',
      layers:      layers || [],
      svgContent:  null,
      createdAt:   Date.now(),
      coordVersion: 2
    };
    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// Update matrix layers (for raster) or svgContent (for SVG)
ipcMain.handle('update-matrix-layers', async (e, { id, layers, coordVersion }) => {
  try {
    const jsonPath = path.join(MATRIZES_DIR, id + '.json');
    if (!fs.existsSync(jsonPath)) return { success: false, error: 'Nao encontrada.' };
    const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    meta.layers = layers;
    if (coordVersion !== undefined) meta.coordVersion = coordVersion;
    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// Save edited SVG content
ipcMain.handle('save-svg-content', async (e, { id, svgContent }) => {
  try {
    const jsonPath = path.join(MATRIZES_DIR, id + '.json');
    if (!fs.existsSync(jsonPath)) return { success: false, error: 'Nao encontrada.' };
    const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    meta.svgContent = svgContent;
    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('update-matrix-meta', async (e, { id, presetName }) => {
  try {
    const jsonPath = path.join(MATRIZES_DIR, id + '.json');
    if (!fs.existsSync(jsonPath)) return { success: false, error: 'Nao encontrada.' };
    const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    meta.presetName = presetName || null;
    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('delete-matrix', async (e, { id }) => {
  try {
    const jsonPath = path.join(MATRIZES_DIR, id + '.json');
    const found    = findMatrixFile(id);
    if (found) fs.unlinkSync(found.filePath);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// Read original matrix file content
ipcMain.handle('read-matrix-image', async (e, { id }) => {
  try {
    const found = findMatrixFile(id);
    if (!found) return { success: false, error: 'Arquivo nao encontrado.' };
    const isSvg = found.ext === '.svg';
    if (isSvg) {
      const svgText = fs.readFileSync(found.filePath, 'utf8');
      return { success: true, format: 'svg', svgText };
    } else {
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
      const mime    = mimeMap[found.ext] || 'image/png';
      const b64     = fs.readFileSync(found.filePath).toString('base64');
      return { success: true, format: 'raster', imageBase64: `data:${mime};base64,${b64}` };
    }
  } catch (err) { return { success: false, error: err.message }; }
});
