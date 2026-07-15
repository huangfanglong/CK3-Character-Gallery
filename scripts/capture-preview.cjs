const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const output = process.argv[2];
if (!output) throw new Error('Pass an output PNG path.');

const electron = require('electron');
const child = spawn(electron, ['.', '--remote-debugging-port=9333'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'ignore',
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function target() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch('http://127.0.0.1:9333/json').then((response) => response.json());
      const page = targets.find((item) => item.type === 'page');
      if (page) return page;
    } catch {}
    await delay(250);
  }
  throw new Error('Renderer debugging target did not become available.');
}

async function command(socket, method, params = {}) {
  const id = Math.floor(Math.random() * 1_000_000);
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      socket.removeEventListener('message', listener);
      payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
    };
    socket.addEventListener('message', listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  try {
    const page = await target();
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    await command(socket, 'Page.enable');
    await delay(1200);
    await command(socket, 'Runtime.evaluate', {
      expression: "document.querySelector('.character-card')?.click()",
    });
    await delay(350);
    const screenshot = await command(socket, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
    socket.close();
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
