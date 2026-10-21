// test/status.test.js — exercises js/screens/status.js's new "start on TV
// boot" toggle (bt-startup.sh enable/disable/bootstrap), added as a second,
// independent state-pill + button row below the pre-existing adapter-power
// one. No test file existed for status.js before this; this one is
// intentionally scoped to just the new toggle's state-rendering/toggle-call
// logic, not a from-scratch rewrite of coverage for the whole screen.
//
// Same dependency-injection trick test/discover.test.js uses: status.js
// reads its exec()/t() off `window` at its own IIFE-invocation time (the
// bottom of the file), so `global.window` is set to fakes *before*
// `require()`-ing the module fresh. `global.document` comes from
// test/helpers/fake-dom.js, same as test/router.test.js/test/discover.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createFakeDom } = require('./helpers/fake-dom.js');
const { createRouter } = require('../js/router.js');

function setUp() {
  const dom = createFakeDom();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;

  const execCalls = [];
  let execImpl = function (script) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    if (script === 'bt-startup.sh') {
      return Promise.resolve({ ok: true, replies: [{ enabled: false }] });
    }
    if (script === 'bt-log.sh') {
      return Promise.resolve({ ok: true, replies: [{ lines: '' }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  };
  function exec() {
    const args = Array.prototype.slice.call(arguments);
    execCalls.push(args);
    return execImpl.apply(null, args);
  }

  const strings = {
    'status.heading': 'Bluetooth',
    'status.checking': 'Checking...',
    'status.turnOn': 'Turn on',
    'status.adapterOn': 'Adapter: on',
    'status.adapterOff': 'Adapter: off',
    'status.startupOn': 'Start on TV boot: on',
    'status.startupOff': 'Start on TV boot: off',
    'status.startupUnknown': 'Start on TV boot: unknown',
    'status.startupEnableButton': 'Enable',
    'status.startupDisableButton': 'Disable',
    'status.startupToggleError': 'Could not update the startup setting: {error}',
    'status.turnOffButton': 'Turn off',
    'status.turnOffWarning': 'Magic Remote warning text',
    'status.turnOffConfirmButton': 'Yes, turn off',
    'status.turnOffCancelButton': 'Cancel',
    'status.turnOffError': 'Could not turn off the adapter: {error}',
    'status.logHeading': 'Log',
    'status.logRefreshButton': 'Refresh log',
    'status.logEmpty': 'No log entries yet.',
    'status.logError': 'Could not read the log: {error}'
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

  global.window = { exec: exec, t: t };

  delete require.cache[require.resolve('../js/screens/status.js')];
  const { render } = require('../js/screens/status.js');

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
    setExecImpl: function (fn) {
      execImpl = fn;
    },
    execCalls: execCalls,
    findButton: findButton
  };
}

function tick() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

test('startup toggle renders disabled state and an Enable button on mount', async () => {
  const ctx = setUp();
  ctx.mount();
  await tick();

  assert.ok(ctx.findButton('Enable'), 'should offer to enable when currently disabled');
  assert.ok(!ctx.findButton('Disable'));
  assert.ok(
    ctx.execCalls.some(function (call) { return call[0] === 'bt-startup.sh' && call[1][0] === 'bootstrap'; }),
    'status.js should query bt-startup.sh bootstrap on mount (a superset of status, see scripts/bt-startup.sh)'
  );
});

test('pressing Enable calls bt-startup.sh enable and flips to a Disable button', async () => {
  const ctx = setUp();
  let enabled = false;
  ctx.setExecImpl(function (script, args) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    if (script === 'bt-startup.sh') {
      if (args[0] === 'enable') {
        enabled = true;
      } else if (args[0] === 'disable') {
        enabled = false;
      }
      return Promise.resolve({ ok: true, replies: [{ enabled: enabled }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  ctx.findButton('Enable').click();
  await tick();

  assert.ok(ctx.findButton('Disable'), 'button should relabel once enabled');
  assert.ok(
    ctx.execCalls.some(function (call) { return call[0] === 'bt-startup.sh' && call[1][0] === 'enable'; })
  );

  // Toggling again should call disable, not enable a second time, since
  // the handler reads the current remembered state rather than always
  // sending the same subcommand.
  ctx.findButton('Disable').click();
  await tick();

  assert.ok(ctx.findButton('Enable'), 'button should relabel back once disabled again');
  assert.ok(
    ctx.execCalls.some(function (call) { return call[0] === 'bt-startup.sh' && call[1][0] === 'disable'; })
  );
});

test('a failed toggle call shows an error without crashing the screen', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script, args) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    if (script === 'bt-startup.sh' && args[0] === 'bootstrap') {
      return Promise.resolve({ ok: true, replies: [{ enabled: false }] });
    }
    return Promise.resolve({ ok: false, errorText: 'symlink failed' });
  });
  ctx.mount();
  await tick();

  ctx.findButton('Enable').click();
  await tick();

  const errorNodes = ctx.root.querySelectorAll('.status-error').filter(function (el) {
    return !el.hidden;
  });
  assert.strictEqual(errorNodes.length, 1);
  assert.match(errorNodes[0].textContent, /symlink failed/);
});

// The human partner reported the D-pad couldn't reliably reach/activate
// the adapter-power button, with a hypothesis that status.js's two toggle
// buttons might be getting merged into one ambiguous row by
// js/router.js's row-grouping (the same `device-row`-class-keyed grouping
// discover.js/paired.js rely on). This test mounts status.js's *actual*
// render() through a real js/router.js createRouter (not a synthetic
// rowSpec), with the adapter reporting powered:false so the adapter
// toggle button is visible/focusable, and drives real Up/Down keydowns —
// disproving that hypothesis: status.js's two bare sibling buttons (not
// wrapped in `.device-row`) were already, and still are after this
// round's `.status-row` layout wrapper, two independent one-element rows
// per router.js's own findRowKey()/getRowGroups() logic (it only keys off
// the `device-row` class, which neither `.status-screen` nor the new
// `.status-row` carries). The real bug this round turned out to be CSS
// (a `[hidden]`-attributed button still rendering due to `.btn`'s
// explicit `display` winning the cascade over the browser's default
// `[hidden]` rule — see css/app.css's new top-of-file rule) — invisible
// to this DOM-only test harness, which doesn't run a CSS engine at all,
// so that half of the fix can only be confirmed by looking at the real
// TV. What IS asserted here, with the production render() function and
// the production router, is that the focus/row-grouping layer itself was
// never the problem.
test('status.js\'s two toggle buttons are independently reachable rows via the real router', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script) {
    if (script === 'bt-power.sh') {
      // Adapter off, so the power-toggle button is visible/focusable —
      // the exact case the human partner was pressing on.
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: false }] }] });
    }
    if (script === 'bt-startup.sh') {
      return Promise.resolve({ ok: true, replies: [{ enabled: false }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });

  const router = createRouter({
    status: { label: 'Status', render: ctx.render }
  });
  router.mount(ctx.root, 'status');
  await tick();

  const toggleButton = ctx.findButton('Turn on');
  const startupButton = ctx.findButton('Enable');
  assert.ok(toggleButton, 'adapter toggle should be present and visible when the adapter is off');
  assert.ok(startupButton);

  // Down from the tab bar enters content, landing on the first row (the
  // adapter toggle).
  ctx.dom.fireKey('Down', 40);
  assert.strictEqual(ctx.dom.document.activeElement, toggleButton);

  // A second Down moves to the second, independent row (the startup
  // toggle) — not a no-op, which is what merging both buttons into one
  // row would have produced.
  ctx.dom.fireKey('Down', 40);
  assert.strictEqual(ctx.dom.document.activeElement, startupButton);

  // Up walks back row by row: first back to the adapter toggle...
  ctx.dom.fireKey('Up', 38);
  assert.strictEqual(ctx.dom.document.activeElement, toggleButton);

  // ...then up again exits the content area entirely, back to the tab
  // bar (proving the adapter toggle really is the *first* row, not part
  // of some ambiguous merged group with no "before" edge).
  ctx.dom.fireKey('Up', 38);
  assert.notStrictEqual(ctx.dom.document.activeElement, toggleButton);
  assert.notStrictEqual(ctx.dom.document.activeElement, startupButton);
});

