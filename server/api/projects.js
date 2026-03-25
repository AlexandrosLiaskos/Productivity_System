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
