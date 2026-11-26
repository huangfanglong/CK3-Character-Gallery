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
    monitor.restoreFocus = (hwnd) => {
      monitor.restoreFocusCalls.push(hwnd);
      if (!monitor.state) { monitor.state = game; monitor.emit('change', game); }
      return true;
    };
    let dock;
    let stalledCreate = null;
    let stalledOperationId = '';
    let stalledLiveImport = null;
    let stalledLiveOperationId = '';
    let holdNextLiveImport = false;
    let dismissalCount = 0;
    let liveTargetName = 'Aella';
    let liveApplyCount = 0;
    const createRecordCommands = [];
    dock = new GameDock({
      BrowserWindow, screen, monitor,
      htmlPath: path.join(__dirname, '..', 'electron', 'game-dock.html'),
      preloadPath: path.join(__dirname, '..', 'electron', 'game-dock-preload.cjs'),
      onCommand: async ({ operationId, type, payload }) => {
        if (type === 'dismiss') dismissalCount += 1;
        if (type === 'select-collection') { dock.setPreferences({ collection: payload.collection }); dock.update({ collection: payload.collection }); }
        if (type === 'set-position') dock.setPreferences({ position: payload.position });
        if (type === 'set-loop-search') {
          if (!dock.game?.hwnd && !(dock.editing && dock.window.isFocused())) {
            const error = 'CK3 is no longer in the foreground.';
            dock.update({ mode: 'error', error });
            return { ok: false, error };
          }
          dock.update({ loopSearchSeconds: payload.seconds });
        }
        if (type === 'quick-add') dock.update({ mode: 'draft', dnaReady: true, characterName: '' });
        if (type === 'create-record') createRecordCommands.push({ operationId, ...payload });
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
        if (type === 'live-prepare-apply') {
          liveApplyCount += 1;
          dock.update({ mode: 'compact', liveTargetName, liveUndoUntil: Date.now() + 18_000, liveApplyId: operationId, message: '', busy: false });
        }
        if (type === 'live-undo') dock.update({ mode: 'compact', liveTargetName: '', liveUndoUntil: 0, liveApplyId: '', message: '', busy: false });
        if (['dismiss', 'cancel-draft', 'finish-without-portrait', 'cancel-capture', 'live-cancel'].includes(type)) {
          dock.update({ mode: 'compact', capture: null, crop: null, characterId: null, liveUndoUntil: 0, liveRetry: false });
          if (stalledCreate) { stalledCreate({ ok: true, cancelled: true }); stalledCreate = null; }
        }
        return { ok: true };
      },
      onGameLoss: () => {
        if (dock?.state.mode === 'framing') dock.update({ mode: 'error', error: 'CK3 is no longer in the foreground.' });
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
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").disabled'), true, 'Quick Add starts disabled without clipboard DNA.');
      assert.match(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").title'), /Copy persistent or Base64 DNA/);
      dock.update({ quickAddReady: true });
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").disabled'), false, 'Eligible clipboard DNA enables Quick Add.');

      const restingGeometry = JSON.parse(await window.webContents.executeJavaScript(`(()=>{ const dock=document.querySelector('.dock'); const rect=dock.getBoundingClientRect(); return JSON.stringify({width:rect.width,height:rect.height,top:rect.top,revealed:dockView.revealed,controls:getComputedStyle(document.querySelector('.dock-bar')).visibility}); })()`));
      assert.deepEqual(restingGeometry, { width: 280, height: 6, top: 0, revealed: false, controls: 'hidden' });
      if (process.env.CK3_GAME_DOCK_STRIP_SCREENSHOT) {
        window.setContentProtection(false);
        const image = await window.webContents.capturePage();
        await require('node:fs/promises').writeFile(process.env.CK3_GAME_DOCK_STRIP_SCREENSHOT, image.toPNG());
      }
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:(window.innerWidth-680)/2+2,clientY:2}))`);
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

      await window.webContents.executeJavaScript('{ window.__quickAddDock = document.querySelector(".dock"); document.querySelector("[data-command=quick-add]").click(); }');
      await delay(50);
      const quickAddMotion = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({sameNode:window.__quickAddDock===document.querySelector('.dock'),height:document.querySelector('.dock').getBoundingClientRect().height,animating:Boolean(dockHeightAnimation)})`));
      assert.equal(quickAddMotion.sameNode, true, 'Quick Add preserves the dock element so transitions can run.');
      assert.equal(quickAddMotion.animating, true, 'Quick Add animates into its variable-height draft.');
      assert.ok(quickAddMotion.height > 48, 'Quick Add is visibly partway through its height transition.');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dock.expanded") !== null'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=create-record][data-frame=true]").disabled'), false);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").disabled'), true);
      assert.equal(createRecordCommands.length, 0, 'Quick Add opens a draft without creating a record.');
      assert.equal(await window.webContents.executeJavaScript('document.activeElement?.id'), 'character-name', 'The inline character name is focused immediately.');
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
      assert.equal(createRecordCommands.at(-1).name, 'Ragnhild of Jorvik', 'Create & frame uses the inline dock name.');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=open-collections]").disabled'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#portrait-reticle") !== null'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".crop-handle").length'), 4);
      const initialLoopControl = JSON.parse(await window.webContents.executeJavaScript(`(()=>{
        const input=document.querySelector('#dock-loop-search-seconds');
        const row=document.querySelector('.loop-search-field').getBoundingClientRect();
        const inputRect=input.getBoundingClientRect();
        const skip=document.querySelector('[data-command=finish-without-portrait]').getBoundingClientRect();
        return JSON.stringify({exists:Boolean(input),disabled:input.disabled,value:input.value,rowTop:row.top,rowLeft:row.left,skipBottom:skip.bottom,skipLeft:skip.left,rowRight:row.right,unitRight:document.querySelector('.loop-search-value > span').getBoundingClientRect().right,inputRight:inputRect.right});
      })()`));
      assert.equal(initialLoopControl.exists, true);
      assert.equal(initialLoopControl.disabled, false, 'The duration is editable before capture starts.');
      assert.equal(initialLoopControl.value, '2');
      assert.ok(initialLoopControl.rowTop >= initialLoopControl.skipBottom, 'Smooth loop search sits directly beneath Skip portrait.');
      assert.ok(Math.abs(initialLoopControl.rowLeft - initialLoopControl.skipLeft) <= .5, 'The duration row aligns with the left edge of Skip portrait.');
      assert.ok(initialLoopControl.inputRight <= initialLoopControl.rowRight + .5 && initialLoopControl.unitRight <= initialLoopControl.rowRight + .5, 'The seconds field and unit stay inside the moved row.');
      const loopRect = await window.webContents.executeJavaScript(`document.querySelector('#dock-loop-search-seconds').getBoundingClientRect().toJSON()`);
      const loopTextX = Math.round(loopRect.x + loopRect.width * .55);
      const loopTextY = Math.round(loopRect.y + loopRect.height / 2);
      window.webContents.sendInputEvent({ type: 'mouseMove', x: loopTextX, y: loopTextY });
      window.webContents.sendInputEvent({ type: 'mouseDown', x: loopTextX, y: loopTextY, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: loopTextX, y: loopTextY, button: 'left', clickCount: 1 });
      await delay(40);
      monitor.state = null;
      monitor.emit('change', null);
      await delay(40);
      const firstLoopClick = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({mode:dockState.mode,active:document.activeElement?.id,textInputVisible:dockState.visible,textInputActive})`));
      assert.equal(firstLoopClick.mode, 'framing', 'The first physical click must not become a CK3 foreground-loss error.');
      assert.equal(firstLoopClick.active, 'dock-loop-search-seconds');
      assert.equal(firstLoopClick.textInputVisible, true);
      assert.equal(firstLoopClick.textInputActive, true);
      assert.equal(dock.editing, true);
      assert.equal(window.isFocused(), true);
      const spinnerX = Math.round(loopRect.right - 8);
      const spinnerY = Math.round(loopRect.y + loopRect.height * .25);
      window.webContents.sendInputEvent({ type: 'mouseMove', x: spinnerX, y: spinnerY });
      window.webContents.sendInputEvent({ type: 'mouseDown', x: spinnerX, y: spinnerY, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: spinnerX, y: spinnerY, button: 'left', clickCount: 1 });
      await delay(60);
      assert.equal(dock.state.loopSearchSeconds, 3, 'The native up arrow changes the real dock setting on the first click.');
      assert.equal(dock.state.mode, 'framing');
      window.webContents.sendInputEvent({ type: 'mouseDown', x: spinnerX, y: spinnerY, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: spinnerX, y: spinnerY, button: 'left', clickCount: 1 });
      await delay(60);
      assert.equal(dock.state.loopSearchSeconds, 4, 'Repeated spinner clicks remain responsive after state publication.');
      assert.equal(dock.state.mode, 'framing');
      await window.webContents.executeJavaScript(`(()=>{const input=document.querySelector('#dock-loop-search-seconds');input.value='8';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await delay(50);
      assert.equal(dock.state.loopSearchSeconds, 8, 'The numeric control updates the dock recording state.');
      const focusedLoopControl = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({active:document.activeElement?.id,value:document.querySelector('#dock-loop-search-seconds').value,textInputActive})`));
      assert.equal(focusedLoopControl.active, 'dock-loop-search-seconds', 'State publication preserves numeric-input focus.');
      assert.equal(focusedLoopControl.value, '8', 'State publication preserves the displayed value.');
      assert.equal(focusedLoopControl.textInputActive, true, 'Numeric editing retains native text-input behavior.');
      assert.equal(dock.editing, true, 'Changing the duration does not return native focus to CK3.');
      dock.update({ mode: 'framing', crop: { centerX: .5, centerY: .5, size: 1 }, sourceSize: { width: 1600, height: 900 }, capture: null });
      /* Native tests leave the OS pointer outside this new window. Explicitly reveal
         the framing panel instead of accidentally measuring its inert collapsed body. */
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
      for (let attempt = 0; attempt < 100 && !(await window.webContents.executeJavaScript('dockView.revealed && document.querySelector(".dock").classList.contains("expanded") && !dockHeightAnimation')); attempt += 1) await delay(25);
      const overlapHit = JSON.parse(await window.webContents.executeJavaScript(`(()=>{
        const rect=document.querySelector('[data-command=reset-crop]').getBoundingClientRect();
        const x=rect.x+rect.width/2,y=rect.y+rect.height/2,target=document.elementFromPoint(x,y);
        const dock=document.querySelector('.dock'),reticle=document.querySelector('#portrait-reticle');
        return JSON.stringify({command:target?.closest('[data-command]')?.dataset.command,target:target?.outerHTML.slice(0,300),point:{x,y},reset:rect.toJSON(),dock:dock.getBoundingClientRect().toJSON(),dockClass:dock.className,reticle:reticle.getBoundingClientRect().toJSON(),active:document.activeElement?.id});
      })()`));
      assert.equal(overlapHit.command, 'reset-crop', `A full-height portrait reticle must not cover the dock controls (${JSON.stringify(overlapHit)}).`);
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

      const framingSession = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({crop:dockState.crop,draftId:dockState.draftId,characterId:dockState.characterId,name:dockState.characterName})`));
      const framingHeight = await window.webContents.executeJavaScript('document.querySelector(".dock").getBoundingClientRect().height');
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:20,clientY:400}))`);
      await delay(40);
      const framingCollapse = JSON.parse(await window.webContents.executeJavaScript(`(()=>{const dock=document.querySelector('.dock');return JSON.stringify({mode:dockState.mode,revealed:dockView.revealed,expanded:dock.classList.contains('expanded'),height:dock.getBoundingClientRect().height,animating:Boolean(dockHeightAnimation),crop:dockState.crop,draftId:dockState.draftId,characterId:dockState.characterId,name:dockState.characterName,reticle:Boolean(document.querySelector('#portrait-reticle'))});})()`));
      assert.equal(framingCollapse.mode, 'framing', 'Leaving the panel must preserve Portrait Framing.');
      assert.equal(framingCollapse.revealed, false);
      assert.equal(framingCollapse.expanded, false);
      assert.equal(framingCollapse.animating, true, 'Framing uses the same smooth collapse transition as the normal dock.');
      assert.ok(framingCollapse.height > 6 && framingCollapse.height < framingHeight, `Framing is visibly mid-collapse (${framingCollapse.height}px).`);
      assert.equal(framingCollapse.reticle, true, 'The crop grid remains available while its panel is retracted.');
      assert.deepEqual({ crop: framingCollapse.crop, draftId: framingCollapse.draftId, characterId: framingCollapse.characterId, name: framingCollapse.name }, framingSession, 'Collapsing does not reset or finish the framing session.');
      for (let attempt = 0; attempt < 100 && await window.webContents.executeJavaScript(`(()=>{const rect=document.querySelector('.dock').getBoundingClientRect();return rect.height!==6||Math.abs(rect.width-280)>.1;})()`); attempt += 1) await delay(25);
      const retractedFraming = JSON.parse(await window.webContents.executeJavaScript(`(()=>{const dock=document.querySelector('.dock');const controls=getComputedStyle(document.querySelector('[data-command=reset-crop]'));const rect=dock.getBoundingClientRect();return JSON.stringify({height:rect.height,width:rect.width,visibility:controls.visibility,pointerEvents:controls.pointerEvents,interactive});})()`));
      assert.equal(retractedFraming.height, 6);
      assert.ok(Math.abs(retractedFraming.width - 280) < .1, `The retracted framing strip returns to its resting width (${retractedFraming.width}px).`);
      assert.equal(retractedFraming.visibility, 'hidden');
      assert.equal(retractedFraming.pointerEvents, 'none');
      assert.equal(retractedFraming.interactive, false);
      assert.equal(dock.window.isVisible(), true, 'Retraction keeps the overlay connected and visible.');
      assert.equal(dock.state.mode, 'framing');
      assert.equal(dock.state.capture, null);
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
      for (let attempt = 0; attempt < 100 && !(await window.webContents.executeJavaScript('dockView.revealed && document.querySelector(".dock").classList.contains("expanded") && !dockHeightAnimation')); attempt += 1) await delay(25);
      const restoredFraming = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({mode:dockState.mode,revealed:dockView.revealed,height:document.querySelector('.dock').getBoundingClientRect().height,controls:getComputedStyle(document.querySelector('[data-command=reset-crop]')).visibility,crop:dockState.crop,draftId:dockState.draftId,characterId:dockState.characterId,name:dockState.characterName})`));
      assert.equal(restoredFraming.mode, 'framing');
      assert.equal(restoredFraming.revealed, true);
      assert.equal(restoredFraming.height, framingHeight);
      assert.equal(restoredFraming.controls, 'visible');
      assert.deepEqual({ crop: restoredFraming.crop, draftId: restoredFraming.draftId, characterId: restoredFraming.characterId, name: restoredFraming.name }, framingSession, 'Re-expansion restores the same framing session and crop.');
      const resumedLoopRect = await window.webContents.executeJavaScript(`document.querySelector('#dock-loop-search-seconds').getBoundingClientRect().toJSON()`);
      const resumedX = Math.round(resumedLoopRect.x + resumedLoopRect.width * .55);
      const resumedY = Math.round(resumedLoopRect.y + resumedLoopRect.height / 2);
      window.webContents.sendInputEvent({ type: 'mouseMove', x: resumedX, y: resumedY });
      window.webContents.sendInputEvent({ type: 'mouseDown', x: resumedX, y: resumedY, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: resumedX, y: resumedY, button: 'left', clickCount: 1 });
      await delay(40);
      monitor.state = null;
      monitor.emit('change', null);
      await delay(40);
      const resumedLoopFocus = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({active:document.activeElement?.id,mode:dockState.mode,textInputActive})`));
      assert.equal(resumedLoopFocus.active, 'dock-loop-search-seconds', 'Retraction and re-expansion must not leave the duration field uneditable.');
      assert.equal(resumedLoopFocus.mode, 'framing');
      assert.equal(resumedLoopFocus.textInputActive, true);
      const resumedSpinnerX = Math.round(resumedLoopRect.right - 8);
      const resumedSpinnerY = Math.round(resumedLoopRect.y + resumedLoopRect.height * .25);
      window.webContents.sendInputEvent({ type: 'mouseMove', x: resumedSpinnerX, y: resumedSpinnerY });
      window.webContents.sendInputEvent({ type: 'mouseDown', x: resumedSpinnerX, y: resumedSpinnerY, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: resumedSpinnerX, y: resumedSpinnerY, button: 'left', clickCount: 1 });
      await delay(60);
      assert.equal(dock.state.loopSearchSeconds, 9, 'Spinner input still works after the dock is re-expanded.');
      const loopUnitLayout = JSON.parse(await window.webContents.executeJavaScript(`(()=>{
        const row=document.querySelector('.loop-search-field').getBoundingClientRect();
        const unit=document.querySelector('.loop-search-value > span').getBoundingClientRect();
        const skip=document.querySelector('[data-command=finish-without-portrait]').getBoundingClientRect();
        return JSON.stringify({rowTop:row.top,rowLeft:row.left,skipBottom:skip.bottom,skipLeft:skip.left,rowRight:row.right,unitRight:unit.right});
      })()`));
      assert.ok(loopUnitLayout.rowTop >= loopUnitLayout.skipBottom, `Retraction keeps the duration row beneath Skip portrait (${JSON.stringify(loopUnitLayout)}).`);
      assert.ok(Math.abs(loopUnitLayout.rowLeft - loopUnitLayout.skipLeft) <= .5, `Retraction preserves left alignment with Skip portrait (${JSON.stringify(loopUnitLayout)}).`);
      assert.ok(loopUnitLayout.unitRight <= loopUnitLayout.rowRight + .5, `The seconds unit must stay inside the moved row (${JSON.stringify(loopUnitLayout)}).`);

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
      dock.update({ mode: 'compact', error: '', capture: null, liveEnabled: true, liveCanApply: true, liveSelectedName: 'Archived Aella', liveTargetAvailable: false, liveDetectedName: '', liveUndoUntil: 0 });
      await delay(30);
      const readPrismState = async () => JSON.parse(await window.webContents.executeJavaScript(`(()=>{
        const dock=document.querySelector('.dock').getBoundingClientRect();
        const read=(selector)=>{
          const button=document.querySelector(selector);
          const rect=button.getBoundingClientRect();
          const beam=getComputedStyle(button,'::before');
          return {disabled:button.disabled,height:rect.height,left:rect.left,right:rect.right,animation:beam.animationName,content:beam.content,pointerEvents:beam.pointerEvents};
        };
        return JSON.stringify({dock:{left:dock.left,right:dock.right},quickAdd:read('[data-command=quick-add]'),import:read('[data-command=live-import]'),apply:read('[data-command=live-prepare-apply]')});
      })()`));
      const assertPrismFit = (state) => {
        assert.equal(state.dock.right - state.dock.left, 680, 'Prominent live controls must preserve the dock width.');
        for (const [name, button] of [['Quick add', state.quickAdd], ['Import', state.import], ['Apply', state.apply]]) {
          assert.equal(button.height, state.quickAdd.height, `${name} must match Quick add's height.`);
          assert.ok(button.left >= state.dock.left && button.right <= state.dock.right, `${name} must remain inside the dock.`);
          assert.equal(button.pointerEvents, 'none', `${name}'s decorative beam must not intercept input.`);
        }
      };
      dock.update({ quickAddReady: false });
      await delay(30);
      const disabledPrism = await readPrismState();
      assertPrismFit(disabledPrism);
      assert.equal(disabledPrism.quickAdd.disabled, true, 'Quick Add is disabled without eligible clipboard DNA.');
      assert.equal(disabledPrism.import.disabled, true, 'Import starts disabled until a real target is detected.');
      assert.equal(disabledPrism.apply.disabled, true, 'A gallery selection alone cannot enable Apply.');
      for (const button of [disabledPrism.quickAdd, disabledPrism.import, disabledPrism.apply]) {
        assert.equal(button.animation, 'none', 'Disabled action buttons must not animate.');
        assert.equal(button.content, 'none', 'Disabled action buttons must not render a prism layer.');
      }
      assert.match(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-import]").title'), /Open a character window/);
      assert.match(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").title'), /Open a character window/);
      dock.update({ liveTargetAvailable: true, liveDetectedName: 'Aella', quickAddReady: true });
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").disabled'), false);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-import]").disabled'), false);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").disabled'), false);
      assert.match(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").title'), /Archived Aella.*Aella/);
      const enabledPrism = await readPrismState();
      assertPrismFit(enabledPrism);
      assert.equal(enabledPrism.quickAdd.animation, 'live-prism');
      assert.equal(enabledPrism.import.animation, 'live-prism');
      assert.equal(enabledPrism.apply.animation, 'live-prism');
      if (process.env.CK3_GAME_DOCK_LIVE_SCREENSHOT) {
        window.setContentProtection(false);
        const rect = await window.webContents.executeJavaScript('document.querySelector(".dock").getBoundingClientRect().toJSON()');
        const image = await window.webContents.capturePage({ x: Math.max(0, Math.floor(rect.x) - 8), y: 0, width: Math.ceil(rect.width) + 16, height: 62 });
        await require('node:fs/promises').writeFile(process.env.CK3_GAME_DOCK_LIVE_SCREENSHOT, image.toPNG());
      }
      dock.update({ liveCanApply: false, liveSelectedName: '' });
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-import]").disabled'), false, 'Clearing the gallery selection does not disable Import.');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").disabled'), true);
      assert.match(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").title'), /Copy persistent or Base64 DNA/);
      const independentPrism = await readPrismState();
      assertPrismFit(independentPrism);
      assert.equal(independentPrism.quickAdd.animation, 'live-prism', 'Quick Add retains its beam independently of the live actions.');
      assert.equal(independentPrism.import.animation, 'live-prism', 'Import retains its beam without an Apply source.');
      assert.equal(independentPrism.apply.animation, 'none', 'Apply loses its beam without a DNA source.');
      const cdp = window.webContents.debugger;
      cdp.attach('1.3');
      try {
        await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        const reducedPrism = await readPrismState();
        assert.equal(reducedPrism.quickAdd.animation, 'none', 'Reduced motion must stop Quick Add’s prism animation.');
        assert.equal(reducedPrism.import.animation, 'none', 'Reduced motion must stop Import’s prism animation.');
        assert.equal(reducedPrism.apply.animation, 'none', 'Reduced motion must stop the enabled-state prism animation.');
      } finally {
        await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        cdp.detach();
      }
      dock.update({ liveCanApply: true, liveApplySource: 'clipboard', liveClipboardFormat: 'persistent', liveSelectedName: '' });
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").disabled'), false, 'Clipboard DNA enables Apply without a gallery selection.');
      assert.match(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").title'), /Persistent clipboard DNA.*Aella/);
      await window.webContents.executeJavaScript('{ window.__applyDock = document.querySelector(".dock"); document.querySelector("[data-command=live-prepare-apply]").click(); }');
      await delay(40);
      const applyMotion = JSON.parse(await window.webContents.executeJavaScript(`(()=>{const dock=document.querySelector('.dock');return JSON.stringify({sameNode:window.__applyDock===dock,height:dock.getBoundingClientRect().height,heightTransition:dock.getAnimations().some((animation)=>animation.transitionProperty==='height')});})()`));
      assert.equal(applyMotion.sameNode, true, 'Apply preserves the dock element throughout its collapse.');
      assert.equal(applyMotion.heightTransition, true, 'Apply uses the same CSS height transition as pointer exit.');
      assert.ok(applyMotion.height > 6 && applyMotion.height < 48, `Apply is visibly mid-collapse (${applyMotion.height}px).`);
      assert.equal(dock.state.mode, 'compact', 'Apply returns directly to the normal controls without a confirmation or result screen.');
      assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector(".live-confirm, [data-command=live-confirm-apply]"))'), false, 'Apply confirmation UI and commands are removed.');
      assert.equal(dock.state.message, '');
      const firstApplyId = dock.state.liveApplyId;
      const firstUndoDeadline = dock.state.liveUndoUntil;
      assert.ok(firstApplyId);
      const immediateRetraction = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({revealed:dockView.revealed,pending:dockView.pending,clock:Boolean(captureClock),undo:Boolean(document.querySelector('[data-command=live-undo]')),importDisabled:document.querySelector('[data-command=live-import]').disabled,applyDisabled:document.querySelector('[data-command=live-prepare-apply]').disabled})`));
      assert.equal(immediateRetraction.revealed, false, 'Apply starts retracting immediately, without a 1.8-second delay.');
      assert.equal(immediateRetraction.pending, false);
      assert.equal(immediateRetraction.clock, true, 'The latest Undo clock continues while the dock is retracted.');
      assert.equal(immediateRetraction.undo, true);
      assert.equal(immediateRetraction.importDisabled, false, 'Import stays available during the Undo period.');
      assert.equal(immediateRetraction.applyDisabled, false, 'Apply stays available during the Undo period.');
      await delay(260);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dock").getBoundingClientRect().height'), 6);
      monitor.state = null;
      monitor.emit('change', null);
      assert.equal(window.isVisible(), false);
      monitor.state = game;
      monitor.emit('change', game);
      await delay(40);
      const returnedToGame = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({visible:dockState.visible,revealed:dockView.revealed,deadline:dockState.liveUndoUntil,id:dockState.liveApplyId,height:document.querySelector('.dock').getBoundingClientRect().height})`));
      assert.equal(returnedToGame.visible, true);
      assert.equal(returnedToGame.revealed, false, 'Alt-Tab leaves the normal dock retracted.');
      assert.equal(returnedToGame.deadline, firstUndoDeadline, 'Alt-Tab must not restart the Undo deadline.');
      assert.equal(returnedToGame.id, firstApplyId);
      assert.equal(returnedToGame.height, 6);
      dock.present();
      await delay(20);
      assert.equal(await window.webContents.executeJavaScript('dockView.revealed'), false, 'Same-state publication cannot reveal the dock.');
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
      await delay(260);
      const revealedUndo = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({revealed:dockView.revealed,height:document.querySelector('.dock').getBoundingClientRect().height,undo:Boolean(document.querySelector('[data-command=live-undo]')),importDisabled:document.querySelector('[data-command=live-import]').disabled,applyDisabled:document.querySelector('[data-command=live-prepare-apply]').disabled})`));
      assert.equal(revealedUndo.revealed, true);
      assert.equal(revealedUndo.height, 48);
      assert.equal(revealedUndo.undo, true);
      assert.equal(revealedUndo.importDisabled, false);
      assert.equal(revealedUndo.applyDisabled, false);
      liveTargetName = 'Second Character';
      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").click()');
      await delay(40);
      assert.equal(liveApplyCount, 2, 'A second character can be modified during the first Undo period.');
      assert.equal(dock.state.mode, 'compact');
      assert.equal(dock.state.liveTargetName, 'Second Character');
      assert.notEqual(dock.state.liveApplyId, firstApplyId, 'The second Apply replaces the first Undo identity.');
      assert.ok(dock.state.liveUndoUntil > firstUndoDeadline, 'The second Apply restarts the 18-second Undo deadline.');
      assert.equal(await window.webContents.executeJavaScript('dockView.revealed'), false, 'Every new Apply retracts immediately, even from an open Undo control.');
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
      await delay(260);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-undo]").click()');
      await delay(40);
      assert.equal(dock.state.mode, 'compact');
      assert.equal(dock.state.liveUndoUntil, 0);
      assert.equal(dock.state.message, '');
      assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector("[data-command=live-undo]"))'), false, 'Undo removes the latest operation control.');
      dock.update({ mode: 'compact', liveCanApply: true, liveApplySource: 'gallery', liveClipboardFormat: '', liveSelectedName: 'Archived Aella' });
      await window.webContents.executeJavaScript('{ window.__importDock = document.querySelector(".dock"); document.querySelector("[data-command=live-import]").click(); }');
      await delay(40);
      const importMotion = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify({sameNode:window.__importDock===document.querySelector('.dock'),height:document.querySelector('.dock').getBoundingClientRect().height,animating:Boolean(dockHeightAnimation)})`));
      assert.equal(importMotion.sameNode, true, 'Import preserves the dock element throughout expansion.');
      assert.equal(importMotion.animating, true, 'Import animates into its variable-height draft.');
      assert.ok(importMotion.height > 48, 'Import is visibly partway through its height transition.');
      assert.equal(dock.state.liveImported, true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dna-state").textContent.includes("Persistent DNA")'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#draft-destination").textContent.trim()'), 'House of Wessex');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#draft-destination").disabled'), false);
      await window.webContents.executeJavaScript(`{ document.querySelector('#character-name').value='Aella of the Stepstones'; document.querySelector('#draft-destination').click(); }`);
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('dockView.pickerSource'), 'draft');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#draft-destination").getAttribute("aria-expanded")'), 'true');
      const draftPickerGeometry = JSON.parse(await window.webContents.executeJavaScript(`(()=>{const anchor=document.querySelector('#draft-destination').getBoundingClientRect();const picker=document.querySelector('.draft-picker').getBoundingClientRect();return JSON.stringify({anchorLeft:anchor.left,anchorBottom:anchor.bottom,anchorWidth:anchor.width,pickerLeft:picker.left,pickerTop:picker.top,pickerWidth:picker.width,name:document.querySelector('#character-name').value});})()`));
      assert.equal(draftPickerGeometry.name, 'Aella of the Stepstones', 'Opening Destination preserves the edited character name.');
      assert.ok(Math.abs(draftPickerGeometry.anchorLeft - draftPickerGeometry.pickerLeft) < 1);
      assert.ok(Math.abs(draftPickerGeometry.anchorWidth - draftPickerGeometry.pickerWidth) < 1);
      assert.ok(draftPickerGeometry.pickerTop >= draftPickerGeometry.anchorBottom, 'The gallery picker opens below its Destination control.');
      await window.webContents.executeJavaScript(`{ const input=document.querySelector('#collection-filter'); input.value='Mediterranean'; input.dispatchEvent(new Event('input',{bubbles:true})); }`);
      assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".collection-option").length'), 1);
      await window.webContents.executeJavaScript('document.querySelector(".collection-option").click()');
      await delay(40);
      assert.equal(dock.state.collection, 'Mediterranean characters');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#draft-destination").textContent.trim()'), 'Mediterranean characters');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#character-name").value'), 'Aella of the Stepstones');
      await window.webContents.executeJavaScript('document.querySelector("[data-command=create-record][data-frame=false]").click()');
      await delay(40);
      assert.equal(createRecordCommands.at(-1).collection, 'Mediterranean characters', 'Import saves to the gallery chosen inside its draft.');
      assert.equal(createRecordCommands.at(-1).name, 'Aella of the Stepstones');
      assert.equal(createRecordCommands.at(-1).frame, false);
      assert.equal(dock.state.mode, 'success');
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
      const beforeCancelledDraftCreates = createRecordCommands.length;
      await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").click()');
      await delay(40);
      assert.equal(dock.state.mode, 'draft', 'Quick Add works after the retired Import completes late.');
      await window.webContents.executeJavaScript('document.querySelector(".dock-heading [data-command=cancel-draft]").click()');
      await delay(40);
      assert.equal(createRecordCommands.length, beforeCancelledDraftCreates, 'Cancelling a staged Quick Add creates no archive entry.');
      dock.update({ mode: 'compact', liveEnabled: true, busy: false });

      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-prepare-apply]").click()');
      await delay(40);
      assert.equal(dock.state.mode, 'compact');
      assert.equal(dock.state.liveApplySource, 'gallery');
      assert.equal(dock.state.liveSelectedName, 'Archived Aella');
      assert.equal(dock.state.liveTargetName, 'Second Character');
      assert.equal(dock.state.message, '');
      assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector(".live-confirm, [data-command=live-confirm-apply]"))'), false);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=live-undo]").disabled'), false);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-undo]").click()');
      await delay(40);
      assert.equal(dock.state.mode, 'compact');
      assert.equal(dock.state.message, '');
      assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector("[data-command=live-undo]"))'), false);
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
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('dockHovered'), true);
      monitor.state = null;
      monitor.emit('change', null);
      assert.equal(window.isVisible(), false);
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('dockHovered'), false, 'Hiding clears the renderer hover latch.');
      monitor.state = game;
      monitor.emit('change', game);
      await delay(40);
      await window.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:window.innerWidth/2,clientY:2}))`);
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('dockHovered'), true, 'A fresh hover is published after hide/show.');
      monitor.state = null;
      monitor.emit('change', null);
      assert.equal(window.isVisible(), false);
      assert.ok(monitor.restoreFocusCalls.length >= 1);
      console.log('Game dock runtime passed: sandbox, states, collection search, framing, capture, errors, menus, hover reset, and focus cleanup.');
    } finally {
      dock.destroy();
    }
  }

  const timeout = setTimeout(() => { console.error('Game dock runtime timed out.'); app.exit(1); }, 20_000);
  app.whenReady().then(main).then(() => { clearTimeout(timeout); app.quit(); }).catch((error) => { console.error(error); clearTimeout(timeout); process.exitCode = 1; app.quit(); });
}
