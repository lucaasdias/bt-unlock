// test/router.test.js — exercises js/router.js's Task 8 D-pad focus logic
// (Up/Down row focus + clamping, Left/Right/Back screen switching +
// wrap, Enter activation, and MutationObserver-driven focus recovery
// after a screen rebuilds its own rows) against the real shipped module,
// not a reimplementation.
//
// router.js is written for a real browser DOM (document.createElement,
// MutationObserver, etc.), which `node --test` doesn't provide on its
// own. Rather than adding this project's first-ever npm dependency
// (jsdom or similar) just for this file, test/helpers/fake-dom.js is a
// small hand-rolled DOM covering exactly what router.js touches — see
// that file's own header for what it does and doesn't support.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createFakeDom } = require('./helpers/fake-dom.js');
const { createRouter } = require('../js/router.js');

// setUp() -> {document, fireKey, flush, router, root}
//   Installs a fresh fake DOM as the global `document`/`MutationObserver`
//   router.js reads at call time, then mounts a router over three fake
//   screens (3 rows, 2 rows, 0 rows) shaped like status/discover/paired
//   enough to exercise every branch: normal row navigation, clamping,
//   and a screen with no actionable rows.
function setUp(rowCounts) {
  const dom = createFakeDom();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;

  const clickLog = [];

  function makeScreen(name, rowCount) {
    return {
      label: name,
      render: function (container) {
        for (let i = 0; i < rowCount; i += 1) {
          const button = dom.document.createElement('button');
          button.type = 'button';
          button.textContent = name + '-row-' + i;
          button.addEventListener('click', function () {
            clickLog.push(name + '-row-' + i);
          });
          container.appendChild(button);
        }
      }
    };
  }

  const screens = {};
  Object.keys(rowCounts).forEach(function (name) {
    screens[name] = makeScreen(name, rowCounts[name]);
  });

  const router = createRouter(screens);
  const root = dom.document.createElement('div');
  router.mount(root, Object.keys(rowCounts)[0]);

  return {
    dom: dom,
    router: router,
    root: root,
    clickLog: clickLog,
    activeText: function () { return dom.document.activeElement.textContent; },
    activeIsBody: function () { return dom.document.activeElement === dom.document.body; }
  };
}

test('mounting a screen focuses its first row', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  assert.strictEqual(t.activeText(), 'a-row-0');
});

test('Down moves focus to the next row and clamps at the last one', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  t.dom.fireKey('ArrowDown', 40);
  assert.strictEqual(t.activeText(), 'a-row-1');
  t.dom.fireKey('ArrowDown', 40);
  assert.strictEqual(t.activeText(), 'a-row-2');
  t.dom.fireKey('ArrowDown', 40); // already at the last row — must not wrap
  assert.strictEqual(t.activeText(), 'a-row-2');
});

test('Up moves focus to the previous row and clamps at the first one', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  t.dom.fireKey('ArrowDown', 40);
  t.dom.fireKey('ArrowDown', 40);
  assert.strictEqual(t.activeText(), 'a-row-2');
  t.dom.fireKey('ArrowUp', 38);
  assert.strictEqual(t.activeText(), 'a-row-1');
  t.dom.fireKey('ArrowUp', 38);
  t.dom.fireKey('ArrowUp', 38); // already at the first row — must not wrap
  assert.strictEqual(t.activeText(), 'a-row-0');
});

test('Enter activates whichever row currently has focus, not some other row', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  t.dom.fireKey('ArrowDown', 40); // focus a-row-1
  t.dom.fireKey('Enter', 13);
  assert.deepStrictEqual(t.clickLog, ['a-row-1']);
});

