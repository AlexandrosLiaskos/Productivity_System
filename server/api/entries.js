/** @module server/api/entries */

import { readdir, readFile, writeFile, unlink, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECTS_DIR, parseFilename, buildFilename, readJSON, writeJSON, sanitizeTitle, sanitizeEmailSubject, safePath } from './utils.js';

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

      if (parsed.type === 'email') {
        // Email entries: read the .meta.json sidecar
        const metaPath = join(dirPath, file.replace('.msg', '.meta.json'));
        const meta = await readJSON(metaPath);
        if (meta) Object.assign(entry, meta);
      } else if (parsed.ext === 'json') {
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
  const parsed = parseFilename(filename);
  if (!parsed) return null;

  if (parsed.type === 'email') {
    // Email entries: read the .meta.json sidecar, not the .msg binary
    const metaPath = safePath(PROJECTS_DIR, project, filename.replace('.msg', '.meta.json'));
    try {
      const meta = await readJSON(metaPath);
      if (!meta) return null;
      return { ...parsed, project, filename, ...meta };
    } catch {
      return null;
    }
  }

  const filePath = safePath(PROJECTS_DIR, project, filename);
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
  const filePath = safePath(PROJECTS_DIR, data.project, filename);

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

  // Email entries: only allow updating the .meta.json sidecar (references).
  // Renaming (changing subject) is not permitted for email entries.
  if (parsed.type === 'email') {
    const metaPath = safePath(PROJECTS_DIR, project, oldFilename.replace('.msg', '.meta.json'));
    const existing = (await readJSON(metaPath)) || {};
    if (updates.references) existing.references = updates.references;
    await writeJSON(metaPath, existing);
    return oldFilename;
  }

  const newParts = {
    title: updates.title ? sanitizeTitle(updates.title) : parsed.title,
    type: updates.type || parsed.type,
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
  const parsed = parseFilename(filename);

  if (parsed && parsed.type === 'email') {
    // Delete the .msg file
    await unlink(safePath(PROJECTS_DIR, project, filename));
    // Delete the .meta.json sidecar
    try { await unlink(safePath(PROJECTS_DIR, project, filename.replace('.msg', '.meta.json'))); } catch { /* may not exist */ }
    // Delete the attachments folder (folder name = filename without .msg)
    const attachDir = safePath(PROJECTS_DIR, project, filename.replace('.msg', ''));
    try { await rm(attachDir, { recursive: true, force: true }); } catch { /* may not exist */ }
    return;
  }

  await unlink(safePath(PROJECTS_DIR, project, filename));
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
      const haystack = [
        entry.title, entry.type, entry.author, entry.project, entry.body || '',
        entry.from || '', (entry.to || []).join(' '), entry.bodyPreview || '',
      ].join(' ').toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}
