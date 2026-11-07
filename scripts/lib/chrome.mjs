// Drives the sidebar preview (tools/preview) in headless Chrome through the DevTools protocol, over
// a pipe: no port, no dependencies. Used by the webview tests, the screenshots and the demo GIF.
//
//   const page = await openPage({ width: 320, height: 1100 });
//   await page.goto(previewUrl({ shot: 1 }));
//   await page.click('.row');            // real mouse events: :hover and focus behave as for a user
//   await page.screenshot('shot.png');
//   await page.close();
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';

export const root = path.resolve(import.meta.dirname, '../..');

export function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p) => p && fs.existsSync(p));
}

/** The preview page, with query parameters such as { shot: 1, theme: 'light' }. */
export function previewUrl(params = {}) {
  const url = pathToFileURL(path.join(root, 'tools/preview/index.html'));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.href;
}

const KEY_CODES = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Backspace: 8,
  Delete: 46,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  F2: 113,
  F10: 121,
  ' ': 32,
};
const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export async function openPage({ width = 320, height = 1100, scale = 2, chrome = findChrome() } = {}) {
  if (!chrome) throw new Error('Google Chrome or Chromium not found; set CHROME_PATH');
  if (!fs.existsSync(path.join(root, 'dist/webview.js'))) throw new Error('Build first: npm run build');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-chrome-'));
  const proc = spawn(
    chrome,
    [
      '--headless',
      '--remote-debugging-pipe',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const [, , , toChrome, fromChrome] = proc.stdio;
  let nextId = 1;
  const calls = new Map();
  const waiters = [];
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const failAll = (err) => {
    for (const { reject } of calls.values()) reject(err);
    calls.clear();
  };
  proc.on('exit', () => failAll(new Error('Chrome exited')));
  proc.on('error', failAll);
  fromChrome.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    for (let end = buffer.indexOf('\0'); end !== -1; end = buffer.indexOf('\0')) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const call = msg.id === undefined ? undefined : calls.get(msg.id);
      if (call) {
        calls.delete(msg.id);
        if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
        else call.resolve(msg.result);
      } else if (msg.method) {
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].method === msg.method) waiters.splice(i, 1)[0].resolve(msg.params);
        }
      }
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      calls.set(id, { resolve, reject, method });
      toChrome.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  const event = (method, ms = 10_000) =>
    new Promise((resolve, reject) => {
      const w = { method, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i !== -1) {
          waiters.splice(i, 1);
          reject(new Error(`timed out waiting for ${method}`));
        }
      }, ms).unref();
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (method, params) => send(method, params, sessionId);
  await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  // Transitions off, so every frame and every check sees the finished state.
  await cmd('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });

  const page = {
    cmd,
    pointer: { x: 0, y: 0 },
    async goto(url) {
      const loaded = event('Page.loadEventFired');
      await cmd('Page.navigate', { url });
      await loaded;
    },
    /** The value of a JavaScript expression in the page (promises are awaited). */
    async eval(expression) {
      const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      }
      return r.result.value;
    },
    /** Waits until the expression is truthy, and returns its value. */
    async until(expression, ms = 5000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const v = await page.eval(expression);
        if (v) return v;
        if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expression}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    /** The centre of the first element matching the selector, scrolled into view. */
    async centre(selector) {
      const box = await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      })()`);
      if (!box) throw new Error(`nothing visible matches ${selector}`);
      return box;
    },
    async move(x, y) {
      await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      page.pointer = { x, y };
    },
    async hover(selector) {
      const { x, y } = await page.centre(selector);
      await page.move(x, y);
    },
    /** A real click (press and release) on the element, or at a point. */
    async click(target, { button = 'left' } = {}) {
      await page.down(target, { button });
      await page.up({ button });
    },
    /** Presses a mouse button on the element, or at a point, and holds it. */
    async down(target, { button = 'left' } = {}) {
      const { x, y } = typeof target === 'string' ? await page.centre(target) : target;
      await page.move(x, y);
      await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
    },
    /** Releases the button where the pointer is. */
    async up({ button = 'left' } = {}) {
      const { x, y } = page.pointer;
      await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
    },
    /** A key press, such as 'ArrowDown' or 'Enter', with modifiers such as ['meta']. */
    async key(key, modifiers = []) {
      const mods = modifiers.reduce((m, k) => m | MODIFIERS[k], 0);
      const code = key === ' ' ? 'Space' : key;
      const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;
      const base = { key, code, windowsVirtualKeyCode: KEY_CODES[key] ?? 0, modifiers: mods };
      await cmd('Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', text });
      await cmd('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    },
    async type(text) {
      await cmd('Input.insertText', { text });
    },
    /** A PNG of the page, or of a region of it in CSS pixels. */
    async screenshot(file, clip) {
      const { data } = await cmd('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
      });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    async close() {
      if (proc.exitCode === null && proc.signalCode === null) {
        const exited = new Promise((r) => proc.once('exit', r));
        send('Browser.close').catch(() => {});
        await Promise.race([exited, new Promise((r) => setTimeout(r, 3000).unref())]);
        proc.kill();
      }
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
  return page;
}
