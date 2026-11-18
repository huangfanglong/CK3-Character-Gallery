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
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    dock = new GameDock({
      BrowserWindow, screen, monitor,
      htmlPath: path.join(__dirname, '..', 'electron', 'game-dock.html'),
      preloadPath: path.join(__dirname, '..', 'electron', 'game-dock-preload.cjs'),
      onCommand: async ({ type, payload }) => {
        if (type === 'select-collection') { dock.setPreferences({ collection: payload.collection }); dock.update({ collection: payload.collection }); }
        if (type === 'set-position') dock.setPreferences({ position: payload.position });
        if (type === 'quick-add') dock.update({ mode: 'draft', dnaReady: true, characterName: '' });
        if (type === 'create-record') dock.update({ mode: payload.frame ? 'framing' : 'success', characterId: 'character-1', characterName: payload.name || 'Unnamed character', dnaAttached: true, crop: { centerX: .5, centerY: .5, size: .35 }, sourceSize: { width: 1600, height: 900 }, undoUntil: Date.now() + 10_000 });
        if (type === 'snapshot') dock.update({ mode: 'success', capture: null, message: 'Portrait and DNA saved.', undoUntil: Date.now() + 10_000 });
        if (type === 'live-capture') dock.update({ mode: 'capture', capture: { state: 'recording', startedAt: Date.now() - 2200 } });
        if (type === 'toggle-capture') dock.update({ capture: { ...dock.state.capture, state: 'matching' } });
        if (['dismiss', 'cancel-draft', 'finish-without-portrait', 'cancel-capture'].includes(type)) dock.update({ mode: 'compact', capture: null, crop: null, characterId: null });
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
      await delay(280);
      const revealedGeometry = JSON.parse(await window.webContents.executeJavaScript(`(()=>{ const dock=document.querySelector('.dock'); const rect=dock.getBoundingClientRect(); return JSON.stringify({width:rect.width,height:rect.height,revealed:dockView.revealed,controls:getComputedStyle(document.querySelector('.dock-bar')).visibility,color:getComputedStyle(dock).color}); })()`));
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
      await delay(240);
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
      await window.webContents.executeJavaScript(`{ const input = document.querySelector('#character-name'); input.value = 'Ragnhild of Jorvik'; document.querySelector('[data-command=create-record][data-frame=true]').click(); }`);
      await delay(80);
      assert.equal(dock.state.characterName, 'Ragnhild of Jorvik');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=open-collections]").disabled'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#portrait-reticle") !== null'), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".crop-handle").length'), 4);
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

      await window.webContents.executeJavaScript('document.querySelector("[data-command=live-capture]").click()');
      await delay(50);
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".capture-copy strong").textContent'), /Recording/);
      assert.match(await window.webContents.executeJavaScript('document.querySelector("#capture-time").textContent'), /^00:0[02]$/);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#portrait-reticle").classList.contains("locked")'), true);
      await window.webContents.executeJavaScript('document.querySelector("[data-command=toggle-capture]").click()');
      await delay(50);
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".capture-copy strong").textContent'), /smooth loop/);

      dock.update({ mode: 'success', capture: null, crop: null, message: 'Portrait and DNA saved.', undoUntil: Date.now() + 10_000 });
      await delay(30);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=undo-create]").disabled'), false);
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".success-actions").textContent'), /View in gallery/);
      dock.update({ mode: 'error', error: 'The CK3 window is no longer available.' });
      await delay(30);
      assert.match(await window.webContents.executeJavaScript('document.querySelector(".dock-body").textContent'), /no longer available/);
      dock.update({ mode: 'compact', error: '', capture: null });
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
