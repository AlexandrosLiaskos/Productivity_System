/** @module server/server */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, parseBody, sendJSON } from './api/utils.js';
import * as entries from './api/entries.js';
import * as projects from './api/projects.js';
import * as git from './api/git.js';
import * as actions from './api/actions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;
// APP_DIR is always relative to server.js so it works both in dev and in the
// packaged Electron app (where ROOT points to the user's data directory).
const APP_DIR = join(__dirname, '..', 'app');

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
