const { app, BrowserWindow, ipcMain, globalShortcut, Menu } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let selectedPrinter = null;

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

// Native print using macOS lp command
ipcMain.handle('print-image-native', async (event, imageDataUrl) => {
  if (!selectedPrinter) {
    return { success: false, error: 'No printer selected' };
  }

  try {
    // Extract base64 data
    const base64Data = imageDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Create temp file
    const tempFile = path.join(os.tmpdir(), `webcam-print-${Date.now()}.png`);
    fs.writeFileSync(tempFile, buffer);

    console.log('Printing to:', selectedPrinter);
    console.log('Temp file:', tempFile);

    // Use macOS lp command
    execSync(`lp -d "${selectedPrinter}" -o fit-to-page "${tempFile}"`, {
      encoding: 'utf8'
    });

    // Clean up temp file after a delay
    setTimeout(() => {
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        console.error('Error cleaning temp file:', e);
      }
    }, 5000);

    return { success: true };
  } catch (error) {
    console.error('Native print error:', error);
    return { success: false, error: error.message };
  }
});