/** @module app/js/modules/email-logger */

import { el } from './utils.js';
import { getState } from './state.js';
import { createProject } from './api.js';

// ----------------------------------------------------------------
// Module-level state
// ----------------------------------------------------------------

/** @type {Set<string>} entryIds of emails selected for logging */
const selectedIds = new Set();

/** @type {Set<string>} outlookEntryIds already tracked in the system */
let trackedIds = new Set();

/** @type {string|null} currently selected folder path */
let currentFolderPath = null;

/** @type {Array} current email list for the open folder */
let currentEmails = [];

/** @type {string} right panel mode: 'list' | 'preview' | 'confirm' */
let rightMode = 'list';

/** @type {object|null} email data for preview mode */
let previewData = null;

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Format a byte size as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Get or create the email logger overlay element.
 * @returns {HTMLElement}
 */
function getOverlay() {
  return document.getElementById('email-logger-overlay');
}

/**
 * Update the bottom bar count and button state.
 * @param {HTMLElement} countEl
 * @param {HTMLButtonElement} logBtn
 */
function updateBottomBar(countEl, logBtn) {
  const n = selectedIds.size;
  countEl.textContent = n === 1 ? '1 email selected' : `${n} emails selected`;
  logBtn.disabled = n === 0;
}

// ----------------------------------------------------------------
// Folder Tree
// ----------------------------------------------------------------

/**
 * Render a single folder node (recursive).
 * @param {object} folder - folder data from outlookAPI.listFolders()
 * @param {HTMLElement} rightPanel - reference to right panel for loading emails
 * @param {HTMLElement} countEl - bottom bar count element
 * @param {HTMLButtonElement} logBtn - "Log Selected" button
 * @returns {HTMLElement}
 */
function renderFolderNode(folder, rightPanel, countEl, logBtn) {
  const hasChildren = folder.subfolders && folder.subfolders.length > 0;

  const nodeEl = el('div', { class: 'email-folder-node' });

  const rowEl = el('div', { class: 'email-folder-row' });

  // Toggle arrow (only if has children)
  const toggleEl = el('span', { class: 'email-folder-toggle' }, hasChildren ? '▶' : ' ');

  // Folder name + count
  const nameEl = el('span', { class: 'email-folder-name' }, folder.name);
  const countSpan = el('span', { class: 'email-folder-count' }, ` (${folder.count != null ? folder.count : 0})`);

  rowEl.appendChild(toggleEl);
  rowEl.appendChild(nameEl);
  rowEl.appendChild(countSpan);
  nodeEl.appendChild(rowEl);

  // Children container (collapsed by default)
  let childrenEl = null;
  let expanded = false;

  if (hasChildren) {
    childrenEl = el('div', { class: 'email-folder-children', style: { display: 'none' } });
    for (const sub of folder.subfolders) {
      childrenEl.appendChild(renderFolderNode(sub, rightPanel, countEl, logBtn));
    }
    nodeEl.appendChild(childrenEl);
  }

  // Click: toggle expand and load emails
  rowEl.addEventListener('click', () => {
    // Toggle children
    if (hasChildren) {
      expanded = !expanded;
      childrenEl.style.display = expanded ? '' : 'none';
      toggleEl.textContent = expanded ? '▼' : '▶';
    }

    // Highlight selected folder
    const allRows = document.querySelectorAll('.email-folder-row');
    for (const r of allRows) r.classList.remove('email-folder-row--selected');
    rowEl.classList.add('email-folder-row--selected');

    // Load emails
    currentFolderPath = folder.path;
    loadEmailList(folder.path, rightPanel, countEl, logBtn);
  });

  return nodeEl;
}

/**
 * Render the folder tree into the left panel.
 * @param {HTMLElement} leftPanel
 * @param {HTMLElement} rightPanel
 * @param {HTMLElement} countEl
 * @param {HTMLButtonElement} logBtn
 */
async function renderFolderTree(leftPanel, rightPanel, countEl, logBtn) {
  while (leftPanel.firstChild) leftPanel.removeChild(leftPanel.firstChild);

  const loadingEl = el('div', { class: 'email-folder-loading' }, 'Loading folders…');
  leftPanel.appendChild(loadingEl);

  if (!window.outlookAPI) {
    while (leftPanel.firstChild) leftPanel.removeChild(leftPanel.firstChild);
    leftPanel.appendChild(el('div', { class: 'email-folder-error' }, 'Outlook not available.'));
    return;
  }

  try {
    const folders = await window.outlookAPI.listFolders();
    while (leftPanel.firstChild) leftPanel.removeChild(leftPanel.firstChild);

    if (!folders || folders.length === 0) {
      leftPanel.appendChild(el('div', { class: 'email-folder-empty' }, 'No folders found.'));
      return;
    }

    for (const folder of folders) {
      leftPanel.appendChild(renderFolderNode(folder, rightPanel, countEl, logBtn));
    }
  } catch (err) {
    while (leftPanel.firstChild) leftPanel.removeChild(leftPanel.firstChild);
    leftPanel.appendChild(el('div', { class: 'email-folder-error' }, 'Error loading folders: ' + err.message));
  }
}

