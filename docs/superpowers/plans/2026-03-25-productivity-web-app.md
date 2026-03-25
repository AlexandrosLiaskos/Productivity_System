# Productivity System Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a vanilla JavaScript web app that manages the file-based Productivity System — CRUD entries (tasks, logs, notes), timeline view, search, filters, git-integrated action history with rewind, hotkeys.

**Architecture:** Node.js server (zero npm deps, built-in `http`/`fs`/`child_process` only) exposes a REST API for file CRUD and git operations. Static vanilla JS frontend uses ES modules, functional style, mobile-first. The filesystem is the database — entries are JSON/MD files organized into project folders. Every mutation is logged to an action history and auto-committed for rewind.

**Tech Stack:** Node.js (built-in modules only), vanilla HTML/CSS/JS (ES modules), git CLI

---

## File Map

```
Productivity_System/
├── .gitignore
├── package.json                        # start script only, zero deps
├── server/
│   ├── server.js                       # HTTP server, router, static file serving
│   └── api/
│       ├── entries.js                  # Entry CRUD (list, read, create, update, delete)
│       ├── projects.js                 # Project listing and metadata
│       ├── git.js                      # commit, push, log, rewind
│       ├── actions.js                  # Action history log, clear
│       └── utils.js                    # Path resolution, filename parse/build, validation
├── app/
│   ├── index.html                      # Single-page shell
│   ├── css/
│   │   └── style.css                   # Mobile-first, white-bg/black-fg
│   └── js/
│       ├── app.js                      # Init, wiring, event delegation
│       └── modules/
│           ├── api.js                  # fetch() wrapper for all server endpoints
│           ├── state.js                # Central state store with pub/sub
│           ├── timeline.js             # Main data-table view
│           ├── modal.js                # Modal system (create, edit, detail, confirm)
│           ├── search.js               # Global + tag search
│           ├── filters.js              # Project and type filter controls
│           ├── hotkeys.js              # Keyboard shortcuts
│           ├── history.js              # Action history panel + rewind
│           └── utils.js                # Filename parsing, date formatting, DOM helpers
├── actions/
│   └── history.json                    # Action log (array of action objects)
└── projects/                           # DATA — already exists
    └── Productivity_System/
        ├── .project.json
        └── (existing entries)
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects (name, status, entry count) |
| GET | `/api/projects/:name` | Get project metadata |
| POST | `/api/projects` | Create project |
| PUT | `/api/projects/:name` | Update project metadata |
| GET | `/api/entries` | List entries (query: `?project=X&type=Y`) |
| GET | `/api/entries/:project/:filename` | Read entry content |
| POST | `/api/entries` | Create entry (returns filename) |
| PUT | `/api/entries/:project/:filename` | Update entry |
| DELETE | `/api/entries/:project/:filename` | Delete entry |
| GET | `/api/search?q=X` | Full-text + tag search (`project:X`, `type:task`, etc.) |
| GET | `/api/git/diff/:hash` | Get diff for a specific commit |
| GET | `/api/actions` | Get action history |
| DELETE | `/api/actions` | Clear all actions |
| DELETE | `/api/actions/:index` | Clear specific action |
| POST | `/api/git/commit` | Commit with message |
| POST | `/api/git/push` | Push to remote |
| GET | `/api/git/log` | Get commit log |
| POST | `/api/git/rewind` | Rewind to commit hash |

---

## Filename Convention

**Pattern:** `{Title}.{type}.{author}.{YYYYMMDD}.{ext}`

- Title: `Title_Case_Underscored`
- type: `task` | `log` | `note`
- author: lowercase surname (optional — omitted if not provided)
- date: `YYYYMMDD`
- ext: `.json` (task, log) | `.md` (note)

**Parsing regex:** `/^(.+)\.(task|log|note)\.(?:([a-z]+)\.)?(\d{8})\.(json|md)$/`

---

## Data Schemas

**Task (.json):**
```json
{
  "status": "queued",
  "deadline": null,
  "body": "",
  "references": {}
}
```

**Log (.json):**
```json
{
  "body": ""
}
```

**Note (.md):** Plain markdown. Metadata derived from filename.

**Project (.project.json):**
```json
{
  "name": "",
  "status": "in_progress",
  "github_url": "",
  "coordinator": "",
  "created": "YYYYMMDD",
  "description": ""
}
```

**Action (in history.json):**
```json
{
  "id": 1,
  "timestamp": "2026-03-25T12:00:00.000Z",
  "type": "create|update|delete",
  "target": "Productivity_System/Fix_Bug.task.liaskos.20260325.json",
  "detail": "Created task",
  "commitHash": "abc1234"
}
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `actions/history.json`
- Create: `server/`, `app/`, `app/css/`, `app/js/`, `app/js/modules/`, `server/api/`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "productivity-system",
  "version": "1.0.0",
  "type": "module",
  "description": "Long-term productivity logging system",
  "scripts": {
    "start": "node server/server.js"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
.DS_Store
Thumbs.db
```

- [ ] **Step 3: Create empty action history**

`actions/history.json`:
```json
[]
```

- [ ] **Step 4: Create all directories**

```bash
mkdir -p server/api app/css app/js/modules
```

- [ ] **Step 5: Initialize git repo**

```bash
cd AlexandrosLiaskos/Productivity_System
git init
git add -A
git commit -m "init: scaffold productivity system"
```

---

## Task 2: Server — Utilities

**Files:**
- Create: `server/api/utils.js`

- [ ] **Step 1: Write utils module**

```javascript
/** @module server/api/utils */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root of the Productivity_System repo */
export const ROOT = join(__dirname, '..', '..');

/** Path to the projects data directory */
export const PROJECTS_DIR = join(ROOT, 'projects');

/** Path to the actions history file */
export const HISTORY_PATH = join(ROOT, 'actions', 'history.json');

/** Filename parsing regex */
const FILENAME_RE = /^(.+)\.(task|log|note)\.(?:([a-z]+)\.)?(\d{8})\.(json|md)$/;

/**
 * Parse an entry filename into its components.
 * @param {string} filename
 * @returns {{ title: string, type: string, author: string|null, date: string, ext: string } | null}
 */
export function parseFilename(filename) {
  const m = filename.match(FILENAME_RE);
  if (!m) return null;
  return { title: m[1], type: m[2], author: m[3] || null, date: m[4], ext: m[5] };
}

/**
 * Build a filename from entry components.
 * @param {{ title: string, type: string, author?: string, date: string }} parts
 * @returns {string}
 */
export function buildFilename({ title, type, author, date }) {
  const ext = type === 'note' ? 'md' : 'json';
  const segments = [title, type];
  if (author) segments.push(author);
  segments.push(date);
  return segments.join('.') + '.' + ext;
}

/**
 * Read and parse a JSON file. Returns null on error.
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function readJSON(filePath) {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write an object as formatted JSON to a file.
 * @param {string} filePath
 * @param {object} data
 */
export async function writeJSON(filePath, data) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Parse the JSON body from an incoming HTTP request.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<object>}
 */
