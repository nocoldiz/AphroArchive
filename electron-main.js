const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let serverProcess;

function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "AphroArchive"
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    // In development, load the Vite dev server
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // In production, start the Node server
    const serverPath = path.join(__dirname, 'server.js');
    
    serverProcess = spawn('node', [serverPath], {
      cwd: __dirname,
      env: { ...process.env, PORT: '3000' }
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`Server: ${data}`);
      if (data.toString().includes('running at')) {
        win.loadURL('http://localhost:3000');
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`Server Error: ${data}`);
    });

    // Fallback if we don't detect the log line
    setTimeout(() => {
      if (!win.webContents.getURL()) {
        win.loadURL('http://localhost:3000');
      }
    }, 3000);
  }

  win.on('closed', () => {
    if (serverProcess) serverProcess.kill();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
  if (serverProcess) serverProcess.kill();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
