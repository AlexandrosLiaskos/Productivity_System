'use strict';

/**
 * Electron preload script (CommonJS — required by Electron even in ESM packages).
 *
 * The app communicates with the backend entirely via HTTP, so no custom IPC
 * APIs need to be exposed to the renderer at this time.
 *
 * This file is a placeholder that wires up the contextBridge for future use.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal API surface for future shortcut/IPC needs.
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Listen for keyboard shortcut events sent from the main process via the
   * application menu (e.g. CmdOrCtrl+N → 'new', CmdOrCtrl+K → 'search').
   *
   * @param {(action: string) => void} callback
   */
  onShortcut: (callback) => {
    ipcRenderer.on('shortcut', (_event, action) => callback(action));
  },
});

// Expose Outlook bridge API.
contextBridge.exposeInMainWorld('outlookAPI', {
  /** Check whether Outlook is available on this machine. */
  checkAvailable: () => ipcRenderer.invoke('outlook:check-available'),

  /** Return the full folder tree from Outlook. */
  listFolders: () => ipcRenderer.invoke('outlook:list-folders'),

  /**
   * List emails in a given folder.
   * @param {string} folderPath
   * @param {number} [limit]
   */
  listEmails: (folderPath, limit) => ipcRenderer.invoke('outlook:list-emails', { folderPath, limit }),

  /**
   * Fetch full preview content for a single email.
   * @param {string} entryId
   */
  previewEmail: (entryId) => ipcRenderer.invoke('outlook:preview-email', { entryId }),

  /**
   * Log one or more emails to the productivity system.
   * @param {{ emails: object[], project: string, author: string, references: string[] }} data
   */
  logEmails: (data) => ipcRenderer.invoke('outlook:log-emails', data),

  /** Return the set of Outlook entry IDs already tracked in the system. */
  getTrackedIds: () => ipcRenderer.invoke('outlook:get-tracked-ids'),
});
