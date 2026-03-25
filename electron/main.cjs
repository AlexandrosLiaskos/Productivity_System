/** @module electron/main — Electron main process (CommonJS) */

'use strict';

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { createServer } = require('node:net');
const { execFile: execFileCb } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, writeFile, readFile, access } = require('node:fs/promises');
const { join } = require('node:path');

const execFile = promisify(execFileCb);

// --- Data directory and window state path (set after app.whenReady) ---
let DATA_DIR;
let STATE_FILE;

/**
 * Find a free TCP port by binding to port 0.
 * @returns {Promise<number>}
 */
function findFreePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Load saved window bounds from disk.
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
 */
async function loadWindowState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save window bounds to disk.
 * @param {BrowserWindow} win
 */
async function saveWindowState(win) {
  try {
    const bounds = win.getBounds();
    await writeFile(STATE_FILE, JSON.stringify(bounds, null, 2), 'utf-8');
  } catch {
    // Non-critical
  }
}

/**
 * Debounce a function call.
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Perform first-run setup: create folder structure and welcome project.
 */
async function firstRunSetup() {
  const projectsDir = join(DATA_DIR, 'projects');

  try {
    await access(projectsDir);
    return; // Already exists
  } catch {
    // Does not exist — proceed
  }

  await mkdir(join(DATA_DIR, 'projects', 'Getting_Started'), { recursive: true });
  await mkdir(join(DATA_DIR, 'actions'), { recursive: true });
  await writeFile(join(DATA_DIR, 'actions', 'history.json'), '[]\n', 'utf-8');

  try {
    await execFile('git', ['init'], { cwd: DATA_DIR });
  } catch {
    // Will be caught by checkGit()
  }

  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = String(today.getFullYear()) + pad(today.getMonth() + 1) + pad(today.getDate());

  await writeFile(
    join(DATA_DIR, 'projects', 'Getting_Started', '.project.json'),
    JSON.stringify({
      name: 'Getting_Started',
      status: 'in_progress',
      github_url: '',
      coordinator: '',
      created: dateStr,
      description: 'Your first project \u2014 start adding entries!',
    }, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Check that git is available on PATH. Show dialog and quit if not.
 */
async function checkGit() {
  try {
    await execFile('git', ['--version']);
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Git Not Found',
      message: 'Git is required but was not found.',
      detail: 'Please install it from https://git-scm.com/ and restart the application.',
      buttons: ['OK'],
    });
    app.quit();
    throw new Error('git not found');
  }
}

/**
 * Build and set the application menu.
 * @param {BrowserWindow} win
 */
function buildMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Entry', accelerator: 'CmdOrCtrl+N', click: () => win.webContents.send('shortcut', 'new') },
        { label: 'Search', accelerator: 'CmdOrCtrl+K', click: () => win.webContents.send('shortcut', 'search') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Productivity System',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About',
              message: 'Productivity System',
              detail: `Version ${app.getVersion()}\nA file-based productivity logging system.\nData: ${DATA_DIR}`,
            });
          },
        },
        {
          label: 'Open Data Folder',
          click: () => { shell.openPath(DATA_DIR); },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Main entry point ---
async function main() {
  await app.whenReady();

  DATA_DIR = join(app.getPath('userData'), 'data');
  STATE_FILE = join(app.getPath('userData'), 'window-state.json');

  await checkGit();
  await firstRunSetup();

  // Find a free port and start the internal HTTP server
  const PORT = await findFreePort();
  process.env.PORT = String(PORT);
  process.env.PRODUCTIVITY_SYSTEM_DIR = DATA_DIR;

  // Dynamic ESM import of the server
  await import('../server/server.js');

  // Small delay to let the server bind
  await new Promise((r) => setTimeout(r, 500));

  // Restore saved window state
  const savedState = await loadWindowState();
  const windowOptions = {
    width: (savedState && savedState.width) || 1200,
    height: (savedState && savedState.height) || 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Productivity System',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (savedState && savedState.x != null) {
    windowOptions.x = savedState.x;
    windowOptions.y = savedState.y;
  }

  const win = new BrowserWindow(windowOptions);
  buildMenu(win);

  const persistState = debounce(() => saveWindowState(win), 500);
  win.on('resize', persistState);
  win.on('move', persistState);

  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://localhost:${PORT}/`);
}

app.on('window-all-closed', () => {
  app.quit();
});

main().catch((err) => {
  if (err.message !== 'git not found') {
    console.error('Fatal error in main:', err);
    dialog
      .showMessageBox({ type: 'error', title: 'Startup Error', message: 'Productivity System failed to start.', detail: err.message, buttons: ['OK'] })
      .finally(() => app.quit());
  }
});
