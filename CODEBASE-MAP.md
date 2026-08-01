# CK3 Character Gallery Codebase Map

Project: Electron desktop archive for browsing and managing CK3 character portraits  
Package version: 3.1.0 | Latest changelog release: 3.1.0

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                            ARCHITECTURE OVERVIEW                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Electron main process  <--- contextBridge / IPC --->  Renderer SPA          │
│          |                                                   |               │
│          +--> fs, clipboard, dialogs, workers                +--> DOM        │
│          +--> global shortcuts and capture HUD               +--> WebCodecs  │
│          +--> archive and portrait lifecycle                 +--> local state│
│                                                                              │
│  Main preload: electron/preload.cjs -> window.galleryDesktop                 │
│  HUD preload:  electron/capture-hud-preload.cjs -> window.captureHud         │
│  Rendering: classic ordered scripts + dom-morph.js keyed reconciliation      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                           MAIN PROCESS  electron/                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  main.cjs                                                                    │
│    - Creates the main BrowserWindow and owns shutdown sequencing.            │
│    - Registers request/response IPC handlers with ipcMain.handle().          │
│    - Owns CaptureSessionManager, CaptureHud, portrait sources, and previews. │
│    - Sends capture:toggle and shortcut:paste-image renderer events.          │
│    - Snapshots webContents IDs before teardown and bounds preview draining.  │
│                                                                              │
│  capture-session-manager.cjs                                                 │
│    - Enforces one owner-scoped capture and one registered global shortcut.   │
│    - Phases: arming -> armed -> starting -> recording -> matching -> saving. │
│    - Saving: writing -> written. Recording may skip matching.                │
│                                                                              │
│  capture-video.cjs / capture-shortcuts.cjs / image-directory.cjs             │
│    - Validate 450x450 VP8/VP9 WebM, 25-second and 75 MiB limits.             │
│    - Validate supported accelerators and resolve safe image directories.     │
│                                                                              │
│  portrait-processor.cjs / portrait-worker-client.cjs                         │
│  portrait-worker-thread.cjs                                                  │
│    - Inspect, crop, quantize, and encode animated GIF portraits in a worker. │
│    - Bound source size, frame count, aggregate pixels, and worker memory.    │
│                                                                              │
│  portrait-source-manager.cjs / portrait-preview-store.cjs                    │
│    - Scope source IDs to renderer owners and serialize worker operations.    │
│    - Stage previews, retry cleanup, and allow shutdown after a bounded drain.│
│                                                                              │
│  archive-store.cjs / gallery-transfer.cjs                                    │
│    - Recover corrupt archives and atomically replace galleries.json.         │
│    - Import, export, and duplicate galleries and character portrait files.   │
│    - Preserve sortMode, nameColor, titleColor, and titleGlowColor metadata.  │
│                                                                              │
│  capture-hud.cjs                                                             │
│    - Main-process HUD controller, status normalization, placement, and       │
│      hiding.                                                                 │
│    - States: armed, starting, recording, matching, saving, saved, failed.    │
│  capture-hud.js / capture-hud.css / capture-hud.html                         │
│    - HUD renderer owns elapsed/countdown clocks, Web Audio cues, and beacon  │
│      UI.                                                                     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                           PRELOAD BRIDGES AND IPC                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Request/response channels exposed by window.galleryDesktop:                 │
│    library:load, library:save, library:choose-image,                         │
│    library:read-clipboard-image, library:read-image-path,                    │
│    library:prepare-image-data, library:save-cropped-image,                   │
│    library:release-image-source, library:delete-image,                       │
│    library:choose-gallery, library:import-gallery,                           │
│    library:export-gallery, library:duplicate-gallery,                        │
│    library:duplicate-character, library:open-folder, library:image-url,      │
│    clipboard:read-text, capture:list-sources, capture:arm, capture:status,   │
│    capture:finish, capture:complete, capture:release, and window:quit.       │
│                                                                              │
│  Main-to-renderer event channels:                                            │
│    capture:toggle       -> global shortcut starts/stops the active capture.  │
│    shortcut:paste-image -> requests renderer clipboard-image handling.       │
│                                                                              │
│  HUD channels exposed by window.captureHud:                                  │
│    capture-hud:ready -> HUD renderer signals readiness.                      │
│    capture-hud:state -> main process publishes normalized visual state.      │
│                                                                              │
│  Boundary rule: renderer code receives only contextBridge methods. Node and  │
│  Electron primitives remain in the main/preload processes.                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                   RENDERER LOAD ORDER  renderer/index.html                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. demo-data.js             10. webm-muxer.js                              │
│   2. state.js                 11. capture-encoder.js                         │
│   3. card-appearance.js       12. capture-loop.js                            │
│   4. portrait-playback.js     13. live-capture.js                            │
│   5. dom-morph.js             14. persistence.js                             │
│   6. dna-workbench.js         15. templates.js                               │
│   7. crop-editor.js           16. modals.js                                  │
│   8. capture-geometry.js      17. app.js                                     │
│   9. capture-settings.js                                                     │
│                                                                              │
│  These are classic scripts. Declaration order is a dependency contract;      │
│  renderer globals are declared centrally in eslint.config.cjs.               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                         RENDERER MODULES  renderer/                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  state.js                                                                    │
│    - Global galleries, selection, filters, sort/view state, modal sessions,  │
│      batch modes, favorites, image URLs, and capture/crop/DNA session state. │
│                                                                              │
│  dom-morph.js / templates.js / app.js / modals.js                            │
│    - Generate markup, perform keyed in-place DOM updates, delegate events,   │
│      manage modal actions, keyboard shortcuts, filtering, sorting, and menus.│
│                                                                              │
│  persistence.js / crop-editor.js / dna-workbench.js                          │
│    - Save, import, export, duplicate, transfer, and clean portrait records.  │
│    - Process crop interactions and append portraits with rollback on failure.│
│    - Validate and edit DNA with local undo/redo history.                     │
│                                                                              │
│  card-appearance.js                                                          │
│    - Validates #RRGGBB colors and applies CSS variables to every view.       │
│    - Independently edits nameColor, titleColor, and titleGlowColor.          │
│    - Previews, resets, persists, and rolls back failed appearance saves.     │
│                                                                              │
│  portrait-playback.js                                                        │
│    - Uses IntersectionObserver, visibility, and geometry checks.             │
│    - Plays active visible portraits; pauses detached or offscreen videos.    │
│                                                                              │
│  capture-geometry.js                                                         │
│    - Pure crop display, draw, move, resize, center, snap, and restore math.  │
│                                                                              │
│  capture-settings.js                                                         │
│    - 30 FPS, 25-second, 750-frame, and 6 Mbps capture limits.                │
│    - Smart Loop overlap/window/descriptor thresholds and 1..25 second limit. │
│                                                                              │
│  capture-encoder.js                                                          │
│    - Configures VP9 WebCodecs with bounded encode queue and 75 MiB buffering.│
│    - Supports direct muxing or bufferOnly encoded chunks for final remuxing. │
│                                                                              │
│  capture-loop.js                                                             │
│    - Owns bounded head/tail VideoFrames and luma/chroma descriptors.         │
│    - Scores appearance plus temporal motion across candidate frame windows.  │
│    - Selects a natural boundary or emits a smooth crossfade fallback.        │
│                                                                              │
│  live-capture.js                                                             │
│    - Lists CK3 sources, arms capture, previews framing, records, matches,    │
│      finalizes WebM output, saves a portrait, and releases every resource.   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                           SMART LOOP CAPTURE FLOW                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Ready -> first shortcut -> Starting -> Recording                            │
│    1. createLiveCaptureEncoder({ bufferOnly: true }) stores encoded chunks.  │
│    2. createLiveCaptureLoopProcessor() receives every accepted canvas frame. │
│    3. Processor streams safe body frames and retains only bounded loop state.│
│                                                                              │
│  Recording -> first Stop -> Matching                                         │
│    4. Search duration is the persisted whole-second setting clamped to 1..25.│
│    5. Remaining capture time further clamps the effective matching window.   │
│    6. HUD switches to LOOP and counts down to the effective deadline.        │
│    7. Scores anchor appearance, window appearance, motion, and total quality.│
│       The best qualifying candidate wins after the full search window.       │
│                                                                              │
│  Matching -> second Stop or deadline -> Saving                               │
│    8. A second Stop forces completion; very short captures wait until usable.│
│    9. Natural result remuxes buffered VP9 chunks to the selected boundary.   │
│   10. No qualifying candidate produces an overlap crossfade fallback.        │
│   11. Final output is remuxed, size-validated, written, and appended.        │
│                                                                              │
│  Safety: 25-second duration timer and 750-frame cap include matching time.   │
│  Errors/cancellation close VideoFrames, encoder chunks, timers, tracks, HUD, │
│  session ownership, and temporary output without saving partial records.     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE AND STYLING                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  renderer/styles.css owns the shell, archive views, inspector, dialogs,      │
│  crop/capture workspace, appearance editor, menus, and responsive layout.    │
│                                                                              │
│  Live capture numeric controls:                                              │
│    - Smooth Loop Search and X/Y/Size use custom themed chevron buttons.      │
│    - Every number input has a separate explicit <label for="...">.           │
│    - app.js calls stepUp()/stepDown() and dispatches input/change events.    │
│    - Stepping restores input focus and respects recording disabled states.   │
│    - Native Chromium spinner glyphs are hidden; typed and keyboard input     │
│      remain.                                                                 │
│                                                                              │
│  Character appearance:                                                       │
│    --character-name-color controls names.                                    │
│    --character-title-color controls title text independently.                │
│    --character-title-glow controls the title text-shadow.                    │
│                                                                              │
│  HUD styling is isolated in electron/capture-hud.css, not renderer styles.   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                           TESTS, COMMANDS, AND CI                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  npm test                                                                    │
│    - Runs lint and syntax, archive, portrait, playback, and capture tests.   │
│    - Also runs transfer, shutdown, and full renderer smoke coverage.         │
│                                                                              │
│  Capture unit coverage:                                                      │
│    test-capture-video.cjs, test-capture-settings.cjs, test-capture-loop.cjs, │
│    test-capture-hud.cjs, test-capture-session-manager.cjs,                   │
│    test-capture-geometry.cjs, test-capture-shortcuts.cjs,                    │
│    test-live-capture-lifecycle.cjs, and test-image-directory.cjs.            │
│                                                                              │
│  Other unit coverage:                                                        │
│    test-archive-store.cjs, test-gallery-transfer.cjs,                        │
│    test-portrait-playback.cjs, test-portrait-preview-store.cjs,              │
│    test-portrait-processor.cjs, test-portrait-source-manager.cjs,            │
│    and test-portrait-worker.cjs.                                             │
│                                                                              │
│  Electron/runtime coverage:                                                  │
│    smoke-renderer.cjs, smoke-main-shutdown.cjs,                              │
│    smoke-capture-hud-runtime.cjs, smoke-capture-ui-runtime.cjs,              │
│    smoke-capture-loop-runtime.cjs, and smoke-packaged-portrait-worker.cjs.   │
│                                                                              │
│  Windows CI (.github/workflows/ci.yml):                                      │
│    npm ci -> license check -> npm test -> three capture runtime smokes ->    │
│    package:win:dir -> packaged portrait-worker smoke.                        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                              PRIMARY DATA FLOWS                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Library edit -> renderer state -> saveLibrary() -> library:save ->          │
│    archive-store atomic galleries.json replacement.                          │
│                                                                              │
│  Clipboard/file portrait -> prepare source in worker -> crop editor ->       │
│    save 450x450 output -> appendPortrait() -> metadata save and cleanup.     │
│                                                                              │
│  Live portrait -> list source -> arm global shortcut -> getDisplayMedia ->   │
│    frame crop -> buffered VP9 encode -> Smart Loop match/fallback -> remux ->│
│    capture:finish -> appendPortrait() -> capture:complete.                   │
│                                                                              │
│  Appearance edit -> validate name/title/glow colors -> saveLibrary() ->      │
│    CSS-variable sync across card, table, inspector, and appearance preview.  │
│                                                                              │
│  Gallery export/import -> gallery-transfer sanitization -> metadata and      │
│    portrait copying -> renderer save -> orphan cleanup after successful move.│
│                                                                              │
│  Window close -> release owner-scoped capture/source state -> destroy HUD -> │
│    bounded portrait-preview drain -> app quit even if native cleanup fails.  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                           RECENT COMMITS REVIEWED                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  0431179  Bound Smart Loop to 25 seconds; fix labels; remove dead helper.    │
│  5c9b5a1  Replace clipped native number spinners with custom chevrons.       │
│  ca8a328  Align capture controls and add independent title-color editing.    │
│  74a82fb  Add full-window Smart Loop scoring, remuxing, fallback, and tests. │
│  63ecd11  Harden shutdown after live capture and add shutdown smoke coverage.│
│                                                                              │
│  Release 3.1.0 (2026-07-31): animated GIF/WebM, live capture, Smart Loop,    │
│  and independent character name/title appearance customization.              │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```
