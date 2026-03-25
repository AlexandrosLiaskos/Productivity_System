/** @module app/js/modules/api */

/**
 * Base fetch wrapper for all API calls.
 * Throws an Error with the server's error message on non-OK responses.
 * @param {string} path - API path, e.g. "/api/entries"
 * @param {RequestInit} [opts={}] - fetch options
 * @returns {Promise<any>} parsed JSON response
 */
export async function request(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ----------------------------------------------------------------
// Projects
// ----------------------------------------------------------------

/**
 * List all projects with metadata and entry counts.
 * @returns {Promise<Array<object>>}
 */
export function listProjects() {
  return request('/api/projects');
}

/**
 * Get a single project's metadata.
 * @param {string} name - project directory name
 * @returns {Promise<object>}
 */
export function getProject(name) {
  return request(`/api/projects/${encodeURIComponent(name)}`);
}

/**
 * Create a new project.
 * @param {object} meta - project metadata
 * @returns {Promise<{ ok: boolean }>}
 */
export function createProject(meta) {
  return request('/api/projects', {
    method: 'POST',
    body: JSON.stringify(meta),
  });
}

/**
 * Update a project's metadata.
 * @param {string} name - project directory name
 * @param {object} updates - fields to update
 * @returns {Promise<{ ok: boolean }>}
 */
export function updateProject(name, updates) {
  return request(`/api/projects/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

// ----------------------------------------------------------------
// Entries
// ----------------------------------------------------------------

/**
 * List entries, optionally filtered by project and/or type.
 * @param {{ project?: string, type?: string }} [filters={}]
 * @returns {Promise<Array<object>>}
 */
export function listEntries(filters = {}) {
  const params = new URLSearchParams();
  if (filters.project) params.set('project', filters.project);
  if (filters.type) params.set('type', filters.type);
  const qs = params.toString();
  return request(`/api/entries${qs ? '?' + qs : ''}`);
}

/**
 * Get the full content of a single entry.
 * @param {string} project - project directory name
 * @param {string} filename - entry filename
 * @returns {Promise<object>}
 */
export function getEntry(project, filename) {
  return request(`/api/entries/${encodeURIComponent(project)}/${encodeURIComponent(filename)}`);
}

/**
 * Create a new entry.
 * @param {object} data - entry data including project, title, type, date, body, etc.
 * @returns {Promise<{ filename: string }>}
 */
export function createEntry(data) {
  return request('/api/entries', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update an existing entry.
 * @param {string} project - project directory name
 * @param {string} filename - current entry filename
 * @param {object} updates - fields to update
 * @returns {Promise<{ filename: string }>}
 */
export function updateEntry(project, filename, updates) {
  return request(`/api/entries/${encodeURIComponent(project)}/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

/**
 * Delete an entry.
 * @param {string} project - project directory name
 * @param {string} filename - entry filename
 * @returns {Promise<{ ok: boolean }>}
 */
export function deleteEntry(project, filename) {
  return request(`/api/entries/${encodeURIComponent(project)}/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
}

// ----------------------------------------------------------------
// Search
// ----------------------------------------------------------------

/**
 * Full-text and tag search across all entries.
 * Supports tag prefixes: project:X, type:task, status:queued, author:liaskos
 * @param {string} q - search query
 * @returns {Promise<Array<object>>}
 */
export function search(q) {
  return request(`/api/search?q=${encodeURIComponent(q)}`);
}

// ----------------------------------------------------------------
// Actions
// ----------------------------------------------------------------

/**
 * Get the full action history.
 * @returns {Promise<Array<object>>}
 */
export function getActions() {
  return request('/api/actions');
}

/**
 * Clear all actions from the history.
 * @returns {Promise<{ ok: boolean }>}
 */
export function clearAllActions() {
  return request('/api/actions', { method: 'DELETE' });
}

/**
 * Remove a specific action by its zero-based index.
 * @param {number} index
 * @returns {Promise<{ ok: boolean }>}
 */
export function clearAction(index) {
  return request(`/api/actions/${index}`, { method: 'DELETE' });
}

// ----------------------------------------------------------------
// Git
// ----------------------------------------------------------------

/**
 * Stage all changes and commit with the given message.
 * @param {string} message - commit message
 * @returns {Promise<{ hash: string }>}
 */
export function gitCommit(message) {
  return request('/api/git/commit', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

/**
 * Push to the remote origin.
 * @returns {Promise<{ ok: boolean }>}
 */
export function gitPush() {
  return request('/api/git/push', { method: 'POST', body: JSON.stringify({}) });
}

/**
 * Get the git commit log.
 * @returns {Promise<Array<{ hash: string, message: string, date: string }>>}
 */
export function gitLog() {
  return request('/api/git/log');
}

/**
 * Rewind the repo to a specific commit hash (non-destructive new commit).
 * @param {string} hash - target commit hash
 * @returns {Promise<{ hash: string }>}
 */
export function gitRewind(hash) {
  return request('/api/git/rewind', {
    method: 'POST',
    body: JSON.stringify({ hash }),
  });
}
