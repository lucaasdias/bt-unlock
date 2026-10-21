// test/router.test.js — exercises js/router.js's three-level D-pad focus
// model (Task 9, superseding Task 8's original flat "Left/Right/Back
// globally switches screens" design): a persistent tab bar (Left/Right
// switches screens live), Down/Up/Back moving between the tab bar and a
// screen's content area, and — once inside content — Up/Down between rows
// and Left/Right between a single row's own action buttons (paired.js's
// Disconnect/Reconnect + Forget), plus the MutationObserver-driven focus
// recovery after a screen rebuilds its own rows (discover.js's poll,
// paired.js's load()) and the busy-disable/re-enable case — both
// carried over unchanged from Task 8, now re-verified against the new
// row/column model.
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

// setUp(rowSpecs) -> {dom, router, root, clickLog, activeText(), activeIsBody(), navLabels()}
//   Installs a fresh fake DOM as the global `document`/`MutationObserver`
//   router.js reads at call time, then mounts a router over screens shaped
//   by `rowSpecs`: { screenName: [rowSize, rowSize, ...] }. A rowSize of 1
//   renders a single standalone <button> (discover.js's/status.js's
//   shape: the row IS the one action, no shared row wrapper needed). A
//   rowSize > 1 renders that many buttons inside one <li class="device-row">
//   (paired.js's shape: several actions sharing one row, same class
//   js/screens/paired.js's real markup and css/app.css's `.device-row`
//   component use), so the router's row-grouping (see router.js's
//   findRowKey/getRowGroups) has real row-mates to group.
function setUp(rowSpecs) {
  const dom = createFakeDom();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;

  const clickLog = [];

  function makeScreen(name, rowSpec) {
    return {
      label: name,
      render: function (container) {
        rowSpec.forEach(function (rowSize, rowIndex) {
          const wrapper = rowSize > 1 ? dom.document.createElement('li') : null;
          if (wrapper) {
            wrapper.className = 'device-row';
            container.appendChild(wrapper);
          }
          for (let i = 0; i < rowSize; i += 1) {
            const button = dom.document.createElement('button');
            button.type = 'button';
            const label = name + '-row' + rowIndex + '-' + i;
            button.textContent = label;
            button.addEventListener('click', function () {
              clickLog.push(label);
            });
            (wrapper || container).appendChild(button);
          }
        });
      }
    };
  }

  const screens = {};
  Object.keys(rowSpecs).forEach(function (name) {
    screens[name] = makeScreen(name, rowSpecs[name]);
  });

  const router = createRouter(screens);
  const root = dom.document.createElement('div');
  router.mount(root, Object.keys(rowSpecs)[0]);

  return {
    dom: dom,
    router: router,
    root: root,
    clickLog: clickLog,
    activeText: function () { return dom.document.activeElement.textContent; },
    activeIsBody: function () { return dom.document.activeElement === dom.document.body; },
    navCurrent: function () {
      return root.querySelectorAll('.app-nav-button')
        .map(function (el) { return el.getAttribute('aria-current'); });
    }
  };
}

// ---- Level 1: the tab bar ----

test('mounting the app focuses the initial screen\'s tab, not its content', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  assert.strictEqual(t.activeText(), 'a');
  assert.deepStrictEqual(t.navCurrent(), ['true', 'false', 'false']);
});

test('Right on the tab bar switches screens live (no Enter needed) and wraps', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowRight', 39);
  assert.strictEqual(t.activeText(), 'b');
  assert.deepStrictEqual(t.navCurrent(), ['false', 'true', 'false']);
  t.dom.fireKey('ArrowRight', 39);
  assert.strictEqual(t.activeText(), 'c');
  t.dom.fireKey('ArrowRight', 39); // wraps back to a
  assert.strictEqual(t.activeText(), 'a');
});

test('Left on the tab bar wraps from the first screen to the last', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowLeft', 37);
  assert.strictEqual(t.activeText(), 'c');
});

test('Up/Enter on the tab bar do nothing (already at the top level)', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowUp', 38);
  assert.strictEqual(t.activeText(), 'a');
  t.dom.fireKey('Enter', 13);
  assert.deepStrictEqual(t.clickLog, []);
  assert.strictEqual(t.activeText(), 'a');
});

