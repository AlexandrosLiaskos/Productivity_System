/** @module app/js/modules/modal */

import { el, todayStamp, formatDate, humanizeTitle } from './utils.js';
import { createEntry, updateEntry, deleteEntry, gitCommit, createProject } from './api.js';
import { getState } from './state.js';

// ----------------------------------------------------------------
// Core open/close
// ----------------------------------------------------------------

/**
 * Open the modal with given title, body element, and footer element.
 * @param {string} title - modal heading text
 * @param {Node} body - DOM node to place in #modal-body
 * @param {Node} [footer] - DOM node to place in #modal-footer (optional)
 * @returns {void}
 */
export function openModal(title, body, footer) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const footerEl = document.getElementById('modal-footer');

  titleEl.textContent = title;

  while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
  while (footerEl.firstChild) footerEl.removeChild(footerEl.firstChild);

  if (body) bodyEl.appendChild(body);
  if (footer) footerEl.appendChild(footer);

  overlay.classList.remove('hidden');
  // Focus first focusable element
  const firstInput = overlay.querySelector('input, select, textarea, button:not(#modal-close)');
  if (firstInput) firstInput.focus();
}

/**
 * Close the modal overlay.
 * @returns {void}
 */
export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ----------------------------------------------------------------
// Filename preview helper
// ----------------------------------------------------------------

/**
 * Build a preview filename string from form field values.
 * @param {string} title
 * @param {string} type
 * @param {string} author
 * @param {string} date  - YYYYMMDD
 * @returns {string}
 */
function previewFilename(title, type, author, date) {
  const safeTitle = title.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '') || 'Untitled';
  const ext = type === 'note' ? 'md' : 'json';
  const parts = [safeTitle, type || 'task'];
  if (author && author.trim()) parts.push(author.trim().toLowerCase());
  parts.push(date || todayStamp());
  return parts.join('.') + '.' + ext;
}

// ----------------------------------------------------------------
// Create Modal
// ----------------------------------------------------------------

/**
 * Show the "Create Entry" modal. On submit, calls api.createEntry and dispatches data:refresh.
 * @returns {void}
 */
