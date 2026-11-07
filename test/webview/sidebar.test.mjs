// The sidebar in a real browser: headless Chrome drives tools/preview, whose stand-in extension
// answers like the real one, with real mouse and keyboard events. It covers the DOM code that the
// unit tests can't (render, selection, actions, events, keyboard, menus).
//   npm run test:webview        (needs Google Chrome or Chromium; CHROME_PATH to pick one)
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { findChrome, openPage, previewUrl } from '../../scripts/lib/chrome.mjs';

if (!findChrome() && process.env.CI) throw new Error('CI needs Chrome for the webview tests');
const skip = findChrome() ? false : 'needs Google Chrome or Chromium (set CHROME_PATH)';

/** The preview's made-up session ids: id(3) is 33333333-3333-4333-8333-333333333333. */
const id = (n) => {
  const d = String(n);
  return `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`;
};
const row = (n) => `.row[data-id="${id(n)}"]`;
const json = (v) => JSON.stringify(v);

let page;
before(async () => {
  if (!skip) page = await openPage({ width: 320, height: 1100 });
});
after(async () => page?.close());
beforeEach(async () => {
  if (skip) return;
  await page.goto(previewUrl({ shot: 1 }));
  await page.until(`document.querySelectorAll('.row').length > 0`);
});

const posted = () => page.eval('window.posted ?? []');
const forget = () => page.eval('window.posted = []');
const rowIds = () => page.eval(`[...document.querySelectorAll('.row')].map((r) => r.dataset.id)`);
const focusedId = () => page.eval('document.activeElement?.dataset.id ?? null');
const titleOf = (n) =>
  page.eval(`document.querySelector(${json(row(n))}).querySelector('.title').textContent`);
const menuLabels = () =>
  page.eval(
    `[...document.querySelectorAll('.menu .menu-item, .menu .menu-label')].map((e) => e.matches('.menu-label') ? '# ' + e.textContent : e.querySelector('.mi-label').textContent + (e.disabled ? ' [off]' : ''))`,
  );
/** Marks the element an expression finds, so it can be clicked by selector. */
async function mark(expression, what) {
  const found = await page.eval(`(() => {
    for (const e of document.querySelectorAll('[data-test]')) e.removeAttribute('data-test');
    const el = ${expression};
    if (el) el.setAttribute('data-test', 'target');
    return Boolean(el);
  })()`);
  assert.ok(found, `no ${what}`);
  return '[data-test="target"]';
}
/** A menu item by its label, optionally only under a given heading. */
const menuItem = (label, heading) =>
  mark(
    `(() => {
      const start = ${heading ? `[...document.querySelectorAll('.menu .menu-label')].find((h) => h.textContent === ${json(heading)})` : `document.querySelector('.menu')?.firstElementChild`};
      for (let el = start; el; el = el.nextElementSibling) {
        if (${Boolean(heading)} && el !== start && el.matches('.menu-sep, .menu-label')) return null;
        if (el.matches('.menu-item') && el.querySelector('.mi-label').textContent === ${json(label)}) return el;
      }
      return null;
    })()`,
    `menu item ${label}`,
  );
const openSessionMenu = async (n) => {
  await page.hover(row(n));
  await page.click(`${row(n)} [data-act="sessionMenu"]`);
  await page.until(`document.querySelector('.menu')`);
};

test('renders the accounts and the folder’s sessions grouped by account', { skip }, async () => {
  assert.deepEqual((await posted())[0], { type: 'ready' }, 'it says it’s ready once loaded');
  assert.equal(await page.eval(`document.querySelectorAll('.card').length`), 3);
  assert.deepEqual(
    await page.eval(`[...document.querySelectorAll('.group-title')].map((e) => e.textContent)`),
    ['you@example.com', 'you@work.example', 'Unassigned'],
  );
  assert.deepEqual(await rowIds(), [1, 3, 6, 2, 4, 5, 7].map(id), 'archived sessions are left out');
  assert.equal(
    await page.eval(`[...document.querySelectorAll('.row')].filter((r) => r.tabIndex === 0).length`),
    1,
  );
  assert.match(await page.eval(`document.querySelector(${json(row(6))}).textContent`), /→ work/);
  assert.equal(
    await page.eval(`document.querySelector('.card[data-account="work"] .bar > i').style.width`),
    '76%',
    'bar widths come from script, as the CSP allows no inline styles',
  );
});

