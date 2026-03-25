# Email Integration — Design Spec

## Overview

Integrate Outlook email logging into the Productivity System. Emails become a first-class entry type (`email`) — users manually select emails from Outlook to log into projects. Emails are saved as `.msg` files with attachments and metadata, viewable in the app, searchable, and linkable to other entries (tasks, logs, notes). The Outlook COM API is accessed via PowerShell scripts spawned from Electron's main process.

## Decisions

| Decision | Choice |
|----------|--------|
| Entry type | New first-class `email` type alongside task, log, note |
| Storage | `.msg` file + `.meta.json` sidecar + `attachments/` folder |
| Outlook access | PowerShell + COM API (zero additional dependencies) |
| Folder browsing | Tree view of all Outlook folders |
| Attachment handling | All attachments auto-saved alongside .msg |
| Referencing | Bidirectional — link emails to entries and entries to emails, both optional |
| Tracked indicator | Shown but greyed out, not re-loggable |
| Email preview | Inline in selection panel, click row to preview, back button preserves checkbox state |

## Data Structure

### File layout per logged email

```
projects/{Project}/
  {Subject}.email.{author}.{YYYYMMDD}.msg              # Outlook .msg file
  {Subject}.email.{author}.{YYYYMMDD}.meta.json         # Metadata sidecar
  {Subject}.email.{author}.{YYYYMMDD}/                   # Attachments folder
    attachment1.pdf
    attachment2.docx
```

### Filename convention

Pattern: `{Subject}.email.{author}.{YYYYMMDD}.msg`

- Subject: sanitized (spaces → underscores, unsafe chars stripped, max 80 chars)
- author: lowercase surname
- YYYYMMDD: email sent date
- The `.msg` file is the canonical entry; the `.meta.json` is the sidecar

### Sidecar `.meta.json` schema

```json
{
  "from": "sender@example.com",
  "to": ["recipient@example.com"],
  "cc": ["cc@example.com"],
  "subject": "Original Subject Line",
  "date": "YYYYMMDD",
  "outlookEntryId": "00000000...",
  "hasAttachments": true,
  "attachments": ["attachment1.pdf", "attachment2.docx"],
  "bodyPreview": "First 200 chars of body text...",
  "references": {
    "linked_task": "Some_Task.task.liaskos.20260320.json",
    "linked_log": "Some_Log.log.liaskos.20260320.json"
  }
}
```

### Filename parsing regex (updated)

The existing regex must be extended to include `email`:

```
/^(.+)\.(task|log|note|email)\.(?:([a-z]+)\.)?(\d{8})\.(json|md|msg)$/
```

After parsing, `parseFilename` must cross-validate type/extension pairs: `task`→`json`, `log`→`json`, `note`→`md`, `email`→`msg`. Reject any mismatch.

Note: `.meta.json` sidecar files do NOT match this regex (their extension is `.meta.json`, not `.json`), so they are naturally skipped by the directory iterator. To read a sidecar, construct the path as `filename.replace('.msg', '.meta.json')`.

### `buildFilename` update

`buildFilename` must handle `type === 'email'` returning `msg` extension:

```js
const ext = type === 'note' ? 'md' : type === 'email' ? 'msg' : 'json';
```

### Email subject sanitization

Email subjects are sanitized via `sanitizeTitle` but with additional rules:
- **Max 80 characters** after sanitization (truncate)
- **Empty fallback**: if sanitized result is empty (e.g., subject was `[???]`), use `no_subject`
- **Duplicate handling**: if the resulting filename already exists in the target project, append `_2`, `_3`, etc. to the subject component

### Tracking already-logged emails

The `outlookEntryId` field in `.meta.json` files is the unique identifier. When browsing Outlook folders, the app collects all `outlookEntryId` values from existing `.meta.json` files across all projects and checks incoming email lists against them.

## Outlook Bridge — PowerShell Scripts

Located at `server/outlook/`. Each script is invoked by Electron's main process via `execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], { timeout: 30000 })`. Output is JSON on stdout. All scripts require PowerShell 5.1+ (built into Windows 10/11).

### `list-folders.ps1`

- Input: none
- Output: `[{ "name": "Inbox", "path": "\\\\alexliaskos@geol.uoa.gr\\Inbox", "count": 142, "subfolders": [...] }]`
- Recursively lists all Outlook folders as a tree

### `list-emails.ps1`