export function showCreateModal() {
  const { projects } = getState();
  const today = todayStamp();

  // --- Body form ---
  const form = el('form', { class: 'modal-form', id: 'create-form' });

  // Project select
  const projectSelect = el('select', { id: 'create-project', name: 'project', required: true });
  projectSelect.appendChild(el('option', { value: '' }, '— select project —'));
  for (const p of projects) {
    projectSelect.appendChild(el('option', { value: p.name }, p.name));
  }
  projectSelect.appendChild(el('option', { value: '__new__' }, '+ New Project'));

  // New project input (hidden by default)
  const newProjectInput = el('input', { type: 'text', id: 'create-new-project', placeholder: 'Project_Name (underscored)', style: 'display:none;margin-top:4px' });
  projectSelect.addEventListener('change', () => {
    newProjectInput.style.display = projectSelect.value === '__new__' ? '' : 'none';
    if (projectSelect.value === '__new__') newProjectInput.focus();
  });

  // Title input
  const titleInput = el('input', { type: 'text', id: 'create-title', name: 'title', placeholder: 'Entry title', required: true });

  // Type select
  const typeSelect = el('select', { id: 'create-type', name: 'type', required: true });
  for (const t of ['task', 'log', 'note']) {
    typeSelect.appendChild(el('option', { value: t }, t));
  }

  // Date input
  const dateInput = el('input', {
    type: 'date',
    id: 'create-date',
    name: 'date',
    value: `${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6,8)}`,
    required: true,
  });

  // Author input (optional)
  const authorInput = el('input', { type: 'text', id: 'create-author', name: 'author', placeholder: 'Author (optional, lowercase surname)' });

  // Filename preview
  const filenamePreview = el('code', { class: 'filename-preview', id: 'create-filename-preview' });

  // Status select (visible only for tasks)
  const statusRow = el('div', { class: 'form-row', id: 'create-status-row' });
  const statusSelect = el('select', { id: 'create-status', name: 'status' });
  for (const s of ['queued', 'in_progress', 'on_hold', 'completed', 'canceled']) {
    statusSelect.appendChild(el('option', { value: s }, s.replace(/_/g, ' ')));
  }
  statusRow.appendChild(el('label', { for: 'create-status' }, 'Status'));
  statusRow.appendChild(statusSelect);

  // Body textarea
  const bodyTextarea = el('textarea', { id: 'create-body', name: 'body', rows: '6', placeholder: 'Content...' });

  // Live filename preview update
  const updatePreview = () => {
    const titleVal = titleInput.value;
    const typeVal = typeSelect.value;
    const authorVal = authorInput.value;
    const dateVal = dateInput.value.replace(/-/g, '');
    filenamePreview.textContent = previewFilename(titleVal, typeVal, authorVal, dateVal);
    // Show/hide status row
    statusRow.style.display = typeVal === 'task' ? '' : 'none';
  };

  titleInput.addEventListener('input', updatePreview);
  typeSelect.addEventListener('change', updatePreview);
  authorInput.addEventListener('input', updatePreview);
  dateInput.addEventListener('change', updatePreview);

  // Build form rows
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'create-project' }, 'Project'),
    projectSelect,
    newProjectInput
  ));
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'create-title' }, 'Title'),
    titleInput
  ));
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'create-type' }, 'Type'),
    typeSelect
  ));
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'create-date' }, 'Date'),
    dateInput
  ));
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'create-author' }, 'Author'),
    authorInput
  ));
  form.appendChild(el('div', { class: 'form-row' },
    el('label', {}, 'Filename'),
    filenamePreview
  ));
  form.appendChild(statusRow);
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'create-body' }, 'Body'),
    bodyTextarea
  ));

  // Trigger initial preview
  updatePreview();

  // --- Footer ---
  const createBtn = el('button', { type: 'button', class: 'btn btn-primary', id: 'create-submit' }, 'Create');
  const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
  cancelBtn.addEventListener('click', closeModal);

  createBtn.addEventListener('click', async () => {
    let project = projectSelect.value;
    const title = titleInput.value.trim();
    const type = typeSelect.value;
    const dateStr = dateInput.value.replace(/-/g, '');
    const author = authorInput.value.trim() || undefined;
    const status = statusSelect.value;
    const body = bodyTextarea.value;

    // Handle new project creation
    if (project === '__new__') {
      const newName = newProjectInput.value.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
      if (!newName) {
        alert('Project name is required.');
        newProjectInput.focus();
        return;
      }
      project = newName;
    }

    if (!project || !title || !type || !dateStr) {
      alert('Project, title, type, and date are required.');
      return;
    }

    createBtn.disabled = true;
    try {
      // Create new project if needed
      if (projectSelect.value === '__new__') {
        await createProject({ name: project, status: 'in_progress', github_url: '', coordinator: '', created: dateStr, description: '' });
      }
      await createEntry({ project, title, type, date: dateStr, author, status, body });
      closeModal();
      document.dispatchEvent(new CustomEvent('data:refresh'));
    } catch (err) {
      alert('Error creating entry: ' + err.message);
    } finally {
      createBtn.disabled = false;
    }
  });

  const footer = el('div', { class: 'modal-footer-btns' }, createBtn, cancelBtn);
  openModal('New Entry', form, footer);
}

// ----------------------------------------------------------------
// Detail Modal
// ----------------------------------------------------------------

/**
 * Show the "Entry Detail" modal for viewing an entry.
 * @param {object} entry - the entry object
 * @returns {void}
 */
