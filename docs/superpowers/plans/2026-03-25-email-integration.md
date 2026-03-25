# Email Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Outlook email logging as a first-class entry type — PowerShell COM bridge, Electron IPC, email logger modal, email viewer, bidirectional references.

**Architecture:** PowerShell scripts access Outlook COM API, Electron main process spawns them and manages IPC, frontend email-logger module handles the folder tree + email list + preview + log confirmation UI.

**Tech Stack:** PowerShell 5.1+ COM, Electron IPC (ipcMain.handle / contextBridge), vanilla JS ES modules

---

## File Map

```
Productivity_System/
├── server/
│   ├── api/
│   │   ├── utils.js                    # MODIFY — update FILENAME_RE, buildFilename, add sanitizeEmailSubject
│   │   └── entries.js                  # MODIFY — email type handling in list/read/update/delete/search
│   └── outlook/
│       ├── check-available.ps1         # NEW — registry check for Outlook
│       ├── list-folders.ps1            # NEW — recursive folder tree via COM
│       ├── list-emails.ps1             # NEW — emails for a folder path
│       ├── preview-email.ps1           # NEW — full email content for preview
│       └── export-email.ps1            # NEW — save .msg + attachments to disk
├── electron/
│   ├── main.cjs                        # MODIFY — ipcMain handlers, menu, startup check
│   └── preload.cjs                     # MODIFY — outlookAPI namespace
├── app/
│   ├── index.html                      # MODIFY — add Log Email button
│   ├── css/
│   │   └── style.css                   # MODIFY — email logger modal styles
│   └── js/
│       ├── app.js                      # MODIFY — import email-logger, bind button, handle shortcut
│       └── modules/
│           ├── utils.js                # MODIFY — parseFilename regex
│           ├── email-logger.js         # NEW — full email logger modal module
│           ├── modal.js                # MODIFY — email detail/edit, linked emails field
│           ├── hotkeys.js              # MODIFY — Ctrl+E handler
│           └── search.js              # MODIFY — email in TAG_DEFS
└── mcp-server/
    └── index.js                        # MODIFY — type enum, regex
```

---

## Task 1: Update core utils — regex, buildFilename, sanitizeEmailSubject

Update filename parsing and building across all three locations (server utils, frontend utils, MCP server) to support the `email` type with `.msg` extension.

- [ ] **1a. Update `server/api/utils.js`**

Modify `FILENAME_RE` to include `email` and `msg`:

```
old_string:
const FILENAME_RE = /^(.+)\.(task|log|note)\.(?:([a-z]+)\.)?(\d{8})\.(json|md)$/;

new_string:
const FILENAME_RE = /^(.+)\.(task|log|note|email)\.(?:([a-z]+)\.)?(\d{8})\.(json|md|msg)$/;
```

Modify `buildFilename` to handle `email` type:

```
old_string:
  const ext = type === 'note' ? 'md' : 'json';

new_string:
  const ext = type === 'note' ? 'md' : type === 'email' ? 'msg' : 'json';
```

Add `sanitizeEmailSubject` function after `sanitizeTitle`:

```
old_string:
/**
 * Resolve a path safely within a base directory. Throws on path traversal.

new_string:
/**
 * Sanitize an email subject for use in filenames.
 * Like sanitizeTitle but with 80-char max and empty-subject fallback.
 * @param {string} raw - original email subject line
 * @returns {string}
 */
export function sanitizeEmailSubject(raw) {
  let sanitized = sanitizeTitle(raw);
  if (!sanitized) sanitized = 'no_subject';
  if (sanitized.length > 80) sanitized = sanitized.slice(0, 80);
  return sanitized;
}

/**
 * Resolve a path safely within a base directory. Throws on path traversal.
```

- [ ] **1b. Update `app/js/modules/utils.js`**

Modify `FILENAME_RE` in frontend utils:

```
old_string:
const FILENAME_RE = /^(.+)\.(task|log|note)\.(?:([a-z]+)\.)?(\d{8})\.(json|md)$/;

new_string:
const FILENAME_RE = /^(.+)\.(task|log|note|email)\.(?:([a-z]+)\.)?(\d{8})\.(json|md|msg)$/;
```

- [ ] **1c. Update `mcp-server/index.js`**

Modify the `FILENAME_RE` regex:

```
old_string:
const FILENAME_RE = /^(.+)\.(task|log|note)\.(?:([a-z]+)\.)?(\d{8})\.(json|md)$/;

new_string:
const FILENAME_RE = /^(.+)\.(task|log|note|email)\.(?:([a-z]+)\.)?(\d{8})\.(json|md|msg)$/;
```

Modify `buildFilename`:

```
old_string:
  const ext = type === 'note' ? 'md' : 'json';

new_string:
  const ext = type === 'note' ? 'md' : type === 'email' ? 'msg' : 'json';
```

Update the type enum in the `list-entries` tool (around line 510):

```
old_string:
    type: z.enum(['task', 'log', 'note']).optional().describe('Filter by entry type'),

new_string:
    type: z.enum(['task', 'log', 'note', 'email']).optional().describe('Filter by entry type'),
```

Update the type enum in the `create-entry` tool (around line 543):

```
old_string:
    type: z.enum(['task', 'log', 'note']).describe('Entry type'),

new_string:
    type: z.enum(['task', 'log', 'note', 'email']).describe('Entry type'),
```

- [ ] **1d. Commit:** `"feat: update filename regex and buildFilename for email type"`

---

## Task 2: Update entries.js for email type

Modify `server/api/entries.js` to handle email entries that use `.msg` + `.meta.json` sidecar files instead of reading/writing JSON/MD directly.

- [ ] **2a. Add `rm` import and update imports**

```
old_string:
import { readdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECTS_DIR, parseFilename, buildFilename, readJSON, writeJSON, sanitizeTitle, safePath } from './utils.js';

new_string:
import { readdir, readFile, writeFile, unlink, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECTS_DIR, parseFilename, buildFilename, readJSON, writeJSON, sanitizeTitle, sanitizeEmailSubject, safePath } from './utils.js';
```

- [ ] **2b. Update `listEntries` — read `.meta.json` sidecar for email entries**

Replace the inner loop body that reads file content. After `const entry = { ...parsed, project: dir, filename: file };`, change the content-reading block:

```
old_string:
      if (parsed.ext === 'json') {
        const content = await readJSON(join(dirPath, file));
        if (content) Object.assign(entry, content);
      } else {
        const raw = await readFile(join(dirPath, file), 'utf-8');
        entry.body = raw;
      }

new_string:
      if (parsed.type === 'email') {
        // Email entries: read the .meta.json sidecar
        const metaPath = join(dirPath, file.replace('.msg', '.meta.json'));
        const meta = await readJSON(metaPath);
        if (meta) Object.assign(entry, meta);
      } else if (parsed.ext === 'json') {
        const content = await readJSON(join(dirPath, file));
        if (content) Object.assign(entry, content);
      } else {
        const raw = await readFile(join(dirPath, file), 'utf-8');
        entry.body = raw;
      }
```

- [ ] **2c. Update `readEntry` — return `.meta.json` content for emails**

```
old_string:
export async function readEntry(project, filename) {
  const filePath = safePath(PROJECTS_DIR, project, filename);
  const parsed = parseFilename(filename);
  if (!parsed) return null;

  try {
    const raw = await readFile(filePath, 'utf-8');
    if (parsed.ext === 'json') {
      return { ...parsed, project, filename, ...JSON.parse(raw) };
    }
    return { ...parsed, project, filename, body: raw };
  } catch {
    return null;
  }
}

new_string:
export async function readEntry(project, filename) {
  const parsed = parseFilename(filename);
  if (!parsed) return null;

  if (parsed.type === 'email') {
    // Email entries: read the .meta.json sidecar, not the .msg binary
    const metaPath = safePath(PROJECTS_DIR, project, filename.replace('.msg', '.meta.json'));
    try {
      const meta = await readJSON(metaPath);
      if (!meta) return null;
      return { ...parsed, project, filename, ...meta };
    } catch {
      return null;
    }
  }

  const filePath = safePath(PROJECTS_DIR, project, filename);
  try {
    const raw = await readFile(filePath, 'utf-8');
    if (parsed.ext === 'json') {
      return { ...parsed, project, filename, ...JSON.parse(raw) };
    }
    return { ...parsed, project, filename, body: raw };
  } catch {
    return null;
  }
}
```