// ---- Level 1 <-> 2: entering/leaving a screen's content ----

test('Down from the tab bar enters the screen, focusing its first row', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowDown', 40);
  assert.strictEqual(t.activeText(), 'a-row0-0');
});

test('Down into a screen with no focusable rows leaves focus on <body>, no throw', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowRight', 39); // tab bar: a -> b
  t.dom.fireKey('ArrowRight', 39); // tab bar: b -> c (zero rows)
  t.dom.fireKey('ArrowDown', 40); // try to enter c's (empty) content
  assert.strictEqual(t.activeIsBody(), true);
});

test('Up from a content area\'s first row returns focus to the tab bar', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowDown', 40); // enter content, row0
  assert.strictEqual(t.activeText(), 'a-row0-0');
  t.dom.fireKey('ArrowUp', 38); // already first row -> exits to tab bar
  assert.strictEqual(t.activeText(), 'a');
  assert.deepStrictEqual(t.navCurrent(), ['true', 'false', 'false']);
});

test('Back from anywhere in a content area returns focus to the tab bar', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowDown', 40); // enter content, row0
  t.dom.fireKey('ArrowDown', 40); // row1
  assert.strictEqual(t.activeText(), 'a-row1-0');
  t.dom.fireKey('Back', 461);
  assert.strictEqual(t.activeText(), 'a');
});

test('switching screens always lands back on the tab bar, even mid-content', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowDown', 40); // enter a's content, row0
  t.dom.fireKey('ArrowDown', 40); // row1
  t.dom.fireKey('ArrowUp', 38); // row1 -> row0
  t.dom.fireKey('ArrowUp', 38); // row0 -> tab bar
  assert.strictEqual(t.activeText(), 'a');
  t.dom.fireKey('ArrowRight', 39); // tab bar: a -> b
  assert.strictEqual(t.activeText(), 'b');
  // re-entering a later starts fresh at its first row, not where we left it
  t.dom.fireKey('ArrowLeft', 37); // back to a
  t.dom.fireKey('ArrowDown', 40); // enter a's content again
  assert.strictEqual(t.activeText(), 'a-row0-0');
});

// ---- Level 2: inside a content area ----

test('Down moves focus to the next row and clamps at the last one', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowDown', 40); // enter content
  t.dom.fireKey('ArrowDown', 40);
  assert.strictEqual(t.activeText(), 'a-row1-0');
  t.dom.fireKey('ArrowDown', 40);
  assert.strictEqual(t.activeText(), 'a-row2-0');
  t.dom.fireKey('ArrowDown', 40); // already at the last row — must not wrap
  assert.strictEqual(t.activeText(), 'a-row2-0');
});

test('Enter activates whichever row currently has focus, not some other row', () => {
  const t = setUp({ a: [1, 1, 1], b: [1, 1], c: [] });
  t.dom.fireKey('ArrowDown', 40); // enter content, row0
  t.dom.fireKey('ArrowDown', 40); // row1
  t.dom.fireKey('Enter', 13);
  assert.deepStrictEqual(t.clickLog, ['a-row1-0']);
});

test('Left/Right move between a single row\'s own action buttons, not the screen', () => {
  // row0 has two actions (paired.js's Disconnect/Reconnect + Forget
  // shape: both inside one <li class="device-row">).
  const t = setUp({ a: [2, 1], b: [1] });
  t.dom.fireKey('ArrowDown', 40); // enter content, lands on row0's first button
  assert.strictEqual(t.activeText(), 'a-row0-0');
  t.dom.fireKey('ArrowRight', 39);
  assert.strictEqual(t.activeText(), 'a-row0-1');
  t.dom.fireKey('ArrowRight', 39); // already the row's last action — clamps, no wrap, no screen switch
  assert.strictEqual(t.activeText(), 'a-row0-1');
  t.dom.fireKey('ArrowLeft', 37);
  assert.strictEqual(t.activeText(), 'a-row0-0');
  t.dom.fireKey('ArrowLeft', 37); // already the row's first action — clamps
  assert.strictEqual(t.activeText(), 'a-row0-0');
  // the active screen never changed through any of this
  assert.deepStrictEqual(t.navCurrent(), ['true', 'false']);
});

