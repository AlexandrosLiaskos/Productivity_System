#!/usr/bin/env node
/**
 * @module productivity-system-mcp
 * MCP server for the Productivity System.
 * Exposes 15 tools for managing projects, entries, git operations, and action history.
 *
 * Usage:
 *   node index.js [--dir <path>]
 *   npx productivity-system-mcp [--dir <path>]
 *
 * --dir defaults to the parent of this script (i.e. the repo root).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { join, resolve, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// CLI argument parsing — resolve ROOT from --dir flag or script location
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse --dir <path> from process.argv.
 * @returns {string} resolved absolute path
 */
function parseDir() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--dir');
  if (idx !== -1 && args[idx + 1]) {
    return resolve(args[idx + 1]);
  }
  // Default: parent directory of this script (the repo root)
  return resolve(__dirname, '..');
}

const ROOT = parseDir();
const PROJECTS_DIR = join(ROOT, 'projects');
const HISTORY_PATH = join(ROOT, 'actions', 'history.json');

// ---------------------------------------------------------------------------
// Utility helpers (self-contained, adapted from server/api/utils.js)
// ---------------------------------------------------------------------------

/** Filename parsing regex */
const FILENAME_RE = /^(.+)\.(task|log|note|email)\.(?:([a-z]+)\.)?(\d{8})\.(json|md|msg)$/;

/**
 * Parse an entry filename into its components.
 * @param {string} filename
 * @returns {{ title: string, type: string, author: string|null, date: string, ext: string } | null}
 */
function parseFilename(filename) {
  const m = filename.match(FILENAME_RE);
  if (!m) return null;
  return { title: m[1], type: m[2], author: m[3] || null, date: m[4], ext: m[5] };
}

/**
 * Build a filename from entry components.
 * @param {{ title: string, type: string, author?: string, date: string }} parts
 * @returns {string}
 */
function buildFilename({ title, type, author, date }) {
  const ext = type === 'note' ? 'md' : type === 'email' ? 'msg' : 'json';
  const segments = [title, type];
  if (author) segments.push(author);
  segments.push(date);
  return segments.join('.') + '.' + ext;
}

/**
 * Sanitize a title string for use in filenames.
 * Replaces spaces with underscores, removes unsafe characters.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeTitle(raw) {
  return raw.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
}

/**
 * Resolve a path safely within a base directory. Throws on path traversal.
 * @param {string} base
 * @param {...string} segments
 * @returns {string}
 */