- [ ] **2d. Update `updateEntry` — write sidecar only for emails (no rename allowed)**

```
old_string:
export async function updateEntry(project, oldFilename, updates) {
  const parsed = parseFilename(oldFilename);
  if (!parsed) throw new Error('Invalid filename');

  const newParts = {
    title: updates.title ? sanitizeTitle(updates.title) : parsed.title,
    type: updates.type || parsed.type,
    author: updates.author !== undefined ? updates.author : parsed.author,
    date: updates.date || parsed.date,
  };
  const newFilename = buildFilename(newParts);

  const oldPath = safePath(PROJECTS_DIR, project, oldFilename);
  const newPath = safePath(PROJECTS_DIR, project, newFilename);

  if (newParts.type === 'note') {
    await writeFile(newPath, updates.body || '', 'utf-8');
  } else {
    const existing = (await readJSON(oldPath)) || {};
    const content = {
      status: updates.status !== undefined ? updates.status : existing.status,
      body: updates.body !== undefined ? updates.body : existing.body,
    };
    if (newParts.type === 'task') {
      content.deadline = updates.deadline !== undefined ? updates.deadline : existing.deadline;
    }
    if (updates.references) content.references = updates.references;
    else if (existing.references) content.references = existing.references;
    await writeJSON(newPath, content);
  }

  if (newFilename !== oldFilename) {
    try { await unlink(oldPath); } catch { /* may be same path */ }
  }

  return newFilename;
}

new_string:
export async function updateEntry(project, oldFilename, updates) {
  const parsed = parseFilename(oldFilename);
  if (!parsed) throw new Error('Invalid filename');

  // Email entries: only allow updating the .meta.json sidecar (references).
  // Renaming (changing subject) is not permitted for email entries.
  if (parsed.type === 'email') {
    const metaPath = safePath(PROJECTS_DIR, project, oldFilename.replace('.msg', '.meta.json'));
    const existing = (await readJSON(metaPath)) || {};
    if (updates.references) existing.references = updates.references;
    await writeJSON(metaPath, existing);
    return oldFilename;
  }

  const newParts = {
    title: updates.title ? sanitizeTitle(updates.title) : parsed.title,
    type: updates.type || parsed.type,
    author: updates.author !== undefined ? updates.author : parsed.author,
    date: updates.date || parsed.date,
  };
  const newFilename = buildFilename(newParts);

  const oldPath = safePath(PROJECTS_DIR, project, oldFilename);
  const newPath = safePath(PROJECTS_DIR, project, newFilename);

  if (newParts.type === 'note') {
    await writeFile(newPath, updates.body || '', 'utf-8');
  } else {
    const existing = (await readJSON(oldPath)) || {};
    const content = {
      status: updates.status !== undefined ? updates.status : existing.status,
      body: updates.body !== undefined ? updates.body : existing.body,
    };
    if (newParts.type === 'task') {
      content.deadline = updates.deadline !== undefined ? updates.deadline : existing.deadline;
    }
    if (updates.references) content.references = updates.references;
    else if (existing.references) content.references = existing.references;
    await writeJSON(newPath, content);
  }

  if (newFilename !== oldFilename) {
    try { await unlink(oldPath); } catch { /* may be same path */ }
  }

  return newFilename;
}
```

- [ ] **2e. Update `deleteEntry` — delete .msg, .meta.json, and attachments folder**

```
old_string:
export async function deleteEntry(project, filename) {
  await unlink(safePath(PROJECTS_DIR, project, filename));
}

new_string:
export async function deleteEntry(project, filename) {
  const parsed = parseFilename(filename);

  if (parsed && parsed.type === 'email') {
    // Delete the .msg file
    await unlink(safePath(PROJECTS_DIR, project, filename));
    // Delete the .meta.json sidecar
    try { await unlink(safePath(PROJECTS_DIR, project, filename.replace('.msg', '.meta.json'))); } catch { /* may not exist */ }
    // Delete the attachments folder (folder name = filename without .msg)
    const attachDir = safePath(PROJECTS_DIR, project, filename.replace('.msg', ''));
    try { await rm(attachDir, { recursive: true, force: true }); } catch { /* may not exist */ }
    return;
  }

  await unlink(safePath(PROJECTS_DIR, project, filename));
}
```

- [ ] **2f. Update `searchEntries` — include email metadata fields in search haystack**

```
old_string:
    if (text) {
      const haystack = [entry.title, entry.type, entry.author, entry.project, entry.body || ''].join(' ').toLowerCase();
      if (!haystack.includes(text)) return false;
    }

new_string:
    if (text) {
      const haystack = [
        entry.title, entry.type, entry.author, entry.project, entry.body || '',
        entry.from || '', (entry.to || []).join(' '), entry.bodyPreview || '',
      ].join(' ').toLowerCase();
      if (!haystack.includes(text)) return false;
    }
```

- [ ] **2g. Commit:** `"feat: update entries.js for email type with sidecar support"`

---

## Task 3: PowerShell scripts

Create the `server/outlook/` directory and all five PowerShell scripts. Each script outputs JSON to stdout, wraps all logic in try/catch, and returns `{"error":"message"}` on failure.

- [ ] **3a. Create `server/outlook/check-available.ps1`**

```powershell
# check-available.ps1 — Check if Outlook is installed via registry (does not launch Outlook)
try {
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Office\*\Outlook',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Office\*\Outlook'
    )
    $found = $false
    foreach ($p in $paths) {
        $keys = Get-Item $p -ErrorAction SilentlyContinue
        if ($keys) { $found = $true; break }
    }
    if ($found) {
        Write-Output '{"available":true}'
    } else {
        Write-Output '{"available":false,"error":"Outlook not installed"}'
    }
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"available`":false,`"error`":`"Check failed: $msg`"}"
}
```

- [ ] **3b. Create `server/outlook/list-folders.ps1`**

```powershell
# list-folders.ps1 — Recursively list all Outlook folders as a JSON tree
param()

function Get-FolderTree {
    param([object]$Folder)
    $result = @{
        name       = $Folder.Name
        path       = $Folder.FolderPath
        count      = $Folder.Items.Count
        subfolders = @()
    }
    foreach ($sub in $Folder.Folders) {
        $result.subfolders += ,(Get-FolderTree -Folder $sub)
    }
    return $result
}

try {
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")
    $topFolders = @()
    foreach ($store in $namespace.Stores) {
        $root = $store.GetRootFolder()
        foreach ($folder in $root.Folders) {
            $topFolders += ,(Get-FolderTree -Folder $folder)
        }
    }
    $json = $topFolders | ConvertTo-Json -Depth 20 -Compress
    # ConvertTo-Json wraps single-element arrays in a bare object; force array
    if ($topFolders.Count -eq 1) { $json = "[$json]" }
    Write-Output $json
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"error`":`"$msg`"}"
}
```

- [ ] **3c. Create `server/outlook/list-emails.ps1`**

```powershell
# list-emails.ps1 — List emails in a folder, most recent first
param(
    [Parameter(Mandatory=$true)]
    [string]$FolderPath,

    [int]$Limit = 50
)

function Resolve-Folder {
    param([string]$Path)
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")

    # FolderPath looks like: \\account@example.com\Inbox\Subfolder
    $parts = $Path -split '\\'
    # Remove empty entries from leading backslashes
    $parts = $parts | Where-Object { $_ -ne '' }

    if ($parts.Count -lt 1) { throw "Invalid folder path: $Path" }

    # First part is the store/account name, find it
    $root = $null
    foreach ($store in $namespace.Stores) {
        $storeRoot = $store.GetRootFolder()
        if ($storeRoot.Name -eq $parts[0] -or $store.DisplayName -eq $parts[0]) {
            $root = $storeRoot
            break
        }
    }
    if (-not $root) { throw "Store not found: $($parts[0])" }

    # Navigate remaining parts
    $current = $root
    for ($i = 1; $i -lt $parts.Count; $i++) {
        $found = $null
        foreach ($sub in $current.Folders) {
            if ($sub.Name -eq $parts[$i]) {
                $found = $sub
                break
            }
        }
        if (-not $found) { throw "Folder not found: $($parts[$i])" }
        $current = $found
    }
    return $current
}

