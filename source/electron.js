require('dotenv').config();

const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/main/ipc-handlers');

const SHORTCUTS_TEXT = [
  'Navigation',
  '  ↑ / ↓            Open the previous/next e-mail',
  '  Shift + ↑ / ↓    Select several e-mails in a row',
  '  Delete           Delete the open e-mail (opens the next one)',
  '',
  'E-mail body zoom',
  '  Ctrl/Cmd + =     Zoom in',
  '  Ctrl/Cmd + -     Zoom out',
  '  Ctrl/Cmd + 0     Reset zoom',
].join('\n');

// A lean menu: only what is actually useful (e-mail body zoom and the
// shortcut reference). Electron's default menu (File/Edit/Window/Help)
// is mostly development items of no use to whoever uses the app.
function buildMenu(mainWindow) {
  const sendZoom = (action) => mainWindow.webContents.send('zoom-change', action);

  const template = [
    {
      label: 'View',
      submenu: [
        { label: 'Zoom in on the e-mail', accelerator: 'CmdOrCtrl+=', click: () => sendZoom(0.1) },
        { label: 'Zoom out of the e-mail', accelerator: 'CmdOrCtrl+-', click: () => sendZoom(-0.1) },
        { label: 'Reset e-mail zoom', accelerator: 'CmdOrCtrl+0', click: () => sendZoom('reset') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard shortcuts',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Keyboard shortcuts',
              message: 'Keyboard shortcuts',
              detail: SHORTCUTS_TEXT,
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(buildMenu(mainWindow));
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  registerIpcHandlers();
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
