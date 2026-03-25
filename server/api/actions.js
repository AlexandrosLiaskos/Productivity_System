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
