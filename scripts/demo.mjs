#!/usr/bin/env node
// Records docs/images/demo.gif for the README: the sidebar preview (made-up data) in headless
// Chrome, with a drawn pointer doing what a user would. It starts a session on another account,
// moves a session there from its menu, and switches the account new tabs start on.
//   npm run demo      (needs Google Chrome and ffmpeg: brew install ffmpeg)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openPage, previewUrl, root } from './lib/chrome.mjs';

const FPS = 20;
const OUT = path.join(root, 'docs/images/demo.gif');
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-demo-'));
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('ffmpeg not found: brew install ffmpeg');
  process.exit(1);
}

const page = await openPage({ width: 320, height: 1200, scale: 2 });
try {
  // The page's clock moves one frame per frame: taking a frame is slower than real time, and
  // "now" shouldn't turn into "1m" halfway through a 14-second loop.
  await page.cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.demoClock = 0; { const start = Date.now(); Date.now = () => start + window.demoClock; }',
  });
  await page.goto(previewUrl({ shot: 1 }));
  await page.until(`document.querySelectorAll('.row').length > 0`);
  // Room for the session this demo adds, so nothing scrolls.
  const height = Math.ceil((await page.eval('document.documentElement.scrollHeight')) + 30);
  await page.cmd('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await page.eval(`(() => {
    const css = document.createElement('style');
    css.textContent = '#demo-pointer{position:fixed;left:0;top:0;width:22px;height:22px;z-index:100000;pointer-events:none}' +
      '#demo-ripple{position:fixed;left:0;top:0;border-radius:50%;border:2px solid rgba(255,255,255,.75);z-index:99999;pointer-events:none;opacity:0}' +
      '#demo-fade{position:fixed;inset:0;background:var(--vscode-sideBar-background);z-index:100001;pointer-events:none;opacity:0}';
    document.head.appendChild(css);
    const pointer = document.createElement('div');
    pointer.id = 'demo-pointer';
    pointer.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2v16l4.2-3.9 2.8 6.4 2.6-1.1-2.7-6.2h5.7z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    const ripple = document.createElement('div');
    ripple.id = 'demo-ripple';
    const fade = document.createElement('div');
    fade.id = 'demo-fade';
    document.body.append(ripple, pointer, fade);
    window.demo = (x, y, r, o, f) => {
      pointer.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)';
      ripple.style.width = ripple.style.height = 2 * r + 'px';
      ripple.style.transform = 'translate(' + (x - r) + 'px,' + (y - r) + 'px)';
      ripple.style.opacity = o;
      fade.style.opacity = f;
    };
  })()`);

  let n = 0;
  let ripple = { r: 0, o: 0 };
  let fade = 0;
  const frame = async () => {
    const { x, y } = page.pointer;
    await page.eval(`demoClock = ${(n * 1000) / FPS}; demo(${x}, ${y}, ${ripple.r}, ${ripple.o}, ${fade})`);
    await page.screenshot(path.join(frames, `f${String(n++).padStart(5, '0')}.png`));
  };
  const hold = async (seconds) => {
    for (let i = Math.round(seconds * FPS); i > 0; i--) await frame();
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  /** Moves the pointer to an element (or a point) along an eased path, a real mouse move per frame. */
  const glide = async (target, seconds) => {
    const to = typeof target === 'string' ? await page.centre(target) : target;
    const from = { ...page.pointer };
    const steps = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      await page.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await frame();
    }
  };
  /** A click where the pointer is, then the stand-in extension's answer, with a ripple. */
  const press = async () => {
    await page.click(page.pointer);
    await new Promise((r) => setTimeout(r, 150));
    for (let i = 1; i <= 7; i++) {
      ripple = { r: 5 + i * 2.2, o: Math.max(0, 0.9 - i * 0.13) };
      await frame();
    }
    ripple = { r: 0, o: 0 };
  };
  const fadeTo = async (target, seconds) => {
    const from = fade;
    const steps = Math.round(seconds * FPS);
    for (let i = 1; i <= steps; i++) {
      fade = from + (target - from) * (i / steps);
      await frame();
    }
  };
  /** The session menu's item for an account, under a heading. */
  const menuItem = async (heading, label) => {
    const ok = await page.eval(`(() => {
      const h = [...document.querySelectorAll('.menu .menu-label')].find((e) => e.textContent === ${JSON.stringify(heading)});
      for (let el = h?.nextElementSibling; el && !el.matches('.menu-label, .menu-sep'); el = el.nextElementSibling)
        if (el.querySelector('.mi-label')?.textContent === ${JSON.stringify(label)}) return el.setAttribute('data-demo', 'target'), true;
      return false;
    })()`);
    if (!ok) throw new Error(`no menu item ${label} under ${heading}`);
    return '[data-demo="target"]';
  };
  const row = (n) =>
    `.row[data-id="${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}"]`;

  // The pointer rests at the same spot at the start and the end, so the loop doesn't jump.
  const rest = { x: 250, y: height - 60 };
  await page.move(rest.x, rest.y);
  fade = 1;
  await fadeTo(0, 0.35);
  await hold(1.1);
  // 1. A new session on another account.
  await glide('.card[data-account="work"] [data-act="new"]', 0.9);
  await hold(0.25);
  await press();
  await hold(1.1);
  // 2. Move a session to that account from its menu.
  await glide(`${row(3)} .title`, 0.9);
  await hold(0.35);
  await glide(`${row(3)} [data-act="sessionMenu"]`, 0.45);
  await hold(0.2);
  await press();
  await hold(0.55);
  await glide(await menuItem('Move to account', 'you@work.example'), 0.8);
  await hold(0.45);
  await press();
  await hold(1.3);
  // 3. New tabs in this window start on that account.
  await glide('.card[data-account="work"] [data-act="pick"]', 0.9);
  await hold(0.25);
  await press();
  await hold(1.5);
  await glide(rest, 0.7);
  await fadeTo(1, 0.35);
} finally {
  await page.close();
}

// One palette for the whole loop (UI colours, no dithering: crisp text), and only the changed
// rectangle stored per frame.
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    path.join(frames, 'f%05d.png'),
    '-vf',
    'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop',
    '0',
    OUT,
  ],
  { stdio: 'inherit' },
);
const count = fs.readdirSync(frames).length;
fs.rmSync(frames, { recursive: true, force: true });
console.log(
  `${path.relative(root, OUT)}: ${count} frames, ${(count / FPS).toFixed(1)} s, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB`,
);