// ----------------------------------------------------------------
// Email List
// ----------------------------------------------------------------

/**
 * Load and render the email list for a folder path.
 * @param {string} folderPath
 * @param {HTMLElement} rightPanel
 * @param {HTMLElement} countEl
 * @param {HTMLButtonElement} logBtn
 */
async function loadEmailList(folderPath, rightPanel, countEl, logBtn) {
  rightMode = 'list';
  while (rightPanel.firstChild) rightPanel.removeChild(rightPanel.firstChild);
  rightPanel.appendChild(el('div', { class: 'email-list-loading' }, 'Loading emails…'));

  try {
    const emails = await window.outlookAPI.listEmails(folderPath, 50);
    currentEmails = emails || [];
    renderEmailList(rightPanel, countEl, logBtn);
  } catch (err) {
    while (rightPanel.firstChild) rightPanel.removeChild(rightPanel.firstChild);
    rightPanel.appendChild(el('div', { class: 'email-list-error' }, 'Error loading emails: ' + err.message));
  }
}

/**
 * Render the email list view into the right panel.
 * @param {HTMLElement} rightPanel
 * @param {HTMLElement} countEl
 * @param {HTMLButtonElement} logBtn
 */
function renderEmailList(rightPanel, countEl, logBtn) {
  while (rightPanel.firstChild) rightPanel.removeChild(rightPanel.firstChild);

  if (currentEmails.length === 0) {
    rightPanel.appendChild(el('div', { class: 'email-list-empty' }, 'No emails in this folder.'));
    return;
  }

  const listEl = el('div', { class: 'email-list' });

  for (const email of currentEmails) {
    const isTracked = trackedIds.has(email.entryId);
    const rowEl = el('div', { class: 'email-row' + (isTracked ? ' email-row--tracked' : '') });

    // Checkbox column
    const checkboxEl = el('input', {
      type: 'checkbox',
      class: 'email-row-checkbox',
      disabled: isTracked,
      title: isTracked ? 'Already tracked' : '',
    });
    if (selectedIds.has(email.entryId)) checkboxEl.checked = true;

    checkboxEl.addEventListener('change', e => {
      e.stopPropagation();
      if (checkboxEl.checked) {
        selectedIds.add(email.entryId);
      } else {
        selectedIds.delete(email.entryId);
      }
      updateBottomBar(countEl, logBtn);
    });

    // Subject
    const subjectEl = el('span', { class: 'email-row-subject' }, email.subject || '(no subject)');

    // From
    const fromEl = el('span', { class: 'email-row-from' }, email.from || '');

    // Date
    const dateEl = el('span', { class: 'email-row-date' }, email.date || '');

    // Attachment icon
    const attachEl = el('span', { class: 'email-row-attach' }, email.hasAttachments ? '📎' : '');

    // Tracked badge
    if (isTracked) {
      const trackedBadge = el('span', { class: 'email-row-tracked-badge' }, 'tracked');
      rowEl.appendChild(checkboxEl);
      rowEl.appendChild(subjectEl);
      rowEl.appendChild(fromEl);
      rowEl.appendChild(dateEl);
      rowEl.appendChild(attachEl);
      rowEl.appendChild(trackedBadge);
    } else {
      rowEl.appendChild(checkboxEl);
      rowEl.appendChild(subjectEl);
      rowEl.appendChild(fromEl);
      rowEl.appendChild(dateEl);
      rowEl.appendChild(attachEl);
    }

    // Click row (not checkbox) → preview
    rowEl.addEventListener('click', e => {
      if (e.target === checkboxEl) return;
      loadEmailPreview(email.entryId, rightPanel, countEl, logBtn);
    });

    listEl.appendChild(rowEl);
  }

  rightPanel.appendChild(listEl);
}

// ----------------------------------------------------------------
// Email Preview
// ----------------------------------------------------------------

