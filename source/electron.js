require('dotenv').config();

const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/main/ipc-handlers');

const SHORTCUTS_TEXT = [
  'Navegação',
  '  ↑ / ↓            Abrir o e-mail anterior/próximo',
  '  Shift + ↑ / ↓    Selecionar vários e-mails em sequência',
  '  Delete           Excluir o e-mail aberto (já abre o próximo)',
  '',
  'Zoom do corpo do e-mail',
  '  Ctrl/Cmd + =     Aumentar zoom',
  '  Ctrl/Cmd + -     Diminuir zoom',
  '  Ctrl/Cmd + 0     Redefinir zoom',
].join('\n');

// Menu enxuto: só o que tem utilidade real (zoom do corpo do e-mail e a
// referência de atalhos). O menu padrão do Electron (File/Edit/Window/Help)
// tem principalmente itens de desenvolvimento sem uso para quem usa o app.
function buildMenu(mainWindow) {
  const sendZoom = (action) => mainWindow.webContents.send('zoom-change', action);

  const template = [
    {
      label: 'Exibir',
      submenu: [
        { label: 'Aumentar zoom do e-mail', accelerator: 'CmdOrCtrl+=', click: () => sendZoom(0.1) },
        { label: 'Diminuir zoom do e-mail', accelerator: 'CmdOrCtrl+-', click: () => sendZoom(-0.1) },
        { label: 'Redefinir zoom do e-mail', accelerator: 'CmdOrCtrl+0', click: () => sendZoom('reset') },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Atalhos de teclado',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Atalhos de teclado',
              message: 'Atalhos de teclado',
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