test('Left/Right on a single-action row (discover.js\'s shape) is a harmless no-op', () => {
  const t = setUp({ a: [1, 1], b: [1] });
  t.dom.fireKey('ArrowDown', 40);
  assert.strictEqual(t.activeText(), 'a-row0-0');
  t.dom.fireKey('ArrowRight', 39);
  assert.strictEqual(t.activeText(), 'a-row0-0'); // nowhere to go — stays put
  t.dom.fireKey('ArrowLeft', 37);
  assert.strictEqual(t.activeText(), 'a-row0-0');
});

test('moving rows preserves column when the new row has enough actions, clamps when it doesn\'t', () => {
  const t = setUp({ a: [2, 1, 2] }); // row0: 2 actions, row1: 1, row2: 2
  t.dom.fireKey('ArrowDown', 40); // row0-0
  t.dom.fireKey('ArrowRight', 39); // row0-1
  t.dom.fireKey('ArrowDown', 40); // row1 only has one action — column clamps to 0
  assert.strictEqual(t.activeText(), 'a-row1-0');
  t.dom.fireKey('ArrowDown', 40); // row2 has 2 actions again, but column was clamped to 0 on row1
  assert.strictEqual(t.activeText(), 'a-row2-0');
});

// This is the scenario router.js's header comment calls out by name:
// discover.js's ~2s poll (and paired.js's load()) fully rebuilds its row
// list — `container.innerHTML = ''` then new buttons — which silently
// blurs whatever had focus back to <body>. The MutationObserver in
// router.js is what notices and restores focus, by row/column, once the
// rebuilt rows exist — but only while focus is logically inside the
// content area (see the next test for the "user stepped back to the tab
// bar first" case).
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
  dom.fireKey('ArrowDown', 40); // enter content, row-A
  dom.fireKey('ArrowDown', 40); // row-B

  assert.strictEqual(dom.document.activeElement.textContent, 'row-B');

  rebuild(); // simulates discover.js's poll / paired.js's load()
  await dom.flush(); // let the MutationObserver's microtask callback run

  assert.strictEqual(dom.document.activeElement.textContent, 'row-B2');
});

test('a mid-poll rebuild does not steal focus back from the tab bar', async () => {
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
      build(['row-A', 'row-B']);
      rebuild = function () { build(['row-A2', 'row-B2']); };
    }
  };

  const router = createRouter({ d: dynamicScreen });
  const root = dom.document.createElement('div');
  router.mount(root, 'd');
  dom.fireKey('ArrowDown', 40); // enter content
  dom.fireKey('ArrowUp', 38); // step back up to the tab bar deliberately

  assert.strictEqual(dom.document.activeElement.textContent, 'd');

  rebuild();
  await dom.flush();

  // Still on the tab bar — the poll rebuild must not reclaim focus.
  assert.strictEqual(dom.document.activeElement.textContent, 'd');
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
  dom.fireKey('ArrowDown', 40); // enter content, row "x"
  dom.fireKey('ArrowDown', 40); // focus row "y" (index 1)
  assert.strictEqual(dom.document.activeElement.textContent, 'y');

  rows.forEach(function (row) { row.disabled = true; }); // simulates setBusy(true)
  assert.strictEqual(dom.document.activeElement, dom.document.body);

  rows.forEach(function (row) { row.disabled = false; }); // simulates setBusy(false)
  await dom.flush();

  assert.strictEqual(dom.document.activeElement.textContent, 'y');
});

