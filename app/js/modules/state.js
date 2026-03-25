/** @module app/js/modules/state */

/**
 * @typedef {Object} Filters
 * @property {string} project - active project filter, empty string = all
 * @property {string} type    - active type filter, empty string = all
 */

/**
 * @typedef {Object} AppState
 * @property {Array<object>}  entries       - all loaded entries
 * @property {Array<object>}  projects      - all loaded project metadata
 * @property {Array<object>}  actions       - action history entries
 * @property {Filters}        filters       - current filter state
 * @property {string}         searchQuery   - current search input value
 * @property {Array<object>}  searchResults - results from the last search
 * @property {string|null}    selectedRow   - filename of the currently selected table row
 */

/** @type {AppState} */
const state = {
  entries: [],
  projects: [],
  actions: [],
  filters: { project: '', type: '' },
  searchQuery: '',
  searchResults: [],
  selectedRow: null,
};

/**
 * Map of state key -> Set of subscriber callback functions.
 * @type {Map<string, Set<Function>>}
 */
const listeners = new Map();

/**
 * Get a shallow copy of the current application state.
 * @returns {AppState}
 */
export function getState() {
  return { ...state };
}

/**
 * Merge a partial state update and notify all subscribers for each changed key.
 * Deep-merges the `filters` key to allow updating a single filter at a time.
 * @param {Partial<AppState>} partial - state slice to merge
 * @returns {void}
 */
export function setState(partial) {
  for (const [key, value] of Object.entries(partial)) {
    if (key === 'filters' && typeof value === 'object' && value !== null) {
      // Deep merge filters so callers can update one field at a time
      state.filters = { ...state.filters, ...value };
    } else {
      state[key] = value;
    }
    // Notify all subscribers for this key
    const subs = listeners.get(key);
    if (subs) {
      for (const fn of subs) {
        try {
          fn(state[key], state);
        } catch (err) {
          console.error(`[state] subscriber error for key "${key}":`, err);
        }
      }
    }
  }
}

/**
 * Subscribe to changes on a specific state key.
 * The callback is invoked with (newValue, fullState) whenever that key changes.
 * Returns an unsubscribe function.
 * @param {string} key - state key to observe (e.g. "entries", "filters")
 * @param {function(any, AppState): void} fn - callback to invoke on change
 * @returns {function(): void} unsubscribe
 */
export function subscribe(key, fn) {
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }
  listeners.get(key).add(fn);
  return function unsubscribe() {
    const subs = listeners.get(key);
    if (subs) subs.delete(fn);
  };
}
