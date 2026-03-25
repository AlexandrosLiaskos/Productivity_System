/** @module app/js/modules/search */

import { el, humanizeTitle } from './utils.js';
import { search } from './api.js';
import { setState } from './state.js';

/** @type {number|null} */
let debounceTimer = null;

/**
 * Perform a search and update state with results.
 * @param {string} query - search query string
 * @returns {Promise<void>}
 */
export async function doSearch(query) {
  if (!query.trim()) {
    setState({ searchQuery: '', searchResults: [] });
    hideDropdown();
    return;
  }

  setState({ searchQuery: query });
  try {
    const results = await search(query);
    setState({ searchResults: results });
    renderSearchDropdown(results);
  } catch (err) {
    console.error('[search] doSearch error:', err);
  }
}

/**
 * Render search results into the #search-list dropdown.
 * @param {object[]} results - array of entry objects
 * @returns {void}
 */
export function renderSearchDropdown(results) {
  const container = document.getElementById('search-results');
  const list = document.getElementById('search-list');
  if (!container || !list) return;

  while (list.firstChild) list.removeChild(list.firstChild);

  if (!results.length) {
    list.appendChild(el('li', { class: 'search-empty' }, 'No results'));
    container.classList.remove('hidden');
    return;
  }

  for (const entry of results) {
    const typeSpan = el('span', { class: `badge badge-type badge-${entry.type}` }, entry.type);
    const titleSpan = el('span', { class: 'search-title' }, humanizeTitle(entry.title));
    const projectSpan = el('span', { class: 'search-project' }, entry.project);

    const li = el('li', { class: 'search-result-item' }, titleSpan, ' ', typeSpan, ' ', projectSpan);
    li.addEventListener('click', () => {
      hideDropdown();
      clearSearch();
      document.dispatchEvent(new CustomEvent('entry:open', { detail: entry }));
    });
    list.appendChild(li);
  }

  container.classList.remove('hidden');
}

/**
 * Hide the search dropdown.
 * @returns {void}
 */
function hideDropdown() {
  const container = document.getElementById('search-results');
  if (container) container.classList.add('hidden');
}

/**
 * Clear the search input and reset state.
 * @returns {void}
 */
function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  setState({ searchQuery: '', searchResults: [] });
  hideDropdown();
}

/**
 * Initialize the search module. Binds input and keyboard events.
 * @returns {void}
 */
export function initSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;

  input.addEventListener('input', e => {
    const query = e.target.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(query), 250);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      clearSearch();
      input.blur();
    }
  });

  // Click outside dismisses dropdown
  document.addEventListener('click', e => {
    const container = document.getElementById('search-results');
    const searchInput = document.getElementById('search-input');
    if (!container) return;
    if (!container.contains(e.target) && e.target !== searchInput) {
      hideDropdown();
    }
  });
}