try {
    $folder = Resolve-Folder -Path $FolderPath
    $items = $folder.Items
    $items.Sort("[ReceivedTime]", $true)  # descending

    $results = @()
    $count = 0
    foreach ($item in $items) {
        if ($count -ge $Limit) { break }
        # Only process mail items (class 43)
        if ($item.Class -ne 43) { continue }

        $toList = @()
        foreach ($recip in $item.Recipients) {
            if ($recip.Type -eq 1) { $toList += $recip.Address }
        }
        $ccList = @()
        foreach ($recip in $item.Recipients) {
            if ($recip.Type -eq 2) { $ccList += $recip.Address }
        }

        $sentDate = ""
        if ($item.SentOn) {
            $sentDate = $item.SentOn.ToString("yyyyMMdd")
        }

        $bodyText = ""
        if ($item.Body) {
            $bodyText = $item.Body
            if ($bodyText.Length -gt 200) { $bodyText = $bodyText.Substring(0, 200) }
            # Normalize whitespace for JSON
            $bodyText = $bodyText -replace "`r`n", " " -replace "`n", " " -replace "`r", " " -replace '\s+', ' '
        }

        $results += @{
            entryId         = $item.EntryID
            subject         = if ($item.Subject) { $item.Subject } else { "" }
            from            = if ($item.SenderEmailAddress) { $item.SenderEmailAddress } else { "" }
            to              = $toList
            cc              = $ccList
            date            = $sentDate
            hasAttachments  = [bool]$item.Attachments.Count
            attachmentCount = $item.Attachments.Count
            bodyPreview     = $bodyText
        }
        $count++
    }

    $json = $results | ConvertTo-Json -Depth 10 -Compress
    if ($results.Count -eq 0) { $json = "[]" }
    elseif ($results.Count -eq 1) { $json = "[$json]" }
    Write-Output $json
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"error`":`"$msg`"}"
}
```

- [ ] **3d. Create `server/outlook/preview-email.ps1`**

```powershell
# preview-email.ps1 — Get full email content for preview
param(
    [Parameter(Mandatory=$true)]
    [string]$EntryId
)

try {
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")
    $item = $namespace.GetItemFromID($EntryId)

    if (-not $item -or $item.Class -ne 43) {
        throw "Mail item not found or invalid"
    }

    $toList = @()
    $ccList = @()
    foreach ($recip in $item.Recipients) {
        if ($recip.Type -eq 1) { $toList += $recip.Address }
        elseif ($recip.Type -eq 2) { $ccList += $recip.Address }
    }

    $sentDate = ""
    if ($item.SentOn) {
        $sentDate = $item.SentOn.ToString("yyyyMMdd")
    }

    $bodyText = ""
    if ($item.Body) {
        $bodyText = $item.Body -replace "`r`n", "`n" -replace "`r", "`n"
    }

    $attachments = @()
    foreach ($att in $item.Attachments) {
        $attachments += @{
            name = $att.FileName
            size = $att.Size
        }
    }

    $result = @{
        entryId     = $item.EntryID
        subject     = if ($item.Subject) { $item.Subject } else { "" }
        from        = if ($item.SenderEmailAddress) { $item.SenderEmailAddress } else { "" }
        to          = $toList
        cc          = $ccList
        date        = $sentDate
        body        = $bodyText
        attachments = $attachments
    }

    $json = $result | ConvertTo-Json -Depth 10 -Compress
    Write-Output $json
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"error`":`"$msg`"}"
}
```

- [ ] **3e. Create `server/outlook/export-email.ps1`**

```powershell
# export-email.ps1 — Save .msg file and attachments to disk
param(
    [Parameter(Mandatory=$true)]
    [string]$EntryId,

    [Parameter(Mandatory=$true)]
    [string]$DestPath,

    [Parameter(Mandatory=$true)]
    [string]$MsgFilename
)

try {
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")
    $item = $namespace.GetItemFromID($EntryId)

    if (-not $item -or $item.Class -ne 43) {
        throw "Mail item not found or invalid"
    }

    # Ensure destination directory exists
    if (-not (Test-Path $DestPath)) {
        New-Item -ItemType Directory -Path $DestPath -Force | Out-Null
    }

    # Save the .msg file (olMSG format = 3)
    $msgFullPath = Join-Path $DestPath $MsgFilename
    $item.SaveAs($msgFullPath, 3)

    # Save attachments
    $attachmentNames = @()
    if ($item.Attachments.Count -gt 0) {
        # Attachment folder = MsgFilename without .msg extension
        $attachFolderName = $MsgFilename -replace '\.msg$', ''
        $attachDir = Join-Path $DestPath $attachFolderName
        if (-not (Test-Path $attachDir)) {
            New-Item -ItemType Directory -Path $attachDir -Force | Out-Null
        }

        foreach ($att in $item.Attachments) {
            # Use bare filename only — no path separators
            $safeName = $att.FileName -replace '[\\\/\:]', '_'
            $attPath = Join-Path $attachDir $safeName
            $att.SaveAsFile($attPath)
            $attachmentNames += $safeName
        }
    }

    $result = @{
        msgPath     = $msgFullPath
        attachments = $attachmentNames
    }

    $json = $result | ConvertTo-Json -Depth 5 -Compress
    if ($attachmentNames.Count -eq 1) {
        # Fix single-element array serialization
        $result.attachments = @($attachmentNames)
        $json = $result | ConvertTo-Json -Depth 5 -Compress
    }
    Write-Output $json
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"error`":`"$msg`"}"
}
```

- [ ] **3f. Commit:** `"feat: add PowerShell scripts for Outlook COM bridge"`

---

## Task 4: Electron IPC — main process handlers

Add Outlook IPC handlers to `electron/main.cjs`. The main process spawns PowerShell scripts and returns JSON results to the renderer.

- [ ] **4a. Add `ipcMain` to the require destructure**

```
old_string:
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');

new_string:
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
```

- [ ] **4b. Add the `runPowerShell` helper function and `outlookAvailable` state after the `execFile` declaration**

```
old_string:
// --- Data directory and window state path (set after app.whenReady) ---
let DATA_DIR;
let STATE_FILE;

new_string:
// --- Data directory and window state path (set after app.whenReady) ---
let DATA_DIR;
let STATE_FILE;

/** Whether Outlook is installed (determined at startup) */
let outlookAvailable = false;

/**
 * Run a PowerShell script and parse its JSON output.
 * @param {string} scriptName - filename inside server/outlook/
 * @param {string[]} [args=[]] - additional arguments
 * @returns {Promise<object>}
 */
async function runPowerShell(scriptName, args = []) {
  const scriptPath = join(__dirname, '..', 'server', 'outlook', scriptName);
  try {
    const { stdout } = await execFile(
      'powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { timeout: 30000 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return { error: 'No output from PowerShell script' };
    return JSON.parse(trimmed);
  } catch (err) {
    return { error: err.message || 'PowerShell execution failed' };
  }
}
```

- [ ] **4c. Register all IPC handlers — add the function right before `// --- Main entry point ---`**

```
old_string:
// --- Main entry point ---
async function main() {

new_string:
/**
 * Register all Outlook IPC handlers.
 */
function registerOutlookIPC() {
  // Check if Outlook is installed
  ipcMain.handle('outlook:check-available', async () => {
    return { available: outlookAvailable };
  });

  // List Outlook folders
  ipcMain.handle('outlook:list-folders', async () => {
    const result = await runPowerShell('list-folders.ps1');
    if (result.error) return { error: result.error };
    return result;
  });

  // List emails in a folder
  ipcMain.handle('outlook:list-emails', async (_event, { folderPath, limit }) => {
    const args = ['-FolderPath', folderPath];
    if (limit) args.push('-Limit', String(limit));
    const result = await runPowerShell('list-emails.ps1', args);
    if (result.error) return { error: result.error };
    return result;
  });

  // Preview a single email
  ipcMain.handle('outlook:preview-email', async (_event, { entryId }) => {
    const result = await runPowerShell('preview-email.ps1', ['-EntryId', entryId]);
    if (result.error) return { error: result.error };
    return result;
  });

  // Export selected emails to project folder
  ipcMain.handle('outlook:log-emails', async (_event, { emails, project }) => {
    const projectDir = join(DATA_DIR, 'projects', project);
    const results = [];
    for (const email of emails) {
      const exportResult = await runPowerShell('export-email.ps1', [
        '-EntryId', email.entryId,
        '-DestPath', projectDir,
        '-MsgFilename', email.msgFilename,
      ]);
      if (exportResult.error) {
        results.push({ entryId: email.entryId, error: exportResult.error });
        continue;
      }
      // Write the .meta.json sidecar
      const metaPath = join(projectDir, email.msgFilename.replace('.msg', '.meta.json'));
      const meta = {
        from: email.from,
        to: email.to,
        cc: email.cc,
        subject: email.subject,
        date: email.date,
        outlookEntryId: email.entryId,
        hasAttachments: email.hasAttachments,
        attachments: exportResult.attachments || [],
        bodyPreview: email.bodyPreview || '',
        references: email.references || {},
      };
      await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
      results.push({ entryId: email.entryId, msgFilename: email.msgFilename, ok: true });
    }
    return results;
  });

  // Get all tracked Outlook entry IDs from existing .meta.json files
  ipcMain.handle('outlook:get-tracked-ids', async () => {
    try {
      const PORT = process.env.PORT;
      const res = await fetch(`http://localhost:${PORT}/api/entries?type=email`);
      const entries = await res.json();
      const ids = (Array.isArray(entries) ? entries : [])
        .map(e => e.outlookEntryId)
        .filter(Boolean);
      return ids;
    } catch {
      return [];
    }
  });
}

