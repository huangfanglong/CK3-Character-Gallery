# CK3 Character Gallery Codebase Map

Project: Electron desktop archive for CK3 character portraits and DNA  
Package version: 4.0.0 | Latest changelog release: 4.0.0

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                            ARCHITECTURE OVERVIEW                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Electron main process  <--- contextBridge / IPC --->  Renderer SPA          │
│          |                                                   |               │
│          +--> fs, clipboard, dialogs, workers                +--> DOM        │
│          +--> global shortcuts and capture HUD               +--> WebCodecs  │
│         +--> CK3 game dock + Live Game Link worker          +--> FLIP motion │
│         +--> archive and portrait lifecycle                 +--> local state │
│                                                                              │
│  Main preload: electron/preload.cjs -> window.galleryDesktop                 │
│  HUD preload:  electron/capture-hud-preload.cjs -> window.captureHud         │
│  Dock preload: electron/game-dock-preload.cjs -> window.gameDock (sandboxed) │
│  Rendering: classic ordered scripts + dom-morph.js keyed reconciliation      │
│  Styling: renderer/styles.css + renderer/optical.css (Optical Archive)       │
│  Live Game Link: worker thread + koffi Win32 process I/O (Windows only)      │
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
│    - Owns GameDockService and routes capture status to dock or HUD.          │
│    - Serializes library:save writes through archiveSaveQueue.                │
│    - Sends capture:toggle and shortcut:paste-image renderer events.          │
│    - Snapshots webContents IDs before teardown and bounds preview draining.  │
│                                                                              │
│  capture-session-manager.cjs                                                 │
│    - Enforces one owner-scoped capture and one registered global shortcut.   │
│    - Phases: arming -> armed -> starting -> recording -> matching -> saving. │
│    - Saving: writing -> written. Recording may skip matching.                │
│   - Dock captures carry dockDraftId + gameHwnd; release restores throttling. │
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
│   - Stage previews, retry cleanup, and allow shutdown after a bounded drain. │
│                                                                              │
│  archive-store.cjs / gallery-transfer.cjs                                    │
│    - Recover corrupt archives and atomically replace galleries.json.         │
│    - Import, export, and duplicate galleries and character portrait files.   │
│    - Preserve sortMode, nameColor, titleColor, titleGlowColor; dock settings │
│      are application preferences and are excluded from collection exports.   │
│                                                                              │
│  capture-hud.cjs                                                             │
│    - Main-process HUD controller, status normalization, placement, and       │
│      hiding.                                                                 │
│    - States: armed, starting, recording, matching, saving, saved, failed.    │
│  capture-hud.js / capture-hud.css / capture-hud.html                         │
│    - HUD renderer owns elapsed/countdown clocks, Web Audio cues, and beacon  │
│      UI.                                                                     │
│                                                                              │
│  game-dock-service.cjs                                                       │
│    - Owns dock lifecycle, preferences (ui-settings.json), and command flow.  │
│    - Scopes clipboard reads to Quick add or a waiting visible draft.         │
│    - Bridges commands to the renderer and validates async results/epochs.    │
│    - Owns Live Game Link operations, consent, selection, and guarded undo.   │
│                                                                              │
│  game-dock.cjs / game-dock-commands.cjs                                      │
│    - BrowserWindow controller: focus-aware visibility, placement, hit        │
│      regions, navigation, and normalizer for allow-listed commands/state.    │
│    - 6 px resting strip; left/center/right; compact 48 / expanded 310 high.  │
│    - Modes: compact, draft, framing, capture, success, error, live-confirm,  │
│      live-result. Capture states: starting, armed, recording, matching,      │
│      saving.                                                                 │
│  game-dock-preload.cjs                                                       │
│    - Exposes window.gameDock: ready, command, setInteractive, setHitRegions, │
│      setTextInput, onState; 25 s command timeout with operation IDs.         │
│  game-dock.js / game-dock.css / game-dock.html                               │
│    - Sandboxed, context-isolated dock renderer. CSP allows only 'self'       │
│      scripts/styles; img/media/connect/object/frame-ancestors are 'none'.    │
│    - Owns reticle framing, pointer/drag state, clocks, and dock markup.      │
│                                                                              │
│  windows-game-monitor.cjs                                                    │
│    - koffi Win32 foreground/bounds hooks; tracks the visible ck3.exe window. │
│    - Drives dock reveal/hide, game-loss notification, and capture source id. │
│  windows-live-process.cjs / x64-decoder.cjs                                  │
│    - Bounded, handle-tracked Read/WriteProcessMemory via koffi (256 MB cap). │
│    - Fail-closed x86-64 decoder for compiler-generated field dispatchers.    │
│                                                                              │
│  live-dna-codec.cjs                                                          │
│    - Strict parser for persistent DNA and gene scripts; positional 4-byte    │
│      gene arrays <-> text; template remapping; appearance-gene exclusions.   │
│  live-game-catalog.cjs                                                       │
│    - Builds the effective gene catalog from base files plus enabled mods,    │
│      overrides, additional files, and replace_path.                          │
│  live-game-resolver.cjs                                                      │
│    - PE section parsing, RTTI/class discovery, and static field resolution.  │
│  live-game-engine.cjs                                                        │
│    - import, prepare-apply, confirm-apply, undo; fingerprint + current-raw   │
│      equality + read-back verification + rollback; cached layout (v2).       │
│  live-game-bridge.cjs / live-game-worker.cjs                                 │
│    - Worker lifecycle with generation + settingRevision isolation, timeouts, │
│      sanitized results, and stale-operation rejection.                       │
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
│    clipboard:read-text, window:quit.                                         │
│    capture:list-sources(gameHwnd), capture:arm(sourceId, shortcut, context), │
│    capture:status, capture:finish, capture:complete, capture:release.        │
│    game-dock:renderer-state, game-dock:renderer-result,                      │
│    game-dock:sync-library, game-dock:set-enabled, game-dock:get-preferences, │
│    game-dock:sync-selection, game-dock:set-live-link-choice,                 │
│    game-dock:set-live-link-enabled.                                          │
│                                                                              │
│  Main-to-renderer event channels:                                            │
│    capture:toggle       -> global shortcut starts/stops the active capture.  │
│    shortcut:paste-image -> requests renderer clipboard-image handling.       │
│    game-dock:command    -> dock command for the renderer to execute.         │
│    game-dock:game-lost  -> CK3 left the foreground; cancel a draft.          │
│    game-dock:cancel     -> dock requests cancellation of a draft.            │
│    game-dock:preferences-> dock preference/consent change broadcast.         │
│                                                                              │
│  HUD channels exposed by window.captureHud:                                  │
│    capture-hud:ready -> HUD renderer signals readiness.                      │
│    capture-hud:state -> main process publishes normalized visual state.      │
│                                                                              │
│  Dock channels exposed by window.gameDock:                                   │
│    game-dock:ready, game-dock:command (renderer), game-dock:interactive,     │
│    game-dock:hit-regions, game-dock:text-input;                              │
│    game-dock:state / game-dock:result from main.                             │
│                                                                              │
│  Boundary rule: renderer/dock code receives only contextBridge methods. Node │
│  and Electron primitives remain in the main/preload processes. All game-dock │
│  IPC is sender-checked; capture channels use requireTrustedCaptureSender.    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                   RENDERER LOAD ORDER  renderer/index.html                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Stylesheets: styles.css, then optical.css                                   │
│                                                                              │
│   1. demo-data.js             12. capture-encoder.js                         │
│   2. state.js                 13. capture-loop.js                            │
│   3. card-appearance.js       14. live-capture.js                            │
│   4. portrait-playback.js     15. persistence.js                             │
│   5. dom-morph.js             16. character-records.js                       │
│   6. motion.js                17. game-dock-workflow.js                      │
│   7. dna-validation.js        18. templates.js                               │
│   8. dna-workbench.js         19. comparison.js                              │
│   9. crop-editor.js           20. modals.js                                  │
│  10. capture-geometry.js      21. app.js                                     │
│  11. capture-settings.js      (+ node_modules/webm-muxer before encoder)     │
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
│      batch modes, favorites, image URLs, capture/crop/DNA session state.     │
│    - Optical state: comparisonIds/tab/zoom/variants, quickTab, visibleLimit  │
│      (48), livingContact, gameDockPreferences, liveLinkConsentPending.       │
│                                                                              │
│  dom-morph.js / templates.js / app.js / modals.js                            │
│    - Generate markup, keyed DOM updates, delegate events, manage modal       │
│      actions, keyboard shortcuts, filtering, sorting, and menus.             │
│    - Left-click Quick Look (shared-context inspector + focus trap),          │
│      comparison tray, inline gallery/collection rename, physical drag        │
│      ordering, File/View toggles for dock and Live Game Link.                │
│                                                                              │
│  motion.js                                                                   │
│    - Interruptible FLIP motion for Quick Look open/close/navigation,         │
│      command dock, collection transitions, reorder, and living contact.      │
│    - Honors prefers-reduced-motion and keeps focus/controls stable.          │
│                                                                              │
│  optical.css                                                                 │
│    - Optical Archive restyle: Manrope Variable font, theme tokens, larger    │
│      type, optical navigation/dialogs, comparison tray, dock, Quick Look.    │
│                                                                              │
│  character-records.js                                                        │
│    - Shared character creation/removal and gallery binding with automatic    │
│      unique names, pinned destinations, rollback, and guarded undo.          │
│                                                                              │
│  game-dock-workflow.js                                                       │
│    - Executes dock commands through a queue, publishes dock state, syncs     │
│      library/collections and selected record, and manages Live Game Link     │
│      consent and selection.                                                  │
│                                                                              │
│  comparison.js                                                               │
│    - Comparison-tray records/markup, variant switching, tab and zoom state.  │
│                                                                              │
│  dna-validation.js                                                           │
│    - UMD module shared with the main process: isValidCk3Dna (1 MB cap) used  │
│      by the dock, Live Game Link, and the DNA workbench.                     │
│                                                                              │
│  persistence.js / crop-editor.js / dna-workbench.js                          │
│    - Save, import, export, duplicate, transfer, and clean portrait records.  │
│   - Process crop interactions and append portraits with rollback on failure. │
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
│    - Optional living contact sheet plays on hover/focus; suppresses or       │
│      restores focus playback across Quick Look and modal transitions.        │
│                                                                              │
│  capture-geometry.js                                                         │
│    - Pure crop display, draw, move, resize, center, snap, and restore math.  │
│    - Shared with the dock renderer for its framing reticle.                  │
│                                                                              │
│  capture-settings.js                                                         │
│    - 30 FPS, 25-second, 750-frame, and 6 Mbps capture limits.                │
│    - Smart Loop overlap/window/descriptor thresholds and 1..25 second limit. │
│                                                                              │
│  capture-encoder.js                                                          │
│   - Configures VP9 WebCodecs with bounded encode queue and 75 MiB buffering. │
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
│    - Accepts an optional gameHwnd/dock context so dock captures target the   │
│      foreground CK3 window instead of a name-matched source.                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                           SMART LOOP CAPTURE FLOW                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Ready -> first shortcut -> Starting -> Recording                            │
│    1. createLiveCaptureEncoder({ bufferOnly: true }) stores encoded chunks.  │
│    2. createLiveCaptureLoopProcessor() receives every accepted canvas frame. │
│   3. Processor streams safe body frames and retains only bounded loop state. │
│                                                                              │
│  Recording -> first Stop -> Matching                                         │
│   4. Search duration is the persisted whole-second setting clamped to 1..25. │
│    5. Remaining capture time further clamps the effective matching window.   │
│    6. HUD (or dock) switches to LOOP and counts down to the deadline.        │
│   7. Scores anchor appearance, window appearance, motion, and total quality. │
│       The best qualifying candidate wins after the full search window.       │
│                                                                              │
│  Matching -> second Stop or deadline -> Saving                               │
│   8. A second Stop forces completion; very short captures wait until usable. │
│    9. Natural result remuxes buffered VP9 chunks to the selected boundary.   │
│   10. No qualifying candidate produces an overlap crossfade fallback.        │
│   11. Final output is remuxed, size-validated, written, and appended.        │
│                                                                              │
│  Safety: 25-second duration timer and 750-frame cap include matching time.   │
│  Dock captures carry dockDraftId/gameHwnd; their status renders in the dock  │
│  instead of the HUD and throttling is restored when the session is released. │
│  Errors/cancellation close VideoFrames, encoder chunks, timers, tracks, HUD, │
│  session ownership, and temporary output without saving partial records.     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                              CK3 GAME DOCK FLOW                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  View -> CK3 game dock enables a separate dock window; the setting is saved  │
│  in ui-settings.json. WindowsGameMonitor shows a 6 px strip at the top of    │
│  the foreground CK3 window; hovering unfolds the controls.                   │
│                                                                              │
│  Quick add -> clipboard read (only on this action or a waiting draft) ->     │
│    validate DNA -> createCharacterRecord with automatic name -> framing.     │
│   A missing/invalid DNA value opens a draft; name and DNA are entered there. │
│                                                                              │
│  Framing -> drag/reticle and corner handles (crop math shared with the main  │
│   app) -> Snapshot (450x450 PNG) or Live portrait (450x450 WebM, Smart Loop) │
│    -> success state with View in gallery and a 12-second guarded Undo.       │
│                                                                              │
│  Input: native hit regions and interactive/text-input flags keep drag and    │
│  typing working while CK3 stays focused; focus loss cancels a draft.         │
│  Closing the Bloodline main window destroys the dock and quits the app.      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                            LIVE GAME LINK FLOW                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Optional. First-run consent (undecided -> enabled/declined) is recorded in  │
│ ui-settings.json; File -> Live Game Link toggles it later without re-prompt. │
│                                                                              │
│  Import -> foreground CK3 target from the monitor -> worker resolves PE/RTTI │
│    layout and the effective gene catalog -> reads the positional gene array  │
│    -> raw-to-persistent DNA -> attaches to the selected record.              │
│                                                                              │
│  Apply -> renderer syncs the selected record (modified time + DNA) ->        │
│    dock prepares a token -> explicit confirm -> fingerprint + current-raw    │
│    equality, verified write and read-back, rollback on mismatch; guarded     │
│    Undo. Hair, beard, clothing, and special appearance genes are excluded.   │
│                                                                              │
│  Safety: bounded reads (256 MB), generation/revision worker isolation,       │
│  sanitized results, cached layout (v2), and refusal on uncertain layouts.    │
│  Live Game Link does not inject into CK3 or modify game files.               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE AND STYLING                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  renderer/styles.css + renderer/optical.css own the shell, archive views,    │
│  inspector, dialogs, crop/capture workspace, appearance editor, menus,       │
│  comparison tray, Quick Look, dock controls, and responsive layout.          │
│                                                                              │
│  Optical Archive additions:                                                  │
│    - Quick Look opens on left-click with shared-element motion; right-click  │
│      only opens the context menu; focus trap and return-focus on close.      │
│    - Comparison tray compares records with portrait/DNA tabs, variant        │
│      switching, and zoom.                                                    │
│    - Optional living contact sheet plays animated portraits on hover/focus.  │
│    - Inline gallery and collection renaming; physical drag ordering.         │
│    - Lazy render: 48 cards initially, +48 via an IntersectionObserver        │
│      sentinel for large collections.                                         │
│    - Larger text and Manrope Variable typography throughout.                 │
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
│  HUD styling is electron/capture-hud.css; dock styling is                    │
│  electron/game-dock.css. Both are isolated from renderer styles.             │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                           TESTS, COMMANDS, AND CI                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  npm test                                                                    │
│    - Runs lint, syntax, archive, portrait, playback, capture, sessions,      │
│      geometry, shortcuts, transfer, game-dock/live-link, shutdown, and full  │
│      renderer smoke coverage.                                                │
│                                                                              │
│  Capture unit coverage:                                                      │
│    test-capture-video.cjs, test-capture-settings.cjs, test-capture-loop.cjs, │
│    test-capture-hud.cjs, test-capture-session-manager.cjs,                   │
│    test-capture-geometry.cjs, test-capture-shortcuts.cjs,                    │
│    test-live-capture-lifecycle.cjs, and test-image-directory.cjs.            │
│                                                                              │
│  Dock and Live Game Link unit coverage (npm run test:game-dock):             │
│    test-live-dna-codec.cjs, test-live-game-catalog.cjs,                      │
│    test-live-game-engine.cjs, test-live-game-bridge.cjs,                     │
│    test-live-game-service.cjs, test-windows-game-monitor.cjs,                │
│    test-game-dock.cjs, test-game-dock-commands.cjs,                          │
│    test-character-records.cjs, test-game-dock-service.cjs,                   │
│    test-game-dock-workflow.cjs.                                              │
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
│    smoke-capture-loop-runtime.cjs, smoke-packaged-portrait-worker.cjs,       │
│    smoke-game-dock-runtime.cjs, smoke-windows-game-monitor-runtime.cjs,      │
│    and smoke-packaged-game-dock.cjs. The dock/monitor runtime smokes are     │
│    documented manual checks and are not part of CI.                          │
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
│    serialized archive-store atomic galleries.json replacement.               │
│                                                                              │
│  Clipboard/file portrait -> prepare source in worker -> crop editor ->       │
│    save 450x450 output -> appendPortrait() -> metadata save and cleanup.     │
│                                                                              │
│  Live portrait -> list source -> arm global shortcut -> getDisplayMedia ->   │
│   frame crop -> buffered VP9 encode -> Smart Loop match/fallback -> remux -> │
│    capture:finish -> appendPortrait() -> capture:complete.                   │
│                                                                              │
│  Dock quick add -> scoped clipboard DNA -> createCharacterRecord -> gallery  │
│    sync -> framing crop -> Snapshot or Live portrait -> 12-second Undo.      │
│                                                                              │
│  Live import/apply -> foreground CK3 target -> worker layout + effective     │
│   gene catalog -> DNA conversion or verified write -> selection/record sync. │
│                                                                              │
│  Appearance edit -> validate name/title/glow colors -> saveLibrary() ->      │
│    CSS-variable sync across card, table, inspector, and appearance preview.  │
│                                                                              │
│  Gallery export/import -> gallery-transfer sanitization -> metadata and      │
│   portrait copying -> renderer save -> orphan cleanup after successful move. │
│                                                                              │
│  Window close -> destroy dock and HUD -> release owner-scoped capture/source │
│    state -> bounded portrait-preview drain -> app quit even if native        │
│    cleanup fails.                                                            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```