function safePath(base, ...segments) {
  const resolved = normalize(resolve(base, ...segments));
  if (!resolved.startsWith(normalize(resolve(base)))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

/**
 * Read and parse a JSON file. Returns null on error.
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
async function readJSON(filePath) {
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
async function writeJSON(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Projects logic (adapted from server/api/projects.js)
// ---------------------------------------------------------------------------

/**
 * List all projects with metadata and entry counts.
 * @returns {Promise<Array<object>>}
 */
async function listProjects() {
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
async function getProject(name) {
  return readJSON(safePath(PROJECTS_DIR, name, '.project.json'));
}

/**
 * Create a new project directory with metadata.
 * @param {object} meta
 * @returns {Promise<void>}
 */
async function createProject(meta) {
  const dirPath = safePath(PROJECTS_DIR, meta.name);
  await mkdir(dirPath, { recursive: true });
  await writeJSON(safePath(PROJECTS_DIR, meta.name, '.project.json'), meta);
}

// ---------------------------------------------------------------------------
// Entries logic (adapted from server/api/entries.js)
// ---------------------------------------------------------------------------

/**
 * List entries, optionally filtered by project and/or type.
 * @param {{ project?: string, type?: string }} filters
 * @returns {Promise<Array<object>>}
 */
async function listEntries({ project, type } = {}) {
  const results = [];
  const projectDirs = project
    ? [project]
    : (await readdir(PROJECTS_DIR)).filter(d => !d.startsWith('.'));

  for (const dir of projectDirs) {
    const dirPath = safePath(PROJECTS_DIR, dir);
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
async function readEntry(project, filename) {
  const filePath = safePath(PROJECTS_DIR, project, filename);
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
 * @param {{ project: string, title: string, type: string, author?: string, date: string, body?: string, status?: string, deadline?: string }} data
 * @returns {Promise<string>}
 */
async function createEntry(data) {
  const title = sanitizeTitle(data.title);
  const filename = buildFilename({ title, type: data.type, author: data.author, date: data.date });
  const filePath = safePath(PROJECTS_DIR, data.project, filename);

  if (data.type === 'note') {
    await writeFile(filePath, data.body || '', 'utf-8');
  } else {
    const content = { status: data.status || 'queued' };
    if (data.type === 'task') content.deadline = data.deadline || null;
    content.body = data.body || '';
    await writeJSON(filePath, content);
  }

  return filename;
}

/**
 * Update an existing entry. Supports renaming and body/field updates.
 * @param {string} project
 * @param {string} oldFilename
 * @param {{ title?: string, author?: string, date?: string, body?: string, status?: string, deadline?: string }} updates
 * @returns {Promise<string>} new filename
 */
async function updateEntry(project, oldFilename, updates) {
  const parsed = parseFilename(oldFilename);
  if (!parsed) throw new Error('Invalid filename');

  const newParts = {
    title: updates.title ? sanitizeTitle(updates.title) : parsed.title,
    type: parsed.type,
    author: updates.author !== undefined ? updates.author : parsed.author,
    date: updates.date || parsed.date,
  };
  const newFilename = buildFilename(newParts);

  const oldPath = safePath(PROJECTS_DIR, project, oldFilename);
  const newPath = safePath(PROJECTS_DIR, project, newFilename);

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
    if (existing.references) content.references = existing.references;
    await writeJSON(newPath, content);
  }

  if (newFilename !== oldFilename) {
    try { await unlink(oldPath); } catch { /* same path or already gone */ }
  }

  return newFilename;
}

/**
 * Delete an entry file.
 * @param {string} project
 * @param {string} filename
 */
async function deleteEntry(project, filename) {
  await unlink(safePath(PROJECTS_DIR, project, filename));
}

/**
 * Full-text + tag search across all entries.
 * Supports tag prefixes: project:X, type:task, status:queued, author:liaskos
 * Remaining text is matched as full-text substring.
 * @param {string} query
 * @returns {Promise<Array<object>>}
 */
async function searchEntries(query) {
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

// ---------------------------------------------------------------------------
// Git logic (adapted from server/api/git.js)
// ---------------------------------------------------------------------------

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
 * @returns {Promise<string>} short commit hash
 */
async function gitCommit(message) {
  await git('add', '-A');
  await git('commit', '-m', message);
  return git('rev-parse', '--short', 'HEAD');
}

/**
 * Push to the remote origin.
 * @returns {Promise<string>}
 */
async function gitPush() {
  return git('push');
}

/**
 * Get the git log as an array of commit objects.
 * @param {number} limit
 * @returns {Promise<Array<{ hash: string, message: string, date: string }>>}
 */
async function gitLog(limit = 20) {
  const raw = await git('log', `--max-count=${limit}`, '--pretty=format:%h\t%s\t%aI');
  if (!raw) return [];
  return raw.split('\n').map(line => {
    const [hash, message, date] = line.split('\t');
    return { hash, message, date };
  });
}

/**
 * Rewind the repo to a specific commit hash (non-destructive: creates new commit).
 * @param {string} hash
 * @returns {Promise<string>} new commit hash
 */
async function gitRewind(hash) {
  await git('checkout', hash, '--', '.');
  return gitCommit(`rewind: restore state from ${hash}`);
}

// ---------------------------------------------------------------------------
// Actions logic (adapted from server/api/actions.js)
// ---------------------------------------------------------------------------

/**
 * Get the full action history.
 * @returns {Promise<Array<object>>}
 */
async function getActions() {
  return (await readJSON(HISTORY_PATH)) || [];
}

/**
 * Clear all actions or remove a single action by index.
 * @param {number|undefined} index - zero-based index; if undefined, clears all
 * @returns {Promise<void>}
 */
async function clearActions(index) {
  if (index === undefined) {
    await writeJSON(HISTORY_PATH, []);
  } else {
    const actions = await getActions();
    if (index >= 0 && index < actions.length) {
      actions.splice(index, 1);
      await writeJSON(HISTORY_PATH, actions);
    }
  }
}

// ---------------------------------------------------------------------------
// MCP server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'productivity-system-mcp',
  version: '1.0.0',
});

/** Wrap a result as MCP text content. */
function ok(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/** Wrap an error as MCP error content. */
function err(e) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

// ── Tool: list_projects ─────────────────────────────────────────────────────
server.tool(
  'list_projects',
  'List all projects with metadata and entry counts.',
  {},
  async () => {
    try {
      return ok(await listProjects());
    } catch (e) { return err(e); }
  },
);

// ── Tool: get_project ───────────────────────────────────────────────────────
server.tool(
  'get_project',
  'Get a project\'s metadata.',
  { name: z.string().describe('Project directory name') },
  async ({ name }) => {
    try {
      const project = await getProject(name);
      if (!project) return err(new Error(`Project not found: ${name}`));
      return ok(project);
    } catch (e) { return err(e); }
  },
);

// ── Tool: create_project ────────────────────────────────────────────────────
server.tool(
  'create_project',
  'Create a new project directory with metadata.',
  {
    name: z.string().describe('Project directory name'),
    description: z.string().optional().describe('Short description of the project'),
    github_url: z.string().optional().describe('GitHub repository URL'),
    coordinator: z.string().optional().describe('Project coordinator name'),
  },
  async ({ name, description, github_url, coordinator }) => {
    try {
      const meta = { name };
      if (description) meta.description = description;
      if (github_url) meta.github_url = github_url;
      if (coordinator) meta.coordinator = coordinator;
      await createProject(meta);
      return ok({ created: name, meta });
    } catch (e) { return err(e); }
  },
);

// ── Tool: list_entries ──────────────────────────────────────────────────────
server.tool(
  'list_entries',
  'List entries with optional filters by project and/or type.',
  {
    project: z.string().optional().describe('Filter by project name'),
    type: z.enum(['task', 'log', 'note', 'email']).optional().describe('Filter by entry type'),
  },
  async ({ project, type }) => {
    try {
      return ok(await listEntries({ project, type }));
    } catch (e) { return err(e); }
  },
);

// ── Tool: get_entry ─────────────────────────────────────────────────────────
server.tool(
  'get_entry',
  'Read a single entry\'s full content.',
  {
    project: z.string().describe('Project name'),
    filename: z.string().describe('Entry filename'),
  },
  async ({ project, filename }) => {
    try {
      const entry = await readEntry(project, filename);
      if (!entry) return err(new Error(`Entry not found: ${project}/${filename}`));
      return ok(entry);
    } catch (e) { return err(e); }
  },
);

// ── Tool: create_entry ──────────────────────────────────────────────────────
server.tool(
  'create_entry',
  'Create a new entry file in a project.',
  {
    project: z.string().describe('Project name'),
    title: z.string().describe('Entry title (used in filename)'),
    type: z.enum(['task', 'log', 'note', 'email']).describe('Entry type'),
    date: z.string().regex(/^\d{8}$/).describe('Date in YYYYMMDD format'),
    author: z.string().optional().describe('Author identifier'),
    status: z.enum(['queued', 'in_progress', 'on_hold', 'completed', 'canceled']).optional().describe('Task status (tasks only)'),
    deadline: z.string().regex(/^\d{8}$/).optional().describe('Deadline in YYYYMMDD format (tasks only)'),
    body: z.string().optional().describe('Entry body content'),
  },
  async ({ project, title, type, date, author, status, deadline, body }) => {
    try {
      const filename = await createEntry({ project, title, type, date, author, status, deadline, body });
      return ok({ created: filename, project });
    } catch (e) { return err(e); }
  },
);

// ── Tool: update_entry ──────────────────────────────────────────────────────
server.tool(
  'update_entry',
  'Update an existing entry\'s fields or body. May rename the file if title/date/author changes.',
  {
    project: z.string().describe('Project name'),
    filename: z.string().describe('Current entry filename'),
    title: z.string().optional().describe('New title'),
    date: z.string().regex(/^\d{8}$/).optional().describe('New date in YYYYMMDD format'),
    author: z.string().optional().describe('New author'),
    status: z.string().optional().describe('New status'),
    deadline: z.string().regex(/^\d{8}$/).optional().describe('New deadline in YYYYMMDD format'),
    body: z.string().optional().describe('New body content'),
  },
  async ({ project, filename, title, date, author, status, deadline, body }) => {
    try {
      const newFilename = await updateEntry(project, filename, { title, date, author, status, deadline, body });
      return ok({ updated: newFilename, project, previousFilename: filename });
    } catch (e) { return err(e); }
  },
);

// ── Tool: delete_entry ──────────────────────────────────────────────────────
server.tool(
  'delete_entry',
  'Delete an entry file from a project.',
  {
    project: z.string().describe('Project name'),
    filename: z.string().describe('Entry filename to delete'),
  },
  async ({ project, filename }) => {
    try {
      await deleteEntry(project, filename);
      return ok({ deleted: filename, project });
    } catch (e) { return err(e); }
  },
);

// ── Tool: search_entries ────────────────────────────────────────────────────
server.tool(
  'search_entries',
  'Search entries with tag support. Supports project:X, type:task, status:queued, author:name prefixes plus free text.',
  {
    query: z.string().describe('Search query with optional tag prefixes (project:X type:task status:queued author:name)'),
  },
  async ({ query }) => {
    try {
      return ok(await searchEntries(query));
    } catch (e) { return err(e); }
  },
);

// ── Tool: git_commit ────────────────────────────────────────────────────────
server.tool(
  'git_commit',
  'Stage all changes and create a git commit.',
  {
    message: z.string().describe('Commit message'),
  },
  async ({ message }) => {
    try {
      const hash = await gitCommit(message);
      return ok({ hash, message });
    } catch (e) { return err(e); }
  },
);

// ── Tool: git_push ──────────────────────────────────────────────────────────
server.tool(
  'git_push',
  'Push committed changes to the remote origin.',
  {},
  async () => {
    try {
      const output = await gitPush();
      return ok({ output });
    } catch (e) { return err(e); }
  },
);

// ── Tool: git_log ───────────────────────────────────────────────────────────
server.tool(
  'git_log',
  'Get the git commit history.',
  {
    limit: z.number().int().positive().optional().default(20).describe('Maximum number of commits to return (default 20)'),
  },
  async ({ limit }) => {
    try {
      return ok(await gitLog(limit));
    } catch (e) { return err(e); }
  },
);

// ── Tool: git_rewind ────────────────────────────────────────────────────────
server.tool(
  'git_rewind',
  'Rewind the repo to a specific commit (non-destructive: creates a new commit restoring that state).',
  {
    hash: z.string().describe('Commit hash to rewind to'),
  },
  async ({ hash }) => {
    try {
      const newHash = await gitRewind(hash);
      return ok({ newHash, rewindedTo: hash });
    } catch (e) { return err(e); }
  },
);

// ── Tool: get_actions ───────────────────────────────────────────────────────
server.tool(
  'get_actions',
  'Get the action history timeline.',
  {},
  async () => {
    try {
      return ok(await getActions());
    } catch (e) { return err(e); }
  },
);

// ── Tool: clear_actions ─────────────────────────────────────────────────────
server.tool(
  'clear_actions',
  'Clear all actions or remove a specific action by zero-based index.',
  {
    index: z.number().int().nonnegative().optional().describe('Zero-based index of the action to remove. Omit to clear all.'),
  },
  async ({ index }) => {
    try {
      await clearActions(index);
      return ok({ cleared: index !== undefined ? `action at index ${index}` : 'all actions' });
    } catch (e) { return err(e); }
  },
);

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