// --- Main entry point ---
async function main() {
```

- [ ] **4d. Call `registerOutlookIPC()` and run the startup availability check inside `main()`**

Add after the `await firstRunSetup();` line:

```
old_string:
  await checkGit();
  await firstRunSetup();

  // Find a free port and start the internal HTTP server

new_string:
  await checkGit();
  await firstRunSetup();

  // Register Outlook IPC handlers
  registerOutlookIPC();

  // Check Outlook availability (non-blocking)
  runPowerShell('check-available.ps1').then(result => {
    outlookAvailable = !!(result && result.available);
  }).catch(() => { outlookAvailable = false; });

  // Find a free port and start the internal HTTP server
```

- [ ] **4e. Add Ctrl+E to the menu in `buildMenu`**

```
old_string:
        { label: 'Search', accelerator: 'CmdOrCtrl+K', click: () => win.webContents.send('shortcut', 'search') },

new_string:
        { label: 'Search', accelerator: 'CmdOrCtrl+K', click: () => win.webContents.send('shortcut', 'search') },
        { label: 'Log Email', accelerator: 'CmdOrCtrl+E', click: () => win.webContents.send('shortcut', 'email-logger') },
```

- [ ] **4f. Commit:** `"feat: add Electron IPC handlers for Outlook integration"`

---

## Task 5: Electron preload — expose outlookAPI

Add an `outlookAPI` namespace to the preload script, exposing invoke wrappers for all six Outlook IPC channels.

- [ ] **5a. Modify `electron/preload.cjs`**

```
old_string:
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

new_string:
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

// Expose Outlook integration API for email logging.
contextBridge.exposeInMainWorld('outlookAPI', {
  /**
   * Check if Outlook COM is accessible.
   * @returns {Promise<{ available: boolean, error?: string }>}
   */
  checkAvailable: () => ipcRenderer.invoke('outlook:check-available'),

  /**
   * Get the Outlook folder tree.
   * @returns {Promise<Array<object> | { error: string }>}
   */
  listFolders: () => ipcRenderer.invoke('outlook:list-folders'),

  /**
   * Get emails for a specific folder path.
   * @param {string} folderPath - Outlook folder path
   * @param {number} [limit=50] - max emails to return
   * @returns {Promise<Array<object> | { error: string }>}
   */
  listEmails: (folderPath, limit) => ipcRenderer.invoke('outlook:list-emails', { folderPath, limit }),

  /**
   * Get full email content for preview.
   * @param {string} entryId - Outlook entry ID
   * @returns {Promise<object | { error: string }>}
   */
  previewEmail: (entryId) => ipcRenderer.invoke('outlook:preview-email', { entryId }),

  /**
   * Export selected emails to a project folder.
   * @param {Array<object>} emails - email objects with entryId, msgFilename, metadata
   * @param {string} project - target project name
   * @returns {Promise<Array<object>>}
   */
  logEmails: (emails, project) => ipcRenderer.invoke('outlook:log-emails', { emails, project }),

  /**
   * Get all tracked Outlook entry IDs from existing .meta.json files.
   * @returns {Promise<string[]>}
   */
  getTrackedIds: () => ipcRenderer.invoke('outlook:get-tracked-ids'),
});
```

- [ ] **5b. Commit:** `"feat: expose outlookAPI in Electron preload"`

---

## Task 6: Frontend — Email Logger Modal

Create the full email logger module that handles folder tree browsing, email list with checkboxes, preview, and log confirmation.

- [ ] **6a. Create `app/js/modules/email-logger.js`**

Create the file with the following complete content:

```js
/** @module app/js/modules/email-logger */

import { el, humanizeTitle, todayStamp } from './utils.js';
import { listProjects, listEntries, createProject } from './api.js';

// ----------------------------------------------------------------
// State for the email logger session
// ----------------------------------------------------------------

/** @type {Map<string, object>} entryId -> email object */
let selectedEmails = new Map();

/** @type {Set<string>} tracked Outlook entry IDs */
let trackedIds = new Set();

/** @type {string|null} currently active folder path */
let currentFolderPath = null;

/** @type {HTMLElement|null} the overlay element */
let overlayEl = null;

// ----------------------------------------------------------------
// DOM helpers
// ----------------------------------------------------------------

/**
 * Remove all child nodes from an element (safe alternative to setting innerHTML).
 * @param {HTMLElement} node
 */
function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Open the email logger modal. Checks Outlook availability first.
 * @returns {Promise<void>}
 */
export async function showEmailLogger() {
  if (typeof window.outlookAPI === 'undefined') {
    alert('Email logging is only available in the desktop app.');
    return;
  }

  const check = await window.outlookAPI.checkAvailable();
  if (!check || !check.available) {
    alert('Outlook is not available. Please ensure Outlook is installed.');
    return;
  }

  // Load tracked IDs
  const ids = await window.outlookAPI.getTrackedIds();
  trackedIds = new Set(Array.isArray(ids) ? ids : []);

  // Reset selection state
  selectedEmails = new Map();
  currentFolderPath = null;

  // Build and show the modal
  renderEmailLoggerModal();

  // Load folder tree
  const folders = await window.outlookAPI.listFolders();
  if (folders && folders.error) {
    renderError(folders.error);
    return;
  }
  renderFolderTree(Array.isArray(folders) ? folders : []);
}

/**
 * Close the email logger modal.
 * @returns {void}
 */
export function closeEmailLogger() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

// ----------------------------------------------------------------
// Modal Shell
// ----------------------------------------------------------------

/**
 * Create and append the email logger modal overlay.
 */
function renderEmailLoggerModal() {
  // Remove any existing overlay
  closeEmailLogger();

  overlayEl = el('div', { class: 'email-logger-overlay' });

  const modal = el('div', { class: 'email-logger-modal' });

  // Header
  const closeBtn = el('button', { class: 'email-logger-close', 'aria-label': 'Close' }, '\u00D7');
  closeBtn.addEventListener('click', closeEmailLogger);
  const header = el('div', { class: 'email-logger-header' },
    el('h2', {}, 'Log Email'),
    closeBtn,
  );

  // Body: two-panel layout
  const foldersPanel = el('div', { class: 'email-logger-folders', id: 'email-folders' },
    el('p', { class: 'email-logger-loading' }, 'Loading folders...'),
  );
  const contentPanel = el('div', { class: 'email-logger-content', id: 'email-content' },
    el('p', { style: 'padding:16px;color:#888' }, 'Select a folder to view emails.'),
  );
  const body = el('div', { class: 'email-logger-body' }, foldersPanel, contentPanel);

  // Bottom bar
  const selectedCount = el('span', { id: 'email-selected-count' }, '0 emails selected');
  const logBtn = el('button', { class: 'btn btn-primary', id: 'email-log-btn', disabled: true }, 'Log Selected');
  const bottomBar = el('div', { class: 'email-logger-bottom', id: 'email-bottom' }, selectedCount, logBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(bottomBar);
  overlayEl.appendChild(modal);
  document.body.appendChild(overlayEl);

  // Close on overlay click
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeEmailLogger();
  });

  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape' && overlayEl) {
      closeEmailLogger();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Log Selected button
  logBtn.addEventListener('click', () => {
    if (selectedEmails.size > 0) showLogConfirmation();
  });
}

