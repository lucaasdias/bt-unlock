// test/discover.test.js — exercises js/screens/discover.js's bounded-
// search state machine (Task 9 round 3): discovery no longer starts
// automatically on mount, instead the user presses a Search/Stop button
// that runs the existing ~2s poll loop for a bounded SEARCH_WINDOW_MS
// window, ending either when that window elapses or the user stops it
// manually — and, either way, without clearing whatever devices were
// already found.
//
// discover.js is written to be loaded either as a browser <script> (which
// reads its dependencies off `window.exec`/`window.classify`/
// `window.isAdapterPowered`/`window.t`) or under Node via CommonJS
// (which `require()`s the real modules instead). Those dependencies are
// read at the IIFE's own invocation time (the bottom of the file), not
// per-call, so to inject fakes under `node --test` this file defines a
// `global.window` *before* requiring discover.js — same trick used
// nowhere else in this project, but the smallest way to get fakes in
// without adding this project's first-ever test-only production code
// path. `global.document` still comes from test/helpers/fake-dom.js,
// same as test/router.test.js already does for js/router.js.
//
// Node's built-in `node:test` mock timers (stable since Node 20.4, no
// added dependency) stand in for setTimeout/clearTimeout so the ~35s
// search window can be exercised without an actual 35s wait.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createFakeDom } = require('./helpers/fake-dom.js');

// setUp() -> {root, mount, cleanup, setExecImpl, setPowered, execCalls, findButton}
//   Mounts discover.js's render() against a fresh fake DOM with
//   controllable exec()/isAdapterPowered() fakes and a tiny literal
//   string table (just the keys this screen actually renders) standing
//   in for t(). classify() is stubbed to always return a supported
//   profile so every fake device in these tests renders a row — the
//   classify/profile-filtering logic itself is devices.test.js's job,
//   not this file's.
function setUp() {
  const dom = createFakeDom();
  global.document = dom.document;

  const execCalls = [];
  let execImpl = function () {
    return Promise.resolve({ ok: true, replies: [{ devices: [] }] });
  };
  function exec() {
    const args = Array.prototype.slice.call(arguments);
    execCalls.push(args);
    return execImpl.apply(null, args);
  }

  let powered = true;
  function isAdapterPowered() {
    return Promise.resolve(powered);
  }

  function classify() {
    return { profile: 'hid', iconId: 'gamepad', kind: 'gamepad' };
  }

  const strings = {
    'discover.heading': 'Discover devices',
    'discover.adapterOffMessage': 'The Bluetooth adapter is off.',
    'discover.goToStatus': 'Go to Status',
    'discover.searchButton': 'Search',
    'discover.stopSearchButton': 'Stop',
    'discover.searchPrompt': 'Press Search to look for nearby devices.',
    'discover.scanning': 'Scanning...',
    'discover.discoveryFailed': 'Discovery failed: {error}',
    'device.kind.gamepad': 'gamepad'
  };
  function t(key, vars) {
    var value = Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
    if (!vars) {
      return value;
    }
    return value.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match;
    });
  }

  global.window = {
    exec: exec,
    classify: classify,
    isAdapterPowered: isAdapterPowered,
    t: t
  };

  delete require.cache[require.resolve('../js/screens/discover.js')];
  const { render } = require('../js/screens/discover.js');

  const root = dom.document.createElement('div');
  let cleanupFn = null;
  const navigated = [];

  function mount() {
    cleanupFn = render(root, function (name) {
      navigated.push(name);
    });
  }

  function findButton(text) {
    return root.querySelectorAll('button').filter(function (button) {
      return button.textContent === text;
    })[0];
  }

  return {
    root: root,
    mount: mount,
    cleanup: function () {
      if (cleanupFn) {
        cleanupFn();
      }
    },
    setExecImpl: function (fn) {
      execImpl = fn;
    },
    setPowered: function (value) {
      powered = value;
    },
    execCalls: execCalls,
    findButton: findButton,
    navigated: navigated
  };
}

// tick() -> Promise<void>
//   Flushes pending microtasks (promise .then() chains) without relying
//   on setTimeout, which node:test's mock timers below take over.
function tick() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

function fakeDeviceListResult(devices) {
  return Promise.resolve({ ok: true, replies: [{ devices: devices }] });
}

