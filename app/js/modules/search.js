/** @module app/js/modules/search */

import { el } from './utils.js';
import { search } from './api.js';
import { getState, setState } from './state.js';

/** Tag definitions with their possible values */
const TAG_DEFS = {
  'project': () => getState().projects.map(p => p.name),
  'type': () => ['task', 'log', 'note', 'email'],
  'status': () => ['in_progress', 'queued', 'on_hold', 'completed', 'canceled'],
  'author': () => [...new Set(getState().entries.map(e => e.author).filter(Boolean))],
};

let debounceTimer = null;
let selectedIndex = -1;

/**
 * Parse the current input to detect if the cursor is on a tag prefix.
 * Returns { prefix, partial, tokenStart } or null.
 * @param {string} value
 * @param {number} cursorPos
 * @returns {object|null}
 */
function detectTagContext(value, cursorPos) {
  // Get text up to cursor
  const textToCursor = value.slice(0, cursorPos);
  // Find the last token (space-separated)
  const lastSpaceIdx = textToCursor.lastIndexOf(' ');
  const currentToken = textToCursor.slice(lastSpaceIdx + 1);

  // Check if current token matches a tag pattern
  const match = currentToken.match(/^(project|type|status|author):(.*)$/i);
  if (match) {
    return {
      prefix: match[1].toLowerCase(),
      partial: match[2].toLowerCase(),
      tokenStart: lastSpaceIdx + 1,
    };
  }

  // Check if they're typing a tag name (no colon yet)
  const tagNameMatch = currentToken.match(/^([a-z]+)$/i);
  if (tagNameMatch) {
    const typed = tagNameMatch[1].toLowerCase();
    const matchingTags = Object.keys(TAG_DEFS).filter(t => t.startsWith(typed) && typed.length >= 2);
    if (matchingTags.length > 0) {
      return {
        prefix: '__tagname__',
        partial: typed,
        tokenStart: lastSpaceIdx + 1,
        matchingTags,
      };
    }
  }

  return null;
}

/**
 * Get autocomplete suggestions for a tag context.
 * @param {object} tagContext
 * @returns {object[]}
 */
function getSuggestions(tagContext) {
  if (tagContext.prefix === '__tagname__') {
    // Suggest tag names themselves
    return tagContext.matchingTags.map(t => ({ label: t + ':', value: t + ':', type: 'prefix' }));
  }

  const valueFn = TAG_DEFS[tagContext.prefix];
  if (!valueFn) return [];

  const values = valueFn();
  const partial = tagContext.partial;

  return values
    .filter(v => v.toLowerCase().includes(partial))
    .map(v => ({ label: v, value: `${tagContext.prefix}:${v}`, type: 'value' }));
}

/**
 * Show the tag autocomplete dropdown.
 * @param {object[]} suggestions
 * @returns {void}
 */
function showAutocomplete(suggestions) {
  const container = document.getElementById('tag-autocomplete');
  const list = document.getElementById('tag-autocomplete-list');
  if (!container || !list) return;

  while (list.firstChild) list.removeChild(list.firstChild);
  selectedIndex = -1;

  if (!suggestions.length) {
    container.classList.add('hidden');
    return;
  }

  suggestions.forEach(s => {
    const li = el('li', {}, s.label);
    if (s.type === 'prefix') {
      const prefixEl = el('span', { class: 'tag-prefix' }, 'tag');
      li.appendChild(prefixEl);
    }
    li.addEventListener('click', () => applyCompletion(s));
    list.appendChild(li);
  });

  // Position relative to search input using viewport coordinates
  const input = document.getElementById('search-input');
  const rect = input.getBoundingClientRect();
  container.style.top = rect.bottom + 'px';
  container.style.left = rect.left + 'px';
  container.style.width = rect.width + 'px';
  container.classList.remove('hidden');
}

/**
 * Hide the autocomplete dropdown.
 * @returns {void}
 */
function hideAutocomplete() {
  const container = document.getElementById('tag-autocomplete');
  if (container) container.classList.add('hidden');
  selectedIndex = -1;
}

/**
 * Apply an autocomplete completion to the search input.
 * @param {object} suggestion
 * @returns {void}
 */
function applyCompletion(suggestion) {
  const input = document.getElementById('search-input');
  if (!input) return;

  const value = input.value;
  const cursorPos = input.selectionStart;
  const textToCursor = value.slice(0, cursorPos);
  const lastSpaceIdx = textToCursor.lastIndexOf(' ');

  const before = value.slice(0, lastSpaceIdx + 1);
  const after = value.slice(cursorPos);

  input.value = before + suggestion.value + (suggestion.type === 'value' ? ' ' : '') + after.trimStart();
  input.focus();

  // Set cursor position after the completed tag
  const newPos = (before + suggestion.value + (suggestion.type === 'value' ? ' ' : '')).length;
  input.setSelectionRange(newPos, newPos);

  hideAutocomplete();

  // Trigger search after completing a tag value
  if (suggestion.type === 'value') {
    triggerSearch(input.value);
  }
}