// ----------------------------------------------------------------
// Folder Tree
// ----------------------------------------------------------------

/**
 * Render the folder tree in the left panel.
 * @param {Array<object>} folders
 */
function renderFolderTree(folders) {
  const container = document.getElementById('email-folders');
  if (!container) return;
  clearChildren(container);

  const tree = buildFolderList(folders);
  container.appendChild(tree);
}

/**
 * Build a nested UL for the folder tree.
 * @param {Array<object>} folders
 * @returns {HTMLElement}
 */
function buildFolderList(folders) {
  const ul = el('ul', { class: 'email-folder-tree' });

  for (const folder of folders) {
    const li = el('li', {});
    const hasChildren = folder.subfolders && folder.subfolders.length > 0;

    const row = el('div', { class: 'email-folder-row' });

    if (hasChildren) {
      const toggle = el('span', { class: 'email-folder-toggle' }, '\u25B6');
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const childUl = li.querySelector(':scope > ul');
        if (childUl) {
          const isHidden = childUl.classList.toggle('hidden');
          toggle.textContent = isHidden ? '\u25B6' : '\u25BC';
        }
      });
      row.appendChild(toggle);
    } else {
      row.appendChild(el('span', { class: 'email-folder-toggle' }, '\u00A0'));
    }

    const label = el('span', { class: 'email-folder-label' },
      folder.name,
      el('span', { class: 'email-folder-count' }, ` (${folder.count})`),
    );
    label.addEventListener('click', () => {
      // Highlight selected folder
      if (overlayEl) {
        const allLabels = overlayEl.querySelectorAll('.email-folder-label');
        allLabels.forEach(l => l.classList.remove('active'));
      }
      label.classList.add('active');

      // Load emails for this folder
      currentFolderPath = folder.path;
      loadEmailsForFolder(folder.path);
    });
    row.appendChild(label);
    li.appendChild(row);

    if (hasChildren) {
      const childUl = buildFolderList(folder.subfolders);
      childUl.classList.add('hidden');
      li.appendChild(childUl);
    }

    ul.appendChild(li);
  }

  return ul;
}

// ----------------------------------------------------------------
// Email List
// ----------------------------------------------------------------

/**
 * Load and display emails for a folder path.
 * @param {string} folderPath
 */
async function loadEmailsForFolder(folderPath) {
  const container = document.getElementById('email-content');
  if (!container) return;
  clearChildren(container);
  container.appendChild(el('p', { class: 'email-logger-loading' }, 'Loading emails...'));

  const emails = await window.outlookAPI.listEmails(folderPath, 50);
  clearChildren(container);

  if (emails && emails.error) {
    container.appendChild(el('p', { style: 'padding:16px;color:red' }, 'Error: ' + emails.error));
    return;
  }

  const list = Array.isArray(emails) ? emails : [];
  if (list.length === 0) {
    container.appendChild(el('p', { style: 'padding:16px;color:#888' }, 'No emails in this folder.'));
    return;
  }

  renderEmailList(list);
}

/**
 * Render the email list in the right panel.
 * @param {Array<object>} emails
 */
function renderEmailList(emails) {
  const container = document.getElementById('email-content');
  if (!container) return;
  clearChildren(container);

  const table = el('table', { class: 'email-list-table' });
  const thead = el('thead', {},
    el('tr', {},
      el('th', { style: 'width:30px' }, ''),
      el('th', {}, 'Subject'),
      el('th', {}, 'From'),
      el('th', {}, 'Date'),
      el('th', { style: 'width:20px' }, ''),
    ),
  );
  table.appendChild(thead);

  const tbody = el('tbody', {});
  for (const email of emails) {
    const isTracked = trackedIds.has(email.entryId);
    const isSelected = selectedEmails.has(email.entryId);

    const tr = el('tr', { class: isTracked ? 'email-row tracked' : 'email-row' });

    // Checkbox cell
    const cb = el('input', { type: 'checkbox', disabled: isTracked, checked: isSelected });
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) {
        selectedEmails.set(email.entryId, email);
      } else {
        selectedEmails.delete(email.entryId);
      }
      updateSelectionCount();
    });
    const cbCell = el('td', {});
    cbCell.appendChild(cb);
    tr.appendChild(cbCell);

    // Subject
    const subjectContent = [email.subject || '(no subject)'];
    if (isTracked) subjectContent.push(el('span', { class: 'email-tracked-badge' }, 'tracked'));
    const subjectCell = el('td', { class: 'email-subject-cell' }, ...subjectContent);
    tr.appendChild(subjectCell);

    // From
    const fromDisplay = email.from ? email.from.split('@')[0] : '';
    tr.appendChild(el('td', {}, fromDisplay));

    // Date
    const dateDisplay = email.date
      ? email.date.slice(0, 4) + '-' + email.date.slice(4, 6) + '-' + email.date.slice(6, 8)
      : '';
    tr.appendChild(el('td', {}, dateDisplay));

    // Attachment indicator
    tr.appendChild(el('td', {}, email.hasAttachments ? '\uD83D\uDCCE' : ''));

    // Click row (not checkbox) to open preview
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      showEmailPreview(email);
    });

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

// ----------------------------------------------------------------
// Email Preview
// ----------------------------------------------------------------

/**
 * Show a full email preview in the right panel.
 * @param {object} email - email summary object
 */
async function showEmailPreview(email) {
  const container = document.getElementById('email-content');
  if (!container) return;
  clearChildren(container);
  container.appendChild(el('p', { class: 'email-logger-loading' }, 'Loading preview...'));

  const detail = await window.outlookAPI.previewEmail(email.entryId);
  clearChildren(container);

  if (detail && detail.error) {
    container.appendChild(el('p', { style: 'padding:16px;color:red' }, 'Error: ' + detail.error));
    return;
  }

  const isTracked = trackedIds.has(email.entryId);
  const isSelected = selectedEmails.has(email.entryId);

  const preview = el('div', { class: 'email-preview' });

  // Back button
  const backBtn = el('button', { class: 'btn btn-secondary email-preview-back' }, '\u2190 Back to list');
  backBtn.addEventListener('click', () => {
    if (currentFolderPath) loadEmailsForFolder(currentFolderPath);
  });
  preview.appendChild(backBtn);

  // Select checkbox (unless tracked)
  if (isTracked) {
    preview.appendChild(el('p', { class: 'email-tracked-notice' }, 'Already tracked'));
  } else {
    const cb = el('input', { type: 'checkbox', id: 'preview-select-cb', checked: isSelected });
    const cbLabel = el('label', { for: 'preview-select-cb', style: 'margin-left:6px' }, 'Select for logging');
    cb.addEventListener('change', () => {
      if (cb.checked) {
        selectedEmails.set(email.entryId, email);
      } else {
        selectedEmails.delete(email.entryId);
      }
      updateSelectionCount();
    });
    preview.appendChild(el('div', { class: 'email-preview-select' }, cb, cbLabel));
  }

  // Metadata
  const meta = el('dl', { class: 'email-preview-meta' });
  meta.appendChild(el('dt', {}, 'From'));
  meta.appendChild(el('dd', {}, detail.from || ''));
  meta.appendChild(el('dt', {}, 'To'));
  meta.appendChild(el('dd', {}, (detail.to || []).join(', ')));
  if (detail.cc && detail.cc.length) {
    meta.appendChild(el('dt', {}, 'CC'));
    meta.appendChild(el('dd', {}, detail.cc.join(', ')));
  }
  meta.appendChild(el('dt', {}, 'Date'));
  const dateStr = detail.date
    ? detail.date.slice(0, 4) + '-' + detail.date.slice(4, 6) + '-' + detail.date.slice(6, 8)
    : '';
  meta.appendChild(el('dd', {}, dateStr));
  meta.appendChild(el('dt', {}, 'Subject'));
  meta.appendChild(el('dd', {}, detail.subject || ''));
  preview.appendChild(meta);

  // Body
  const bodyPre = el('pre', { class: 'email-preview-body' });
  bodyPre.textContent = detail.body || '';
  preview.appendChild(bodyPre);

  // Attachments
  if (detail.attachments && detail.attachments.length) {
    preview.appendChild(el('h4', {}, 'Attachments'));
    const attList = el('ul', { class: 'email-preview-attachments' });
    for (const att of detail.attachments) {
      const sizeKB = att.size ? (att.size / 1024).toFixed(1) + ' KB' : '';
      attList.appendChild(el('li', {}, att.name + ' (' + sizeKB + ')'));
    }
    preview.appendChild(attList);
  }

  container.appendChild(preview);
}