// ---- Log viewer ----

test('the log viewer fetches and renders bt-log.sh tail on mount', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    if (script === 'bt-log.sh') {
      return Promise.resolve({ ok: true, replies: [{ lines: '2026-10-21T00:00:00Z something happened\n' }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  const logBox = ctx.root.querySelectorAll('.log-box')[0];
  assert.ok(logBox);
  assert.match(logBox.textContent, /something happened/);
});

test('an empty log shows the empty-state message, not a blank box', async () => {
  const ctx = setUp(); // default execImpl already returns { lines: '' }
  ctx.mount();
  await tick();

  const logBox = ctx.root.querySelectorAll('.log-box')[0];
  assert.strictEqual(logBox.textContent, 'No log entries yet.');
});

test('pressing the log refresh button re-fetches the tail', async () => {
  const ctx = setUp();
  let callCount = 0;
  ctx.setExecImpl(function (script) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    if (script === 'bt-log.sh') {
      callCount += 1;
      return Promise.resolve({ ok: true, replies: [{ lines: 'call ' + callCount }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  const logBox = ctx.root.querySelectorAll('.log-box')[0];
  assert.strictEqual(logBox.textContent, 'call 1');

  ctx.findButton('Refresh log').click();
  await tick();

  assert.strictEqual(logBox.textContent, 'call 2');
});

test('a failed log fetch shows an error, not a crash', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    if (script === 'bt-log.sh') {
      return Promise.resolve({ ok: false, errorText: 'no such file' });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  const errorNodes = ctx.root.querySelectorAll('.status-error').filter(function (el) {
    return !el.hidden;
  });
  assert.strictEqual(errorNodes.length, 1);
  assert.match(errorNodes[0].textContent, /no such file/);
});

// ---- Turn-off confirmation state machine ----

test('the off button only appears while the adapter is on, and starts the confirmation flow', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  const offButton = ctx.findButton('Turn off');
  assert.ok(offButton, 'off button should be visible while the adapter is on');
  assert.ok(ctx.findButton('Yes, turn off').hidden, 'confirm button should not be reachable before the off button is pressed');

  offButton.click();

  assert.ok(offButton.hidden, 'off button hides once confirmation starts (exactly one path forward)');
  const confirmButton = ctx.findButton('Yes, turn off');
  const cancelButton = ctx.findButton('Cancel');
  assert.ok(confirmButton && !confirmButton.hidden);
  assert.ok(cancelButton && !cancelButton.hidden);
});

test('the off button does not appear at all while the adapter is off', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: false }] }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  assert.ok(ctx.findButton('Turn off').hidden);
});

test('cancelling the confirmation returns to the off button without calling bt-power.sh off', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  ctx.findButton('Turn off').click();
  ctx.findButton('Cancel').click();
  await tick();

  assert.ok(ctx.findButton('Turn off') && !ctx.findButton('Turn off').hidden);
  assert.ok(!ctx.execCalls.some(function (call) { return call[0] === 'bt-power.sh' && call[1][0] === 'off'; }));
});

test('confirming calls bt-power.sh off and the adapter reports off afterward', async () => {
  const ctx = setUp();
  let powered = true;
  ctx.setExecImpl(function (script, args) {
    if (script === 'bt-power.sh') {
      if (args[0] === 'off') {
        powered = false;
      }
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: powered }] }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  ctx.findButton('Turn off').click();
  ctx.findButton('Yes, turn off').click();
  await tick();

  assert.ok(
    ctx.execCalls.some(function (call) { return call[0] === 'bt-power.sh' && call[1][0] === 'off'; })
  );
  // Adapter now reports off: the on-button reappears, the off-button and
  // the whole confirmation flow are gone (refresh() resets confirmingOff).
  assert.ok(ctx.findButton('Turn on') && !ctx.findButton('Turn on').hidden);
  assert.ok(ctx.findButton('Turn off').hidden);
  assert.ok(ctx.findButton('Yes, turn off').hidden);
  assert.ok(ctx.findButton('Cancel').hidden);
});

test('a failed off call shows an error and returns to a sane state', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script, args) {
    if (script === 'bt-power.sh') {
      if (args[0] === 'off') {
        return Promise.resolve({ ok: false, errorText: 'adapter busy' });
      }
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });
  ctx.mount();
  await tick();

  ctx.findButton('Turn off').click();
  ctx.findButton('Yes, turn off').click();
  await tick();

  const errorNodes = ctx.root.querySelectorAll('.status-error').filter(function (el) {
    return !el.hidden;
  });
  assert.strictEqual(errorNodes.length, 1);
  assert.match(errorNodes[0].textContent, /adapter busy/);
  // Still powered (the off call failed), so the off button is offered
  // again rather than the screen being stuck mid-confirmation.
  assert.ok(ctx.findButton('Turn off') && !ctx.findButton('Turn off').hidden);
});

