// status.js — Screen 1: adapter status/power.
//
// Shows the Bluetooth adapter's current power state and a button to turn
// it on. There is no documented adapter/setState {"powered":false} use
// case in this app — the whole point of BT Unlock is to make accessories
// work, so the UI never offers to turn the adapter off (the stock TV
// settings already can, if truly needed).
//
// Loaded as a plain <script> tag in the browser (attaches `render` and
// `isAdapterPowered` to `window`) and exported via CommonJS under Node.
(function (global, execRef, tRef) {
  'use strict';

  // isAdapterPowered() -> Promise<boolean>
  //   Runs bt-power.sh status and reads the "powered" field off the
  //   parsed adapter/getStatus reply. Resolves to false (rather than
  //   rejecting) on any exec failure or malformed reply, so callers never
  //   need a try/catch just to ask "is it on" — Discover (Task 5) relies
  //   on this to decide whether to prompt the user to power on.
  //
  //   NOTE (verified live against the real TV while implementing this
  //   screen): adapter/getStatus does NOT return a top-level "powered"
  //   field as the brief assumed. The real reply shape is
  //   {"subscribed":false,"adapters":[{"powered":true,...}],"returnValue":true}
  //   — "powered" is nested inside adapters[0]. Reading reply.powered
  //   directly would always be undefined/falsy.
  function isAdapterPowered() {
    return execRef('bt-power.sh', ['status']).then(function (result) {
      if (!result.ok || !result.replies || result.replies.length === 0) {
        return false;
      }
      var reply = result.replies[result.replies.length - 1];
      var adapters = reply.adapters || [];
      return adapters.length > 0 && adapters[0].powered === true;
    });
  }

  // isStartupEnabled() -> Promise<boolean>
  //   Runs bt-startup.sh's `bootstrap` subcommand (not `status` — see
  //   scripts/bt-startup.sh's header) and reads its synthetic
  //   {"enabled":...} reply (filesystem-only, not a real Luna call, but
  //   shaped to parse through js/luna.js's existing parseReplies()/
  //   toExecResult() exactly like one). `bootstrap` is a superset of
  //   `status`: on a brand-new install (no marker file yet) it enables
  //   start-on-boot once automatically before reporting the state, so
  //   the default experience is "on" without the user having to find and
  //   flip the toggle themselves; on every later call (marker already
  //   exists) it's identical to a plain status read and never re-enables
  //   something the user deliberately turned off. Resolves to false
  //   rather than rejecting on any exec failure or malformed reply, same
  //   no-try/catch-needed contract as isAdapterPowered().
  function isStartupEnabled() {
    return execRef('bt-startup.sh', ['bootstrap']).then(function (result) {
      if (!result.ok || !result.replies || result.replies.length === 0) {
        return false;
      }
      var reply = result.replies[result.replies.length - 1];
      return reply.enabled === true;
    });
  }

  // render(container: HTMLElement) -> void
  //   Renders the status screen into `container`: a label showing the
  //   current power state, and a button to turn the adapter on. The
  //   button is only enabled/shown doing work while a toggle is in
  //   flight, and any exec failure is shown inline rather than left
  //   silent (Anti-goal: no blank/stuck screen).
  function render(container) {
    container.innerHTML = '';

    var wrapper = document.createElement('div');
    wrapper.className = 'status-screen';

    var heading = document.createElement('h1');
    heading.textContent = tRef('status.heading');
    wrapper.appendChild(heading);

    var errorLabel = document.createElement('p');
    errorLabel.className = 'status-error';
    errorLabel.hidden = true;
    wrapper.appendChild(errorLabel);

    // Two columns (css/app.css's `.status-columns`): the adapter/off/
    // startup rows on the left, the log viewer to the right — per the
    // human partner's original request (their annotated photo showed
    // the log box in the empty space to the right) and this round's
    // follow-up ("dedicated box to the side, not squeezed"). Collapses
    // to a single stacked column on narrow viewports via CSS, same
    // media-query-free responsive approach (flex-wrap) the rest of this
    // app's layout already relies on.
    var statusColumns = document.createElement('div');
    statusColumns.className = 'status-columns';

    var statusMain = document.createElement('div');
    statusMain.className = 'status-main';

    var statusLogPanel = document.createElement('div');
    statusLogPanel.className = 'status-log-panel';

    statusColumns.appendChild(statusMain);
    statusColumns.appendChild(statusLogPanel);
    wrapper.appendChild(statusColumns);

    // Each toggle's pill + button is one `.status-row` (css/app.css: a
    // flex row, pill next to its own button), and the two `.status-row`s
    // stack vertically as separate block-level rows below each other —
    // fixing a real layout bug the human partner caught live: without
    // this wrapper, a `<p class="state-pill">` is `display:inline-block`
    // (so it no longer breaks onto its own line the way a plain <p>
    // normally would) and a `<button>` is inline-level by default too,
    // so all four elements (both pills, both buttons) were rendering as
    // one single flowed-together horizontal line instead of two readable
    // rows. Grouping them under a non-`device-row`-classed wrapper div
    // does not change js/router.js's focus grouping at all — findRowKey()
    // only keys off the `device-row` class, so each button is still its
    // own independent focusable row exactly as before this change.
    var adapterRow = document.createElement('div');
    adapterRow.className = 'status-row';

    var stateLabel = document.createElement('p');
    stateLabel.className = 'status-state state-pill';
    stateLabel.textContent = tRef('status.checking');
    adapterRow.appendChild(stateLabel);

    var toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'status-toggle btn btn-primary';
    toggleButton.textContent = tRef('status.turnOn');
    adapterRow.appendChild(toggleButton);

    statusMain.appendChild(adapterRow);

    // "Turn off" — only ever shown/enabled while the adapter is on
    // (mirroring the "on" button's shown-only-when-off rule), and never
    // calls bt-power.sh off directly: this is the app's first genuinely
    // risky action (likely also disables the Magic Remote's pointer/
    // motion, since it's the same radio), explicitly confirmed wanted by
    // the human partner, but shipped WITH a confirmation step and an
    // on-screen warning, not silently. paired.js's Forget action has no
    // confirmation step to borrow a pattern from (checked — it's a
    // direct action), so this is the first confirmation flow in the app:
    // pressing "Turn off" reveals an inline warning + separate
    // Confirm/Cancel buttons, rather than a native JS confirm() dialog,
    // which has no D-pad affordance at all.
    // Wrapped in its own `.status-row` — per live feedback, the bare
    // button (no row wrapper, so none of the other rows' margin-bottom)
    // sat touching/overlapping the "Iniciar com a TV" row right below
    // it instead of having its own clean space. Every row on this
    // screen now consistently goes through `.status-row`'s spacing.
    var offRow = document.createElement('div');
    offRow.className = 'status-row';

    var offButton = document.createElement('button');
    offButton.type = 'button';
    offButton.className = 'btn btn-danger';
    offButton.textContent = tRef('status.turnOffButton');
    offButton.hidden = true;
    offRow.appendChild(offButton);
    statusMain.appendChild(offRow);

    var offWarning = document.createElement('div');
    offWarning.className = 'status-warning';
    offWarning.hidden = true;

    var offWarningText = document.createElement('p');
    offWarningText.textContent = tRef('status.turnOffWarning');
    offWarning.appendChild(offWarningText);

    var confirmOffButton = document.createElement('button');
    confirmOffButton.type = 'button';
    confirmOffButton.className = 'btn btn-danger';
    confirmOffButton.textContent = tRef('status.turnOffConfirmButton');
    confirmOffButton.hidden = true;
    offWarning.appendChild(confirmOffButton);

    var cancelOffButton = document.createElement('button');
    cancelOffButton.type = 'button';
    cancelOffButton.className = 'btn btn-secondary';
    cancelOffButton.textContent = tRef('status.turnOffCancelButton');
    cancelOffButton.hidden = true;
    offWarning.appendChild(cancelOffButton);

    statusMain.appendChild(offWarning);

    // "Start on TV boot" toggle — a second, independent row below the
    // adapter-power one, same state-pill + button visual language. Unlike
    // the adapter toggle (one-directional: this app never offers to turn
    // the adapter back off), this one is a real bidirectional toggle, so
    // the button's own label always names the action pressing it will
    // take next (same convention discover.js's Search/Stop button uses).
    //
    // --status-row--stacked (per the human partner's live feedback,
    // this round): unlike the adapter row above (pill beside its
    // button), this row's label and button stack vertically instead —
    // label on top, button below.
    var startupRow = document.createElement('div');
    startupRow.className = 'status-row status-row--stacked';

    var startupStateLabel = document.createElement('p');
    startupStateLabel.className = 'status-state state-pill';
    startupStateLabel.textContent = tRef('status.checking');
    startupRow.appendChild(startupStateLabel);

    var startupToggleButton = document.createElement('button');
    startupToggleButton.type = 'button';
    startupToggleButton.className = 'btn btn-secondary';
    startupRow.appendChild(startupToggleButton);

    statusMain.appendChild(startupRow);

    // ---- Log viewer (read-only, scrollable, monospace) ----
    // One-shot fetch on mount plus a manual refresh button next to its
    // own heading (same `.screen-header` + "Atualizar" pattern as
    // paired.js's refresh button) — this project's exec() is a one-shot
    // call, not a live stream, so there is no way to tail -f this into
    // the UI; a manual refresh is the honest equivalent.
    var logHeader = document.createElement('div');
    logHeader.className = 'screen-header';

    var logHeading = document.createElement('h2');
    logHeading.className = 'section-heading';
    logHeading.textContent = tRef('status.logHeading');
    logHeader.appendChild(logHeading);

    var logRefreshButton = document.createElement('button');
    logRefreshButton.type = 'button';
    logRefreshButton.className = 'btn btn-secondary btn-compact';
    logRefreshButton.textContent = tRef('status.logRefreshButton');
    logHeader.appendChild(logRefreshButton);

    statusLogPanel.appendChild(logHeader);

    // `.scrollable-content` + `tabindex="0"`: makes the log box itself a
    // normal focusable row (js/router.js's FOCUSABLE_SELECTOR already
    // matches any `[tabindex]`, so no router.js change was needed just
    // to make it reachable). js/router.js's handleKeydown now also
    // checks for this class on whichever element currently has focus —
    // Up/Down scroll the box's own content instead of moving to another
    // row while it's focused and there's more to scroll in that
    // direction, falling through to the normal row-to-row behavior once
    // it's scrolled all the way to that edge (or if there's nothing to
    // scroll at all). See js/router.js's own comment on `isScrollable`/
    // `tryScroll` for the full reasoning.
    var logBox = document.createElement('pre');
    logBox.className = 'log-box scrollable-content';
    logBox.setAttribute('tabindex', '0');
    logBox.textContent = tRef('status.logEmpty');
    statusLogPanel.appendChild(logBox);

    container.appendChild(wrapper);

    function showError(message) {
      errorLabel.textContent = message;
      errorLabel.hidden = false;
    }

    function clearError() {
      errorLabel.hidden = true;
      errorLabel.textContent = '';
    }

    function setStateClass(modifier) {
      stateLabel.className = 'status-state state-pill' + (modifier ? ' state-pill--' + modifier : '');
    }

    function setStartupStateClass(modifier) {
      startupStateLabel.className = 'status-state state-pill' + (modifier ? ' state-pill--' + modifier : '');
    }

    var startupEnabled = false;

    function refreshStartup() {
      return isStartupEnabled().then(function (enabled) {
        startupEnabled = enabled;
        startupStateLabel.textContent = tRef(enabled ? 'status.startupOn' : 'status.startupOff');
        setStartupStateClass(enabled ? 'on' : 'off');
        startupToggleButton.textContent = tRef(enabled ? 'status.startupDisableButton' : 'status.startupEnableButton');
        return enabled;
      });
    }

    function handleStartupToggle() {
      startupToggleButton.disabled = true;
      clearError();
      execRef('bt-startup.sh', [startupEnabled ? 'disable' : 'enable']).then(function (result) {
        if (!result.ok) {
          showError(tRef('status.startupToggleError', { error: result.errorText || tRef('common.unknownError') }));
        }
        return refreshStartup();
      }).catch(function (err) {
        showError(tRef('status.startupToggleError', { error: err.message }));
      }).then(function () {
        startupToggleButton.disabled = false;
      });
    }

    var adapterPowered = false;
    var confirmingOff = false;

    // updateOffUI() -> void
    //   The off button is only ever offered while the adapter is
    //   actually on, mirroring the "on" button's own hidden-while-on
    //   rule; while the confirmation warning is showing, the off button
    //   itself hides so there's exactly one path forward at a time
    //   (Confirm or Cancel), not two competing ways to re-trigger it.
    //
    //   Sets `hidden` on confirmOffButton/cancelOffButton THEMSELVES,
    //   not just on their offWarning wrapper — js/router.js's
    //   getFocusableRowElements() only checks each focusable element's
    //   own `.hidden`/`.disabled`, never an ancestor's, so a button
    //   nested inside a hidden container but not itself marked hidden
    //   stays reachable by the D-pad while invisible. Caught by this
    //   screen's own router-integration test (test/status.test.js) once
    //   this confirmation flow existed — the exact same class of bug
    //   flagged for the adapter toggle button earlier this round, this
    //   time in status.js's own logic rather than CSS.
    function updateOffUI() {
      offButton.hidden = !adapterPowered || confirmingOff;
      offWarning.hidden = !confirmingOff;
      confirmOffButton.hidden = !confirmingOff;
      cancelOffButton.hidden = !confirmingOff;
    }

    function refresh() {
      return isAdapterPowered().then(function (powered) {
        adapterPowered = powered;
        stateLabel.textContent = tRef(powered ? 'status.adapterOn' : 'status.adapterOff');
        setStateClass(powered ? 'on' : 'off');
        toggleButton.hidden = powered;
        // Any refresh (including the one right after actually turning
        // it off) resets any in-progress confirmation — there's nothing
        // left to confirm once the state has just been read fresh.
        confirmingOff = false;
        updateOffUI();
        return powered;
      });
    }

    function handleToggle() {
      toggleButton.disabled = true;
      clearError();
      execRef('bt-power.sh', ['on']).then(function (result) {
        if (!result.ok) {
          showError(tRef('status.turnOnError', { error: result.errorText || tRef('common.unknownError') }));
        }
        return refresh();
      }).catch(function (err) {
        showError(tRef('status.turnOnError', { error: err.message }));
      }).then(function () {
        toggleButton.disabled = false;
      });
    }

    function handleOffButton() {
      confirmingOff = true;
      updateOffUI();
    }

    function handleCancelOff() {
      confirmingOff = false;
      updateOffUI();
    }

    function handleConfirmOff() {
      confirmOffButton.disabled = true;
      cancelOffButton.disabled = true;
      clearError();
      execRef('bt-power.sh', ['off']).then(function (result) {
        if (!result.ok) {
          showError(tRef('status.turnOffError', { error: result.errorText || tRef('common.unknownError') }));
        }
        return refresh();
      }).catch(function (err) {
        showError(tRef('status.turnOffError', { error: err.message }));
        confirmingOff = false;
        updateOffUI();
      }).then(function () {
        confirmOffButton.disabled = false;
        cancelOffButton.disabled = false;
      });
    }

    // ---- Log viewer logic ----
    function renderLog(text) {
      logBox.textContent = text && text.length > 0 ? text : tRef('status.logEmpty');
    }

    function refreshLog() {
      logRefreshButton.disabled = true;
      return execRef('bt-log.sh', ['tail']).then(function (result) {
        if (!result.ok || !result.replies || result.replies.length === 0) {
          showError(tRef('status.logError', { error: (result && result.errorText) || tRef('common.unknownError') }));
          return;
        }
        var reply = result.replies[result.replies.length - 1];
        renderLog(reply.lines || '');
      }).catch(function (err) {
        showError(tRef('status.logError', { error: err.message }));
      }).then(function () {
        logRefreshButton.disabled = false;
      });
    }

    toggleButton.addEventListener('click', handleToggle);
    offButton.addEventListener('click', handleOffButton);
    confirmOffButton.addEventListener('click', handleConfirmOff);
    cancelOffButton.addEventListener('click', handleCancelOff);
    startupToggleButton.addEventListener('click', handleStartupToggle);
    logRefreshButton.addEventListener('click', refreshLog);

    refresh().catch(function (err) {
      stateLabel.textContent = tRef('status.adapterUnknown');
      setStateClass(null);
      showError(tRef('status.readError', { error: err.message }));
    });

    refreshStartup().catch(function (err) {
      startupStateLabel.textContent = tRef('status.startupUnknown');
      setStartupStateClass(null);
      showError(tRef('status.startupReadError', { error: err.message }));
    });

    refreshLog();
  }

  var api = {
    render: render,
    isAdapterPowered: isAdapterPowered
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.render = render;
    global.isAdapterPowered = isAdapterPowered;
  }
})(
  typeof window !== 'undefined' ? window : this,
  typeof window !== 'undefined' ? window.exec : require('../luna.js').exec,
  typeof window !== 'undefined' ? window.t : require('../i18n.js').t
);
