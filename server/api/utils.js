/** @module server/api/utils */

import { join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root data directory — configurable via PRODUCTIVITY_SYSTEM_DIR env var */
export const ROOT = process.env.PRODUCTIVITY_SYSTEM_DIR || join(__dirname, '..', '..');

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
  const resolved = normalize(resolve(base, ...segments));
  if (!resolved.startsWith(normalize(resolve(base)))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}