test('a click opens a session on its account; the menu moves it to another', { skip }, async () => {
  await forget();
  await page.click(`${row(3)} .title`);
  assert.deepEqual(await posted(), [{ type: 'open', id: id(3), account: 'default' }]);
  assert.ok(await page.eval(`document.querySelector(${json(row(3))}).classList.contains('selected')`));

  await openSessionMenu(3);
  assert.deepEqual(await menuLabels(), [
    'Open in a tab',
    'Rename',
    'Archive',
    'Copy session ID',
    '# Open on account',
    'you@example.com',
    'you@work.example',
    '# Move to account',
    'you@example.com [off]',
    'you@work.example',
    'you@client.example',
    'Delete (close it first) [off]',
  ]);
  await forget();
  await page.click(await menuItem('you@work.example', 'Move to account'));
  assert.deepEqual(await posted(), [{ type: 'move', id: id(3), account: 'work' }]);
  assert.equal(await page.eval(`document.querySelector('.menu')`), null, 'the menu closes');
  await page.until(
    `document.querySelector(${json(row(3))}).querySelector('.chip')?.textContent === '→ work'`,
  );

  await openSessionMenu(4);
  await forget();
  await page.click(await menuItem('you@example.com', 'Open on account'));
  assert.deepEqual(await posted(), [{ type: 'open', id: id(4), account: 'default' }]);
});

test(
  'a right-click opens the menu at the pointer; Escape closes it and gives focus back',
  { skip },
  async () => {
    const { x, y } = await page.centre(`${row(4)} .title`);
    await page.click({ x, y }, { button: 'right' });
    await page.until(`document.querySelector('.menu')`);
    const { top, bottom, fits } = await page.eval(`(() => {
      const r = document.querySelector('.menu').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, fits: r.top >= 0 && r.bottom <= innerHeight };
    })()`);
    // Below the pointer, or above it when there's no room below (as here, near the bottom).
    assert.ok(
      Math.abs(top - y) < 2 || Math.abs(bottom - y) < 2,
      `it opens at the pointer (${top}–${bottom} vs ${y})`,
    );
    assert.ok(fits, 'and stays on screen');
    assert.ok(
      await page.eval(`document.activeElement.classList.contains('menu-item')`),
      'the first item has focus',
    );
    await page.key('ArrowDown');
    assert.equal(await page.eval(`document.activeElement.querySelector('.mi-label').textContent`), 'Rename');
    await page.key('Escape');
    assert.equal(await page.eval(`document.querySelector('.menu')`), null);
    assert.equal(await focusedId(), id(4));
  },
);

test('a state that arrives while a menu is open waits until it closes', { skip }, async () => {
  await openSessionMenu(1);
  await page.eval(`(() => {
    const next = JSON.parse(JSON.stringify(state));
    next.sessions[0].title = 'Changed while the menu was open';
    window.postMessage({ type: 'state', state: next }, '*');
  })()`);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await titleOf(1), 'Fix flaky checkout test', 'the open menu isn’t torn down');
  await page.key('Escape');
  await page.until(
    `document.querySelector(${json(row(1))}).querySelector('.title').textContent === 'Changed while the menu was open'`,
  );
});

test('the keyboard: arrows, Home, End, Enter, F2 to rename, Escape to cancel, ⌘⌫', { skip }, async () => {
  await page.click('[data-role="search"]');
  await page.key('ArrowDown');
  assert.equal(await focusedId(), id(1), '↓ in the search box goes to the first session');
  await page.key('ArrowDown');
  assert.equal(await focusedId(), id(3));
  await page.key('End');
  assert.equal(await focusedId(), id(7));
  await page.key('Home');
  assert.equal(await focusedId(), id(1));
  assert.ok(await page.eval(`document.querySelector(${json(row(1))}).classList.contains('selected')`));
  await forget();
  await page.key('Enter');
  assert.deepEqual(await posted(), [{ type: 'open', id: id(1), account: 'default' }]);

  await page.key('F2');
  assert.equal(await page.eval(`document.activeElement.className`), 'rename-input');
  await forget();
  await page.type('Fix the checkout test');
  await page.key('Enter');
  assert.deepEqual(await posted(), [{ type: 'rename', id: id(1), title: 'Fix the checkout test' }]);
  await page.until(`!document.querySelector('.rename-input')`);
  assert.equal(await titleOf(1), 'Fix the checkout test');
  assert.equal(await focusedId(), id(1), 'focus comes back to the row');

  await page.key('F2');
  await page.type('Not this');
  await page.key('Escape');
  assert.equal(await titleOf(1), 'Fix the checkout test', 'Escape cancels');
  await forget();
  await page.key('Backspace', ['meta']);
  assert.deepEqual(await posted(), [{ type: 'delete', id: id(1) }]);
});

