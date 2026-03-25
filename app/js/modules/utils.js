/** @module app/js/modules/utils */

/** Filename parsing regex — matches {Title}.{type}[.{author}].{YYYYMMDD}.{ext} */
const FILENAME_RE = /^(.+)\.(task|log|note)\.(?:([a-z]+)\.)?(\d{8})\.(json|md)$/;

/**
 * Parse an entry filename into its components.
 * @param {string} filename
 * @returns {{ title: string, type: string, author: string|null, date: string, ext: string } | null}
 */
export function parseFilename(filename) {
  const m = filename.match(FILENAME_RE);
  if (!m) return null;
  return { title: m[1], type: m[2], author: m[3] || null, date: m[4], ext: m[5] };
}

/**
 * Format a YYYYMMDD date string as YYYY-MM-DD.
 * @param {string} stamp - e.g. "20260325"
 * @returns {string} e.g. "2026-03-25"
 */
export function formatDate(stamp) {
  if (!stamp || stamp.length !== 8) return stamp;
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
}

/**
 * Return today's date as a YYYYMMDD stamp.
 * @returns {string}
 */
export function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${mo}${day}`;
}

/**
 * Convert a Title_Case_Underscored filename title to a human-readable string.
 * @param {string} title - e.g. "Fix_Login_Bug"
 * @returns {string} e.g. "Fix Login Bug"
 */
export function humanizeTitle(title) {
  return title.replace(/_/g, ' ');
}

/**
 * Format an ISO timestamp string for display.
 * @param {string} iso - ISO 8601 string, e.g. "2026-03-25T12:00:00.000Z"
 * @returns {string} e.g. "2026-03-25 12:00"
 */
export function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time}`;
}

/**
 * Determine whether a deadline has passed (is overdue).
 * @param {string|null} deadline - ISO date string or YYYYMMDD stamp, or null
 * @returns {boolean}
 */
export function isOverdue(deadline) {
  if (!deadline) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let d;
  if (/^\d{8}$/.test(deadline)) {
    // YYYYMMDD
    d = new Date(
      parseInt(deadline.slice(0, 4), 10),
      parseInt(deadline.slice(4, 6), 10) - 1,
      parseInt(deadline.slice(6, 8), 10)
    );
  } else {
    d = new Date(deadline);
  }
  if (isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  return d < now;
}

/**
 * Create a DOM element with optional attributes and children.
 * Safe alternative to innerHTML — no string interpolation of user content.
 * @param {string} tag - HTML tag name
 * @param {Object} [attrs={}] - attribute key/value pairs (use 'class' for className, 'for' for htmlFor)
 * @param {...(Node|string)} children - child nodes or text strings
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') {
      node.className = value;
    } else if (key === 'for') {
      node.htmlFor = value;
    } else if (key.startsWith('data-')) {
      node.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      node.setAttribute(key, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
      else node.removeAttribute(key);
    } else if (typeof node[key] !== 'undefined' && key !== 'type') {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
  return node;
}
