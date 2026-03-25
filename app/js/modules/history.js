/** @module app/js/modules/history */

import { el, formatTimestamp } from './utils.js';
import { clearAllActions, gitRewind } from './api.js';
import { subscribe, setState } from './state.js';
import { showConfirmModal } from './modal.js';

/**
 * Render the action history list in reverse-chronological order.
 * @param {object[]} actions - array of action objects
 * @returns {void}
 */
export function renderHistory(actions) {
  const list = document.getElementById('history-list');
  if (!list) return;

  while (list.firstChild) list.removeChild(list.firstChild);

  if (!actions.length) {
    list.appendChild(el('li', { class: 'history-empty' }, 'No actions recorded.'));
    return;
  }

  // Reverse-chronological
  const sorted = [...actions].reverse();

  for (const action of sorted) {
    const typeSpan = el('span', { class: `history-type history-type-${action.type}` }, action.type);
    const detailSpan = el('span', { class: 'history-detail' }, action.detail || action.target || '');
    const timeSpan = el('span', { class: 'history-time' }, formatTimestamp(action.timestamp));

    const li = el('li', { class: 'history-item' }, typeSpan, ' ', detailSpan, ' ', timeSpan);

    if (action.commitHash) {
      const rewindLink = el('button', {
        class: 'btn-link history-rewind',
        type: 'button',
        title: `Rewind to commit ${action.commitHash}`,
      }, `rewind to ${action.commitHash}`);

      rewindLink.addEventListener('click', () => {
        showConfirmModal(
          'Rewind Repository',
          `Rewind to commit ${action.commitHash}? A new commit will be created restoring that state.`,
          async () => {
            try {
              await gitRewind(action.commitHash);
              document.dispatchEvent(new CustomEvent('data:refresh'));
            } catch (err) {
              alert('Rewind failed: ' + err.message);
            }
          }
        );
      });

      li.appendChild(document.createTextNode(' '));
      li.appendChild(rewindLink);
    }

    list.appendChild(li);
  }
}

/**
 * Toggle the visibility of the action history panel.
 * @returns {void}
 */
export function toggleHistory() {
  const panel = document.getElementById('history-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
}

/**
 * Initialize the history module. Subscribes to actions state, binds panel controls.
 * @returns {void}
 */
export function initHistory() {
  // Subscribe to actions state changes
  subscribe('actions', actions => {
    renderHistory(actions);
  });

  // History toggle button
  const btnHistory = document.getElementById('btn-history');
  if (btnHistory) {
    btnHistory.addEventListener('click', toggleHistory);
  }

  // Close button
  const closeBtn = document.getElementById('history-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const panel = document.getElementById('history-panel');
      if (panel) panel.classList.add('hidden');
    });
  }

  // Clear all button
  const clearBtn = document.getElementById('btn-clear-history');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      showConfirmModal(
        'Clear History',
        'Clear all action history? This cannot be undone.',
        async () => {
          try {
            await clearAllActions();
            setState({ actions: [] });
          } catch (err) {
            alert('Error clearing history: ' + err.message);
          }
        }
      );
    });
  }
}