// ----------------------------------------------------------------
// Log Confirmation
// ----------------------------------------------------------------

/**
 * Show the log confirmation panel (replaces right panel).
 */
async function showLogConfirmation() {
  const container = document.getElementById('email-content');
  if (!container) return;
  clearChildren(container);

  const panel = el('div', { class: 'email-log-confirm' });
  panel.appendChild(el('h3', {}, 'Log Confirmation'));

  // Project select
  let projects = [];
  try {
    projects = await listProjects();
  } catch { /* empty */ }

  const projectSelect = el('select', { id: 'email-log-project' });
  projectSelect.appendChild(el('option', { value: '' }, '-- select project --'));
  for (const p of projects) {
    projectSelect.appendChild(el('option', { value: p.name }, p.name));
  }
  projectSelect.appendChild(el('option', { value: '__new__' }, '+ New Project'));

  const newProjectInput = el('input', {
    type: 'text', placeholder: 'Project_Name (underscored)',
    style: 'display:none;margin-top:4px',
    id: 'email-log-new-project',
  });
  projectSelect.addEventListener('change', () => {
    newProjectInput.style.display = projectSelect.value === '__new__' ? '' : 'none';
    // Reset linked entry dropdown when project changes
    if (projectSelect.value && projectSelect.value !== '__new__') {
      loadLinkedEntries(projectSelect.value);
    }
  });

  panel.appendChild(el('div', { class: 'form-row' },
    el('label', {}, 'Target Project'),
    projectSelect,
    newProjectInput,
  ));

  // Link to entry (optional)
  const linkSelect = el('select', { id: 'email-log-link' });
  linkSelect.appendChild(el('option', { value: '' }, '(none)'));
  panel.appendChild(el('div', { class: 'form-row' },
    el('label', {}, 'Link to Entry (optional)'),
    linkSelect,
  ));

  // Selected emails list
  panel.appendChild(el('h4', {}, 'Selected Emails (' + selectedEmails.size + ')'));
  const emailList = el('ul', { class: 'email-log-list' });
  for (const [, email] of selectedEmails) {
    emailList.appendChild(el('li', {}, email.subject || '(no subject)'));
  }
  panel.appendChild(emailList);

  // Confirm button
  const confirmBtn = el('button', { class: 'btn btn-primary', id: 'email-confirm-btn' }, 'Confirm');
  const cancelBtn = el('button', { class: 'btn btn-secondary' }, 'Cancel');
  cancelBtn.addEventListener('click', () => {
    if (currentFolderPath) loadEmailsForFolder(currentFolderPath);
  });

  // Progress indicator
  const progress = el('p', { id: 'email-log-progress', style: 'display:none' }, 'Exporting...');

  confirmBtn.addEventListener('click', () => executeLogEmails(projectSelect, newProjectInput, linkSelect, confirmBtn, progress));

  panel.appendChild(el('div', { class: 'email-log-actions' }, confirmBtn, cancelBtn));
  panel.appendChild(progress);

  container.appendChild(panel);
}

/**
 * Populate the linked entry dropdown for a project.
 * @param {string} project
 */
async function loadLinkedEntries(project) {
  const linkSelect = document.getElementById('email-log-link');
  if (!linkSelect) return;
  clearChildren(linkSelect);
  linkSelect.appendChild(el('option', { value: '' }, '(none)'));

  try {
    const entries = await listEntries({ project });
    for (const entry of entries) {
      linkSelect.appendChild(el('option', { value: entry.filename },
        humanizeTitle(entry.title) + ' (' + entry.type + ')'));
    }
  } catch { /* empty */ }
}

/**
 * Execute the email export and logging flow.
 * @param {HTMLSelectElement} projectSelect
 * @param {HTMLInputElement} newProjectInput
 * @param {HTMLSelectElement} linkSelect
 * @param {HTMLButtonElement} confirmBtn
 * @param {HTMLElement} progress
 */
async function executeLogEmails(projectSelect, newProjectInput, linkSelect, confirmBtn, progress) {
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
    return;
  }

  confirmBtn.disabled = true;
  progress.style.display = '';

  try {
    // Create new project if needed
    if (projectSelect.value === '__new__') {
      await createProject({
        name: project,
        status: 'in_progress',
        github_url: '',
        coordinator: '',
        created: todayStamp(),
        description: '',
      });
    }

    // Build the linked entry reference
    const linkedEntry = linkSelect.value || null;
    const references = {};
    if (linkedEntry) {
      references.linked_entry = linkedEntry;
    }

    // Prepare emails for export
    const emailsToLog = [];
    for (const [, email] of selectedEmails) {
      const subject = sanitizeSubject(email.subject || '');
      const authorRaw = email.from ? email.from.split('@')[0].split('.').pop().toLowerCase() : 'unknown';
      const author = authorRaw.replace(/[^a-z]/g, '') || 'unknown';
      const date = email.date || todayStamp();
      const msgFilename = buildMsgFilename(subject, author, date);

      emailsToLog.push({
        entryId: email.entryId,
        msgFilename,
        from: email.from,
        to: email.to || [],
        cc: email.cc || [],
        subject: email.subject || '',
        date,
        hasAttachments: !!email.hasAttachments,
        bodyPreview: email.bodyPreview || '',
        references,
      });
    }

    // Call Electron IPC to export
    const results = await window.outlookAPI.logEmails(emailsToLog, project);

    const errors = results.filter(r => r.error);
    if (errors.length) {
      alert('Exported with ' + errors.length + ' error(s):\n' + errors.map(e => e.error).join('\n'));
    }

    // Close and refresh
    closeEmailLogger();
    document.dispatchEvent(new CustomEvent('data:refresh'));
  } catch (err) {
    alert('Error logging emails: ' + err.message);
  } finally {
    confirmBtn.disabled = false;
    progress.style.display = 'none';
  }
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Sanitize an email subject for use in filenames.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeSubject(raw) {
  let s = raw.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
  if (!s) s = 'no_subject';
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

/**
 * Build a .msg filename from sanitized components.
 * @param {string} subject - sanitized subject
 * @param {string} author
 * @param {string} date - YYYYMMDD
 * @returns {string}
 */
function buildMsgFilename(subject, author, date) {
  return subject + '.email.' + author + '.' + date + '.msg';
}

/**
 * Update the selection count display and button state.
 */
function updateSelectionCount() {
  const countEl = document.getElementById('email-selected-count');
  const logBtn = document.getElementById('email-log-btn');
  const suffix = selectedEmails.size !== 1 ? 's' : '';
  if (countEl) countEl.textContent = selectedEmails.size + ' email' + suffix + ' selected';
  if (logBtn) logBtn.disabled = selectedEmails.size === 0;
}

/**
 * Render an error message in the folder panel.
 * @param {string} msg
 */
function renderError(msg) {
  const container = document.getElementById('email-folders');
  if (container) {
    clearChildren(container);
    container.appendChild(el('p', { style: 'padding:16px;color:red' }, 'Error: ' + msg));
  }
}
```

- [ ] **6b. Add email logger CSS to `app/css/style.css`**

Append the following at the end of the file (before the closing `@media print` block):

```
old_string:
/* --- Print --- */
@media print {

new_string:
/* --- Email Logger Modal --- */
.email-logger-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.email-logger-modal {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 100%;
  max-width: 960px;
  height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 4px 4px 0 var(--fg);
}

.email-logger-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.email-logger-header h2 {
  font-size: 14px;
  font-weight: 700;
}

.email-logger-close {
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--fg);
}

.email-logger-close:hover {
  background: var(--bg-hover);
}

.email-logger-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.email-logger-folders {
  width: 260px;
  min-width: 200px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px 0;
  flex-shrink: 0;
}

.email-logger-content {
  flex: 1;
  overflow-y: auto;
}

.email-logger-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.email-logger-loading {
  padding: 16px;
  color: #888;
  font-size: 12px;
}

/* Folder tree */
.email-folder-tree {
  list-style: none;
  padding: 0;
  margin: 0;
}

.email-folder-tree ul {
  list-style: none;
  padding-left: 16px;
  margin: 0;
}

.email-folder-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 12px;
}

