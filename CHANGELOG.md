# Changelog

All notable changes to CK3 Character Gallery will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [3.1.0] - 2026-07-31

### Added
- Name colors, title glow customization, title color picker to character cards.
- Animated GIF support.
- Animated WebM support.
- Live portrait feature that record a user-defined frame in CK3 as animated WebM to use as an animated portrait. Has a smart 'smooth loop' feature that keep passively recording after the recording ends within a user-defined time window, scores candidate frames across that recording window, selects the best one at the end, and remuxes the WebM to that boundary so that the looping animation of the character portrait can appear as smooth as possible without sudden jerks/resets back to first frame.

## [3.0.2] - 2026-07-22

### Fixed
- Fix app icon bug introduced in 3.0.1. See #10 and #12.

## [3.0.1] - 2026-07-18

### Added
- Add app icon for the packaged build.
- Adds the ability to move/batch move character cards between Collections/Galleries.
- Adds the ability to batch select Collections/Galleries and the ability to batch remove them
- Adds the ability to shortcut delete the selected Collection by clicking DEL on keyboard.
- Clicking outside of the COLLECTIONS left pane while in Collections batch selection mode will now cancel out batch selection mode.
- Add a batch selection mode indicator when in Collections batch select mode by displaying the numbers of currently selected Collections next to 'COLLECTIONS' on the left pane

### Fixed
- Fixes the "Open DNA Workbench" button disappearing when there are 15+ collections. See #6 and #8.

## [3.0.0] - 2026-07-15

Version 3 is a rewrite. Built with Electron 43. It keeps the local gallery idea and the existing development data, but updated to be more aesthetically pleasing and with more intuitive controls and tools.

These notes cover changes since the `v.2.0.1` tag.

### Added

#### Application Shell
- Electron main process with context-isolated preload bridge, replacing the Tkinter interface.
- Custom title bar and File, Edit, View, and Help menus.
- Card and compact-list views.
- Right click menus for collections, character cards, and table rows.
- In Compact list view, hovering over portrait entries will display a large preview of the portrait.
- Morph-preserved modal roots so live editor state survives unrelated re-renders.
- Scoped selection, modal, chrome, and context-menu rendering.
- Empty default state and a non-persistent sample collection for an empty archive.

#### Browsing the Archive
- Search across character names, titles, and tags.
- Combined toolbar panel; DNA status, Favorites only, and multiple tags can be combined with AND logic.
- Recent, oldest, alphabetical, and per-collection Custom sorting with drag-and-drop.
- Favorites stored in the local Electron profile with filled yellow stars (won't persist in Exported galleries/collections).
- Choosing a blank space will deselect whatever you have selected in the app, for intuitivity.

#### Character Records
- New dialogs for creating characters and collections.
- Sidebar and right-click controls to rename, duplicate, and delete collections.
- Drag-and-drop collection ordering in the sidebar.
- Notes can also act as a tag editor, `#`-prefixed words become tags and are highlighted, and searchable.
- Character card customizations with name color and title glow.
- DNA workbench with Clear DNA, Homogenize DNA, and local Ctrl+Z undo / Ctrl+Y redo history.
- Automatic local saves after record changes, with Ctrl+S for an explicit save.

#### Portraits and Variants
- Ctrl+V opens the new-character prompt when an image is in copy clipboard but no character is selected, the image continues into the crop window after naming. If a character is selected and CK3 DNA strings is copied, then paste the DNA into the selected character card instead, continuing into the DNA workbench with the DNA for confirmation.
- Ctrl+C when selecting a character card with DNA data copies its DNA; right-click Copy DNA and Paste DNA with confirmation before overwriting existing DNA.
- Standardized cropped clipboard portraits at 450x450 PNG.
- Portrait variant selection in the right pane with per-thumbnail image and large preview switching on selection.
- Delete acts on the selected portrait, with a separate confirmation dialog.

#### Data and Desktop Integration
- Export now uses a Save-style dialog with the collection folder name prefilled; no longer requires selecting a folder to save into.
- JSON saves written to a temporary file before replacing `galleries.json`.
- Timestamped recovery copies and persistent warnings when `galleries.json` is corrupt.
- Visible save-failure reporting and strict portrait copy errors for crop, export, import, and duplication.
- Portable folder export with `characters.json`, `gallery.json`, and copied per-character portraits.
- Import compatibility with v2 folders containing `characters.json` and images but no `gallery.json`.

### Fixed

- Duplicate character duplication now copies portrait files to independent paths, preventing data loss when the original is deleted.
- Corrupt galleries.json is renamed with a timestamp before recovery, preventing accidental overwrite.
- Archive-load failures and corruption now surface as persistent UI warnings and toasts instead of being silently swallowed.
- Character, batch, collection, and variant deletion save metadata first and remove only unreferenced portrait files.
- Export, import, and duplication now fail loudly when portrait copies fail instead of silently dropping files.