/**
 * Load and render the email preview for an entryId.
 * @param {string} entryId
 * @param {HTMLElement} rightPanel
 * @param {HTMLElement} countEl
 * @param {HTMLButtonElement} logBtn
 */
async function loadEmailPreview(entryId, rightPanel, countEl, logBtn) {
  rightMode = 'preview';
  while (rightPanel.firstChild) rightPanel.removeChild(rightPanel.firstChild);
  rightPanel.appendChild(el('div', { class: 'email-preview-loading' }, 'Loading preview…'));

  try {
    const data = await window.outlookAPI.previewEmail(entryId);
    previewData = data;
    renderEmailPreview(rightPanel, countEl, logBtn);
  } catch (err) {
    while (rightPanel.firstChild) rightPanel.removeChild(rightPanel.firstChild);
    rightPanel.appendChild(el('div', { class: 'email-preview-error' }, 'Error loading preview: ' + err.message));
  }
}

/**
 * Render the email preview view into the right panel.
 * @param {HTMLElement} rightPanel
 * @param {HTMLElement} countEl
 * @param {HTMLButtonElement} logBtn
 */
function renderEmailPreview(rightPanel, countEl, logBtn) {
  while (rightPanel.firstChild) rightPanel.removeChild(rightPanel.firstChild);

  const data = previewData;
  if (!data) return;

  const isTracked = trackedIds.has(data.entryId);
  const preview = el('div', { class: 'email-preview' });

  // Top bar: back arrow + select checkbox
  const topBar = el('div', { class: 'email-preview-topbar' });

  const backBtn = el('button', { type: 'button', class: 'email-preview-back btn btn-secondary' }, '← Back');
  backBtn.addEventListener('click', () => {
    rightMode = 'list';
    renderEmailList(rightPanel, countEl, logBtn);
  });
  topBar.appendChild(backBtn);

  if (isTracked) {
    topBar.appendChild(el('span', { class: 'email-preview-tracked-note' }, 'Already tracked'));
  } else {
    const selectCb = el('input', {
      type: 'checkbox',
      id: 'preview-select-cb',
      class: 'email-preview-select-cb',
    });
    selectCb.checked = selectedIds.has(data.entryId);
    selectCb.addEventListener('change', () => {
      if (selectCb.checked) {
        selectedIds.add(data.entryId);
      } else {
        selectedIds.delete(data.entryId);
      }
      updateBottomBar(countEl, logBtn);
    });
    const selectLabel = el('label', { for: 'preview-select-cb', class: 'email-preview-select-label' }, 'Select for logging');
    topBar.appendChild(selectCb);
    topBar.appendChild(selectLabel);
  }

  preview.appendChild(topBar);

  // Meta table
  const metaEl = el('dl', { class: 'email-preview-meta' });
  const metaRows = [
    ['From', data.from || ''],
    ['To', Array.isArray(data.to) ? data.to.join(', ') : (data.to || '')],
    ['CC', Array.isArray(data.cc) ? data.cc.join(', ') : (data.cc || '')],
    ['Date', data.date || ''],
    ['Subject', data.subject || ''],
  ];
  for (const [label, value] of metaRows) {
    metaEl.appendChild(el('dt', {}, label));
    metaEl.appendChild(el('dd', {}, value));
  }
  preview.appendChild(metaEl);

  // Body
  if (data.body) {
    preview.appendChild(el('hr', {}));
    const bodyEl = el('pre', { class: 'email-preview-body' });
    bodyEl.textContent = data.body;
    preview.appendChild(bodyEl);
  }

  // Attachments
  if (data.attachments && data.attachments.length > 0) {
    preview.appendChild(el('hr', {}));
    preview.appendChild(el('div', { class: 'email-preview-attachments-label' }, 'Attachments'));
    const attachList = el('ul', { class: 'email-preview-attachments' });
    for (const att of data.attachments) {
      const li = el('li', {});
      const nameText = typeof att === 'string' ? att : (att.name || '');
      const sizeText = typeof att === 'object' && att.size != null ? ' — ' + formatSize(att.size) : '';
      li.appendChild(document.createTextNode(nameText + sizeText));
      attachList.appendChild(li);
    }
    preview.appendChild(attachList);
  }

  rightPanel.appendChild(preview);
}

// ----------------------------------------------------------------
// Confirm / Log
// ----------------------------------------------------------------

/**
 * Render the confirm/log panel into the right panel.
 * @param {HTMLElement} rightPanel
 * @param {HTMLElement} countEl
 * @param {HTMLButtonElement} logBtn
 */