.email-folder-toggle {
  font-size: 10px;
  width: 14px;
  text-align: center;
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}

.email-folder-label {
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--radius);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.email-folder-label:hover {
  background: var(--bg-hover);
}

.email-folder-label.active {
  background: var(--bg-active);
  color: var(--fg-active);
}

.email-folder-count {
  font-size: 10px;
  color: #888;
}

.email-folder-label.active .email-folder-count {
  color: var(--fg-active);
}

/* Email list table */
.email-list-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.email-list-table th {
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.email-list-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #e8e8e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
}

.email-list-table td:first-child,
.email-list-table td:last-child {
  max-width: none;
  width: 30px;
  text-align: center;
}

.email-list-table td:nth-child(2) {
  max-width: 0;
  width: 100%;
}

.email-row {
  cursor: pointer;
  transition: background 0.1s;
}

.email-row:hover {
  background: var(--bg-hover);
}

.email-row.tracked {
  opacity: 0.5;
}

.email-subject-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.email-tracked-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 4px;
  border: 1px solid #ccc;
  border-radius: var(--radius);
  color: #888;
  flex-shrink: 0;
}

/* Email preview */
.email-preview {
  padding: 16px;
}

.email-preview-back {
  font-size: 12px;
  margin-bottom: 12px;
}

.email-preview-select {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
  font-size: 12px;
}

.email-tracked-notice {
  font-size: 12px;
  color: #888;
  font-style: italic;
  margin-bottom: 12px;
}

.email-preview-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin-bottom: 16px;
  font-size: 12px;
}

.email-preview-meta dt {
  font-weight: 700;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.05em;
  color: #555;
}

.email-preview-meta dd {
  word-break: break-all;
}