export function showDetailModal(entry) {
  const body = el('div', { class: 'detail-view' });

  // Info table
  const table = el('table', { class: 'detail-table' });
  const rows = [
    ['Filename', entry.filename],
    ['Project', entry.project],
    ['Type', entry.type],
    ['Date', formatDate(entry.date)],
    ['Author', entry.author || '—'],
  ];
  if (entry.type === 'task') {
    rows.push(['Status', (entry.status || 'queued').replace(/_/g, ' ')]);
    rows.push(['Deadline', entry.deadline ? formatDate(entry.deadline) : '—']);
  }
  if (entry.origin_note) {
    rows.push(['Origin Note', entry.origin_note]);
  }

  for (const [label, value] of rows) {
    const tr = el('tr', {},
      el('th', {}, label),
      el('td', {}, value)
    );
    table.appendChild(tr);
  }
  body.appendChild(table);

  // Body content
  if (entry.body) {
    body.appendChild(el('hr', {}));
    const pre = el('pre', { class: 'entry-body-content' });
    pre.textContent = entry.body;
    body.appendChild(pre);
  }

  // Footer buttons
  const editBtn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Edit');
  editBtn.addEventListener('click', () => showEditModal(entry));

  const deleteBtn = el('button', { type: 'button', class: 'btn btn-danger' }, 'Delete');
  deleteBtn.addEventListener('click', () => {
    showConfirmModal(
      'Delete Entry',
      `Delete "${humanizeTitle(entry.title)}"? This cannot be undone.`,
      async () => {
        try {
          await deleteEntry(entry.project, entry.filename);
          closeModal();
          document.dispatchEvent(new CustomEvent('data:refresh'));
        } catch (err) {
          alert('Error deleting entry: ' + err.message);
        }
      }
    );
  });

  const closeBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Close');
  closeBtn.addEventListener('click', closeModal);

  const footer = el('div', { class: 'modal-footer-btns' }, editBtn, deleteBtn, closeBtn);
  openModal(humanizeTitle(entry.title), body, footer);
}

// ----------------------------------------------------------------
// Edit Modal
// ----------------------------------------------------------------

/**
 * Show the "Edit Entry" modal for editing an entry's fields.
 * @param {object} entry - the entry object to edit
 * @returns {void}
 */
