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
