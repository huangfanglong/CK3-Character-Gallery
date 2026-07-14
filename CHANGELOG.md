# Changes from 2.0 to 3.0

Version 3 is a rewrite. Built with Electron 43. It keeps the local gallery idea and the existing development data, but updated to be more aesthetically pleasing and with some more intuitive controls & tools.

These notes start at the `v.2.0.1` tag and end at the current v3.

## The Application Shell

- Replaced the Tkinter interface with an Electron main process, a context-isolated preload bridge, and a dependency-light HTML/CSS/JavaScript renderer.
- Added a custom title bar and File, Edit, View, and Help menus that match the rest of the interface.
- Removed the redundant View menu command for hiding the character inspector and added Help shortcut hints.
- Split the window into collection navigation, the character archive, and a character inspector.
- Added themed right-click menus for collections, character cards, and table rows.
- Added card and compact-list views.
- Added a large, viewport-aware portrait preview when hovering over a thumbnail in compact-list view. Previewing does not select the character or shift the table layout.
- Made the main shell fill the window and adjusted the layout for narrower desktop sizes.
- Added an empty inspector state and a non-persistent sample collection for an empty archive.
- Split renderer state, templates, modal workflows, DNA workbench, crop editor, and persistence into focused browser modules while keeping the renderer smoke surface stable.
- Consolidated repeated selection resets, portrait-limit checks, drag-and-drop wiring, and Enter-to-confirm keyboard routing.
- Removed the unused ME account badge, removed the empty inspector's Study a character heading, and renamed its creation action to New character.
- Standardized Import collection wording in the File menu and sidebar.

## Browsing the Archive

- Added search across character names, titles, and tags.
- Replaced the native Sort by select with a dark themed, animated option menu whose trigger responds to hover, press, and open states.
- Made the large archive heading display the active collection name and update immediately after collection changes.
- Kept `tag:` and `tags:` searches. Comma-separated `tags:` queries now require every listed tag.
- Replaced the single mutually exclusive archive filter with a toolbar panel that combines one DNA status, Favorites only, and multiple tags using AND logic.
- Added live filter result totals, Clear all and Done controls, and a badge that counts the active filter controls without treating free-text search as a filter.
- Kept the sidebar and archive chips as quick controls while allowing favorites and DNA status to remain independently combinable.
- Added recent, oldest, and alphabetical sorting.
- Added per-collection Custom sorting. Dragging one of two or more visible cards changes the displayed order, switches the collection to Custom, and saves both the mode and character order.
- Added favorites stored in the local Electron profile.
- Filled active favorite stars in yellow instead of changing only the outline color.
- Added blank-space deselection so the inspector can be cleared without choosing another record.
- Replaced missing portrait artwork with a neutral gray silhouette.
- Simplified the archive header to show only the collection count instead of duplicate Shown and In Collection counts.

## Character Records

- Added dialogs for creating characters and collections.
- Added sidebar and right-click controls to rename collections and delete any collection except the last one.
- Added collection duplication with new character IDs and copied portrait files.
- Added drag-and-drop collection ordering in the sidebar and persisted the resulting gallery-array order.
- Added record management for rename, duplicate, and delete.
- Made character duplication copy portrait files into the new character directory instead of sharing paths with the original.
- Added explicit multi-select mode with Select shown, Delete selected, and Cancel controls for batch character deletion.
- Added Windows-style `Ctrl+Click` multi-selection, with `Command+Click` support on macOS. Starting from a selected character retains it when a second character is added.
- Added a confirmation step before character deletion, including `Enter` to confirm and `Escape` to cancel.
- Added notes to character records.
- Made Notes the tag editor: comma- or whitespace-terminated words beginning with `#` are highlighted in orange, normalized into the character tag list on save, and available to tag search.
- Added an inline optional title editor to the inspector. Empty titles render no subtitle, and the old `Uncatalogued character` fallback is treated as empty.
- Moved raw DNA editing into a focused workbench and kept one-click DNA copy in the inspector.
- Enlarged the DNA workbench and restored Clear DNA and Homogenize DNA beside the save action. Homogenize uses v2's allele-copying behavior, now including a nested first gene written on the same line as `genes={`, and preserves the editor's scroll position. Both tools leave persistence to Save DNA.
- Added workbench-local `Ctrl+Z` undo and `Ctrl+Y` redo history for typing, pasted replacements, Clear DNA, and Homogenize DNA. New edits after undo discard the abandoned redo branch.
- Derived DNA-ready and draft status from whether the record contains a DNA string.
- Added automatic local saves after record changes, while retaining `Ctrl+S` for an explicit save.

## Portraits and Variants

