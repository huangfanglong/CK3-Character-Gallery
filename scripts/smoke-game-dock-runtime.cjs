const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const electron = require('electron');

if (!electron.app) {
  const { spawnSync } = require('node:child_process');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const { app, BrowserWindow, screen } = electron;
  const { GameDock } = require('../electron/game-dock.cjs');
  const { setTimeout: delay } = require('node:timers/promises');

  async function main() {
    const display = screen.getPrimaryDisplay();
    const game = {
      hwnd: '9001', processId: 9001, executable: 'ck3.exe', visible: true, minimized: false,
      bounds: display.workArea,
      clientBounds: { x: display.workArea.x + 40, y: display.workArea.y + 40, width: Math.min(1200, display.workArea.width - 80), height: Math.min(800, display.workArea.height - 80) },
    };
    const monitor = new EventEmitter();
    monitor.state = game;
    monitor.start = () => true;
    monitor.stop = () => {};
    monitor.refresh = () => monitor.state;
    monitor.restoreFocusCalls = [];
    monitor.restoreFocus = (hwnd) => { monitor.restoreFocusCalls.push(hwnd); return true; };
    let dock;
    let stalledCreate = null;
    let stalledOperationId = '';
    let stalledLiveImport = null;
    let stalledLiveOperationId = '';
    let holdNextLiveImport = false;
    let dismissalCount = 0;
    dock = new GameDock({
      BrowserWindow, screen, monitor,
      htmlPath: path.join(__dirname, '..', 'electron', 'game-dock.html'),
      preloadPath: path.join(__dirname, '..', 'electron', 'game-dock-preload.cjs'),
      onCommand: async ({ operationId, type, payload }) => {
        if (type === 'dismiss') dismissalCount += 1;
        if (type === 'select-collection') { dock.setPreferences({ collection: payload.collection }); dock.update({ collection: payload.collection }); }
        if (type === 'set-position') dock.setPreferences({ position: payload.position });
        if (type === 'quick-add') dock.update({ mode: 'draft', dnaReady: true, characterName: '' });
        if (type === 'create-record' && payload.name === 'Stalled capture') {
          stalledOperationId = operationId;
          return new Promise((resolve) => { stalledCreate = resolve; });
        }
        if (type === 'create-record') dock.update({ mode: payload.frame ? 'framing' : 'success', characterId: 'character-1', characterName: payload.name || 'Unnamed character', dnaAttached: true, crop: { centerX: .5, centerY: .5, size: .35 }, sourceSize: { width: 1600, height: 900 }, undoUntil: Date.now() + 10_000 });
        if (type === 'snapshot') dock.update({ mode: 'success', capture: null, message: 'Portrait and DNA saved.', undoUntil: Date.now() + 10_000 });
        if (type === 'live-capture') dock.update({ mode: 'capture', capture: { state: 'recording', startedAt: Date.now() - 2200 } });
        if (type === 'toggle-capture') dock.update({ capture: { ...dock.state.capture, state: 'matching' } });
        if (type === 'live-import' && holdNextLiveImport) {
          holdNextLiveImport = false;
          stalledLiveOperationId = operationId;
          return new Promise((resolve) => { stalledLiveImport = resolve; });
        }
        if (type === 'live-import') dock.update({ mode: 'draft', dnaReady: true, dnaAttached: true, liveImported: true, characterName: 'Aella', message: '24 genes imported as persistent DNA.' });
        if (type === 'live-prepare-apply') dock.update({ mode: 'live-confirm', liveTargetName: 'Aella', liveReport: '24 genes mapped to this installation.', busy: false });
        if (type === 'live-confirm-apply') dock.update({ mode: 'live-result', liveUndoUntil: Date.now() + 20_000, message: 'Applied 24 mapped genes. Hair, beard, and clothing were not changed.', busy: false });
        if (type === 'live-undo') dock.update({ mode: 'live-result', liveUndoUntil: 0, message: 'Original DNA restored and verified.', busy: false });
        if (['dismiss', 'cancel-draft', 'finish-without-portrait', 'cancel-capture', 'live-cancel'].includes(type)) {
          dock.update({ mode: 'compact', capture: null, crop: null, characterId: null, liveUndoUntil: 0, liveRetry: false });
          if (stalledCreate) { stalledCreate({ ok: true, cancelled: true }); stalledCreate = null; }
        }
        return { ok: true };
      },
    });
    try {
      dock.setLibrary(['The Baltic Court', 'House of Wessex', 'Mediterranean characters'], 'The Baltic Court');
      assert.equal(dock.start(), true);
      const deadline = Date.now() + 5000;
      while (!dock.ready && Date.now() < deadline) await delay(25);
      assert.equal(dock.ready, true);
      await delay(100);
      const window = dock.window;
      assert.equal(window.isFocusable(), false);
      assert.equal(window.isVisible(), true);
      assert.deepEqual(window.getBounds(), game.clientBounds);
      assert.equal(await window.webContents.executeJavaScript('typeof window.require'), 'undefined');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dock") !== null'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").textContent.trim()'), 'Quick add');

      const restingGeometry = JSON.parse(await window.webContents.executeJavaScript(`(()=>{ const dock=document.querySelector('.dock'); const rect=dock.getBoundingClientRect(); return JSON.stringify({width:rect.width,height:rect.height,top:rect.top,revealed:dockView.revealed,controls:getComputedStyle(document.querySelector('.dock-bar')).visibility}); })()`));
      assert.deepEqual(restingGeometry, { width: 280, height: 6, top: 0, revealed: false, controls: 'hidden' });
      if (process.env.CK3_GAME_DOCK_STRIP_SCREENSHOT) {
        window.setContentProtection(false);
        const image = await window.webContents.capturePage();
        await require('node:fs/promises').writeFile(process.env.CK3_GAME_DOCK_STRIP_SCREENSHOT, image.toPNG());
      }
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
      let revealedGeometry;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
        revealedGeometry = JSON.parse(await window.webContents.executeJavaScript(`(()=>{ const dock=document.querySelector('.dock'); const rect=dock.getBoundingClientRect(); return JSON.stringify({width:rect.width,height:rect.height,revealed:dockView.revealed,controls:getComputedStyle(document.querySelector('.dock-bar')).visibility,color:getComputedStyle(dock).color}); })()`));
        if (revealedGeometry.width === 680 && revealedGeometry.height === 48) break;
        await delay(25);
      }
      assert.deepEqual(revealedGeometry, { width: 680, height: 48, revealed: true, controls: 'visible', color: 'rgb(28, 29, 36)' });
      if (process.env.CK3_GAME_DOCK_MENU_SCREENSHOT) {
        window.setContentProtection(false);
        const image = await window.webContents.capturePage();
        await require('node:fs/promises').writeFile(process.env.CK3_GAME_DOCK_MENU_SCREENSHOT, image.toPNG());
      }
      await window.webContents.executeJavaScript('document.querySelector("[data-command=toggle-menu]").click()');
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:20,clientY:160}))`);
      assert.equal(await window.webContents.executeJavaScript('dockView.revealed'), true, 'An open menu keeps the dock unfolded.');
      await window.webContents.executeJavaScript('document.querySelector("[data-command=toggle-menu]").click()');
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:20,clientY:160}))`);
      for (let attempt = 0; attempt < 100 && await window.webContents.executeJavaScript('document.querySelector(".dock").getBoundingClientRect().height') !== 6; attempt += 1) await delay(25);
      assert.equal(await window.webContents.executeJavaScript('dockView.revealed'), false);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dock").getBoundingClientRect().height'), 6);
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
      await delay(240);

      await window.webContents.executeJavaScript('document.querySelector("[data-command=open-collections]").click()');
      await window.webContents.executeJavaScript('document.querySelector("#collection-filter").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))');
      await delay(50);
      assert.equal(await window.webContents.executeJavaScript('textInputActive'), true);
      assert.equal(dock.editing, true);
      await window.webContents.executeJavaScript(`{ const input = document.querySelector('#collection-filter'); input.value = 'wessex'; input.dispatchEvent(new Event('input', { bubbles: true })); }`);
      assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".collection-option").length'), 1);
      await window.webContents.executeJavaScript('document.querySelector(".collection-option").click()');
      await delay(50);
      assert.equal(dock.state.collection, 'House of Wessex');

      await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").click()');
      await delay(50);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dock.expanded") !== null'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=create-record][data-frame=true]").disabled'), false);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").disabled'), true);
      const nameRect = JSON.parse(await window.webContents.executeJavaScript(`(()=>{const input=document.querySelector('#character-name');input.value='Ragnhild of Jorvik';const rect=input.getBoundingClientRect();return JSON.stringify({x:rect.x,y:rect.y,height:rect.height});})()`));
      const nameY = Math.round(nameRect.y + nameRect.height / 2);
      const nameStart = Math.round(nameRect.x + 8);
      await window.webContents.executeJavaScript(
        `document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:${nameStart},clientY:${nameY}}))`,
      );
      await delay(60);
      assert.equal(
        await window.webContents.executeJavaScript('interactive'),
        true,
      );
      window.webContents.sendInputEvent({ type: 'mouseMove', x: nameStart, y: nameY });
      window.webContents.sendInputEvent({ type: 'mouseDown', x: nameStart, y: nameY, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: nameStart + 110, y: nameY, button: 'left', buttons: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: nameStart + 110, y: nameY, button: 'left', clickCount: 1 });
      await delay(80);
      const nameSelection = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({active:document.activeElement?.id,start:document.querySelector('#character-name').selectionStart,end:document.querySelector('#character-name').selectionEnd})`));
      assert.equal(nameSelection.active, 'character-name');
      assert.ok(nameSelection.end > nameSelection.start, `Native pointer drag must select the character name (${JSON.stringify(nameSelection)}).`);
      await window.webContents.executeJavaScript(`document.querySelector('#character-name').setSelectionRange(document.querySelector('#character-name').value.length,document.querySelector('#character-name').value.length)`);
      const createRect = await window.webContents.executeJavaScript(`document.querySelector('[data-command=create-record][data-frame=true]').getBoundingClientRect().toJSON()`);
      const createX = Math.round(createRect.x + createRect.width / 2);
      const createY = Math.round(createRect.y + createRect.height / 2);
      window.webContents.sendInputEvent({ type: 'mouseMove', x: createX, y: createY });
      window.webContents.sendInputEvent({ type: 'mouseDown', x: createX, y: createY, button: 'left', clickCount: 1 });
      await delay(30);
      assert.equal(dock.editing, true, 'Focusing Create & frame must not return native focus to CK3 between press and release.');
      window.webContents.sendInputEvent({ type: 'mouseUp', x: createX, y: createY, button: 'left', clickCount: 1 });
      await delay(80);
      assert.equal(dock.state.characterName, 'Ragnhild of Jorvik');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=open-collections]").disabled'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#portrait-reticle") !== null'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".crop-handle").length'), 4);
      dock.update({ mode: 'framing', crop: { centerX: .5, centerY: .5, size: 1 }, sourceSize: { width: 1600, height: 900 }, capture: null });
      await delay(30);
      const overlapHit = await window.webContents.executeJavaScript(`(()=>{const rect=document.querySelector('[data-command=reset-crop]').getBoundingClientRect();return document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('[data-command]')?.dataset.command;})()`);
      assert.equal(overlapHit, 'reset-crop', 'A full-height portrait reticle must not cover the dock controls.');
      for (const handle of ['north-west', 'north-east', 'south-east', 'south-west']) {
        dock.update({ mode: 'framing', crop: { centerX: .5, centerY: .5, size: .35 }, sourceSize: { width: 1600, height: 900 }, capture: null });
        await delay(20);
        const dragResult = JSON.parse(await window.webContents.executeJavaScript(`(()=>{
          const reticle=document.querySelector('#portrait-reticle');
          reticle.setPointerCapture=()=>{};
          const rect=cropRect();
          const handleNode=document.querySelector('[data-crop-handle=${handle}]');
          const x=rect.x+(${handle === 'north-east' || handle === 'south-east' ? 'rect.size' : '0'});
          const y=rect.y+(${handle === 'south-east' || handle === 'south-west' ? 'rect.size' : '0'});
          handleNode.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:7,clientX:x,clientY:y}));
          reticle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:7,clientX:x+12,clientY:y+9}));
          const scale=dockState.sourceSize.width/dockDisplayGeometry().width;
          const expected=normalizedCaptureCrop(resizeCaptureCrop(drag.crop,drag.handle,{x:drag.initialPointer.x+12*scale,y:drag.initialPointer.y+9*scale},1600,900,40),1600,900);
          const actual={...dockState.crop};
          reticle.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:7,clientX:x+12,clientY:y+9}));
          return JSON.stringify({actual,expected});
        })()`));
        for (const key of ['centerX', 'centerY', 'size']) assert.ok(Math.abs(dragResult.actual[key] - dragResult.expected[key]) < 0.000001, `${handle} drag used the wrong source pointer (${JSON.stringify(dragResult)}).`);
      }
      for (const [index, part] of ['move', 'north-west'].entries()) {
        dock.update({ mode: 'framing', crop: { centerX: .5, centerY: .5, size: .35 }, sourceSize: { width: 1600, height: 900 }, capture: null });
        await delay(20);
        const pointerId = 70 + index;
        const recovered = JSON.parse(await window.webContents.executeJavaScript(`(()=>{
          const reticle=document.querySelector('#portrait-reticle');
          reticle.setPointerCapture=()=>{};
          const rect=cropRect();
          const part=${JSON.stringify(part)};
          const x=part==='move'?rect.x+rect.size/2:rect.x;
          const y=part==='move'?rect.y+rect.size/2:rect.y;
          const hoverTarget=part==='move'?reticle:document.querySelector('[data-crop-handle=north-west]');
          hoverTarget.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:${pointerId},buttons:0,clientX:x,clientY:y}));
          /* Deliberately omit pointerdown: Windows ate it for the inactive dock. */
          reticle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:${pointerId},buttons:1,clientX:x+12,clientY:y+9}));
          const recoveredHandle=drag?.handle;
          const scale=dockState.sourceSize.width/dockDisplayGeometry().width;
          const expected=normalizedCaptureCrop(drag.handle
            ? resizeCaptureCrop(drag.crop,drag.handle,{x:drag.initialPointer.x+12*scale,y:drag.initialPointer.y+9*scale},1600,900,40)
            : moveCaptureCrop(drag.crop,12*scale,9*scale,1600,900),1600,900);
          const actual={...dockState.crop};
          reticle.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:${pointerId},button:0,buttons:0,clientX:x+12,clientY:y+9}));
          return JSON.stringify({actual,expected,recoveredHandle});
        })()`));
        assert.equal(recovered.recoveredHandle, part === 'move' ? '' : 'north-west', 'Recovery must preserve the hovered crop target.');
        for (const key of ['centerX', 'centerY', 'size']) assert.ok(Math.abs(recovered.actual[key] - recovered.expected[key]) < 0.000001, `${part} without pointerdown was not recovered (${JSON.stringify(recovered)}).`);
      }
      const externalDrag = JSON.parse(await window.webContents.executeJavaScript(`(()=>{
        const reticle=document.querySelector('#portrait-reticle');
        const rect=cropRect();
        const before={...dockState.crop};
        document.querySelector('.dock').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:88,buttons:0,clientX:20,clientY:20}));
        reticle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:88,buttons:1,clientX:rect.x+30,clientY:rect.y+30}));
        const result={started:Boolean(drag),before,after:{...dockState.crop}};
        reticle.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:88,button:0,buttons:0,clientX:rect.x+30,clientY:rect.y+30}));
        return JSON.stringify(result);
      })()`));
      assert.equal(externalDrag.started, false, 'A drag without a crop hover must remain CK3 input.');
      assert.deepEqual(externalDrag.after, externalDrag.before);

      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-capture]").click()');
      await delay(50);
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".capture-copy strong").textContent'), /Recording/);
      assert.match(await window.webContents.executeJavaScript('document.querySelector("#capture-time").textContent'), /^00:0[02]$/);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#portrait-reticle").classList.contains("locked")'), true);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=toggle-capture]").click()');
      await delay(50);
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".capture-copy strong").textContent'), /smooth loop/);
      await window.webContents.executeJavaScript(`dockState.capture.state='recording';dockState.shortcut='"><img id="dock-shortcut-injection" src=x>';renderDock()`);
      assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector("#dock-shortcut-injection"))'), false, 'Capture shortcuts must not be parsed as dock HTML.');
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".capture-copy span").textContent'), /Press .* to stop/);
      await window.webContents.executeJavaScript("dockState.capture.state='matching';delete dockState.shortcut;renderDock()");

      dock.update({ mode: 'success', capture: null, crop: null, message: 'Portrait and DNA saved.', undoUntil: Date.now() + 10_000 });
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=undo-create]").disabled'), false);
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".success-actions").textContent'), /View in gallery/);
      dock.update({ mode: 'error', error: 'The CK3 window is no longer available.' });
      await delay(30);
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".dock-body").textContent'), /no longer available/);
      const dismissalBaseline = dismissalCount;
      await window.webContents.executeJavaScript(`(()=>{const button=document.querySelector('.capture-actions [data-command=dismiss]');const rect=button.getBoundingClientRect();button.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,buttons:0,pointerId:90,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));})()`);
      await delay(30);
      assert.equal(dock.state.mode, 'error', 'A release without a matching dock hover remains CK3 input.');
      assert.equal(dismissalCount, dismissalBaseline);
      await window.webContents.executeJavaScript(`(()=>{const button=document.querySelector('.capture-actions [data-command=dismiss]');const rect=button.getBoundingClientRect();const x=rect.x+rect.width/2;const y=rect.y+rect.height/2;button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,buttons:0,pointerId:91,clientX:x,clientY:y}));button.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,buttons:0,pointerId:91,clientX:x,clientY:y}));button.dispatchEvent(new PointerEvent('click',{bubbles:true,cancelable:true,button:0,pointerId:91,clientX:x,clientY:y}));})()`);
      await delay(50);
      assert.equal(dock.state.mode, 'compact', 'A recent matching hover preserves the inactive Windows release fallback.');
      assert.equal(dismissalCount, dismissalBaseline + 1, 'A synthesized click following the release fallback must not dispatch twice.');
      dock.update({ mode: 'compact', error: '', capture: null, liveEnabled: true, liveCanApply: true, liveSelectedName: 'Archived Aella', liveUndoUntil: 0 });
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-import]").disabled'), false);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").disabled'), false);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-import]").click()');
      await delay(40);
      assert.equal(dock.state.liveImported, true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dna-state").textContent.includes("Persistent DNA")'), true);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-cancel]")?.click()');
      dock.update({ mode: 'compact' });

      holdNextLiveImport = true;
      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-import]").click()');
      for (let attempt = 0; attempt < 50 && !stalledLiveImport; attempt += 1) await delay(20);
      assert.equal(typeof stalledLiveImport, 'function');
      assert.equal(await window.webContents.executeJavaScript('dockView.pending'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").disabled'), true);
      dock.retirePendingCommands();
      dock.update({ mode: 'compact', busy: false, liveEnabled: false, error: '', liveRetry: false });
      await delay(40);
      assert.equal(await window.webContents.executeJavaScript('dockView.pending'), false, 'Changing the live preference releases an obsolete pending Import.');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").disabled'), false);
      dock.update({ liveEnabled: true });
      assert.ok(stalledLiveOperationId);
      stalledLiveImport({ ok: false, error: 'Live Game Link was turned off.' });
      stalledLiveImport = null;
      await delay(40);
      assert.equal(dock.state.mode, 'compact', 'A late Import failure cannot reopen an error after the toggle.');
      assert.equal(await window.webContents.executeJavaScript('dockView.pending'), false);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").click()');
      await delay(40);
      assert.equal(dock.state.mode, 'draft', 'Quick Add works after the retired Import completes late.');
      await window.webContents.executeJavaScript('document.querySelector(".dock-heading [data-command=cancel-draft]").click()');
      await delay(40);
      dock.update({ mode: 'compact', liveEnabled: true, busy: false });

      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").click()');
      await delay(40);
      const confirmation = await window.webContents.executeJavaScript('document.querySelector(".live-confirm").textContent');
      assert.match(confirmation, /Archived Aella/);
      assert.match(confirmation, /Aella/);
      assert.match(confirmation, /Hair, beard, clothing/);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-confirm-apply]").click()');
      await delay(40);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-undo]").disabled'), false);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-undo]").click()');
      await delay(40);
      assert.match(dock.state.message, /restored and verified/);
      assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector("[data-command=live-undo]"))'), false);
      dock.update({ mode: 'live-confirm', liveRetry: false });
      await window.webContents.executeJavaScript('document.querySelector(".dock").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
      await delay(40);
      assert.equal(dock.state.mode, 'compact');
      dock.update({ mode: 'compact', error: '', capture: null, busy: false });
      await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").click()');
      await delay(40);
      await window.webContents.executeJavaScript(`{const input=document.querySelector('#character-name');input.value='Stalled capture';document.querySelector('[data-command=create-record][data-frame=true]').click();}`);
      for (let attempt = 0; attempt < 50 && !stalledCreate; attempt += 1) await delay(20);
      assert.equal(typeof stalledCreate, 'function');
      assert.equal(await window.webContents.executeJavaScript('dockView.pending'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dock-heading [data-command=cancel-draft]").disabled'), false);
      await window.webContents.executeJavaScript('document.querySelector(".dock-heading [data-command=cancel-draft]").click()');
      await delay(60);
      assert.equal(dock.state.mode, 'compact');
      assert.equal(await window.webContents.executeJavaScript('dockView.pending'), false, 'Cancel unlocks the dock while creation is outstanding.');
      window.webContents.send('game-dock:result', { operationId: stalledOperationId, ok: false, error: 'Late capture failure' });
      await delay(40);
      assert.equal(dock.state.mode, 'compact', 'A late IPC result cannot reopen the cancelled draft.');
      await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").click()');
      await delay(40);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#character-name").disabled'), false);
      await window.webContents.executeJavaScript('document.querySelector(".dock-heading [data-command=cancel-draft]").click()');
      await delay(40);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=toggle-menu]").click()');
      assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll("[data-position]").length'), 3);
      await window.webContents.executeJavaScript('document.querySelector("[data-position=right]").click()');
      assert.equal(dock.preferences.position, 'right');

      if (process.env.CK3_GAME_DOCK_SCREENSHOT) {
        dock.setPreferences({ position: 'center' });
        dock.update({ mode: 'framing', characterName: 'Ragnhild of Jorvik', crop: { centerX: .5, centerY: .54, size: .4 }, sourceSize: { width: 1600, height: 900 }, collection: 'House of Wessex' });
        await delay(100);
        window.setContentProtection(false);
        const image = await window.webContents.capturePage();
        await require('node:fs/promises').writeFile(process.env.CK3_GAME_DOCK_SCREENSHOT, image.toPNG());
      }
      monitor.state = null;
      monitor.emit('change', null);
      assert.equal(window.isVisible(), false);
      assert.ok(monitor.restoreFocusCalls.length >= 1);
      console.log('Game dock runtime passed: sandbox, compact and expanded states, collection search, framing, capture feedback, errors, menus, and focus cleanup.');
    } finally {
      dock.destroy();
    }
  }

  const timeout = setTimeout(() => { console.error('Game dock runtime timed out.'); app.exit(1); }, 20_000);
  app.whenReady().then(main).then(() => { clearTimeout(timeout); app.quit(); }).catch((error) => { console.error(error); clearTimeout(timeout); process.exitCode = 1; app.quit(); });
}