test('idle on mount: shows the search prompt, not an auto-started scan', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function () {
    throw new Error('exec() should not be called before Search is pressed');
  });
  ctx.mount();
  await tick();

  assert.ok(ctx.findButton('Search'), 'Search button should be present');
  assert.strictEqual(ctx.root.querySelectorAll('.list-empty').length, 1);
  assert.strictEqual(ctx.execCalls.length, 0);

  ctx.cleanup();
});

test('idle -> searching -> stopped by the search window timing out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const ctx = setUp();
  ctx.setExecImpl(function (script, args) {
    assert.strictEqual(script, 'bt-discover.sh');
    if (args[0] === 'start') {
      return fakeDeviceListResult([{ address: 'AA:BB:CC', name: 'Pad', classOfDevice: 1 }]);
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  const searchButton = ctx.findButton('Search');
  assert.ok(searchButton);
  searchButton.click();
  await tick();

  assert.ok(ctx.findButton('Stop'), 'button relabels to Stop while searching');
  assert.strictEqual(ctx.root.querySelectorAll('.device-row').length, 1, 'the found device is rendered');
  const startCallsBeforeTimeout = ctx.execCalls.filter(function (call) {
    return call[1][0] === 'start';
  }).length;
  assert.ok(startCallsBeforeTimeout >= 1);

  // Let the ~35s bounded search window elapse without the user doing
  // anything.
  t.mock.timers.tick(35000);
  await tick();

  assert.ok(ctx.findButton('Search'), 'button reverts to Search once the window times out');
  assert.strictEqual(
    ctx.execCalls.some(function (call) { return call[0] === 'bt-discover.sh' && call[1][0] === 'stop'; }),
    true,
    'adapter/cancelDiscovery (via bt-discover.sh stop) is called when the window times out'
  );
  // The device found during the search is still visible/selectable —
  // the list is not cleared just because the window ran out.
  assert.strictEqual(ctx.root.querySelectorAll('.device-row').length, 1);
  assert.strictEqual(ctx.root.querySelectorAll('.list-empty').length, 0);

  // No further 'start' polling should happen once stopped: advancing
  // time well past another poll interval should not add new exec calls.
  const execCallCountAfterStop = ctx.execCalls.length;
  t.mock.timers.tick(10000);
  await tick();
  assert.strictEqual(ctx.execCalls.length, execCallCountAfterStop, 'polling has actually stopped, not just the UI label');

  ctx.cleanup();
});

test('idle -> searching -> stopped manually keeps the found device list', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const ctx = setUp();
  ctx.setExecImpl(function (script, args) {
    if (args[0] === 'start') {
      return fakeDeviceListResult([
        { address: 'AA:BB:CC', name: 'Pad', classOfDevice: 1 },
        { address: 'DD:EE:FF', name: 'Pad 2', classOfDevice: 1 }
      ]);
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  ctx.findButton('Search').click();
  await tick();
  assert.strictEqual(ctx.root.querySelectorAll('.device-row').length, 2);

  // User stops the search well before the window would have elapsed.
  ctx.findButton('Stop').click();
  await tick();

  assert.ok(ctx.findButton('Search'), 'button reverts to a startable state');
  assert.strictEqual(
    ctx.execCalls.some(function (call) { return call[1][0] === 'stop'; }),
    true,
    'manually stopping also fires the adapter-side cancel'
  );
  // The two devices found before the user stopped are still there.
  assert.strictEqual(ctx.root.querySelectorAll('.device-row').length, 2);
  assert.strictEqual(ctx.root.querySelectorAll('.list-empty').length, 0);

  // The window timer itself must have been cancelled too — advancing
  // past where it would have fired must not trigger a second, redundant
  // stop (which would otherwise show up as a second 'stop' exec call).
  const stopCallCountAfterManualStop = ctx.execCalls.filter(function (call) {
    return call[1][0] === 'stop';
  }).length;
  t.mock.timers.tick(40000);
  await tick();
  const stopCallCountAfterWaiting = ctx.execCalls.filter(function (call) {
    return call[1][0] === 'stop';
  }).length;
  assert.strictEqual(stopCallCountAfterWaiting, stopCallCountAfterManualStop);

  ctx.cleanup();
});

test('adapter-off prompt still takes priority over the search button', async () => {
  const ctx = setUp();
  ctx.setPowered(false);
  ctx.setExecImpl(function () {
    throw new Error('exec() should not run discovery while the adapter is off');
  });
  ctx.mount();
  await tick();

  assert.ok(!ctx.findButton('Search'), 'no search button while the adapter-off prompt is showing');
  assert.ok(ctx.findButton('Go to Status'));

  ctx.cleanup();
});
