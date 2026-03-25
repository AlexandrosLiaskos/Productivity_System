A vanilla JavaScript web app for the Productivity System with high cohesion and low coupling, mobile-first, white-bg/black-fg only theme, data-file-first, functional, JSDoc-documented functions and modules.

## Views

- Timeline/history-based data-table as the main view
- Filter for per-project and cross-project views
- Filter for per-type and cross-type views
- Additional entry information accessible via modal on-click
- Global search
- Tag-search for project-search, task-search, note-search, and log-search

## CRUD

- Create modals with fields: title, type, date
- Optional fields: author
- All fields compiled to the filename (the entry ID)
- Body field for content (JSON or markdown, determined automatically by entry type)
- Entry info modals with edit button (file-info/filename + body) and delete button

## Actions & History

- All actions saved on an actions timeline/history
- Rewind capability: every state git-tracked for rollback
- Ability to clear specific or ALL actions history
- Commit and push system actions/functions available

## Hotkeys

- Search hotkey
- Create hotkey

## Additional Considerations

- Keyboard navigation in the data table (arrow keys, Escape to close modals)
- Quick status toggle: click status badge to cycle task states inline
- Deadline indicators: visual markers for upcoming/overdue tasks
- Cross-reference navigation: clickable origin_note references to jump to linked entries
- Diff view in action history: show what changed at each rewind point
- Confirmation dialogs for destructive actions (delete, clear history)