export function parseBody(req) {
  const MAX_BODY = 1024 * 1024; // 1MB
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} data
 */
export function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Sanitize a title string for use in filenames.
 * Replaces spaces with underscores, removes unsafe characters.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeTitle(raw) {
  return raw.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
}

/**
 * Resolve a path safely within a base directory. Throws on path traversal.
 * @param {string} base
 * @param {...string} segments
 * @returns {string}
 */
export function safePath(base, ...segments) {
  const { resolve, normalize } = await import('node:path');
  const resolved = normalize(resolve(base, ...segments));
  if (!resolved.startsWith(normalize(resolve(base)))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/api/utils.js
git commit -m "feat: add server utilities — filename parsing, JSON helpers"
```

---

## Task 3: Server — Entry CRUD

**Files:**
- Create: `server/api/entries.js`

- [ ] **Step 1: Write entries module**

```javascript
/** @module server/api/entries */

import { readdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECTS_DIR, parseFilename, buildFilename, readJSON, writeJSON, sanitizeTitle, safePath } from './utils.js';

/**
 * List entries, optionally filtered by project and/or type.
 * @param {{ project?: string, type?: string }} filters
 * @returns {Promise<Array<object>>}
 */
export async function listEntries({ project, type } = {}) {
  const results = [];
  const projectDirs = project
    ? [project]
    : (await readdir(PROJECTS_DIR)).filter(d => !d.startsWith('.'));

  for (const dir of projectDirs) {
    const dirPath = join(PROJECTS_DIR, dir);
    try {
      const dirStat = await stat(dirPath);
      if (!dirStat.isDirectory()) continue;
    } catch { continue; }

    const files = await readdir(dirPath);
    for (const file of files) {
      if (file.startsWith('.')) continue;
      const parsed = parseFilename(file);
      if (!parsed) continue;
      if (type && parsed.type !== type) continue;

      const entry = { ...parsed, project: dir, filename: file };

      if (parsed.ext === 'json') {
        const content = await readJSON(join(dirPath, file));
        if (content) Object.assign(entry, content);
      } else {
        const raw = await readFile(join(dirPath, file), 'utf-8');
        entry.body = raw;
      }

      results.push(entry);
    }
  }

  results.sort((a, b) => b.date.localeCompare(a.date));
  return results;
}

/**
 * Read a single entry's full content.
 * @param {string} project
 * @param {string} filename
 * @returns {Promise<object|null>}
 */
export async function readEntry(project, filename) {
  const filePath = join(PROJECTS_DIR, project, filename);
  const parsed = parseFilename(filename);
  if (!parsed) return null;

  try {
    const raw = await readFile(filePath, 'utf-8');
    if (parsed.ext === 'json') {
      return { ...parsed, project, filename, ...JSON.parse(raw) };
    }
    return { ...parsed, project, filename, body: raw };
  } catch {
    return null;
  }
}

/**
 * Create a new entry file. Returns the generated filename.
 * @param {{ project: string, title: string, type: string, author?: string, date: string, body?: string, status?: string, deadline?: string, references?: object }} data
 * @returns {Promise<string>}
 */
export async function createEntry(data) {
  const title = sanitizeTitle(data.title);
  const filename = buildFilename({ title, type: data.type, author: data.author, date: data.date });
  const filePath = join(PROJECTS_DIR, data.project, filename);

  if (data.type === 'note') {
    await writeFile(filePath, data.body || '', 'utf-8');
  } else {
    const content = { status: data.status || 'queued' };
    if (data.type === 'task') content.deadline = data.deadline || null;
    content.body = data.body || '';
    if (data.references) content.references = data.references;
    await writeJSON(filePath, content);
  }

  return filename;
}

/**
 * Update an existing entry. Supports renaming (filename change) and body update.
 * @param {string} project
 * @param {string} oldFilename
 * @param {{ title?: string, type?: string, author?: string, date?: string, body?: string, status?: string, deadline?: string, references?: object }} updates
 * @returns {Promise<string>} new filename
 */
export async function updateEntry(project, oldFilename, updates) {
  const parsed = parseFilename(oldFilename);
  if (!parsed) throw new Error('Invalid filename');

  const newParts = {
    title: updates.title ? sanitizeTitle(updates.title) : parsed.title,
    type: updates.type || parsed.type,
    author: updates.author !== undefined ? updates.author : parsed.author,
    date: updates.date || parsed.date,
  };
  const newFilename = buildFilename(newParts);

  const oldPath = join(PROJECTS_DIR, project, oldFilename);
  const newPath = join(PROJECTS_DIR, project, newFilename);

  if (newParts.type === 'note') {
    await writeFile(newPath, updates.body || '', 'utf-8');
  } else {
    const existing = (await readJSON(oldPath)) || {};
    const content = {
      status: updates.status !== undefined ? updates.status : existing.status,
      body: updates.body !== undefined ? updates.body : existing.body,
    };
    if (newParts.type === 'task') {
      content.deadline = updates.deadline !== undefined ? updates.deadline : existing.deadline;
    }
    if (updates.references) content.references = updates.references;
    else if (existing.references) content.references = existing.references;
    await writeJSON(newPath, content);
  }

  if (newFilename !== oldFilename) {
    try { await unlink(oldPath); } catch { /* may be same path */ }
  }

  return newFilename;
}

/**
 * Delete an entry file.
 * @param {string} project
 * @param {string} filename
 */
export async function deleteEntry(project, filename) {
  await unlink(join(PROJECTS_DIR, project, filename));
}

/**
 * Full-text + tag search across all entries.
 * Supports tag prefixes: project:X, type:task, status:queued, author:liaskos
 * Remaining text is matched as full-text substring.
 * @param {string} query
 * @returns {Promise<Array<object>>}
 */
export async function searchEntries(query) {
  if (!query.trim()) return [];
  const tags = {};
  const textParts = [];
  for (const token of query.split(/\s+/)) {
    const m = token.match(/^(project|type|status|author):(.+)$/i);
    if (m) tags[m[1].toLowerCase()] = m[2].toLowerCase();
    else textParts.push(token);
  }
  const text = textParts.join(' ').toLowerCase();
  const all = await listEntries();
  return all.filter(entry => {
    if (tags.project && entry.project.toLowerCase() !== tags.project) return false;
    if (tags.type && entry.type !== tags.type) return false;
    if (tags.status && (entry.status || '').toLowerCase() !== tags.status) return false;
    if (tags.author && (entry.author || '').toLowerCase() !== tags.author) return false;
    if (text) {
      const haystack = [entry.title, entry.type, entry.author, entry.project, entry.body || ''].join(' ').toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/api/entries.js
git commit -m "feat: add entry CRUD — list, read, create, update, delete, search"
```

---

## Task 4: Server — Project Operations

**Files:**
- Create: `server/api/projects.js`

- [ ] **Step 1: Write projects module**

```javascript
/** @module server/api/projects */

import { readdir, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECTS_DIR, readJSON, writeJSON, parseFilename } from './utils.js';

/**
 * List all projects with metadata and entry counts.
 * @returns {Promise<Array<object>>}
 */
export async function listProjects() {
  const dirs = await readdir(PROJECTS_DIR);
  const results = [];

  for (const dir of dirs) {
    const dirPath = join(PROJECTS_DIR, dir);
    try {
      const s = await stat(dirPath);
      if (!s.isDirectory()) continue;
    } catch { continue; }

    const meta = (await readJSON(join(dirPath, '.project.json'))) || { name: dir };
    const files = await readdir(dirPath);
    const entryCount = files.filter(f => !f.startsWith('.') && parseFilename(f)).length;

    results.push({ ...meta, entryCount });
  }

  return results;
}

/**
 * Get a single project's metadata.
 * @param {string} name
 * @returns {Promise<object|null>}
 */
export async function getProject(name) {
  return readJSON(join(PROJECTS_DIR, name, '.project.json'));
}

/**
 * Create a new project directory with metadata.
 * @param {object} meta
 * @returns {Promise<void>}
 */
export async function createProject(meta) {
  const dirPath = join(PROJECTS_DIR, meta.name);
  await mkdir(dirPath, { recursive: true });
  await writeJSON(join(dirPath, '.project.json'), meta);
}

/**
 * Update a project's metadata.
 * @param {string} name
 * @param {object} updates
 * @returns {Promise<void>}
 */
export async function updateProject(name, updates) {
  const metaPath = join(PROJECTS_DIR, name, '.project.json');
  const existing = (await readJSON(metaPath)) || {};
  await writeJSON(metaPath, { ...existing, ...updates });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/api/projects.js
git commit -m "feat: add project operations — list, get, create, update"
```

---

## Task 5: Server — Git Operations

**Files:**
- Create: `server/api/git.js`

Uses `execFile` (not `exec`) — arguments passed as array, no shell interpolation.

- [ ] **Step 1: Write git module**

```javascript
/** @module server/api/git */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './utils.js';

const execFile = promisify(execFileCb);

/**
 * Run a git command in the repo root.
 * @param {...string} args
 * @returns {Promise<string>} stdout
 */
async function git(...args) {
  const { stdout } = await execFile('git', args, { cwd: ROOT, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

/**
 * Stage all changes and commit with a message.
 * @param {string} message
 * @returns {Promise<string>} commit hash
 */
export async function commit(message) {
  await git('add', '-A');
  await git('commit', '-m', message);
  const hash = await git('rev-parse', '--short', 'HEAD');
  return hash;
}

/**
 * Push to the remote origin.
 * @returns {Promise<string>}
 */
export async function push() {
  return git('push');
}

/**
 * Get the git log as an array of commit objects.
 * @param {number} limit
 * @returns {Promise<Array<{ hash: string, message: string, date: string }>>}
 */
export async function log(limit = 50) {
  const raw = await git('log', `--max-count=${limit}`, '--pretty=format:%h\t%s\t%aI');
  if (!raw) return [];
  return raw.split('\n').map(line => {
    const [hash, message, date] = line.split('\t');
    return { hash, message, date };
  });
}

/**
 * Get the diff for a specific commit.
 * @param {string} hash
 * @returns {Promise<string>} diff output
 */
export async function diff(hash) {
  return git('diff', `${hash}~1`, hash);
}

/**
 * Rewind the repo to a specific commit hash.
 * Creates a new commit that represents the old state (non-destructive).
 * @param {string} hash
 * @returns {Promise<string>} new commit hash
 */
export async function rewind(hash) {
  await git('checkout', hash, '--', '.');
  return commit(`rewind: restore state from ${hash}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/api/git.js
git commit -m "feat: add git operations — commit, push, log, rewind"
```

---

## Task 6: Server — Action History

**Files:**
- Create: `server/api/actions.js`

- [ ] **Step 1: Write actions module**

```javascript
/** @module server/api/actions */

import { HISTORY_PATH, readJSON, writeJSON } from './utils.js';

/**
 * Get the full action history.
 * @returns {Promise<Array<object>>}
 */
export async function getActions() {
  return (await readJSON(HISTORY_PATH)) || [];
}

/**
 * Append an action to the history log.
 * @param {{ type: string, target: string, detail: string, commitHash?: string }} action
 * @returns {Promise<object>} the saved action
 */
export async function logAction({ type, target, detail, commitHash }) {
  const actions = await getActions();
  const entry = {
    id: actions.length + 1,
    timestamp: new Date().toISOString(),
    type,
    target,
    detail,
    commitHash: commitHash || null,
  };
  actions.push(entry);
  await writeJSON(HISTORY_PATH, actions);
  return entry;
}

/**
 * Clear all actions from the history.
 * @returns {Promise<void>}
 */
export async function clearAllActions() {
  await writeJSON(HISTORY_PATH, []);
}

/**
 * Remove a specific action by index.
 * @param {number} index - zero-based index
 * @returns {Promise<void>}
 */
export async function clearAction(index) {
  const actions = await getActions();
  if (index >= 0 && index < actions.length) {
    actions.splice(index, 1);
    await writeJSON(HISTORY_PATH, actions);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/api/actions.js
git commit -m "feat: add action history — log, get, clear"
```

---

## Task 7: Server — HTTP Server & Router

**Files:**
- Create: `server/server.js`

- [ ] **Step 1: Write the HTTP server with full routing**

```javascript
/** @module server/server */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { ROOT, parseBody, sendJSON } from './api/utils.js';
import * as entries from './api/entries.js';
import * as projects from './api/projects.js';
import * as git from './api/git.js';
import * as actions from './api/actions.js';

const PORT = process.env.PORT || 3000;
const APP_DIR = join(ROOT, 'app');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Serve a static file from the app/ directory.
 * @param {import('node:http').ServerResponse} res
 * @param {string} urlPath
 */
async function serveStatic(res, urlPath) {
  const { resolve, normalize } = await import('node:path');
  const filePath = join(APP_DIR, urlPath === '/' ? 'index.html' : urlPath);
  const resolved = normalize(resolve(filePath));
  if (!resolved.startsWith(normalize(resolve(APP_DIR)))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('Not a file');
    const content = await readFile(filePath);
    const mime = MIME[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

/**
 * Log an action and auto-commit the change.
 * @param {{ type: string, target: string, detail: string }} action
 * @returns {Promise<object>}
 */
async function logAndCommit(action) {
  let commitHash = null;
  try { commitHash = await git.commit(action.detail); } catch { /* no changes to commit */ }
  return actions.logAction({ ...action, commitHash });
}

/**
 * Route an API request.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} method
 * @param {string} path
 */
async function routeAPI(req, res, method, path) {
  const segments = path.split('/').filter(Boolean);

  try {
    // --- Projects ---
    if (segments[1] === 'projects') {
      if (method === 'GET' && segments.length === 2) {
        return sendJSON(res, 200, await projects.listProjects());
      }
      if (method === 'GET' && segments.length === 3) {
        const data = await projects.getProject(decodeURIComponent(segments[2]));
        return data ? sendJSON(res, 200, data) : sendJSON(res, 404, { error: 'Not found' });
      }
      if (method === 'POST' && segments.length === 2) {
        const body = await parseBody(req);
        await projects.createProject(body);
        await logAndCommit({ type: 'create', target: body.name, detail: `Created project ${body.name}` });
        return sendJSON(res, 201, { ok: true });
      }
      if (method === 'PUT' && segments.length === 3) {
        const body = await parseBody(req);
        await projects.updateProject(decodeURIComponent(segments[2]), body);
        await logAndCommit({ type: 'update', target: segments[2], detail: `Updated project ${segments[2]}` });
        return sendJSON(res, 200, { ok: true });
      }
    }

    // --- Entries ---
    if (segments[1] === 'entries') {
      if (method === 'GET' && segments.length === 2) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const project = url.searchParams.get('project') || undefined;
        const type = url.searchParams.get('type') || undefined;
        return sendJSON(res, 200, await entries.listEntries({ project, type }));
      }
      if (method === 'GET' && segments.length === 4) {
        const data = await entries.readEntry(decodeURIComponent(segments[2]), decodeURIComponent(segments[3]));
        return data ? sendJSON(res, 200, data) : sendJSON(res, 404, { error: 'Not found' });
      }
      if (method === 'POST' && segments.length === 2) {
        const body = await parseBody(req);
        const filename = await entries.createEntry(body);
        await logAndCommit({ type: 'create', target: `${body.project}/${filename}`, detail: `Created ${body.type}: ${body.title}` });
        return sendJSON(res, 201, { filename });
      }
      if (method === 'PUT' && segments.length === 4) {
        const project = decodeURIComponent(segments[2]);
        const oldFilename = decodeURIComponent(segments[3]);
        const body = await parseBody(req);
        const newFilename = await entries.updateEntry(project, oldFilename, body);
        await logAndCommit({ type: 'update', target: `${project}/${newFilename}`, detail: `Updated ${oldFilename}` });
        return sendJSON(res, 200, { filename: newFilename });
      }
      if (method === 'DELETE' && segments.length === 4) {
        const project = decodeURIComponent(segments[2]);
        const filename = decodeURIComponent(segments[3]);
        await entries.deleteEntry(project, filename);
        await logAndCommit({ type: 'delete', target: `${project}/${filename}`, detail: `Deleted ${filename}` });
        return sendJSON(res, 200, { ok: true });
      }
    }

    // --- Search ---
    if (segments[1] === 'search' && method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const q = url.searchParams.get('q') || '';
      return sendJSON(res, 200, await entries.searchEntries(q));
    }

    // --- Actions ---
    if (segments[1] === 'actions') {
      if (method === 'GET' && segments.length === 2) {
        return sendJSON(res, 200, await actions.getActions());
      }
      if (method === 'DELETE' && segments.length === 2) {
        await actions.clearAllActions();
        return sendJSON(res, 200, { ok: true });
      }
      if (method === 'DELETE' && segments.length === 3) {
        await actions.clearAction(parseInt(segments[2], 10));
        return sendJSON(res, 200, { ok: true });
      }
    }

    // --- Git ---
    if (segments[1] === 'git') {
      if (method === 'POST' && segments[2] === 'commit') {
        const body = await parseBody(req);
        const hash = await git.commit(body.message || 'manual commit');
        return sendJSON(res, 200, { hash });
      }
      if (method === 'POST' && segments[2] === 'push') {
        await git.push();
        return sendJSON(res, 200, { ok: true });
      }
      if (method === 'GET' && segments[2] === 'log') {
        return sendJSON(res, 200, await git.log());
      }
      if (method === 'GET' && segments[2] === 'diff' && segments[3]) {
        const diffOutput = await git.diff(segments[3]);
        return sendJSON(res, 200, { diff: diffOutput });
      }
      if (method === 'POST' && segments[2] === 'rewind') {
        const body = await parseBody(req);
        const hash = await git.rewind(body.hash);
        await actions.logAction({ type: 'rewind', target: body.hash, detail: `Rewound to ${body.hash}`, commitHash: hash });
        return sendJSON(res, 200, { hash });
      }
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
}

const server = createServer(async (req, res) => {
  const method = req.method;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path.startsWith('/api/')) {
    return routeAPI(req, res, method, path);
  }

  return serveStatic(res, path);
});

server.listen(PORT, () => {
  console.log(`Productivity System running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Test the server starts**

```bash
node server/server.js &
curl http://localhost:3000/api/projects
# Expected: JSON array with the Productivity_System project
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add server/server.js
git commit -m "feat: add HTTP server with full REST API routing"
```

---

## Task 8: Frontend — HTML Shell & CSS

**Files:**
- Create: `app/index.html`
- Create: `app/css/style.css`

- [ ] **Step 1: Write index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Productivity System</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header id="header">
    <h1>Productivity System</h1>
    <div id="header-actions">
      <input type="search" id="search-input" placeholder="Search... (Ctrl+K)" aria-label="Search entries">
      <button id="btn-create" title="New Entry (Ctrl+N)">+ New</button>
      <button id="btn-history" title="Action History">History</button>
      <button id="btn-git-commit" title="Git Commit">Commit</button>
      <button id="btn-git-push" title="Git Push">Push</button>
    </div>
  </header>

  <nav id="filters">
    <div id="filter-projects" class="filter-group">
      <span class="filter-label">Projects:</span>
    </div>
    <div id="filter-types" class="filter-group">
      <span class="filter-label">Types:</span>
      <button class="filter-tag active" data-type="">All</button>
      <button class="filter-tag" data-type="task">Tasks</button>
      <button class="filter-tag" data-type="log">Logs</button>
      <button class="filter-tag" data-type="note">Notes</button>
    </div>
  </nav>

  <main id="timeline">
    <table id="entries-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Title</th>
          <th>Type</th>
          <th>Project</th>
          <th class="col-status">Status</th>
        </tr>
      </thead>
      <tbody id="entries-body"></tbody>
    </table>
    <p id="empty-state" class="hidden">No entries found.</p>
  </main>

  <div id="modal-overlay" class="hidden">
    <div id="modal" role="dialog" aria-modal="true">
      <div id="modal-header">
        <h2 id="modal-title"></h2>
        <button id="modal-close" aria-label="Close">&times;</button>
      </div>
      <div id="modal-body"></div>
      <div id="modal-footer"></div>
    </div>
  </div>

  <aside id="history-panel" class="hidden">
    <div id="history-header">
      <h2>Action History</h2>
      <button id="history-close" aria-label="Close">&times;</button>
    </div>
    <div id="history-actions">
      <button id="btn-clear-history">Clear All</button>
    </div>
    <ul id="history-list"></ul>
  </aside>

  <div id="search-results" class="hidden">
    <ul id="search-list"></ul>
  </div>

  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write style.css** (mobile-first, monospace, white/black only — see full CSS in spec)

- [ ] **Step 3: Commit**

```bash
git add app/index.html app/css/style.css
git commit -m "feat: add HTML shell and mobile-first CSS"
```

---

## Task 9–11: Frontend Core Modules

**Files:**
- Create: `app/js/modules/utils.js` — filename parsing, date formatting, `el()` DOM helper
- Create: `app/js/modules/api.js` — fetch wrapper for all 17 API endpoints
- Create: `app/js/modules/state.js` — central state object with pub/sub (`getState`, `setState`, `subscribe`)

Each module is self-contained. See full code in spec. All use JSDoc and ES module exports.

- [ ] **Step 1: Write utils.js** (parseFilename, formatDate, todayStamp, humanizeTitle, isOverdue, el)
- [ ] **Step 2: Write api.js** (request helper + one export per API endpoint)
- [ ] **Step 3: Write state.js** (state object, listeners Map, getState/setState/subscribe)
- [ ] **Step 4: Commit**

```bash
git add app/js/modules/utils.js app/js/modules/api.js app/js/modules/state.js
git commit -m "feat: add frontend core — utils, API client, state management"
```

---

## Task 12: Frontend — Timeline View

**Files:**
- Create: `app/js/modules/timeline.js`

Renders the data table from state, handles status badge click-to-cycle, emits `entry:open` events on row click, subscribes to `entries`, `filters`, `searchQuery`, `searchResults`, `selectedRow`.

- [ ] **Step 1: Write timeline.js** (renderTable, cycleStatus, getFilteredEntries, initTimeline)
- [ ] **Step 2: Commit**

```bash
git add app/js/modules/timeline.js
git commit -m "feat: add timeline data-table view with status toggle"
```

---

## Task 13: Frontend — Filters

**Files:**
- Create: `app/js/modules/filters.js`

Renders project filter tags dynamically from state (with entry count badges), binds type filter clicks. Subscribes to `projects`.

- [ ] **Step 1: Write filters.js** (renderProjectFilters, bindTypeFilters, initFilters)
- [ ] **Step 2: Commit**

```bash
git add app/js/modules/filters.js
git commit -m "feat: add project and type filter controls"
```

---

## Task 14: Frontend — Modal System

**Files:**
- Create: `app/js/modules/modal.js`

The largest frontend module. Five modal types:
- **Create:** project select, title, type, date, author, status (task only), body, filename preview
- **Detail:** info table + body content + edit/delete buttons
- **Edit:** editable filename fields + body + filename preview
- **Confirm:** message + confirm/cancel (used for delete, clear history, push)
- **Commit:** message input for git commit

All modals use the `el()` helper for safe DOM construction (no innerHTML with user content). Filename preview updates live as fields change.

- [ ] **Step 1: Write modal.js** (openModal, closeModal, showCreateModal, showDetailModal, showEditModal, showConfirmModal, showCommitModal, initModal)
- [ ] **Step 2: Commit**

```bash
git add app/js/modules/modal.js
git commit -m "feat: add modal system — create, detail, edit, delete, commit"
```

---

## Task 15: Frontend — Search

**Files:**
- Create: `app/js/modules/search.js`

Debounced input (250ms), updates state which triggers timeline re-render. Dropdown shows results with click-to-open. Escape clears. Click-outside dismisses.

- [ ] **Step 1: Write search.js** (doSearch, renderSearchDropdown, initSearch)
- [ ] **Step 2: Commit**

```bash
git add app/js/modules/search.js
git commit -m "feat: add search with debounced input and dropdown"
```

---

## Task 16: Frontend — Action History Panel

**Files:**
- Create: `app/js/modules/history.js`

Slide-in panel from right. Shows actions in reverse-chronological order. Each action with commitHash shows a clickable "rewind to {hash}" link that triggers confirm modal. Clear All button with confirmation.

- [ ] **Step 1: Write history.js** (renderHistory, toggleHistory, initHistory)
- [ ] **Step 2: Commit**

```bash
git add app/js/modules/history.js
git commit -m "feat: add action history panel with rewind"
```

---

## Task 17: Frontend — Hotkeys

**Files:**
- Create: `app/js/modules/hotkeys.js`

| Key | Action |
|-----|--------|
| Ctrl+K | Focus search |
| Ctrl+N | Open create modal |
| Escape | Close modal / history / clear search |
| Arrow Up/Down | Navigate table rows (skipped when in input) |
| Enter | Open selected entry |

- [ ] **Step 1: Write hotkeys.js** (initHotkeys)
- [ ] **Step 2: Commit**

```bash
git add app/js/modules/hotkeys.js
git commit -m "feat: add keyboard shortcuts — Ctrl+K, Ctrl+N, arrows, Escape"
```

---

## Task 18: Frontend — App Entry Point

**Files:**
- Create: `app/js/app.js`

Wires everything: imports all modules, calls all `init*()` functions, binds header buttons, listens for `entry:open` and `data:refresh` custom events, loads initial data.

- [ ] **Step 1: Write app.js** (loadData, init)
- [ ] **Step 2: Start server and verify in browser**

```bash
cd AlexandrosLiaskos/Productivity_System
node server/server.js
# Open http://localhost:3000
# Verify: 4 entries in timeline, filters, modals, search, hotkeys
```

- [ ] **Step 3: Commit**

```bash
git add app/js/app.js
git commit -m "feat: wire app — init, event delegation, data loading"
```

---

## Task 19: Integration Test & Final Commit

- [ ] **Step 1: Test CRUD** — Ctrl+N create task, verify in timeline, click to view, edit, toggle status, delete
- [ ] **Step 2: Test filters** — per-project, per-type, cross filters
- [ ] **Step 3: Test search** — Ctrl+K, type query, click result
- [ ] **Step 4: Test history** — open panel, verify logged actions, rewind
- [ ] **Step 5: Test git** — manual commit, verify
- [ ] **Step 6: Test keyboard nav** — arrows, Enter, Escape
- [ ] **Step 7: Test mobile** — dev tools mobile viewport
- [ ] **Step 8: Fix any issues**
- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat: complete productivity system web app v1"
```