export function showEditModal(entry) {
  const form = el('form', { class: 'modal-form', id: 'edit-form' });

  // Title
  const titleInput = el('input', {
    type: 'text', id: 'edit-title', name: 'title',
    value: humanizeTitle(entry.title), required: true,
  });

  // Date
  const dateInput = el('input', {
    type: 'date', id: 'edit-date', name: 'date',
    value: formatDate(entry.date), required: true,
  });

  // Author
  const authorInput = el('input', {
    type: 'text', id: 'edit-author', name: 'author',
    value: entry.author || '',
    placeholder: 'Author (optional)',
  });

  // Filename preview
  const filenamePreview = el('code', { class: 'filename-preview', id: 'edit-filename-preview' });

  // Status (task only)
  const statusRow = el('div', { class: 'form-row', id: 'edit-status-row', style: { display: entry.type === 'task' ? '' : 'none' } });
  const statusSelect = el('select', { id: 'edit-status', name: 'status' });
  for (const s of ['queued', 'in_progress', 'on_hold', 'completed', 'canceled']) {
    const opt = el('option', { value: s }, s.replace(/_/g, ' '));
    if (entry.status === s) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  statusRow.appendChild(el('label', { for: 'edit-status' }, 'Status'));
  statusRow.appendChild(statusSelect);

  // Deadline (task only)
  const deadlineRow = el('div', { class: 'form-row', id: 'edit-deadline-row', style: { display: entry.type === 'task' ? '' : 'none' } });
  const deadlineInput = el('input', {
    type: 'date', id: 'edit-deadline', name: 'deadline',
    value: entry.deadline ? formatDate(entry.deadline) : '',
  });
  deadlineRow.appendChild(el('label', { for: 'edit-deadline' }, 'Deadline'));
  deadlineRow.appendChild(deadlineInput);

  // Body
  const bodyTextarea = el('textarea', { id: 'edit-body', name: 'body', rows: '8' });
  bodyTextarea.value = entry.body || '';

  // Live filename preview
  const updatePreview = () => {
    const titleVal = titleInput.value;
    const authorVal = authorInput.value;
    const dateVal = dateInput.value.replace(/-/g, '');
    filenamePreview.textContent = previewFilename(titleVal, entry.type, authorVal, dateVal);
  };

  titleInput.addEventListener('input', updatePreview);
  authorInput.addEventListener('input', updatePreview);
  dateInput.addEventListener('change', updatePreview);
  updatePreview();

  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'edit-title' }, 'Title'),
    titleInput
  ));
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'edit-date' }, 'Date'),
    dateInput
  ));
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'edit-author' }, 'Author'),
    authorInput
  ));
  form.appendChild(el('div', { class: 'form-row' },
    el('label', {}, 'Filename'),
    filenamePreview
  ));
  form.appendChild(statusRow);
  form.appendChild(deadlineRow);
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'edit-body' }, 'Body'),
    bodyTextarea
  ));

  // Footer
  const saveBtn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Save');
  const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
  cancelBtn.addEventListener('click', () => showDetailModal(entry));

  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const dateStr = dateInput.value.replace(/-/g, '');
    const author = authorInput.value.trim() || undefined;
    const body = bodyTextarea.value;

    const updates = { title, date: dateStr, author, body };

    if (entry.type === 'task') {
      updates.status = statusSelect.value;
      const dl = deadlineInput.value;
      updates.deadline = dl ? dl.replace(/-/g, '') : null;
    }

    saveBtn.disabled = true;
    try {
      const { filename: newFilename } = await updateEntry(entry.project, entry.filename, updates);
      closeModal();
      document.dispatchEvent(new CustomEvent('data:refresh'));
      // Re-open detail with the updated entry (with new filename)
      const updatedEntry = { ...entry, ...updates, filename: newFilename, title: title.replace(/\s+/g, '_') };
      // Small delay to let data:refresh propagate
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('entry:open', { detail: updatedEntry }));
      }, 300);
    } catch (err) {
      alert('Error saving entry: ' + err.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  const footer = el('div', { class: 'modal-footer-btns' }, saveBtn, cancelBtn);
  openModal('Edit — ' + humanizeTitle(entry.title), form, footer);
}

// ----------------------------------------------------------------
// Confirm Modal
// ----------------------------------------------------------------

/**
 * Show a confirmation modal with a message and confirm/cancel buttons.
 * @param {string} title - modal title
 * @param {string} message - confirmation message
 * @param {function(): void | Promise<void>} onConfirm - called on confirm
 * @returns {void}
 */
export function showConfirmModal(title, message, onConfirm) {
  const body = el('p', { class: 'confirm-message' }, message);

  const confirmBtn = el('button', { type: 'button', class: 'btn btn-danger' }, 'Confirm');
  const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');

  cancelBtn.addEventListener('click', closeModal);
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    try {
      await onConfirm();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      confirmBtn.disabled = false;
    }
  });

  const footer = el('div', { class: 'modal-footer-btns' }, confirmBtn, cancelBtn);
  openModal(title, body, footer);
}

// ----------------------------------------------------------------
// Commit Modal
// ----------------------------------------------------------------

/**
 * Show the git commit modal with a message input.
 * @returns {void}
 */
export function showCommitModal() {
  const form = el('form', { class: 'modal-form' });
  const msgInput = el('input', {
    type: 'text',
    id: 'commit-message',
    placeholder: 'Commit message',
    required: true,
  });
  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'commit-message' }, 'Message'),
    msgInput
  ));

  const commitBtn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Commit');
  const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
  cancelBtn.addEventListener('click', closeModal);

  commitBtn.addEventListener('click', async () => {
    const message = msgInput.value.trim();
    if (!message) { alert('Commit message is required.'); return; }
    commitBtn.disabled = true;
    try {
      const result = await gitCommit(message);
      closeModal();
      document.dispatchEvent(new CustomEvent('data:refresh'));
      alert(`Committed: ${result.hash}`);
    } catch (err) {
      alert('Commit failed: ' + err.message);
    } finally {
      commitBtn.disabled = false;
    }
  });

  const footer = el('div', { class: 'modal-footer-btns' }, commitBtn, cancelBtn);
  openModal('Git Commit', form, footer);
}

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------

/**
 * Initialize the modal system. Binds close button and overlay click.
 * @returns {void}
 */
export function initModal() {
  const closeBtn = document.getElementById('modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });
  }
}