- Kept the five-portrait limit from v2.
- Added portrait intake through the native file chooser.
- Added `Ctrl+V` support for clipboard bitmaps, copied image files, file paths, and `text/uri-list` entries.
- Made `Ctrl+V` open the new-character prompt when an image is available but no character is selected. The image continues into the crop window after the record is named.
- Made `Ctrl+V` recognize structured CK3 portrait DNA and long valid base64 payloads when a character is selected. The workbench opens prefilled with Save DNA focused, and Enter commits the value.
- Made valid clipboard DNA open the new-character prompt when no character is selected. Naming it creates a DNA-ready record with no portrait.
- Made `Ctrl+C` copy DNA from a selected DNA-ready character and added Copy DNA and Paste DNA to the character right-click menu. Pasting over existing DNA asks for confirmation and still requires Save DNA to commit the replacement.
- Added a crop window for pasted portraits with drag positioning, reset, and 100-300% zoom.
- Added mouse-wheel crop zoom in 10% steps, synchronized with the existing slider and percentage readout.
- Standardized cropped clipboard portraits at 450 x 450 PNG.
- Added a variant strip to the inspector. Each thumbnail displays its own image and changes the large preview when selected.
- Made portrait thumbnails keyboard-focusable.
- Made `Delete` act on the focused variant when a variant is selected, with a separate confirmation dialog. Selecting the character card again restores character-level deletion.
- Added safe portrait-file deletion that refuses paths outside the archive image directory.
- Made character, batch, collection, and variant deletion persist record removal before deleting only portrait files that are no longer referenced anywhere in the archive.
- Added previous and next controls to character cards with a visible position such as `2/4`.
- Removed the redundant portrait-count label from cards; multi-portrait cards keep the smaller cycle position and arrows.
- Added `coverIndex` to remember the portrait used on a card. Adding or deleting variants keeps the index in range.

## Inspector and Window Behavior

- Kept Copy DNA and Open Workbench fixed to the bottom of the inspector.
- Made portrait variants and notes scroll above those actions instead of moving them off-screen.
- Added themed toast messages, dialogs, delete states, and menu popovers.
- Added keyboard focus restoration after dialogs and portrait selection.
- Renamed the inspector heading from CHARACTER STUDY to CHARACTER and widened the DNA workbench again for long DNA strings.
- Preserved archive, sidebar, and inspector scroll offsets across renderer updates. Selecting lower-row cards or clearing selection no longer moves the middle pane.
- Replaced Chromium's white and gray scrollbars with dark archive tracks and muted sage thumbs throughout the app.

## Data and Desktop Integration

- Continued to use `character_gallery_data/galleries.json` and per-character image directories during development.
- Changed JSON saves to write a temporary file before replacing `galleries.json`.
- Added timestamped recovery copies and a persistent warning when `galleries.json` is corrupt, while keeping missing-file setup separate from read failures.
- Added visible save-failure reporting and strict portrait copy errors for crop, export, import, and duplication operations instead of silently dropping files.
- Configured packaged builds to use Electron's application data directory.
- Added a command to open the local archive folder.
- Added portable folder export with `characters.json`, `gallery.json`, and copied per-character portraits.
- Replaced the export folder picker with a Save-style dialog that prefills the collection directory name, allowing export into the currently viewed destination without navigating back to its parent or manually creating a folder first.
- Made exported folders directly importable. Round trips preserve portraits, DNA, notes, titles, colors, tags, timestamps, cover selection, and collection sort mode.
- Allowed import to resolve a single collection export inside the selected parent folder, matching the destination level chosen during export.
- Kept import compatibility with v2 folders that contain `characters.json` and images but no `gallery.json`.
- Kept the renderer behind a small preload API instead of enabling Node.js in the page.
- Isolated renderer smoke tests in an OS temporary archive and ignored the entire development data directory so tests and normal Git commits do not read, write, or include personal gallery records.

## Keyboard Shortcuts

The v3 currently handles:

- `Ctrl+N`: new character
- `Ctrl+F`: search
- `Ctrl+S`: save
- `Ctrl+D`: duplicate the selected character
- `Ctrl+E`: export the active collection
- `Ctrl+V`: paste a portrait, create a character from an image, or open copied DNA
- `Ctrl+C`: copy DNA from the selected character
- `Ctrl+Z`: undo the last DNA workbench edit
- `Ctrl+Y`: redo the last undone DNA workbench edit
- `F2`: manage the selected record
- `Delete`: delete the focused variant, selected character, or current batch
- `Enter`: confirm deletion
- `Escape`: close a dialog or menu, or leave batch selection

Command-key equivalents are handled on macOS.

## Tests Added During the Rewrite

- Added JavaScript syntax checks for the Electron main process, preload script, and renderer.
- Added an Electron renderer smoke test through the Chrome DevTools Protocol.
- Added an isolated filesystem round-trip test for collection metadata and portraits.
- Covered character selection, custom card ordering, collection right-click menus and ordering, safe collection duplication, saved sort mode, DNA undo/redo history and scroll position, DNA copy/paste confirmation, themed scrollbars, batch deletion, collection rename/delete, search, menus, shortcuts, notes, delete confirmation, blank-space deselection, clipboard crop plumbing, distinct portrait variants, variant focus, cover cycling, and full-height window layout.
- Tested live Windows clipboard paste separately with an image file copied from Explorer.
- Ran `npm audit --audit-level=high` with no high-severity dependency findings at the time of this writing.