- Input: `-FolderPath <path>` `-Limit <n>` (default 50)
- Output: `[{ "entryId": "...", "subject": "...", "from": "...", "to": ["..."], "cc": ["..."], "date": "YYYYMMDD", "hasAttachments": true, "attachmentCount": 2, "bodyPreview": "first 200 chars..." }]`
- Lists emails in a specific folder, most recent first

### `preview-email.ps1`

- Input: `-EntryId <id>`
- Output: `{ "entryId": "...", "subject": "...", "from": "...", "to": ["..."], "cc": ["..."], "date": "YYYYMMDD", "body": "full body text", "attachments": [{ "name": "file.pdf", "size": 12345 }] }`
- Gets full email content for preview (without saving to disk)

### `export-email.ps1`

- Input: `-EntryId <id>` `-DestPath <path>` `-MsgFilename <filename>`
- `DestPath` is the absolute path to the project folder. The script saves `{DestPath}\{MsgFilename}` and creates attachments at `{DestPath}\{MsgFilename without .msg}\`
- Output: `{ "msgPath": "...", "attachments": ["filename1.pdf", "filename2.docx"] }` (attachment values are bare filenames, no path separators)
- Saves the .msg file using Outlook's `SaveAs` method (olMSG format = 3)
- Saves all attachments to the subfolder

### Error handling

All scripts wrap operations in try/catch and output `{ "error": "message" }` on failure. The Electron main process checks for the `error` key before forwarding results to the renderer.

### Outlook availability check

On app startup, a lightweight registry check determines if Outlook is installed (without launching it):
```powershell
try {
  $key = Get-Item 'HKLM:\SOFTWARE\Microsoft\Office\*\Outlook' -ErrorAction SilentlyContinue
  if ($key) { Write-Output '{"available":true}' }
  else { Write-Output '{"available":false,"error":"Outlook not installed"}' }
} catch { Write-Output '{"available":false,"error":"Check failed"}' }
```

If Outlook isn't installed, the "Log Email" button is disabled with a tooltip. The full COM connection (which may launch Outlook) only happens when the user actually clicks "Log Email".

## Electron IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `outlook:check-available` | renderer → main → renderer | Check if Outlook COM is accessible |
| `outlook:list-folders` | renderer → main → renderer | Get folder tree |
| `outlook:list-emails` | renderer → main → renderer | Get emails for a folder path |
| `outlook:preview-email` | renderer → main → renderer | Get full email content for preview |
| `outlook:log-emails` | renderer → main → renderer | Export selected emails to project folder |
| `outlook:get-tracked-ids` | renderer → main → renderer | Get all outlookEntryIds from existing .meta.json files |

The main process handles these via `ipcMain.handle()`. The preload script exposes them under a new `outlookAPI` namespace via `contextBridge.exposeInMainWorld('outlookAPI', {...})`, separate from the existing `electronAPI`.

### `outlook:get-tracked-ids` implementation

The main process calls the internal HTTP API (`GET /api/entries?type=email`) and extracts `outlookEntryId` from each result's metadata. This avoids duplicating filesystem logic.

## Frontend UI

### Header

New button: **"Log Email"** — added after "+ New", before "History". Hotkey: **Ctrl+E** (registered as a menu accelerator in `buildMenu`, sending `shortcut:email-logger` to the renderer — same pattern as Ctrl+N and Ctrl+K).

Disabled with tooltip "Outlook not available" if the COM check fails.

### Email Logger Modal

A modal with two panels side by side (stacked on mobile):

**Left panel: Folder Tree**
- Recursive tree of all Outlook folders
- Each node shows: folder name + unread/total count
- Click to expand/collapse subfolders
- Click a leaf or folder to load its emails in the right panel
- Currently selected folder is highlighted

**Right panel: Email List / Preview**

**List mode (default):**
- Emails listed as rows: checkbox | subject | from | date | attachment icon
- Already-tracked emails: greyed out, "tracked" badge, checkbox disabled
- Click checkbox → select for logging
- Click row (not checkbox) → switch to Preview mode

**Preview mode:**
- Back arrow at top → returns to List mode (selections preserved)
- "Select for logging" checkbox at top
- Displays: from, to, cc, date, subject
- Full body text (plain text rendering)
- Attachment list with filenames and sizes
- Tracked emails show "Already tracked" instead of checkbox

**Bottom bar (persistent across both modes):**
- Shows count: "3 emails selected"
- "Log Selected" button → opens Log Confirmation sub-panel

### Log Confirmation (replaces right panel)

- Target project: dropdown with "+ New Project" option
- Link to entry (optional): dropdown of existing entries in selected project
- List of selected emails with subjects
- "Confirm" button → triggers export
- Progress indicator during export
- On completion: closes modal, refreshes timeline

### Email Detail Modal (timeline click)

When clicking an `email` entry in the timeline, the existing detail modal shows:
- From, To, CC, Date, Subject (from .meta.json)
- Body preview (from .meta.json `bodyPreview` or parsed from .msg)
- Attachments: listed with filenames, clickable to open via `shell.openPath`. Attachment filenames in `.meta.json` are bare filenames only (no path separators). Before opening, the full path is constructed via `safePath(PROJECTS_DIR, project, attachmentsFolder, filename)` to prevent path traversal
- Linked entries: shown as clickable references
- Edit button: allows editing references (link to tasks/logs/notes)
- Delete button: removes .msg + .meta.json + attachments folder

### Bidirectional Linking

**From email (at log time or in edit):** optional dropdown to link to existing entries in the same project.

**From entry (edit modal):** new optional "Linked Emails" field — dropdown of email entries in the same project. The `references` object is a freeform key/value map. Values can be a single filename string or an array of filenames for multiple links:
```json
{
  "references": {
    "origin_note": "Some_Note.note.liaskos.20260315.md",
    "linked_emails": ["Meeting1.email.liaskos.20260315.msg", "Meeting2.email.liaskos.20260316.msg"]
  }
}
```

### Search

- `type:email` tag works in the search bar
- Email entries searchable by subject (from filename title) and from/project (from .meta.json)
- Email entries appear in the timeline like any other entry

## Server-side Changes

### `server/api/utils.js`

- Update `FILENAME_RE` to include `email` type and `msg` extension:
  ```
  /^(.+)\.(task|log|note|email)\.(?:([a-z]+)\.)?(\d{8})\.(json|md|msg)$/
  ```

### `server/api/entries.js`

- `listEntries`: for `email` type, read the `.meta.json` sidecar (path: `filename.replace('.msg', '.meta.json')`) instead of the `.msg` binary. Return sidecar fields merged with parsed filename fields.
- `readEntry`: for emails, return parsed `.meta.json` content (never read the `.msg` binary through the HTTP API).
- `createEntry`: for emails, this is handled by the Electron export flow, not the HTTP API. After `export-email.ps1` completes, the **Electron main process** writes the `.meta.json` sidecar using metadata from the `preview-email.ps1` output combined with user-chosen project/references.
- `updateEntry`: for `email` type, reads and writes the `.meta.json` sidecar only — never touches the `.msg` binary. Renaming (changing subject) is not permitted for email entries; only `references` and metadata can be updated.
- `deleteEntry`: for emails, must delete three things: the `.msg` file, the `.meta.json` sidecar, and recursively delete the attachments folder (folder name = `.msg` filename with `.msg` stripped). All paths constructed via `safePath`.
- `searchEntries`: email search haystack includes: `entry.title`, `entry.type`, `entry.author`, `entry.project`, `entry.from`, `(entry.to || []).join(' ')`, `entry.bodyPreview || ''`

### Frontend modules

- `app/js/modules/utils.js`: update `parseFilename` regex to include `email`/`msg`
- `app/js/modules/email-logger.js`: new module — folder tree, email list, preview, log confirmation
- `app/js/modules/modal.js`: update detail modal to handle email type, add "Linked Emails" field to edit modal
- `app/js/modules/hotkeys.js`: add Ctrl+E for email logger
- `app/js/modules/search.js`: add `email` to TAG_DEFS type list

### MCP Server

- Update `mcp-server/index.js`: extend type enum to include `email`, update filename regex

## Constraints

- **Windows only** — Outlook COM API is Windows-specific. The email feature is gracefully disabled on other platforms.
- **Outlook must be installed** — the COM API requires a local Outlook installation (not just web Outlook).
- **Outlook must be running or launchable** — COM will start Outlook if it's not running.
- **No automatic syncing** — emails are only logged when the user explicitly selects them.
- **.msg files are binary** — they're stored as-is, not converted. The app parses them for display only.

## Out of Scope

- Email sending/replying from within the app
- Calendar/contact integration
- Automatic email-to-task conversion rules
- Email body editing after logging
- macOS/Linux Outlook support