test('a rename stays while states from before it arrive', { skip }, async () => {
  // The stand-in extension's state still has the old title: a state built before it handled the rename.
  const stale = `window.postMessage({ type: 'state', state: JSON.parse(JSON.stringify(state)) }, '*')`;
  await page.hover(row(3));
  await page.click(`${row(3)} [data-act="rename"]`);
  await page.until(`document.activeElement?.className === 'rename-input'`);
  await page.eval(stale); // arrives during the rename, so it waits
  await new Promise((r) => setTimeout(r, 50));
  await page.type('Release notes, final');
  await page.key('Enter');
  assert.equal(await titleOf(3), 'Release notes, final', 'the waiting state doesn’t put the old title back');
  await page.eval(stale); // one more, after the rename but before the extension's answer
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await titleOf(3), 'Release notes, final');
  await page.until(`window.posted.some((m) => m.type === 'rename')`);
  await new Promise((r) => setTimeout(r, 150)); // the extension's answer, with the new title
  assert.equal(await titleOf(3), 'Release notes, final');
});

test('a click still lands when a state arrives between the press and the release', { skip }, async () => {
  await forget();
  await page.down('.card[data-account="client"] [data-act="signIn"]');
  // The stand-in extension changes, and sends its state while the button is down.
  await page.eval(`(() => {
    state.sessions[0].title = 'Arrived mid-click';
    window.postMessage({ type: 'state', state: JSON.parse(JSON.stringify(state)) }, '*');
  })()`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await titleOf(1), 'Fix flaky checkout test', 'the state waits while the button is down');
  await page.up();
  assert.deepEqual(await posted(), [{ type: 'signIn', account: 'client' }], 'the click lands');
  await page.until(
    `document.querySelector(${json(row(1))}).querySelector('.title').textContent === 'Arrived mid-click'`,
  );
});

test(
  'search narrows the list and Escape clears it; the tabs switch between all, open and archived',
  { skip },
  async () => {
    await page.click('[data-role="search"]');
    await page.type('auth');
    assert.deepEqual(await rowIds(), [id(2)]);
    assert.equal(await page.eval(`document.querySelector('.row mark')?.textContent`), 'auth');
    await page.key('Escape');
    assert.equal((await rowIds()).length, 7);
    assert.equal(await page.eval(`document.querySelector('[data-role="search"]').value`), '');
    await page.click('[data-filter="archived"]');
    assert.deepEqual(await rowIds(), [id(8)]);
    await page.click('[data-filter="open"]');
    assert.deepEqual(await rowIds(), [1, 3, 2, 5].map(id));
    await page.click('[data-filter="all"]');
    assert.equal((await rowIds()).length, 7);
  },
);

test(
  'account cards: new tabs, a new session, sign in, hiding a per-model limit, folding',
  { skip },
  async () => {
    const card = (name) => `.card[data-account="${name}"]`;
    await forget();
    await page.click(`${card('work')} [data-act="pick"]`);
    await page.until(`document.querySelector(${json(card('work'))}).classList.contains('is-pick')`);
    assert.ok(await page.eval(`document.querySelector(${json(`${card('default')} [data-act="pick"]`)})`));
    await page.click(`${card('work')} [data-act="new"]`);
    await page.click(`${card('client')} [data-act="signIn"]`);
    assert.deepEqual(await posted(), [
      { type: 'pick', account: 'work' },
      { type: 'new', account: 'work' },
      { type: 'signIn', account: 'client' },
    ]);
    await page.until(`document.querySelectorAll('.row').length === 8`);

    const limits = () => page.eval(`document.querySelectorAll(${json(`${card('work')} .limit`)}).length`);
    assert.equal(await limits(), 3);
    await page.click(`${card('work')} .limit [data-act="toggleLimit"]`);
    assert.equal(await limits(), 2, 'the per-model limit is hidden');
    await page.click(`${card('work')} .limits-foot [data-act="toggleLimit"]`);
    assert.equal(await limits(), 3, 'and its ▾ shows it again');

    await page.click('[data-toggle="accounts"]');
    assert.ok(await page.eval(`document.querySelector('#sec-accounts').classList.contains('collapsed')`));
    await page.click('[data-toggle="accounts"]');
    assert.ok(!(await page.eval(`document.querySelector('#sec-accounts').classList.contains('collapsed')`)));
  },
);

test('the account menu offers Remove only for extra accounts', { skip }, async () => {
  await page.click('.card[data-account="default"] [data-act="accountMenu"]');
  await page.until(`document.querySelector('.menu')`);
  assert.ok(!(await menuLabels()).includes('Remove account…'));
  await page.key('Escape');
  await page.click('.card[data-account="work"] [data-act="accountMenu"]');
  await page.until(`document.querySelector('.menu')`);
  assert.deepEqual(await menuLabels(), [
    'New session',
    'Use for new tabs',
    'Sign in again…',
    'Usage details on claude.ai',
    'Remove account…',
  ]);
  await forget();
  await page.click(await menuItem('Remove account…'));
  assert.deepEqual(await posted(), [{ type: 'removeAccount', account: 'work' }]);
});
