/** @module app/js/app */

import { listEntries, listProjects, getActions, gitPush } from './modules/api.js';
import { setState } from './modules/state.js';
import { initTimeline } from './modules/timeline.js';
import { initFilters } from './modules/filters.js';
import { initModal, showDetailModal, showCreateModal, showCommitModal, showConfirmModal, closeModal } from './modules/modal.js';
import { initSearch } from './modules/search.js';
import { initHistory } from './modules/history.js';
import { initHotkeys } from './modules/hotkeys.js';
import { showEmailLogger, initEmailLogger } from './modules/email-logger.js';

/**
 * Load all data in parallel and push to state.
 * @returns {Promise<void>}
 */
export async function loadData() {
  try {
    const [entries, projects, actions] = await Promise.all([
      listEntries(),
      listProjects(),
      getActions(),
    ]);
    setState({ entries, projects, actions });
  } catch (err) {
    console.error('[app] loadData error:', err);
  }
}

/**
 * Initialize the application: wire all modules, bind events, load data.
 * @returns {void}
 */
export function init() {
  // Initialize all modules
  initModal();
  initTimeline();
  initFilters();
  initSearch();
  initHistory();
  initHotkeys();
  initEmailLogger();

  // Header button bindings
  const btnCreate = document.getElementById('btn-create');
  if (btnCreate) btnCreate.addEventListener('click', showCreateModal);

  const btnLogEmail = document.getElementById('btn-log-email');
  if (btnLogEmail) {
    if (!window.outlookAPI) {
      btnLogEmail.disabled = true;
      btnLogEmail.title = 'Outlook not available';
    } else {
      btnLogEmail.addEventListener('click', showEmailLogger);
    }
  }

  const btnCommit = document.getElementById('btn-git-commit');
  if (btnCommit) btnCommit.addEventListener('click', showCommitModal);

  const btnPush = document.getElementById('btn-git-push');
  if (btnPush) {
    btnPush.addEventListener('click', () => {
      showConfirmModal(
        'Git Push',
        'Push all commits to the remote origin?',
        async () => {
          try {
            await gitPush();
            closeModal();
            alert('Pushed successfully.');
          } catch (err) {
            alert('Push failed: ' + err.message);
          }
        }
      );
    });
  }

  // Electron menu shortcut handler
  if (window.electronAPI && window.electronAPI.onShortcut) {
    window.electronAPI.onShortcut(action => {
      if (action === 'new') showCreateModal();
      if (action === 'email-logger') showEmailLogger();
    });
  }

  // Global event listeners
  document.addEventListener('entry:open', e => {
    showDetailModal(e.detail);
  });

  document.addEventListener('data:refresh', () => {
    loadData();
  });

  // Load initial data
  loadData();
}

// Boot
init();
