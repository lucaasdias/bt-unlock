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
(function (global, execRef, classifyRef, isAdapterPoweredRef) {
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

  // render(container: HTMLElement, navigate: (name: string) => void) -> Function
  //   Returns a cleanup function the router calls before tearing this
  //   screen down, so the polling timer never outlives the screen.
  function render(container, navigate) {
    container.innerHTML = '';

    var pollTimer = null;
    var pollInFlight = false;
    var busy = false; // true while a pair/connect sequence is running

    var wrapper = document.createElement('div');
    wrapper.className = 'discover-screen';

    var heading = document.createElement('h1');
    heading.textContent = 'Discover devices';
    wrapper.appendChild(heading);

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

    function showError(message) {
      errorLabel.textContent = message;
      errorLabel.hidden = false;
    }

    function clearError() {
      errorLabel.hidden = true;
      errorLabel.textContent = '';
    }

    function showAdapterOffPrompt() {
      stopPolling();
      wrapper.innerHTML = '';
      heading.textContent = 'Discover devices';
      wrapper.appendChild(heading);

      var message = document.createElement('p');
      message.className = 'discover-status';
      message.textContent = 'The Bluetooth adapter is off. Turn it on to discover devices.';
      wrapper.appendChild(message);

      var goToStatusButton = document.createElement('button');
      goToStatusButton.type = 'button';
      goToStatusButton.textContent = 'Go to Status';
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
        button.disabled = busy;
        var label = device.name && device.name.length > 0 ? device.name : device.address;
        button.textContent = '[' + classified.iconId + '] ' + label + ' (' + classified.kind + ')';
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
              showError('Discovery failed: ' + (result.errorText || 'unknown error'));
            }
          });
        }
        clearError();
        statusLabel.textContent = 'Scanning...';
        var reply = result.replies[result.replies.length - 1];
        var devices = (reply && reply.devices) || [];
        renderDeviceList(devices);
      }).catch(function (err) {
        pollInFlight = false;
        showError('Discovery failed: ' + err.message);
      });
    }

    function startPolling() {
      pollOnce();
      pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
    }

    function setBusy(isBusy, message) {
      busy = isBusy;
      statusLabel.textContent = message || '';
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
      setBusy(true, 'Pairing with ' + label + '...');

      pairAttemptToken += 1;
      var thisAttempt = pairAttemptToken;
      function isStale() {
        return thisAttempt !== pairAttemptToken;
      }

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
          showError('Pairing failed: ' + (pairResult.errorText || 'unknown error'));
          setBusy(false);
          return;
        }

        setBusy(true, 'Connecting to ' + label + '...');
        return execRef('bt-connect.sh', [device.address, classified.profile]).then(function (connectResult) {
          if (isStale()) {
            return;
          }
          if (!connectResult.ok) {
            showError('Connect failed: ' + (connectResult.errorText || 'unknown error'));
          } else {
            statusLabel.textContent = 'Connected: ' + label;
          }
          setBusy(false);
        });
      }).catch(function (err) {
        if (isStale()) {
          return;
        }
        // Covers both a genuine exec()/script failure and the client-side
        // pairing timeout above (confirmed live: a non-"Just Works" or
        // unreachable device leaves bt-pair.sh's `luna-send -n 3` blocked
        // indefinitely with no error — this timeout is what returns the
        // UI to a clean, re-triable state instead of a stuck spinner).
        // The script itself keeps running on the TV in the background in
        // that case; it isn't and can't cheaply be cancelled from here.
        var message = err.message === 'timed out'
          ? 'Pairing timed out. The device may be out of range, or may need a PIN this app can\'t supply yet.'
          : 'Pairing failed: ' + err.message;
        showError(message);
        setBusy(false);
      });
    }

    isAdapterPoweredRef().then(function (powered) {
      if (!powered) {
        showAdapterOffPrompt();
        return;
      }
      startPolling();
    });

    return function cleanup() {
      stopPolling();
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
  typeof window !== 'undefined' ? window.isAdapterPowered : require('./status.js').isAdapterPowered
);