.email-preview-body {
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid #e8e8e8;
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.email-preview-attachments {
  list-style: none;
  padding: 0;
  font-size: 12px;
}

.email-preview-attachments li {
  padding: 3px 0;
  border-bottom: 1px solid #e8e8e8;
}

/* Log confirmation */
.email-log-confirm {
  padding: 16px;
}

.email-log-confirm h3 {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 16px;
}

.email-log-confirm h4 {
  font-size: 12px;
  font-weight: 700;
  margin: 12px 0 6px;
}

.email-log-list {
  list-style: none;
  padding: 0;
  font-size: 12px;
  margin-bottom: 16px;
}

.email-log-list li {
  padding: 4px 0;
  border-bottom: 1px solid #e8e8e8;
}

.email-log-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

/* Mobile stacking */
@media (max-width: 767px) {
  .email-logger-body {
    flex-direction: column;
  }

  .email-logger-folders {
    width: 100%;
    min-width: 0;
    max-height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}

/* --- Print --- */
@media print {
```

- [ ] **6c. Commit:** `"feat: add email logger modal with folder tree, email list, preview, and log confirmation"`

---

## Task 7: Frontend — Email detail in existing modal + bidirectional linking

Modify the existing modal module to display email entries properly in the detail view and allow editing references (bidirectional linking).

- [ ] **7a. Update `showDetailModal` in `app/js/modules/modal.js` to handle email type**

```
old_string:
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

new_string:
  if (entry.type === 'task') {
    rows.push(['Status', (entry.status || 'queued').replace(/_/g, ' ')]);
    rows.push(['Deadline', entry.deadline ? formatDate(entry.deadline) : '—']);
  }
  if (entry.type === 'email') {
    rows.push(['From', entry.from || '—']);
    rows.push(['To', (entry.to || []).join(', ') || '—']);
    if (entry.cc && entry.cc.length) rows.push(['CC', entry.cc.join(', ')]);
    rows.push(['Subject', entry.subject || '—']);
    if (entry.hasAttachments && entry.attachments && entry.attachments.length) {
      rows.push(['Attachments', entry.attachments.join(', ')]);
    }
  }
  if (entry.origin_note) {
    rows.push(['Origin Note', entry.origin_note]);
  }
  // Show references if present
  if (entry.references && Object.keys(entry.references).length) {
    for (const [key, val] of Object.entries(entry.references)) {
      const display = Array.isArray(val) ? val.join(', ') : val;
      rows.push([key.replace(/_/g, ' '), display]);
    }
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
  if (entry.type === 'email' && entry.bodyPreview) {
    body.appendChild(el('hr', {}));
    const pre = el('pre', { class: 'entry-body-content' });
    pre.textContent = entry.bodyPreview;
    body.appendChild(pre);
  } else if (entry.body) {
    body.appendChild(el('hr', {}));
    const pre = el('pre', { class: 'entry-body-content' });
    pre.textContent = entry.body;
    body.appendChild(pre);
  }
```

- [ ] **7b. Update `showEditModal` to handle email type (references only, no rename)**

For email entries, the edit modal should only allow editing references. Add this at the beginning of `showEditModal`, right after the function declaration:

```
old_string:
export function showEditModal(entry) {
  const form = el('form', { class: 'modal-form', id: 'edit-form' });

  // Title
  const titleInput = el('input', {

new_string:
export function showEditModal(entry) {
  // Email entries: only allow editing references
  if (entry.type === 'email') {
    showEmailEditModal(entry);
    return;
  }

  const form = el('form', { class: 'modal-form', id: 'edit-form' });

  // Title
  const titleInput = el('input', {
```

- [ ] **7c. Add the `showEmailEditModal` function — add it right before the `showConfirmModal` function**

```
old_string:
// ----------------------------------------------------------------
// Confirm Modal
// ----------------------------------------------------------------

/**
 * Show a confirmation modal with a message and confirm/cancel buttons.

new_string:
// ----------------------------------------------------------------
// Email Edit Modal (references only)
// ----------------------------------------------------------------

/**
 * Show an edit modal for email entries (only references can be edited).
 * @param {object} entry - the email entry object
 * @returns {void}
 */
async function showEmailEditModal(entry) {
  const form = el('form', { class: 'modal-form', id: 'edit-email-form' });

  // Show current references
  const refs = entry.references || {};

  // Linked entry dropdown — load entries from same project
  let projectEntries = [];
  try {
    const res = await fetch('/api/entries?project=' + encodeURIComponent(entry.project));
    projectEntries = await res.json();
  } catch { /* empty */ }

  const linkedSelect = el('select', { id: 'edit-email-link' });
  linkedSelect.appendChild(el('option', { value: '' }, '(none)'));
  for (const e of (Array.isArray(projectEntries) ? projectEntries : [])) {
    if (e.filename === entry.filename) continue; // skip self
    const opt = el('option', { value: e.filename },
      (e.title || '').replace(/_/g, ' ') + ' (' + e.type + ')');
    if (refs.linked_entry === e.filename) opt.selected = true;
    linkedSelect.appendChild(opt);
  }

  form.appendChild(el('div', { class: 'form-row' },
    el('label', { for: 'edit-email-link' }, 'Linked Entry'),
    linkedSelect,
  ));

  // Show info that only references can be edited
  form.appendChild(el('p', { class: 'form-hint' }, 'Email entries can only have their references edited.'));

  // Footer
  const saveBtn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Save');
  const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
  cancelBtn.addEventListener('click', () => showDetailModal(entry));

  saveBtn.addEventListener('click', async () => {
    const linkedValue = linkedSelect.value;
    const newRefs = { ...refs };
    if (linkedValue) {
      newRefs.linked_entry = linkedValue;
    } else {
      delete newRefs.linked_entry;
    }

    saveBtn.disabled = true;
    try {
      await updateEntry(entry.project, entry.filename, { references: newRefs });
      closeModal();
      document.dispatchEvent(new CustomEvent('data:refresh'));
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('entry:open', {
          detail: { ...entry, references: newRefs },
        }));
      }, 300);
    } catch (err) {
      alert('Error saving: ' + err.message);
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
```

- [ ] **7d. Add "Linked Emails" field to the existing edit modal for task/log/note entries**

In the `showEditModal` function, add a "Linked Emails" dropdown after the body textarea. Insert before the live filename preview update section:

```
old_string:
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

new_string:
  // Linked Emails select (optional — populated async)
  const linkedEmailsSelect = el('select', { id: 'edit-linked-emails', multiple: true, style: 'min-height:60px' });
  const linkedEmailsRow = el('div', { class: 'form-row' },
    el('label', { for: 'edit-linked-emails' }, 'Linked Emails'),
    linkedEmailsSelect,
    el('p', { class: 'form-hint' }, 'Ctrl+click to select multiple'),
  );

  // Load email entries for the project asynchronously
  (async () => {
    try {
      const res = await fetch('/api/entries?project=' + encodeURIComponent(entry.project) + '&type=email');
      const emailEntries = await res.json();
      const currentLinked = entry.references && entry.references.linked_emails
        ? (Array.isArray(entry.references.linked_emails) ? entry.references.linked_emails : [entry.references.linked_emails])
        : [];
      for (const e of (Array.isArray(emailEntries) ? emailEntries : [])) {
        const opt = el('option', { value: e.filename }, (e.title || '').replace(/_/g, ' '));
        if (currentLinked.includes(e.filename)) opt.selected = true;
        linkedEmailsSelect.appendChild(opt);
      }
    } catch { /* no email entries available */ }
  })();

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
  form.appendChild(linkedEmailsRow);
```

- [ ] **7e. Update the save handler in `showEditModal` to include linked_emails in references**

```
old_string:
    const updates = { title, date: dateStr, author, body };

    if (entry.type === 'task') {
      updates.status = statusSelect.value;
      const dl = deadlineInput.value;
      updates.deadline = dl ? dl.replace(/-/g, '') : null;
    }

new_string:
    const updates = { title, date: dateStr, author, body };

    if (entry.type === 'task') {
      updates.status = statusSelect.value;
      const dl = deadlineInput.value;
      updates.deadline = dl ? dl.replace(/-/g, '') : null;
    }

    // Include linked emails in references
    const selectedLinkedEmails = Array.from(linkedEmailsSelect.selectedOptions).map(o => o.value);
    const refs = { ...(entry.references || {}) };
    if (selectedLinkedEmails.length > 0) {
      refs.linked_emails = selectedLinkedEmails;
    } else {
      delete refs.linked_emails;
    }
    if (Object.keys(refs).length > 0) {
      updates.references = refs;
    }
```

- [ ] **7f. Commit:** `"feat: add email detail view in modal and bidirectional linking"`

---

## Task 8: Frontend — Wiring (hotkeys, search, HTML, app.js)

Wire the email logger into the app entry points: header button, keyboard shortcut, search tags, and app initialization.

- [ ] **8a. Update `app/index.html` — add "Log Email" button**

```
old_string:
      <button id="btn-create" title="New Entry (Ctrl+N)">+ New</button>
      <button id="btn-history" title="Action History">History</button>

new_string:
      <button id="btn-create" title="New Entry (Ctrl+N)">+ New</button>
      <button id="btn-email" title="Log Email (Ctrl+E)">Log Email</button>
      <button id="btn-history" title="Action History">History</button>
```

- [ ] **8b. Update `app/js/modules/hotkeys.js` — add Ctrl+E handler**

Import `showEmailLogger`:

```
old_string:
import { getState, setState } from './state.js';
import { showCreateModal, closeModal } from './modal.js';

new_string:
import { getState, setState } from './state.js';
import { showCreateModal, closeModal } from './modal.js';
import { showEmailLogger } from './email-logger.js';
```

Add Ctrl+E handler after the Ctrl+N block:

```
old_string:
    // Ctrl+N — open create modal
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      showCreateModal();
      return;
    }

    // Escape — close modal, then history panel, then clear search

new_string:
    // Ctrl+N — open create modal
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      showCreateModal();
      return;
    }

    // Ctrl+E — open email logger
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault();
      showEmailLogger();
      return;
    }

    // Escape — close modal, then history panel, then clear search
```

- [ ] **8c. Update `app/js/modules/search.js` — add 'email' to TAG_DEFS type list**

```
old_string:
  'type': () => ['task', 'log', 'note'],

new_string:
  'type': () => ['task', 'log', 'note', 'email'],
```

- [ ] **8d. Update `app/js/app.js` — import email-logger, bind Log Email button, handle shortcut**

Add the import:

```
old_string:
import { initHotkeys } from './modules/hotkeys.js';

new_string:
import { initHotkeys } from './modules/hotkeys.js';
import { showEmailLogger } from './modules/email-logger.js';
```

Add button binding inside `init()`:

```
old_string:
  const btnCommit = document.getElementById('btn-git-commit');
  if (btnCommit) btnCommit.addEventListener('click', showCommitModal);

new_string:
  const btnEmail = document.getElementById('btn-email');
  if (btnEmail) {
    // Disable button if Outlook not available (check async)
    if (typeof window.outlookAPI !== 'undefined') {
      window.outlookAPI.checkAvailable().then(result => {
        if (!result || !result.available) {
          btnEmail.disabled = true;
          btnEmail.title = 'Outlook not available';
        }
      });
    } else {
      btnEmail.disabled = true;
      btnEmail.title = 'Only available in desktop app';
    }
    btnEmail.addEventListener('click', showEmailLogger);
  }

  const btnCommit = document.getElementById('btn-git-commit');
  if (btnCommit) btnCommit.addEventListener('click', showCommitModal);
```

Handle the `email-logger` shortcut from the Electron menu:

```
old_string:
  // Global event listeners
  document.addEventListener('entry:open', e => {

new_string:
  // Listen for menu shortcuts (Electron sends these via electronAPI)
  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.onShortcut) {
    window.electronAPI.onShortcut((action) => {
      if (action === 'email-logger') showEmailLogger();
    });
  }

  // Global event listeners
  document.addEventListener('entry:open', e => {
```

- [ ] **8e. Commit:** `"feat: wire email logger into hotkeys, search, HTML, and app.js"`

---

## Task 9: Integration test

Manual integration test to verify the full email logging flow end-to-end.

- [ ] **9a. Test Outlook availability check**
  - Launch the app in Electron
  - Verify the "Log Email" button is enabled if Outlook is installed, disabled with tooltip otherwise

- [ ] **9b. Test folder browsing**
  - Click "Log Email" (or press Ctrl+E)
  - Verify folder tree loads and displays all Outlook folders
  - Click folders to expand/collapse
  - Click a folder to load emails in right panel

- [ ] **9c. Test email list**
  - Verify emails appear with subject, from, date, attachment icon
  - Verify already-tracked emails show "tracked" badge and disabled checkbox
  - Select/deselect emails with checkboxes
  - Verify selection count updates in bottom bar

- [ ] **9d. Test email preview**
  - Click an email row (not checkbox) to see preview
  - Verify from, to, cc, date, subject, body, attachments display correctly
  - Click back button, verify selections preserved
  - Use preview checkbox to select/deselect

- [ ] **9e. Test log flow**
  - Select 1-3 emails, click "Log Selected"
  - Choose a project, optionally link to an entry
  - Click "Confirm"
  - Verify progress indicator appears
  - Verify modal closes and timeline refreshes
  - Verify `.msg`, `.meta.json`, and attachments folder created in project directory

- [ ] **9f. Test email detail in timeline**
  - Click the logged email entry in the timeline
  - Verify detail modal shows from, to, cc, subject, body preview, attachments, references
  - Click "Edit" -- verify only references dropdown shown
  - Save a reference change, verify it persists

- [ ] **9g. Test bidirectional linking**
  - Edit a task/log/note entry
  - Verify "Linked Emails" multi-select appears with email entries from same project
  - Select an email, save
  - Verify the reference appears in the detail modal

- [ ] **9h. Test search**
  - Type `type:email` in search bar
  - Verify autocomplete suggests "email"
  - Verify email entries appear in results
  - Search by email sender name, verify it matches

- [ ] **9i. Test deletion**
  - Open an email entry detail, click Delete
  - Confirm deletion
  - Verify `.msg`, `.meta.json`, and attachments folder are all removed

- [ ] **9j. Test edge cases**
  - Log an email with no subject (should use "no_subject")
  - Log an email with a very long subject (should truncate to 80 chars)
  - Log an email with special characters in subject (should be sanitized)
  - Verify re-logging a tracked email is prevented (checkbox disabled, greyed out)