// ---- Scrollable focused element (status.js's log viewer, Task 9 round
// 7): a `[tabindex]` element carrying the `scrollable-content` class is
// an ordinary row for Up/Down-between-rows purposes, EXCEPT while it has
// focus, where Up/Down scroll its own content first — falling through
// to the normal row-to-row behavior only once it's scrolled all the way
// to that edge, or has nothing to scroll in that direction at all.
// scrollTop/scrollHeight/clientHeight are plain mutable properties on
// test/helpers/fake-dom.js's FakeElement (nothing special needed there),
// set directly here to simulate "has more to scroll" vs. "already at
// the edge" without depending on any real layout engine.
function setUpScrollScreen() {
  const dom = createFakeDom();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;

  let scrollBox;
  let afterButton;
  const screen = {
    label: 's',
    render: function (container) {
      scrollBox = dom.document.createElement('pre');
      scrollBox.className = 'log-box scrollable-content';
      scrollBox.setAttribute('tabindex', '0');
      scrollBox.scrollTop = 50;
      scrollBox.scrollHeight = 200;
      scrollBox.clientHeight = 100; // max scrollTop = 100
      container.appendChild(scrollBox);

      afterButton = dom.document.createElement('button');
      afterButton.type = 'button';
      afterButton.textContent = 'after';
      container.appendChild(afterButton);
    }
  };

  const router = createRouter({ s: screen });
  const root = dom.document.createElement('div');
  router.mount(root, 's');
  dom.fireKey('ArrowDown', 40); // enter content, lands on the scroll box (row 0)

  return {
    dom: dom,
    scrollBox: function () { return scrollBox; },
    afterButton: function () { return afterButton; }
  };
}

test('Down scrolls a focused scrollable element instead of moving rows', () => {
  const ctx = setUpScrollScreen();
  assert.strictEqual(ctx.dom.document.activeElement, ctx.scrollBox());

  ctx.dom.fireKey('ArrowDown', 40);

  assert.strictEqual(ctx.scrollBox().scrollTop, 100, 'scrolled down by the step, clamped to max');
  assert.strictEqual(ctx.dom.document.activeElement, ctx.scrollBox(), 'focus stays on the scroll box, did not move to the next row');
});

test('Up scrolls it the other way, also without moving rows', () => {
  const ctx = setUpScrollScreen();

  ctx.dom.fireKey('ArrowUp', 38);

  assert.strictEqual(ctx.scrollBox().scrollTop, 0, 'scrolled up by the step (50 - 60, clamped to 0)');
  assert.strictEqual(ctx.dom.document.activeElement, ctx.scrollBox());
});

test('once scrolled to the bottom edge, Down falls through to the normal next-row behavior', () => {
  const ctx = setUpScrollScreen();
  ctx.scrollBox().scrollTop = 100; // already at max (scrollHeight 200 - clientHeight 100)

  ctx.dom.fireKey('ArrowDown', 40);

  assert.strictEqual(ctx.scrollBox().scrollTop, 100, 'nothing left to scroll, so scrollTop is untouched');
  assert.strictEqual(ctx.dom.document.activeElement, ctx.afterButton(), 'Down moved to the next row instead');
});

test('once scrolled to the top edge, Up falls through to exit to the tab bar (it is the first row)', () => {
  const ctx = setUpScrollScreen();
  ctx.scrollBox().scrollTop = 0; // already at the top

  ctx.dom.fireKey('ArrowUp', 38);

  assert.notStrictEqual(ctx.dom.document.activeElement, ctx.scrollBox(), 'Up exited the content area, same as any other first row');
});

test('an element with nothing to scroll (fits entirely) behaves as a plain row — Up/Down move rows normally', () => {
  const dom = createFakeDom();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;

  let scrollBox;
  let afterButton;
  const screen = {
    label: 's2',
    render: function (container) {
      scrollBox = dom.document.createElement('pre');
      scrollBox.className = 'log-box scrollable-content';
      scrollBox.setAttribute('tabindex', '0');
      // scrollTop/scrollHeight/clientHeight all default to 0/undefined —
      // nothing to scroll, same as fake-dom's usual (no real layout
      // engine) state, or a real short log that fits without overflow.
      container.appendChild(scrollBox);

      afterButton = dom.document.createElement('button');
      afterButton.type = 'button';
      afterButton.textContent = 'after';
      container.appendChild(afterButton);
    }
  };

  const router = createRouter({ s2: screen });
  const root = dom.document.createElement('div');
  router.mount(root, 's2');
  dom.fireKey('ArrowDown', 40); // enter content, row 0 (the scroll box)

  dom.fireKey('ArrowDown', 40);
  assert.strictEqual(dom.document.activeElement, afterButton, 'Down moves to the next row, not an attempted (impossible) scroll');
});