function renderConfirm(rightPanel, countEl, logBtn) {
  rightMode = 'confirm';
  while (rightPanel.firstChild) rightPanel.removeChild(rightPanel.firstChild);

  const { projects } = getState();
  const selectedEmails = currentEmails.filter(e => selectedIds.has(e.entryId));

  const confirmEl = el('div', { class: 'email-confirm' });

  // Back button
  const backBtn = el('button', { type: 'button', class: 'btn btn-secondary email-confirm-back' }, '← Back to List');
  backBtn.addEventListener('click', () => {
    rightMode = 'list';
    renderEmailList(rightPanel, countEl, logBtn);
  });
  confirmEl.appendChild(backBtn);

  confirmEl.appendChild(el('h3', { class: 'email-confirm-title' }, 'Log Selected Emails'));

  // Project select
  const projectRow = el('div', { class: 'form-row' });
  projectRow.appendChild(el('label', { for: 'email-confirm-project' }, 'Project'));
  const projectSelect = el('select', { id: 'email-confirm-project' });
  projectSelect.appendChild(el('option', { value: '' }, '— select project —'));
  for (const p of projects) {
    projectSelect.appendChild(el('option', { value: p.name }, p.name));
  }
  projectSelect.appendChild(el('option', { value: '__new__' }, '+ New Project'));
  projectRow.appendChild(projectSelect);

  // New project input (hidden by default)
  const newProjectInput = el('input', {
    type: 'text',
    id: 'email-confirm-new-project',
    placeholder: 'Project_Name (underscored)',
    style: { display: 'none', marginTop: '4px' },
  });
  projectRow.appendChild(newProjectInput);
  projectSelect.addEventListener('change', () => {
    newProjectInput.style.display = projectSelect.value === '__new__' ? '' : 'none';
    if (projectSelect.value === '__new__') newProjectInput.focus();
    // Refresh link-to-entry options
    populateEntryLinks(projectSelect.value, linkSelect);
  });
  confirmEl.appendChild(projectRow);

  // Link to entry (optional)
  const linkRow = el('div', { class: 'form-row' });
  linkRow.appendChild(el('label', { for: 'email-confirm-link' }, 'Link to Entry (optional)'));
  const linkSelect = el('select', { id: 'email-confirm-link' });
  linkSelect.appendChild(el('option', { value: '' }, '— none —'));
  linkRow.appendChild(linkSelect);
  confirmEl.appendChild(linkRow);

  /**
   * Populate entry links for the selected project.
   * @param {string} projectName
   * @param {HTMLSelectElement} selectEl
   */
  function populateEntryLinks(projectName, selectEl) {
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
    selectEl.appendChild(el('option', { value: '' }, '— none —'));
    if (!projectName || projectName === '__new__') return;
    const { entries } = getState();
    const projectEntries = entries.filter(e => e.project === projectName && e.type !== 'email');
    for (const entry of projectEntries) {
      selectEl.appendChild(el('option', { value: entry.filename }, entry.filename));
    }
  }

  // Author input
  const authorRow = el('div', { class: 'form-row' });
  authorRow.appendChild(el('label', { for: 'email-confirm-author' }, 'Author (optional)'));
  const authorInput = el('input', {
    type: 'text',
    id: 'email-confirm-author',
    placeholder: 'liaskos',
    value: 'liaskos',
  });
  authorRow.appendChild(authorInput);
  confirmEl.appendChild(authorRow);

  // Selected email list
  confirmEl.appendChild(el('div', { class: 'email-confirm-list-label' }, `Selected emails (${selectedEmails.length}):`));
  const emailUl = el('ul', { class: 'email-confirm-list' });
  for (const email of selectedEmails) {
    emailUl.appendChild(el('li', {}, email.subject || '(no subject)'));
  }
  confirmEl.appendChild(emailUl);

  // Progress text
  const progressEl = el('div', { class: 'email-confirm-progress' });
  confirmEl.appendChild(progressEl);

  // Confirm button
  const confirmBtn = el('button', { type: 'button', class: 'btn btn-primary email-confirm-btn' }, 'Confirm & Log');
  confirmBtn.addEventListener('click', async () => {
    let project = projectSelect.value;

    if (project === '__new__') {
      const newName = newProjectInput.value.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
      if (!newName) {
        alert('Project name is required.');
        newProjectInput.focus();
        return;
      }
      project = newName;
    }

    if (!project) {
      alert('Please select a project.');
      projectSelect.focus();
      return;
    }

    const author = authorInput.value.trim() || 'liaskos';
    const linkedEntry = linkSelect.value || null;
    const references = linkedEntry ? { linked_entry: linkedEntry } : {};

    const emailsToLog = selectedEmails.map(e => ({
      entryId: e.entryId,
      subject: e.subject,
    }));

    confirmBtn.disabled = true;
    backBtn.disabled = true;
    progressEl.textContent = 'Logging emails…';

    try {
      // Create new project if needed
      if (projectSelect.value === '__new__') {
        await createProject({ name: project, status: 'in_progress', github_url: '', coordinator: '', created: '', description: '' });
      }

      await window.outlookAPI.logEmails({ emails: emailsToLog, project, author, references });

      progressEl.textContent = 'Done! Closing…';
      selectedIds.clear();
      updateBottomBar(countEl, logBtn);
      closeEmailLogger();
      document.dispatchEvent(new CustomEvent('data:refresh'));
    } catch (err) {
      progressEl.textContent = 'Error: ' + err.message;
      confirmBtn.disabled = false;
      backBtn.disabled = false;
    }
  });
  confirmEl.appendChild(confirmBtn);

  rightPanel.appendChild(confirmEl);
}

