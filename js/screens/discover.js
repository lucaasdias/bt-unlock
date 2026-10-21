// discover.js — Screen 2: discover & pair.
//
// Lists nearby Bluetooth devices (polling bt-discover.sh's snapshot every
// ~2s, since `exec` is a single blocking call, not a subscription — see
// the architecture note in scripts/bt-discover.sh), classifies each one
// via devices.js's classify(), and lets the user pick one to pair and
// connect.
//
// Loaded as a plain <script> tag in the browser (attaches `renderDiscover`
// to `window` — named distinctly from status.js's `render` so the two
// screens' globals don't collide) and exported via CommonJS under Node.
(function (global, execRef, classifyRef, isAdapterPoweredRef, tRef) {
  'use strict';

  var POLL_INTERVAL_MS = 2000;
  // Verified live against the real TV while implementing this screen,
  // against two real devices (a DualShock 4 and an Xbox Wireless
  // Controller): `bt-pair.sh` originally called `adapter/pair` with
  // `luna-send -n 3` (per the brief) and blocked indefinitely (confirmed
  // past 90s repeatedly) even for a device that successfully paired
  // within seconds — because a Just-Works pairing only ever produces 2
  // replies, not 3, so the 3rd `-n 3` was waiting on a reply that is
  // never sent. That root cause is now fixed in bt-pair.sh itself
  // (`-n 2`), which should return promptly for the common case.
  //
  // This client-side timeout stays as a safety net, not a crutch: a
  // genuinely unreachable/unresponsive device (walked away, battery
  // dies, out of range) — the Review Focus scenario for this task —
  // can still leave `bt-pair.sh` waiting on even that 2nd reply forever,
  // and Homebrew Channel's own exec service has no timeout of its own.
  // Without this, that's exactly the "stuck spinner forever" anti-goal.
  var PAIR_TIMEOUT_MS = 20000;
  // bt-connect.sh's `<profile>/connect` call needs the same safety net as
  // bt-pair.sh, for the same anti-goal reason — confirmed live, not just
  // in theory: a direct `hid/connect` call against a real device (a BLE-
  // only controller that doesn't actually expose classic HID) hung for
  // 20+ seconds with no response at all before being killed manually.
  // `exec()` has no timeout of its own, so without this a bad profile
  // match or an unresponsive device would hang the UI exactly the same
  // way the unwrapped pair call used to.
  var CONNECT_TIMEOUT_MS = 20000;

  // SEARCH_WINDOW_MS — this screen no longer polls forever once mounted.
  // The user presses Search to start a bounded scan; it auto-stops after
  // this long if they don't stop it manually first. 35s is comfortably
  // longer than the adapter's own ~20s discoveryTimeout mentioned in
  // scripts/bt-discover.sh's header (so a normal scan has time to
  // actually find something) while still being a bounded "search", not
  // an indefinite background scan the user has to remember is running.
  var SEARCH_WINDOW_MS = 35000;

  // ICON_GLYPHS — presentation-only map from devices.js's classify()
  // iconId to a glyph shown inside the device-row's icon circle (Task 9
  // design system). Purely cosmetic: no effect on classification/profile
  // selection logic, which stays entirely in devices.js.
  var ICON_GLYPHS = {
    gamepad: '🎮',
    keyboard: '⌨️',
    mouse: '🖱️',
    audio: '🎧',
    unknown: '❓'
  };

  // render(container: HTMLElement, navigate: (name: string) => void) -> Function
  //   Returns a cleanup function the router calls before tearing this
  //   screen down, so the polling timer never outlives the screen.
  function render(container, navigate) {
    container.innerHTML = '';

    var pollTimer = null;
    var pollInFlight = false;
    var busy = false; // true while a pair/connect sequence is running
    var searching = false; // true while a bounded search window is active
    var searchWindowTimer = null;

    var wrapper = document.createElement('div');
    wrapper.className = 'discover-screen';

    // Heading + Search/Stop button share one row (.screen-header,
    // css/app.css), same pattern just applied to paired.js's Refresh
    // button after the human partner flagged a lone button floating
    // between the heading and the list as visually disconnected.
    var header = document.createElement('div');
    header.className = 'screen-header';

    var heading = document.createElement('h1');
    heading.textContent = tRef('discover.heading');
    header.appendChild(heading);

    var searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.className = 'btn btn-primary';
    searchButton.textContent = tRef('discover.searchButton');
    searchButton.addEventListener('click', function () {
      if (searching) {
        stopSearch();
      } else {
        startSearch();
      }
    });
    header.appendChild(searchButton);

    wrapper.appendChild(header);

    var statusLabel = document.createElement('p');
    statusLabel.className = 'discover-status';
    wrapper.appendChild(statusLabel);

    var errorLabel = document.createElement('p');
    errorLabel.className = 'discover-error';
    errorLabel.hidden = true;
    wrapper.appendChild(errorLabel);

    var list = document.createElement('ul');
    list.className = 'discover-list';
    wrapper.appendChild(list);

    container.appendChild(wrapper);

    function stopPolling() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function clearSearchWindow() {
      if (searchWindowTimer !== null) {
        clearTimeout(searchWindowTimer);
        searchWindowTimer = null;
      }
    }

    function setSearchButtonLabel() {
      searchButton.textContent = tRef(searching ? 'discover.stopSearchButton' : 'discover.searchButton');
    }

    // showIdleEmptyPromptIfEmpty() -> void
    //   Shown in place of the device list whenever it's actually empty —
    //   before the very first search, or after a search (timed out or
    //   stopped manually) that found nothing. Never clears a list that
    //   already has devices in it: per spec, devices found so far must
    //   stay visible/selectable after a search ends, so this only adds
    //   the prompt back when there is genuinely nothing to show.
    function showIdleEmptyPromptIfEmpty() {
      if (list.children.length === 0) {
        var empty = document.createElement('li');
        empty.className = 'list-empty';
        empty.textContent = tRef('discover.searchPrompt');
        list.appendChild(empty);
      }
    }

    // startSearch() / stopSearch() — the bounded-search state machine.
    // Discovery used to start automatically on mount and poll forever;
    // now it only runs for up to SEARCH_WINDOW_MS after the user presses
    // the button, and can be ended early the same way the button started
    // it (click toggles based on `searching`).
    function startSearch() {
      if (busy || searching) {
        return;
      }
      searching = true;
      setSearchButtonLabel();
      clearError();
      startPolling();
      searchWindowTimer = setTimeout(function () {
        stopSearch();
      }, SEARCH_WINDOW_MS);
    }

    // stopSearch() -> void
    //   Ends the search whether triggered by the window elapsing or the
    //   user pressing Stop. Stops client-side polling immediately; also
    //   fires bt-discover.sh's `stop` subcommand (adapter/cancelDiscovery,
    //   see scripts/bt-discover.sh) so the radio itself stops scanning too
    //   rather than relying solely on the adapter's own ~20s
    //   discoveryTimeout — best-effort and fire-and-forget, since there is
    //   nothing actionable to show the user if this particular call fails
    //   (client polling has already stopped either way, and the adapter's
    //   own timeout is the fallback).
    function stopSearch() {
      if (!searching) {
        return;
      }
      searching = false;
      clearSearchWindow();
      stopPolling();
      setSearchButtonLabel();
      statusLabel.textContent = '';
      showIdleEmptyPromptIfEmpty();
      execRef('bt-discover.sh', ['stop']).catch(function () {});
    }

    function showError(message) {
      errorLabel.textContent = message;
      errorLabel.hidden = false;
    }

    function clearError() {
      errorLabel.hidden = true;
      errorLabel.textContent = '';
    }

    function showAdapterOffPrompt() {
      searching = false;
      clearSearchWindow();
      stopPolling();
      wrapper.innerHTML = '';
      heading.textContent = tRef('discover.heading');
      wrapper.appendChild(heading);

      var message = document.createElement('p');
      message.className = 'discover-status';
      message.textContent = tRef('discover.adapterOffMessage');
      wrapper.appendChild(message);

      var goToStatusButton = document.createElement('button');
      goToStatusButton.type = 'button';
      goToStatusButton.className = 'btn btn-primary';
      goToStatusButton.textContent = tRef('discover.goToStatus');
      goToStatusButton.addEventListener('click', function () {
        navigate('status');
      });
      wrapper.appendChild(goToStatusButton);
    }

    function renderDeviceList(devices) {
      list.innerHTML = '';
      devices.forEach(function (device) {
        var classified = classifyRef(device.classOfDevice || 0);
        // Spec non-goal: a device whose class doesn't map to a supported
        // profile is not offered at all, rather than attempting a profile
        // connect that would fail silently.
        if (classified.profile === null) {
          return;
        }

        var item = document.createElement('li');
        item.className = 'discover-device';

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'device-row';
        button.disabled = busy;
        var label = device.name && device.name.length > 0 ? device.name : device.address;

        var icon = document.createElement('span');
        icon.className = 'device-row-icon';
        icon.textContent = ICON_GLYPHS[classified.iconId] || ICON_GLYPHS.unknown;
        button.appendChild(icon);

        var text = document.createElement('span');
        text.className = 'device-row-text';

        var name = document.createElement('span');
        name.className = 'device-row-name';
        name.textContent = label;
        text.appendChild(name);

        var meta = document.createElement('span');
        meta.className = 'device-row-meta';
        meta.textContent = tRef('device.kind.' + classified.kind);
        text.appendChild(meta);

        button.appendChild(text);

        button.addEventListener('click', function () {
          handleSelect(device, classified);
        });

        item.appendChild(button);
        list.appendChild(item);
      });
    }

    function pollOnce() {
      if (pollInFlight || busy) {
        return;
      }
      pollInFlight = true;
      execRef('bt-discover.sh', ['start']).then(function (result) {
        pollInFlight = false;
        if (!result.ok) {
          // Either `start` or the `getStatus` snapshot failed. The most
          // likely real-world cause (Review Focus: the adapter turning
          // off mid-session, racing with another client) gets its own
          // message; anything else is shown generically rather than left
          // as a silently-stuck list.
          return isAdapterPoweredRef().then(function (powered) {
            if (!powered) {
              showAdapterOffPrompt();
            } else {
              showError(tRef('discover.discoveryFailed', { error: result.errorText || tRef('common.unknownError') }));
            }
          });
        }
        clearError();
        statusLabel.textContent = tRef('discover.scanning');
        var reply = result.replies[result.replies.length - 1];
        var devices = (reply && reply.devices) || [];
        renderDeviceList(devices);
      }).catch(function (err) {
        pollInFlight = false;
        showError(tRef('discover.discoveryFailed', { error: err.message }));
      });
    }

    function startPolling() {
      pollOnce();
      pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
    }

    function setBusy(isBusy, message) {
      busy = isBusy;
      statusLabel.textContent = message || '';
      searchButton.disabled = isBusy;
      Array.prototype.forEach.call(list.querySelectorAll('button'), function (button) {
        button.disabled = isBusy;
      });
    }

    var pairAttemptToken = 0;

    function raceTimeout(promise, ms) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          reject(new Error('timed out'));
        }, ms);
        promise.then(function (value) {
          clearTimeout(timer);
          resolve(value);
        }, function (err) {
          clearTimeout(timer);
          reject(err);
        });
      });
    }

    function handleSelect(device, classified) {
      var label = device.name && device.name.length > 0 ? device.name : device.address;
      clearError();
      setBusy(true, tRef('discover.pairing', { device: label }));

      pairAttemptToken += 1;
      var thisAttempt = pairAttemptToken;
      function isStale() {
        return thisAttempt !== pairAttemptToken;
      }

      // Tracks which leg timed out, since both legs share one .catch
      // below but need different, accurate messages.
      var stage = 'pair';

      raceTimeout(execRef('bt-pair.sh', [device.address]), PAIR_TIMEOUT_MS).then(function (pairResult) {
        if (isStale()) {
          return;
        }
        if (!pairResult.ok) {
          // TODO: a device that isn't "Just Works" (e.g. needs a PIN) will
          // surface its `request:enterPasskey` event as one of this
          // reply's middle entries, which bt-pair.sh has no way to act
          // on — there is no passkey-entry UI yet. That case is an
          // untested, known gap for this screen (see task-5-report.md);
          // today it is shown as this same generic pairing-failed error
          // rather than its own "enter PIN" flow.
          showError(tRef('discover.pairingFailed', { error: pairResult.errorText || tRef('common.unknownError') }));
          setBusy(false);
          return;
        }

        stage = 'connect';
        setBusy(true, tRef('discover.connecting', { device: label }));
        return raceTimeout(execRef('bt-connect.sh', [device.address, classified.profile]), CONNECT_TIMEOUT_MS).then(function (connectResult) {
          if (isStale()) {
            return;
          }
          // setBusy(false) resets statusLabel.textContent to '' (no
          // message passed), so it must run BEFORE setting the
          // "Connected: X" success text below, or this would immediately
          // overwrite it back to blank — a real bug caught by local
          // testing of this exact change (see task-5-report.md): the
          // success message never actually displayed, even before this
          // task's connect-timeout fix.
          setBusy(false);
          if (!connectResult.ok) {
            showError(tRef('discover.connectFailed', { error: connectResult.errorText || tRef('common.unknownError') }));
          } else {
            statusLabel.textContent = tRef('discover.connected', { device: label });
          }
        });
      }).catch(function (err) {
        if (isStale()) {
          return;
        }
        // Covers both a genuine exec()/script failure and either leg's
        // client-side timeout above. The pair leg hanging indefinitely
        // (a non-"Just Works" or unreachable device) is confirmed live.
        // The connect leg wraps the exact same raceTimeout() helper the
        // same way for the same reason — confirmed live that bt-connect.sh's
        // `<profile>/connect` call itself CAN hang indefinitely (a bad
        // profile match or unresponsive device, 20+s with no response,
        // no error, nothing from Homebrew's exec service either), but
        // the wrapped recovery path for this specific leg is reasoned
        // from the identical, already-proven pair-leg pattern rather
        // than independently re-observed live — see task-5-report.md.
        // The underlying script keeps running on the TV in the
        // background in that case; it isn't and can't cheaply be
        // cancelled from here.
        var message;
        if (err.message === 'timed out') {
          message = stage === 'pair'
            ? tRef('discover.pairingTimedOut')
            : tRef('discover.connectTimedOut');
        } else {
          message = stage === 'pair'
            ? tRef('discover.pairingFailed', { error: err.message })
            : tRef('discover.connectFailed', { error: err.message });
        }
        showError(message);
        setBusy(false);
      });
    }

    isAdapterPoweredRef().then(function (powered) {
      if (!powered) {
        showAdapterOffPrompt();
        return;
      }
      // Discovery no longer auto-starts on mount — idle until the user
      // presses Search, per spec. Show the empty-state prompt so an
      // otherwise-blank list doesn't look broken/stuck.
      showIdleEmptyPromptIfEmpty();
    });

    return function cleanup() {
      stopPolling();
      clearSearchWindow();
    };
  }

  var api = { render: render };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.renderDiscover = render;
  }
})(
  typeof window !== 'undefined' ? window : this,
  typeof window !== 'undefined' ? window.exec : require('../luna.js').exec,
  typeof window !== 'undefined' ? window.classify : require('../devices.js').classify,
  typeof window !== 'undefined' ? window.isAdapterPowered : require('./status.js').isAdapterPowered,
  typeof window !== 'undefined' ? window.t : require('../i18n.js').t
);