// Regression test for the exact bug this round's live feedback surfaced:
// js/router.js's getFocusableRowElements() only checks each focusable
// element's OWN `.hidden`, never an ancestor's — so confirmOffButton/
// cancelOffButton must be individually hidden while the confirmation
// isn't showing, not just their offWarning wrapper. Drives the real
// router the same way the toggle-buttons regression test above does.
test('the confirm/cancel buttons are not D-pad-reachable until the off button is pressed', async () => {
  const ctx = setUp();
  ctx.setExecImpl(function (script) {
    if (script === 'bt-power.sh') {
      return Promise.resolve({ ok: true, replies: [{ adapters: [{ powered: true }] }] });
    }
    return Promise.resolve({ ok: true, replies: [{}] });
  });

  const router = createRouter({ status: { label: 'Status', render: ctx.render } });
  router.mount(ctx.root, 'status');
  await tick();

  const offButton = ctx.findButton('Turn off');
  ctx.dom.fireKey('Down', 40);
  // The adapter toggle itself is hidden (adapter is on), so the first
  // reachable row should be the off button, not the (not yet visible)
  // confirm/cancel pair.
  assert.strictEqual(ctx.dom.document.activeElement, offButton);

  offButton.click();
  await tick();

  // offButton just became hidden while it held focus; js/router.js's
  // MutationObserver-driven reconcileFocus() (Task 8/9's existing
  // recovery mechanism, unchanged by this round) restores focus to the
  // row at the same remembered index — which is now confirmOffButton,
  // since offButton itself is excluded from the row list once hidden.
  const confirmButton = ctx.findButton('Yes, turn off');
  assert.strictEqual(ctx.dom.document.activeElement, confirmButton, 'confirm button should be reachable once the off button is pressed');
});