test('Right switches to the next screen and resets focus to its first row', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  t.dom.fireKey('ArrowDown', 40); // focus a-row-1, to prove the new screen does not inherit this index
  t.dom.fireKey('ArrowRight', 39);
  assert.strictEqual(t.activeText(), 'b-row-0');

  const current = t.root.querySelectorAll('.app-nav-button')
    .map(function (el) { return el.getAttribute('aria-current'); });
  assert.deepStrictEqual(current, ['false', 'true', 'false']);
});

test('Right onto a screen with no focusable rows leaves focus on <body>, no throw', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  t.dom.fireKey('ArrowRight', 39); // a -> b
  t.dom.fireKey('ArrowRight', 39); // b -> c (zero rows)
  assert.strictEqual(t.activeIsBody(), true);
});

test('Right wraps from the last screen back to the first', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  t.dom.fireKey('ArrowRight', 39); // a -> b
  t.dom.fireKey('ArrowRight', 39); // b -> c
  t.dom.fireKey('ArrowRight', 39); // c -> wraps to a
  assert.strictEqual(t.activeText(), 'a-row-0');
});

test('Back behaves like Left (goes to the previous screen)', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  t.dom.fireKey('ArrowRight', 39); // a -> b
  t.dom.fireKey('ArrowRight', 39); // b -> c
  t.dom.fireKey('Back', 461);      // c -> back to b, same as Left
  assert.strictEqual(t.activeText(), 'b-row-0');
});

test('Left from the first screen wraps to the last', () => {
  const t = setUp({ a: 3, b: 2, c: 0 });
  t.dom.fireKey('ArrowLeft', 37);
  assert.strictEqual(t.activeIsBody(), true); // wraps to screen c, which has 0 rows
});

// This is the scenario router.js's header comment calls out by name:
// discover.js's ~2s poll (and paired.js's load()) fully rebuilds its row
// list — `container.innerHTML = ''` then new buttons — which silently
// blurs whatever had focus back to <body>. The MutationObserver in
// router.js is what notices and restores focus, by row index, once the
// rebuilt rows exist.
test('focus survives a screen rebuilding its own rows mid-session (same row index)', async () => {
  const dom = createFakeDom();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;

  let rebuild;
  const dynamicScreen = {
    label: 'd',
    render: function (container) {
      function build(labels) {
        container.innerHTML = '';
        labels.forEach(function (label) {
          const button = dom.document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          container.appendChild(button);
        });
      }
      build(['row-A', 'row-B', 'row-C']);
      rebuild = function () { build(['row-A2', 'row-B2', 'row-C2']); };
    }
  };

  const router = createRouter({ d: dynamicScreen });
  const root = dom.document.createElement('div');
  router.mount(root, 'd');

  assert.strictEqual(dom.document.activeElement.textContent, 'row-A');
  dom.fireKey('ArrowDown', 40);
  assert.strictEqual(dom.document.activeElement.textContent, 'row-B');

  rebuild(); // simulates discover.js's poll / paired.js's load()
  await dom.flush(); // let the MutationObserver's microtask callback run

  assert.strictEqual(dom.document.activeElement.textContent, 'row-B2');
});

test('busy-disabling the focused row blurs it, and re-enabling restores it by index', async () => {
  const dom = createFakeDom();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;

  let rows;
  const screen = {
    label: 'e',
    render: function (container) {
      rows = ['x', 'y', 'z'].map(function (label) {
        const button = dom.document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        container.appendChild(button);
        return button;
      });
    }
  };

  const router = createRouter({ e: screen });
  const root = dom.document.createElement('div');
  router.mount(root, 'e');

  dom.fireKey('ArrowDown', 40); // focus row "y" (index 1)
  assert.strictEqual(dom.document.activeElement.textContent, 'y');

  rows.forEach(function (row) { row.disabled = true; }); // simulates setBusy(true)
  assert.strictEqual(dom.document.activeElement, dom.document.body);

  rows.forEach(function (row) { row.disabled = false; }); // simulates setBusy(false)
  await dom.flush();

  assert.strictEqual(dom.document.activeElement.textContent, 'y');
});
