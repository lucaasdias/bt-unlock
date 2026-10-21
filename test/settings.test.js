// test/settings.test.js — exercises js/screens/settings.js's manual
// language override (persistence + applying it live) and the always-
// visible Help/QR docked panel. Does not re-test js/qrcode.js's own
// matrix correctness (see test/qrcode.test.js for that) — only that
// settings.js calls it and renders an SVG when a matrix comes back, and
// still shows the plain URL either way.
//
// The Help panel has gone through three designs: inline (cut off at a
// legible QR size), a full-screen modal (worked, but the human partner
// wanted it docked instead), and now this — an always-visible side
// panel, same pattern as status.js's Log viewer box, no show/hide
// trigger and no focus-trap machinery to test (there's nothing modal
// about it any more — it's just an ordinary, non-interactive part of
// the Settings screen).
//
// Same dependency-injection trick the other screen test files use:
// settings.js reads its dependencies off `window` at its own
// IIFE-invocation time, so `global.window` is set to fakes *before*
// `require()`-ing the module fresh. `global.document` comes from
// test/helpers/fake-dom.js. A tiny fake localStorage stands in for the
// real one (fake-dom.js has no DOM storage concept, and this app's only
// other use of browser storage is this screen).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createFakeDom } = require('./helpers/fake-dom.js');
const { generateQRMatrix } = require('../js/qrcode.js');
const { createRouter } = require('../js/router.js');

var OVERRIDE_KEY = 'bt-unlock.localeOverride';

function createFakeStorage() {
  var store = {};
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem: function (key, value) {
      store[key] = String(value);
    },
    _dump: function () {
      return store;
    }
  };
}

function setUp() {
  const dom = createFakeDom();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;

  var activeLocale = 'pt-BR';
  var setLocaleCalls = [];
  function setLocale(code) {
    setLocaleCalls.push(code);
    activeLocale = code;
    return code;
  }
  function getLocale() {
    return activeLocale;
  }

  const strings = {
    'settings.heading': 'Settings',
    'settings.languageHeading': 'Language',
    'settings.languagePtBR': 'Português',
    'settings.languageEn': 'English',
    'settings.languageEs': 'Español',
    'settings.helpHeading': 'Help'
  };
  function t(key) {
    return Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
  }

  const storage = createFakeStorage();
  const reinitCalls = [];

  global.window = {
    setLocale: setLocale,
    getLocale: getLocale,
    t: t,
    generateQRMatrix: generateQRMatrix,
    localStorage: storage,
    LOCALE_OVERRIDE_STORAGE_KEY: OVERRIDE_KEY,
    reinitApp: function (screen) {
      reinitCalls.push(screen);
    }
  };

  delete require.cache[require.resolve('../js/screens/settings.js')];
  const { render } = require('../js/screens/settings.js');

  const root = dom.document.createElement('div');

  function findButton(text) {
    return root.querySelectorAll('button').filter(function (button) {
      return button.textContent === text;
    })[0];
  }

  return {
    dom: dom,
    render: render,
    root: root,
    mount: function () {
      render(root);
    },
    findButton: findButton,
    storage: storage,
    setLocaleCalls: setLocaleCalls,
    reinitCalls: reinitCalls,
    getLocale: getLocale
  };
}

test('the current locale\'s language button is highlighted on mount', () => {
  const ctx = setUp(); // getLocale() returns 'pt-BR' by default
  ctx.mount();

  assert.match(ctx.findButton('Português').className, /btn-primary/);
  assert.match(ctx.findButton('English').className, /btn-secondary/);
  assert.match(ctx.findButton('Español').className, /btn-secondary/);
});

test('picking a language calls setLocale, persists the choice, and asks for a full re-render', () => {
  const ctx = setUp();
  ctx.mount();

  ctx.findButton('English').click();

  assert.deepStrictEqual(ctx.setLocaleCalls, ['en'], 'setLocale() should be called immediately, live');
  assert.strictEqual(ctx.storage.getItem(OVERRIDE_KEY), 'en', 'the choice must persist in localStorage for next launch');
  assert.deepStrictEqual(ctx.reinitCalls, ['settings'], 'the whole app should be asked to rebuild, landing back on settings');
});

