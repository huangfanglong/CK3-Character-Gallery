const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electron = require('electron');
const projectRoot = path.join(__dirname, '..');
const debuggingPort = 10000 + Math.floor(Math.random() * 50000);
const smokeDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ck3-shutdown-smoke-'));
const child = spawn(electron, ['.', `--remote-debugging-port=${debuggingPort}`], {
  cwd: projectRoot,
  env: { ...process.env, CK3_GALLERY_TEST_DATA_DIRECTORY: smokeDataDirectory },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const childStderr = [];
const DEVTOOLS_TIMEOUT_MS = 5_000;
let childError = null;
child.once('error', (error) => { childError = error; });
child.stderr?.on('data', (chunk) => childStderr.push(chunk));
const childClose = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function stderrText() {
  return Buffer.concat(childStderr).toString('utf8').trim();
}

function terminateChild() {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

function cleanup() {
  terminateChild();
  try { fs.rmSync(smokeDataDirectory, { recursive: true, force: true }); } catch {}
}

async function getPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (childError) throw childError;
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 1_000);
    try {
      const pages = await fetch(`http://127.0.0.1:${debuggingPort}/json`, { signal: controller.signal }).then((response) => response.json());
      const page = pages.find((candidate) => candidate.type === 'page' && !candidate.url.startsWith('devtools://'));
      if (page) return page;
    } catch {}
    finally { clearTimeout(fetchTimeout); }
    await delay(250);
  }
  throw new Error(`Electron page was not available.${stderrText() ? `\n${stderrText()}` : ''}`);
}

async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Timed out connecting to the Electron DevTools target.')), DEVTOOLS_TIMEOUT_MS);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      if (error) {
        socket.close();
        reject(error);
      } else resolve();
    };
    const onOpen = () => finish();
    const onError = () => finish(new Error('The Electron DevTools target failed to connect.'));
    const onClose = () => finish(new Error('The Electron DevTools target closed before connecting.'));
    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
  });
  return socket;
}

function runtimeCommand(socket, id, expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(`Timed out evaluating the Electron DevTools command: ${expression}`)), DEVTOOLS_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onMessage = (event) => {
      let payload;
      try { payload = JSON.parse(event.data); }
      catch (error) { finish(error); return; }
      if (payload.id !== id) return;
      if (payload.error || payload.result?.exceptionDetails) finish(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      else finish(null, payload.result.result.value);
    };
    const onError = () => finish(new Error('The Electron DevTools target reported a socket error.'));
    const onClose = () => finish(new Error('The Electron DevTools target closed during evaluation.'));
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
    try {
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } }));
    } catch (error) { finish(error); }
  });
}

async function waitForChildClose(timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      childClose,
      new Promise((resolve) => { timeout = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  let socket;
  try {
    socket = await connect(await getPage());
    const bridgeReady = await runtimeCommand(socket, 1, "(async()=>{const deadline=Date.now()+5000;while(typeof window.galleryDesktop?.quit !== 'function' && Date.now()<deadline) await new Promise((resolve)=>setTimeout(resolve,25));return typeof window.galleryDesktop?.quit === 'function';})()", true);
    if (!bridgeReady) throw new Error('The production quit bridge was not available.');
    socket.send(JSON.stringify({
      id: 2,
      method: 'Runtime.evaluate',
      params: { expression: 'window.galleryDesktop.quit().catch(() => {}); true', returnByValue: true },
    }));
    const exit = await waitForChildClose(8_000);
    const stderr = stderrText();
    if (!exit) throw new Error(`Electron did not exit after the production quit request.${stderr ? `\n${stderr}` : ''}`);
    if (exit.code !== 0) throw new Error(`Electron exited with code ${exit.code} and signal ${exit.signal || 'none'}.${stderr ? `\n${stderr}` : ''}`);
    if (/Object has been destroyed/i.test(stderr)) throw new Error(`Electron accessed a destroyed object during shutdown.\n${stderr}`);
    console.log('Main shutdown smoke test passed: the production quit path exits cleanly without destroyed-object errors.');
  } finally {
    socket?.close();
    cleanup();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
