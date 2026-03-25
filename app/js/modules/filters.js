/** @module app/js/modules/filters */

import { el } from './utils.js';
import { getState, setState, subscribe } from './state.js';

/**
 * Render project filter buttons with entry count badges into #filter-projects.
 * Preserves the existing "Projects:" label span.
 * @param {object[]} projects - array of project objects with `name` and `entryCount`
 * @returns {void}
 */
export function renderProjectFilters(projects) {
  const container = document.getElementById('filter-projects');
  if (!container) return;

  // Keep the label, remove old buttons
  const label = container.querySelector('.filter-label');
  while (container.firstChild) container.removeChild(container.firstChild);
  if (label) container.appendChild(label);

  const { filters } = getState();

  // "All" button
  const allBtn = el('button', {
    class: `filter-tag${filters.project === '' ? ' active' : ''}`,
    'data-project': '',
  }, 'All');
  allBtn.addEventListener('click', () => {
    setState({ filters: { project: '' } });
  });
  container.appendChild(allBtn);

  for (const project of projects) {
    const isActive = filters.project === project.name;
    const badge = el('span', { class: 'filter-count' }, String(project.entryCount || 0));
    const btn = el('button', {
      class: `filter-tag${isActive ? ' active' : ''}`,
      'data-project': project.name,
    }, project.name, ' ', badge);
    btn.addEventListener('click', () => {
      setState({ filters: { project: project.name } });
    });
    container.appendChild(btn);
  }
}

/**
 * Bind click handlers to the static type filter buttons already present in the HTML.
 * @returns {void}
 */
export function bindTypeFilters() {
  const container = document.getElementById('filter-types');
  if (!container) return;

  container.addEventListener('click', e => {
    const btn = e.target.closest('.filter-tag[data-type]');
    if (!btn) return;
    const type = btn.dataset.type;
    setState({ filters: { type } });
    container.querySelectorAll('.filter-tag').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
}

/**
 * Initialize the filters module. Binds type filters and subscribes to `projects` state.
 * @returns {void}
 */
export function initFilters() {
  bindTypeFilters();

  subscribe('projects', projects => {
    renderProjectFilters(projects);
  });

  // Re-render project active state when filters change
  subscribe('filters', (filters) => {
    const container = document.getElementById('filter-projects');
    if (!container) return;
    container.querySelectorAll('.filter-tag[data-project]').forEach(btn => {
      if (btn.dataset.project === filters.project) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  });
}