test('switching languages twice persists only the latest choice', () => {
  const ctx = setUp();
  ctx.mount();

  ctx.findButton('English').click();
  ctx.findButton('Español').click();

  assert.strictEqual(ctx.storage.getItem(OVERRIDE_KEY), 'es');
});

test('a missing/throwing localStorage does not crash picking a language', () => {
  const ctx = setUp();
  ctx.mount();

  global.window.localStorage = {
    getItem: function () { throw new Error('blocked'); },
    setItem: function () { throw new Error('blocked'); }
  };

  assert.doesNotThrow(function () {
    ctx.findButton('English').click();
  });
  // setLocale() still ran live even though persistence failed.
  assert.deepStrictEqual(ctx.setLocaleCalls, ['en']);
});

// ---- Help/QR docked panel — always visible, no trigger ----

test('the QR code and plain URL render immediately on mount, with no button press needed', () => {
  const ctx = setUp();
  ctx.mount();

  assert.strictEqual(ctx.root.querySelectorAll('.help-qr-svg').length, 1, 'the QR code renders as soon as the screen mounts');
  const urlText = ctx.root.querySelectorAll('.help-url')[0];
  assert.strictEqual(urlText.textContent, 'https://github.com/lucaasdias/bt-unlock', 'the plain URL is always shown too, as a fallback (see js/qrcode.js header)');
});

test('the panel is docked in its own right-column container, same structure as status.js\'s log panel', () => {
  const ctx = setUp();
  ctx.mount();

  const columns = ctx.root.querySelectorAll('.status-columns')[0];
  const main = ctx.root.querySelectorAll('.status-main')[0];
  const helpPanel = ctx.root.querySelectorAll('.status-log-panel')[0];
  assert.ok(columns && main && helpPanel, 'reuses the exact two-column structure status.js\'s log panel uses');
  assert.ok(main.querySelectorAll('.language-row').length === 1, 'language picker lives in the left (main) column');
  assert.ok(helpPanel.querySelectorAll('.help-qr-panel').length === 1, 'the QR/URL panel lives in the right column');
});

test('there is no modal overlay or show/hide button left in the markup', () => {
  const ctx = setUp();
  ctx.mount();

  assert.strictEqual(ctx.root.querySelectorAll('.modal-overlay').length, 0);
  assert.ok(!ctx.findButton('Get Help'), 'no trigger button — the panel is always visible, like the log box');
});

// ---- Language row: Left/Right within one row, not Up/Down between
// three separate rows (per live feedback — matches paired.js's
// Disconnect/Forget convention) ----

test('the three language buttons are one Left/Right row, not three separate Up/Down rows', () => {
  const ctx = setUp();
  const router = createRouter({ settings: { label: 'Settings', render: ctx.render } });
  router.mount(ctx.root, 'settings');

  ctx.dom.fireKey('Down', 40); // tab bar -> content, first row
  const ptButton = ctx.findButton('Português');
  const enButton = ctx.findButton('English');
  const esButton = ctx.findButton('Español');
  assert.strictEqual(ctx.dom.document.activeElement, ptButton, 'first row, first column');

  ctx.dom.fireKey('Right', 39);
  assert.strictEqual(ctx.dom.document.activeElement, enButton, 'Right moves within the same row');

  ctx.dom.fireKey('Right', 39);
  assert.strictEqual(ctx.dom.document.activeElement, esButton);

  // The language row is the Settings screen's only focusable row now
  // (the QR/URL panel is non-interactive, same as the rest of its
  // content) — Down clamps at the last (only) row rather than moving
  // anywhere, same clamping behavior any single-row screen already has.
  ctx.dom.fireKey('Down', 40);
  assert.strictEqual(ctx.dom.document.activeElement, esButton, 'Down clamps in place — nothing else to move to');
});
