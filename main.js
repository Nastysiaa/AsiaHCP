const { app, BrowserWindow, ipcMain, globalShortcut, Menu } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let selectedPrinter = null;

app.setName('AsiaHCP');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'icon.png'),
    title: 'AsiaHCP',
    resizable: true,
    minWidth: 1000,
    minHeight: 600
  });

  mainWindow.loadFile('index.html');
  
  // Create menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Change Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('show-settings');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Uncomment for debugging
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Get available printers
ipcMain.handle('get-printers', async (event) => {
  try {
    // Method 1: Try Electron API
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const printers = await mainWindow.webContents.getPrintersAsync();
        if (printers && printers.length > 0) {
          return printers;
        }
      } catch (e) {
        console.log('Electron API failed, trying system command...');
      }
    }

    // Method 2: Fallback to system command (macOS)
    if (process.platform === 'darwin') {
      try {
        const output = execSync('lpstat -p', { encoding: 'utf8' });
        const printers = [];
        const lines = output.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('printer ')) {
            const name = line.split(' ')[1];
            printers.push({
              name: name,
              displayName: name,
              description: '',
              status: 0,
              isDefault: false
            });
          }
        }
        
        // Check for default printer
        try {
          const defaultOutput = execSync('lpstat -d', { encoding: 'utf8' });
          const match = defaultOutput.match(/system default destination: (.+)/);
          if (match && match[1]) {
            const defaultName = match[1].trim();
            const defaultPrinter = printers.find(p => p.name === defaultName);
            if (defaultPrinter) {
              defaultPrinter.isDefault = true;
            }
          }
        } catch (e) {
          // No default printer set
        }
        
        return printers;
      } catch (error) {
        console.error('System command failed:', error);
        return [];
      }
    }

    return [];
  } catch (error) {
    console.error('Error getting printers:', error);
    return [];
  }
});

// Set selected printer
ipcMain.on('set-printer', (event, printerName) => {
  selectedPrinter = printerName;
  console.log('Selected printer:', selectedPrinter);
});

// Native print using macOS lp command (auto-detect grayscale across vendors)
const { execFileSync } = require('child_process');

ipcMain.handle('print-image-native', async (event, dataUrl, printOpts = {}) => {
  const deviceName = printOpts.deviceName || selectedPrinter;

  if (!deviceName) return { success: false, error: 'No printer selected' };
  if (!dataUrl || !/^data:image\/(png|jpeg);base64,/.test(dataUrl)) {
    return { success: false, error: 'Invalid image data URL' };
  }
  if (process.platform !== 'darwin') {
    return { success: false, error: 'Native CUPS path is macOS-only' };
  }

  // --- helpers ---
  const PREFERRED_GRAY_VALUES = [
    'Gray', 'KGray', 'DeviceGray', 'Grayscale', 'Mono', 'Monochrome', 'Black',
    'Gray16', 'DeviceGray16', 'B&W', 'BW', 'BlackWhite'
  ];

  // keys that commonly control color/mono on different vendors
  const COLOR_KEY_HINTS = [
    'print-color-mode', 'colormodel', 'colormode', 'colormgmt', 'processcolormodel',
    'outputmode', 'color', 'ap_colormode', 'hpcolormode', 'brmonocolor', 'cmcolormode',
    'xeroxcolor', 'epcolormode', 'printasgray'
  ];

  const parseOptions = (txt) => {
    // returns array of { key, baseKey, raw, choices:[{val, isDefault}] }
    return txt.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [lhs, rhsRaw] = line.split(':');
      if (!rhsRaw) return null;
      const key = lhs.trim();                     // e.g., "ColorModel/Color Mode"
      const baseKey = key.split('/')[0].trim();   // e.g., "ColorModel"
      const rhs = rhsRaw.trim();
      const tokens = rhs.split(/\s+/).filter(Boolean);
      const choices = tokens.map(val => ({
        val: val.replace(/^\*/, ''),              // strip '*' marker
        isDefault: val.startsWith('*')
      }));
      return { key, baseKey, raw: line, choices };
    }).filter(Boolean);
  };

  const findGrayOption = (options) => {
    // 1) restrict to color-related keys
    const candidates = options.filter(o => {
      const k = o.baseKey.toLowerCase();
      return COLOR_KEY_HINTS.some(h => k.includes(h));
    });

    // 2) among those, find one that offers a grayish value
    let best = null;
    for (const opt of candidates) {
      // Build a quick lookup of available values
      const values = new Set(opt.choices.map(c => c.val));
      // Pick first preferred value available
      const chosen = PREFERRED_GRAY_VALUES.find(v => values.has(v));
      if (chosen) {
        // prefer direct "print-color-mode" or "ColorModel" first
        const baseLower = opt.baseKey.toLowerCase();
        const rank =
          baseLower.includes('print-color-mode') ? 0 :
          baseLower.includes('colormodel')       ? 1 : 2;
        const score = `${rank}-${PREFERRED_GRAY_VALUES.indexOf(chosen)}`;
        best = best && best.score <= score ? best : { opt, value: chosen, score };
      }
    }

    // 3) Return best match if found
    if (best) return { key: best.opt.baseKey, value: best.value };

    // 4) No match: try to fall back to IPP Everywhere if present at all
    const hasPrintColorMode = options.some(o => o.baseKey.toLowerCase().includes('print-color-mode'));
    if (hasPrintColorMode) return { key: 'print-color-mode', value: 'monochrome' };

    return null;
  };

  let tmpDir, filePath;
  try {
    // Write image to temp file
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asiahcp-print-'));
    const ext = dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    filePath = path.join(tmpDir, `capture.${ext}`);
    const base64 = dataUrl.split(',')[1];
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

    // Query printer capabilities
    let lpopts = '';
    try {
      lpopts = execFileSync('lpoptions', ['-p', deviceName, '-l'], { encoding: 'utf8' });
    } catch {
      // Some drivers don't expose -l; we'll fall back to generic flags
    }

    const args = ['-d', deviceName, '-o', 'fit-to-page'];
    const addOpt = (k, v) => args.push('-o', `${k}=${v}`);

    // Choose the best gray option for THIS printer
    let appliedGray = null;
    if (lpopts) {
      const parsed = parseOptions(lpopts);
      const chosen = findGrayOption(parsed);
      if (chosen) {
        addOpt(chosen.key, chosen.value);
        appliedGray = chosen;
      }
    }

    // Robust fallbacks (ignored if unknown)
    if (!appliedGray) {
      addOpt('print-color-mode', 'monochrome'); // IPP Everywhere
      addOpt('ColorModel', 'Gray');             // Common PPD
      addOpt('ColorModel', 'KGray');            // Some PPDs
      addOpt('PrintAsGray', 'true');            // Some drivers
      addOpt('ColorMode', 'Monochrome');        // Alt spelling
    }

    if (printOpts.jobTitle) {
      args.unshift('-t', String(printOpts.jobTitle));
    }

    // Print via CUPS
    const out = execFileSync('lp', args.concat([filePath]), { encoding: 'utf8' });

    return { success: true, job: out.trim(), appliedGray };
  } catch (error) {
    console.error('Native print error:', error);
    return { success: false, error: error.message };
  } finally {
    try { if (filePath) fs.unlinkSync(filePath); } catch {}
    try { if (tmpDir) fs.rmdirSync(tmpDir); } catch {}
  }
});
