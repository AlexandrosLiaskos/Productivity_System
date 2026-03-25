/** @module electron/main — Electron main process (CommonJS) */

'use strict';

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const { createServer } = require('node:net');
const { execFile: execFileCb, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, writeFile, readFile, access } = require('node:fs/promises');
const { join } = require('node:path');
const http = require('node:http');

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
 * Sanitize an email subject for use in filenames.
 * Re-implemented inline (CJS) — mirrors server/api/utils.js sanitizeEmailSubject.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeEmailSubject(raw) {
  if (!raw) return 'no_subject';
  let s = raw.trim();
  // Replace characters that are illegal in filenames with underscores
  s = s.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  // Collapse multiple spaces/underscores
  s = s.replace(/[\s_]+/g, '_');
  // Strip leading/trailing underscores
  s = s.replace(/^_+|_+$/g, '');
  if (!s) return 'no_subject';
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

/**
 * Spawn a PowerShell script and return parsed JSON output.
 * @param {string} scriptName - filename under server/outlook/
 * @param {string[]} [args=[]]
 * @returns {Promise<any>}
 */
function runPowerShell(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, '..', 'server', 'outlook', scriptName);
    const ps = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      ...args,
    ], { timeout: 30000 });

    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (chunk) => { stdout += chunk; });
    ps.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      ps.kill();
      reject(new Error(`PowerShell script "${scriptName}" timed out after 30s`));
    }, 30000);

    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`PowerShell script "${scriptName}" exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`PowerShell script "${scriptName}" returned non-JSON output: ${stdout.trim()}`));
      }
    });

    ps.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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
        { label: 'Log Email', accelerator: 'CmdOrCtrl+E', click: () => win.webContents.send('shortcut', 'email-logger') },
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

  // --- Outlook IPC handlers ---

  ipcMain.handle('outlook:check-available', async () => {
    return runPowerShell('check-available.ps1');
  });

  ipcMain.handle('outlook:list-folders', async () => {
    return runPowerShell('list-folders.ps1');
  });

  ipcMain.handle('outlook:list-emails', async (_event, { folderPath, limit }) => {
    return runPowerShell('list-emails.ps1', ['-FolderPath', folderPath, '-Limit', String(limit || 50)]);
  });

  ipcMain.handle('outlook:preview-email', async (_event, { entryId }) => {
    return runPowerShell('preview-email.ps1', ['-EntryId', entryId]);
  });

  ipcMain.handle('outlook:log-emails', async (_event, { emails, project, author, references }) => {
    const projectDir = join(DATA_DIR, 'projects', project);
    const results = [];

    for (const email of emails) {
      const { entryId, subject, from, to, cc, date, hasAttachments, bodyPreview, attachments } = email;

      // Build date string (YYYYMMDD)
      const d = new Date(date);
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());

      // Build base filename (without extension)
      const sanitizedSubject = sanitizeEmailSubject(subject);
      const authorPart = author ? `.${author}` : '';
      const baseNameNoExt = `${sanitizedSubject}.email${authorPart}.${dateStr}`;

      // Handle duplicate filenames by appending _2, _3, etc.
      let msgFilename = `${baseNameNoExt}.msg`;
      let suffix = 2;
      while (true) {
        try {
          await access(join(projectDir, msgFilename));
          // File exists — try next suffix
          msgFilename = `${baseNameNoExt}_${suffix}.msg`;
          suffix++;
        } catch {
          // File does not exist — we can use this name
          break;
        }
      }

      // Export the .msg file + attachments via PowerShell
      const exportArgs = ['-EntryId', entryId, '-OutputDir', projectDir, '-Filename', msgFilename];
      await runPowerShell('export-email.ps1', exportArgs);

      // Write .meta.json sidecar
      const metaFilename = msgFilename.replace('.msg', '.meta.json');
      const meta = {
        subject,
        from,
        to,
        cc,
        date,
        hasAttachments,
        bodyPreview,
        attachments: attachments || [],
        references: references || [],
      };
      await writeFile(join(projectDir, metaFilename), JSON.stringify(meta, null, 2) + '\n', 'utf-8');

      // Auto-commit
      try {
        await execFile('git', ['add', msgFilename, metaFilename], { cwd: projectDir });
        await execFile('git', ['commit', '-m', `log: email "${subject}"`], { cwd: DATA_DIR });
      } catch {
        // Non-fatal — commit failures are ignored
      }

      results.push({ msgFilename, metaFilename });
    }

    return { logged: results };
  });

  ipcMain.handle('outlook:get-tracked-ids', async () => {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${PORT}/api/entries?type=email`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const entries = JSON.parse(body);
            const ids = entries
              .map((e) => e.outlookEntryId)
              .filter(Boolean);
            resolve(ids);
          } catch (e) {
            reject(new Error('Failed to parse entries response: ' + e.message));
          }
        });
      }).on('error', reject);
    });
  });

  // --- Startup Outlook availability check ---
  let outlookAvailable = null;
  try {
    outlookAvailable = await runPowerShell('check-available.ps1');
  } catch {
    outlookAvailable = { available: false };
  }

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