// ----------------------------------------------------------------
// Open / Close
// ----------------------------------------------------------------

/**
 * Close the email logger overlay.
 * @returns {void}
 */
function closeEmailLogger() {
  const overlay = getOverlay();
  if (overlay) {
    overlay.classList.add('hidden');
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  }
  // Reset module state
  selectedIds.clear();
  trackedIds = new Set();
  currentFolderPath = null;
  currentEmails = [];
  rightMode = 'list';
  previewData = null;
}

/**
 * Open the email logger modal.
 * Fetches tracked IDs, renders folder tree and empty right panel.
 * Requires window.outlookAPI to be present.
 * @returns {void}
 */
export function showEmailLogger() {
  if (!window.outlookAPI) {
    alert('Outlook is not available in this environment.');
    return;
  }

  const overlay = getOverlay();
  if (!overlay) return;

  // Clear previous state
  selectedIds.clear();
  trackedIds = new Set();
  currentFolderPath = null;
  currentEmails = [];
  rightMode = 'list';
  previewData = null;

  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  overlay.classList.remove('hidden');

  // Build modal structure
  const modal = el('div', { class: 'email-logger', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Email Logger' });

  // Header
  const header = el('div', { class: 'email-logger-header' });
  header.appendChild(el('span', { class: 'email-logger-title' }, 'Log Email from Outlook'));
  const closeBtn = el('button', { type: 'button', class: 'email-logger-close', 'aria-label': 'Close' }, '×');
  closeBtn.addEventListener('click', closeEmailLogger);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Body (two-panel)
  const body = el('div', { class: 'email-logger-body' });

  // Left panel: folder tree
  const leftPanel = el('div', { class: 'email-folder-tree' });
  leftPanel.appendChild(el('div', { class: 'email-folder-panel-title' }, 'Folders'));
  const treeContainer = el('div', { class: 'email-folder-tree-container' });
  leftPanel.appendChild(treeContainer);

  // Right panel
  const rightPanel = el('div', { class: 'email-right-panel' });
  rightPanel.appendChild(el('div', { class: 'email-list-placeholder' }, 'Select a folder to view emails.'));

  body.appendChild(leftPanel);
  body.appendChild(rightPanel);
  modal.appendChild(body);

  // Bottom bar
  const bottomBar = el('div', { class: 'email-bottom-bar' });
  const countEl = el('span', { class: 'email-bottom-count' }, '0 emails selected');
  const logBtn = el('button', { type: 'button', class: 'btn btn-primary email-bottom-log-btn', disabled: true }, 'Log Selected');
  logBtn.addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    renderConfirm(rightPanel, countEl, logBtn);
  });
  bottomBar.appendChild(countEl);
  bottomBar.appendChild(logBtn);
  modal.appendChild(bottomBar);

  overlay.appendChild(modal);

  // Escape to close
  const escHandler = e => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      closeEmailLogger();
    }
  };
  document.addEventListener('keydown', escHandler);

  // Fetch tracked IDs, then render folder tree
  window.outlookAPI.getTrackedIds()
    .then(ids => {
      trackedIds = new Set(Array.isArray(ids) ? ids : []);
    })
    .catch(() => {
      trackedIds = new Set();
    })
    .finally(() => {
      renderFolderTree(treeContainer, rightPanel, countEl, logBtn);
    });
}

/**
 * Initialize the email logger module. No persistent state needed at startup.
 * @returns {void}
 */
export function initEmailLogger() {
  // No-op for now — no persistent state initialization required.
}
