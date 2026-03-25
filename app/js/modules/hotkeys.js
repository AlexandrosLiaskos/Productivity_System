/** @module app/js/modules/hotkeys */

import { getState, setState } from './state.js';
import { showCreateModal, closeModal } from './modal.js';

/**
 * Determine if a keyboard event originates from an editable field.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function isInInput(e) {
  const tag = e.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Navigate the table by moving the selectedRow up or down.
 * @param {'up'|'down'} direction
 * @returns {void}
 */
function navigateTable(direction) {
  const rows = Array.from(document.querySelectorAll('#entries-body .entry-row'));
  if (!rows.length) return;

  const { selectedRow } = getState();
  const idx = rows.findIndex(r => r.dataset.filename === selectedRow);

  let nextIdx;
  if (direction === 'down') {
    nextIdx = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1);
  } else {
    nextIdx = idx < 0 ? rows.length - 1 : Math.max(idx - 1, 0);
  }

  const nextRow = rows[nextIdx];
  if (nextRow) {
    setState({ selectedRow: nextRow.dataset.filename });
    nextRow.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Open the currently selected entry.
 * @returns {void}
 */
function openSelected() {
  const { selectedRow } = getState();
  if (!selectedRow) return;

  const row = document.querySelector(`#entries-body .entry-row[data-filename="${CSS.escape(selectedRow)}"]`);
  if (row) row.click();
}

/**
 * Initialize keyboard shortcut bindings.
 * @returns {void}
 */
export function initHotkeys() {
  document.addEventListener('keydown', e => {
    // Ctrl+K — focus search
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      const input = document.getElementById('search-input');
      if (input) input.focus();
      return;
    }

    // Ctrl+P — focus search and insert project: tag
    if (e.ctrlKey && e.key === 'p') {
      e.preventDefault();
      const input = document.getElementById('search-input');
      if (input) {
        input.focus();
        if (!input.value.includes('project:')) {
          input.value = (input.value.trimEnd() + (input.value ? ' ' : '') + 'project:').trimStart();
          input.dispatchEvent(new Event('input'));
        }
      }
      return;
    }

    // Ctrl+T — focus search and insert type: tag
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      const input = document.getElementById('search-input');
      if (input) {
        input.focus();
        if (!input.value.includes('type:')) {
          input.value = (input.value.trimEnd() + (input.value ? ' ' : '') + 'type:').trimStart();
          input.dispatchEvent(new Event('input'));
        }
      }
      return;
    }

    // Ctrl+N — open create modal
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      showCreateModal();
      return;
    }

    // Escape — close modal, then history panel, then clear search
    if (e.key === 'Escape') {
      const overlay = document.getElementById('modal-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        closeModal();
        return;
      }
      const historyPanel = document.getElementById('history-panel');
      if (historyPanel && !historyPanel.classList.contains('hidden')) {
        historyPanel.classList.add('hidden');
        return;
      }
      // Clear search
      const searchInput = document.getElementById('search-input');
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        setState({ searchQuery: '', searchResults: [] });
        const results = document.getElementById('search-results');
        if (results) results.classList.add('hidden');
      }
      return;
    }

    // Arrow Up/Down — navigate table rows (skip when in input)
    if (!isInInput(e)) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateTable('down');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateTable('up');
        return;
      }
      // Enter — open selected entry
      if (e.key === 'Enter') {
        const overlay = document.getElementById('modal-overlay');
        if (overlay && !overlay.classList.contains('hidden')) return;
        openSelected();
      }
    }
  });
}
