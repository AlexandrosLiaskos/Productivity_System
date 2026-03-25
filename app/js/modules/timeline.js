/** @module app/js/modules/timeline */

import { formatDate, humanizeTitle, isOverdue, el } from './utils.js';
import { updateEntry } from './api.js';
import { getState, setState, subscribe } from './state.js';

/** @type {string[]} */
export const TASK_STATUSES = ['in_progress', 'queued', 'on_hold', 'completed', 'canceled'];

/**
 * Cycle an entry's status to the next value in TASK_STATUSES.
 * Updates the entry via the API and dispatches a data:refresh event.
 * @param {object} entry - the entry object with project, filename, and status
 * @returns {Promise<void>}
 */
export async function cycleStatus(entry) {
  const current = entry.status || 'queued';
  const idx = TASK_STATUSES.indexOf(current);
  const next = TASK_STATUSES[(idx + 1) % TASK_STATUSES.length];
  try {
    await updateEntry(entry.project, entry.filename, { status: next });
    document.dispatchEvent(new CustomEvent('data:refresh'));
  } catch (err) {
    console.error('[timeline] cycleStatus error:', err);
  }
}

/**
 * Get the list of entries filtered by the current state (filters and searchQuery/searchResults).
 * @returns {object[]}
 */
export function getFilteredEntries() {
  const { entries, filters, searchQuery, searchResults } = getState();

  if (searchQuery && searchQuery.trim()) {
    return searchResults;
  }

  return entries.filter(entry => {
    if (filters.project && entry.project !== filters.project) return false;
    if (filters.type && entry.type !== filters.type) return false;
    return true;
  });
}

/**
 * Render tbody rows from an array of entries.
 * @param {object[]} entries - array of entry objects
 * @returns {void}
 */
export function renderTable(entries) {
  const tbody = document.getElementById('entries-body');
  const emptyState = document.getElementById('empty-state');
  if (!tbody) return;

  // Clear existing rows
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  if (!entries.length) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  const { selectedRow } = getState();

  for (const entry of entries) {
    const isSelected = selectedRow === entry.filename;
    const overdue = entry.type === 'task' && isOverdue(entry.deadline);

    // Date cell
    const tdDate = el('td', { class: 'col-date' }, formatDate(entry.date));

    // Title cell
    const titleClasses = ['col-title', overdue ? 'overdue' : ''].filter(Boolean).join(' ');
    const tdTitle = el('td', { class: titleClasses }, humanizeTitle(entry.title));

    // Type badge cell
    const typeBadge = el('span', { class: `badge badge-type badge-${entry.type}` }, entry.type);
    const tdType = el('td', { class: 'col-type' }, typeBadge);

    // Project cell
    const tdProject = el('td', { class: 'col-project' }, entry.project);

    // Status cell (only tasks have status)
    let tdStatus;
    if (entry.type === 'task') {
      const statusVal = entry.status || 'queued';
      const statusBadge = el('button', {
        class: `badge badge-status badge-status-${statusVal}`,
        'data-status': statusVal,
        title: 'Click to cycle status',
        type: 'button',
      }, statusVal.replace(/_/g, ' '));
      statusBadge.addEventListener('click', e => {
        e.stopPropagation();
        cycleStatus(entry);
      });
      tdStatus = el('td', { class: 'col-status' }, statusBadge);
    } else {
      tdStatus = el('td', { class: 'col-status' }, '—');
    }

    const trClasses = ['entry-row', isSelected ? 'selected' : '', overdue ? 'row-overdue' : ''].filter(Boolean).join(' ');
    const tr = el('tr', {
      class: trClasses,
      'data-filename': entry.filename,
      'data-project': entry.project,
    }, tdDate, tdTitle, tdType, tdProject, tdStatus);

    tr.addEventListener('click', () => {
      setState({ selectedRow: entry.filename });
      document.dispatchEvent(new CustomEvent('entry:open', { detail: entry }));
    });

    tbody.appendChild(tr);
  }
}

/**
 * Initialize the timeline view. Subscribes to relevant state keys and re-renders on changes.
 * @returns {void}
 */
export function initTimeline() {
  const rerender = () => renderTable(getFilteredEntries());

  subscribe('entries', rerender);
  subscribe('filters', rerender);
  subscribe('searchResults', rerender);
  subscribe('searchQuery', rerender);
  subscribe('selectedRow', () => {
    const { selectedRow } = getState();
    document.querySelectorAll('#entries-body .entry-row').forEach(row => {
      if (row.dataset.filename === selectedRow) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    });
  });
}
