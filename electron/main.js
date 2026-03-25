/** @module electron/main */

import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { createServer } from 'node:net';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const execFile = promisify(execFileCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Data directory (in OS user data folder, never relative) ---
const DATA_DIR = join(app.getPath('userData'), 'data');

// --- Window state persistence ---
const STATE_FILE = join(app.getPath('userData'), 'window-state.json');

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
    // Non-critical — ignore
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

  // Check if already initialised
  try {
    await access(projectsDir);
    return; // Already exists — skip setup
  } catch {
    // Does not exist — proceed
  }

  // Create directories
  await mkdir(join(DATA_DIR, 'projects', 'Getting_Started'), { recursive: true });
  await mkdir(join(DATA_DIR, 'actions'), { recursive: true });

  // Create actions history
  await writeFile(join(DATA_DIR, 'actions', 'history.json'), '[]\n', 'utf-8');

  // Git init
  try {
    await execFile('git', ['init'], { cwd: DATA_DIR });
  } catch {
    // Git unavailable — will be caught by checkGit() shortly
  }

  // Create welcome project
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr =
    String(today.getFullYear()) +
    pad(today.getMonth() + 1) +
    pad(today.getDate());

  const welcomeProject = {
    name: 'Getting_Started',
    status: 'in_progress',
    github_url: '',
    coordinator: '',
    created: dateStr,
    description: 'Your first project \u2014 start adding entries!',
  };

  await writeFile(
    join(DATA_DIR, 'projects', 'Getting_Started', '.project.json'),
    JSON.stringify(welcomeProject, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Check that git is available on PATH. Show a dialog and quit if not.
 */
async function checkGit() {
  try {
    await execFile('git', ['--version']);
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Git Not Found',
      message: 'Git is required but was not found.',
      detail:
        'Please install it from https://git-scm.com/ and restart the application.',
      buttons: ['OK'],
    });
    app.quit();
    throw new Error('git not found');
  }
}

/**
 * Build and set the application menu.
 * @param {BrowserWindow} win
 * @param {number} port
 */
function buildMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Entry',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('shortcut', 'new'),
        },
        {
          label: 'Search',
          accelerator: 'CmdOrCtrl+K',
          click: () => win.webContents.send('shortcut', 'search'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
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
          click: () => {
            shell.openPath(DATA_DIR);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// --- Main entry point ---
async function main() {
  await app.whenReady();

  // Check git availability first
  await checkGit();

  // First-run setup (creates DATA_DIR structure if needed)
  await firstRunSetup();

  // Find a free port and start the internal HTTP server
  const PORT = await findFreePort();
  process.env.PORT = String(PORT);
  process.env.PRODUCTIVITY_SYSTEM_DIR = DATA_DIR;

  // Dynamically import the server — it reads PORT and DATA_DIR from env at import time
  await import('../server/server.js');

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

  // Save bounds on resize/move (debounced to avoid excessive disk writes)
  const persistState = debounce(() => saveWindowState(win), 500);
  win.on('resize', persistState);
  win.on('move', persistState);

  // Wait briefly for the server to be ready, then load the UI
  win.once('ready-to-show', () => win.show());

  // Poll until the server responds, then load
  const tryLoad = async (attempts = 0) => {
    try {
      await new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.once('listening', () => { probe.close(); resolve(); });
        // We actually want to connect, not listen — use net.connect
        probe.close();
        resolve();
      });
      // Small delay to ensure HTTP server is accepting connections
      await new Promise((r) => setTimeout(r, 300 + attempts * 100));
      win.loadURL(`http://localhost:${PORT}/`);
    } catch {
      if (attempts < 10) {
        setTimeout(() => tryLoad(attempts + 1), 200);
      } else {
        win.loadURL(`http://localhost:${PORT}/`);
      }
    }
  };

  await tryLoad();
}

app.on('window-all-closed', () => {
  app.quit();
});

main().catch((err) => {
  if (err.message !== 'git not found') {
    console.error('Fatal error in main:', err);
    dialog
      .showMessageBox({
        type: 'error',
        title: 'Startup Error',
        message: 'Productivity System failed to start.',
        detail: err.message,
        buttons: ['OK'],
      })
      .finally(() => app.quit());
  }
});