/**
 * Navigate autocomplete with arrow keys.
 * @param {number} direction - 1 for down, -1 for up
 * @returns {void}
 */
function navigateAutocomplete(direction) {
  const list = document.getElementById('tag-autocomplete-list');
  if (!list) return;
  const items = list.querySelectorAll('li');
  if (!items.length) return;

  if (selectedIndex >= 0 && items[selectedIndex]) {
    items[selectedIndex].classList.remove('selected');
  }

  selectedIndex += direction;
  if (selectedIndex < 0) selectedIndex = items.length - 1;
  if (selectedIndex >= items.length) selectedIndex = 0;

  items[selectedIndex].classList.add('selected');
  items[selectedIndex].scrollIntoView({ block: 'nearest' });
}

/**
 * Execute search — applies tag filters to timeline or shows results dropdown.
 * @param {string} query
 * @returns {Promise<void>}
 */
async function triggerSearch(query) {
  if (!query.trim()) {
    setState({ searchQuery: '', searchResults: [] });
    hideResultsDropdown();
    return;
  }

  setState({ searchQuery: query });

  try {
    const results = await search(query);
    setState({ searchResults: results });

    // Check if query has ONLY tags (no free text)
    const tokens = query.trim().split(/\s+/);
    const allTags = tokens.every(t => /^(project|type|status|author):.+$/i.test(t));

    if (allTags) {
      // Tag-only query: filter timeline directly, don't show dropdown
      hideResultsDropdown();
    } else {
      // Has free text: show results dropdown
      renderResultsDropdown(results);
    }
  } catch (err) {
    console.error('[search] error:', err);
  }
}

/**
 * Render search results dropdown (for free-text searches).
 * @param {object[]} results
 * @returns {void}
 */
function renderResultsDropdown(results) {
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
    const li = el('li', { class: 'search-result-item' },
      el('span', { class: 'search-result-title' }, entry.title.replace(/_/g, ' ')),
      el('span', { class: 'search-result-meta' }, `${entry.type} · ${entry.project}`)
    );
    li.addEventListener('click', () => {
      hideResultsDropdown();
      clearSearch();
      document.dispatchEvent(new CustomEvent('entry:open', { detail: entry }));
    });
    list.appendChild(li);
  }

  container.classList.remove('hidden');
}

/**
 * Hide the search results dropdown.
 * @returns {void}
 */
function hideResultsDropdown() {
  const c = document.getElementById('search-results');
  if (c) c.classList.add('hidden');
}

/**
 * Clear the search input and reset state.
 * @returns {void}
 */
function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  setState({ searchQuery: '', searchResults: [] });
  hideResultsDropdown();
  hideAutocomplete();
}

/**
 * Initialize the search module with tag autocomplete.
 * @returns {void}
 */
export function initSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;

  input.addEventListener('input', () => {
    const value = input.value;
    const cursorPos = input.selectionStart;

    // Check for tag context
    const tagContext = detectTagContext(value, cursorPos);
    if (tagContext) {
      const suggestions = getSuggestions(tagContext);
      showAutocomplete(suggestions);
    } else {
      hideAutocomplete();
    }

    // Debounced search execution
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => triggerSearch(value), 300);
  });

  input.addEventListener('keydown', e => {
    const acVisible = !document.getElementById('tag-autocomplete')?.classList.contains('hidden');

    if (acVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateAutocomplete(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateAutocomplete(-1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const items = document.querySelectorAll('#tag-autocomplete-list li');
        if (selectedIndex >= 0 && items[selectedIndex]) {
          items[selectedIndex].click();
        } else if (items.length === 1) {
          items[0].click();
        }
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const items = document.querySelectorAll('#tag-autocomplete-list li');
        if (items.length === 1) {
          items[0].click();
        } else if (selectedIndex >= 0 && items[selectedIndex]) {
          items[selectedIndex].click();
        } else {
          navigateAutocomplete(1);
        }
        return;
      }
    }

    if (e.key === 'Escape') {
      if (acVisible) {
        hideAutocomplete();
      } else {
        clearSearch();
        input.blur();
      }
    }
  });

  // Click outside dismisses both dropdowns
  document.addEventListener('click', e => {
    if (!e.target.closest('#tag-autocomplete') && !e.target.closest('#search-input')) {
      hideAutocomplete();
    }
    if (!e.target.closest('#search-results') && !e.target.closest('#search-input')) {
      hideResultsDropdown();
    }
  });
}

// Export clearSearch for hotkeys module
export { clearSearch };
