// paired.js — Screen 3: paired devices management.
//
// Lists already-paired Bluetooth devices (via bt-paired.sh's one-shot
// device/getStatus snapshot, filtered to paired:true), classifies each
// one via devices.js's classify(), and offers a connect/disconnect
// toggle plus a forget action per row.
//
// Unlike discover.js this screen does not poll on a timer — the paired
// list only changes in response to this screen's own actions (or
// Discover's pairing), so it loads once on render/navigation and
// refreshes after each action instead of continuously re-scanning.
//
// Loaded as a plain <script> tag in the browser (attaches `renderPaired`
// to `window` — named distinctly from status.js's `render` and
// discover.js's `renderDiscover` so the three screens' globals don't
// collide) and exported via CommonJS under Node.
(function (global, execRef, classifyRef, tRef) {
  'use strict';

  // Same anti-goal as discover.js (Task 5): `exec()` has no timeout of
  // its own, and a profile mismatch or unresponsive device can hang a
  // connect/disconnect call indefinitely (confirmed live in Task 5 for
  // bt-connect.sh). Every exec() call this screen makes that could hang
  // — connect, disconnect, and forget (which itself disconnects before
  // unpairing) — is raced against this timeout so the UI always comes
  // back to a usable state.
  var ACTION_TIMEOUT_MS = 20000;

  // ICON_GLYPHS — presentation-only map from devices.js's classify()
  // iconId to a glyph shown inside the device-row's icon circle (Task 9
  // design system), identical to discover.js's. Purely cosmetic.
  var ICON_GLYPHS = {
    gamepad: '🎮',
    keyboard: '⌨️',
    mouse: '🖱️',
    audio: '🎧',
    unknown: '❓'
  };

  // render(container: HTMLElement, navigate: (name: string) => void) -> Function
  //   Returns a cleanup function the router calls before tearing this
  //   screen down. There is no polling timer to stop, but an in-flight
  //   action's stale-response guard still needs the attempt token bumped
  //   so a late reply from a screen the user has left can't repaint it.
  function render(container, navigate) {
    container.innerHTML = '';

    var busy = false;
    var attemptToken = 0;

    var wrapper = document.createElement('div');
    wrapper.className = 'paired-screen';

    // Heading + refresh button share one row (.screen-header, css/app.css)
    // rather than the refresh button sitting as its own block between the
    // heading and the list — feedback from the human partner looking at
    // the real TV: a lone button floating there read as disconnected from
    // both the heading above and the list below it. Markup/CSS-only:
    // refreshButton is still the same element, same click handler, same
    // tab-order position among this screen's focusable elements (right
    // after the heading, before any device row) — js/router.js's
    // row-grouping only cares about DOM order and the `device-row`
    // ancestor class, neither of which this changes.
    var header = document.createElement('div');
    header.className = 'screen-header';

    var heading = document.createElement('h1');
    heading.textContent = tRef('paired.heading');
    header.appendChild(heading);

    var refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'btn btn-secondary';
    refreshButton.textContent = tRef('paired.refresh');
    refreshButton.addEventListener('click', function () {
      load();
    });
    header.appendChild(refreshButton);

    wrapper.appendChild(header);

    var statusLabel = document.createElement('p');
    statusLabel.className = 'paired-status';
    wrapper.appendChild(statusLabel);

    var errorLabel = document.createElement('p');
    errorLabel.className = 'paired-error';
    errorLabel.hidden = true;
    wrapper.appendChild(errorLabel);

    var list = document.createElement('ul');
    list.className = 'paired-list';
    wrapper.appendChild(list);

    container.appendChild(wrapper);

    function showError(message) {
      errorLabel.textContent = message;
      errorLabel.hidden = false;
    }

    function clearError() {
      errorLabel.hidden = true;
      errorLabel.textContent = '';
    }

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

    function setBusy(isBusy, message) {
      busy = isBusy;
      statusLabel.textContent = message || '';
      refreshButton.disabled = isBusy;
      Array.prototype.forEach.call(list.querySelectorAll('button'), function (button) {
        button.disabled = isBusy;
      });
    }

    function renderDeviceList(devices) {
      list.innerHTML = '';
      var paired = devices.filter(function (device) {
        return device.paired === true;
      });

      if (paired.length === 0) {
        var empty = document.createElement('li');
        empty.className = 'list-empty';
        empty.textContent = tRef('paired.empty');
        list.appendChild(empty);
        return;
      }

      paired.forEach(function (device) {
        var classified = classifyRef(device.classOfDevice || 0);
        var label = device.name && device.name.length > 0 ? device.name : device.address;
        var connectedProfiles = device.connectedProfiles || [];
        var connected = connectedProfiles.length > 0;

        var item = document.createElement('li');
        item.className = 'paired-device device-row';

        var main = document.createElement('span');
        main.className = 'device-row-main';

        var icon = document.createElement('span');
        icon.className = 'device-row-icon';
        icon.textContent = ICON_GLYPHS[classified.iconId] || ICON_GLYPHS.unknown;
        main.appendChild(icon);

        var text = document.createElement('span');
        text.className = 'device-row-text';

        var name = document.createElement('span');
        name.className = 'device-row-name';
        name.textContent = label;
        text.appendChild(name);

        var meta = document.createElement('span');
        meta.className = 'device-row-meta ' + (connected ? 'device-row-meta--connected' : 'device-row-meta--disconnected');
        meta.textContent = tRef('device.kind.' + classified.kind) + ' — ' +
          tRef(connected ? 'paired.connected' : 'paired.disconnected');
        text.appendChild(meta);

        main.appendChild(text);
        item.appendChild(main);

        var actions = document.createElement('span');
        actions.className = 'device-row-actions';

        // A device whose class doesn't map to a supported profile (same
        // profile === null case discover.js filters out of its list)
        // can still be paired and still needs to be forgettable, but
        // there is no profile to connect/disconnect it over — only
        // Forget is offered for it.
        if (classified.profile !== null) {
          var toggleButton = document.createElement('button');
          toggleButton.type = 'button';
          toggleButton.className = 'btn btn-secondary btn-compact';
          toggleButton.textContent = tRef(connected ? 'paired.disconnectButton' : 'paired.reconnectButton');
          toggleButton.addEventListener('click', function () {
            handleToggleConnection(device, classified, connected, label);
          });
          actions.appendChild(toggleButton);
        }

        var forgetButton = document.createElement('button');
        forgetButton.type = 'button';
        forgetButton.className = 'btn btn-danger btn-compact';
        forgetButton.textContent = tRef('paired.forgetButton');
        forgetButton.addEventListener('click', function () {
          handleForget(device, classified, label);
        });
        actions.appendChild(forgetButton);

        item.appendChild(actions);

        list.appendChild(item);
      });
    }

    function load() {
      clearError();
      setBusy(true, tRef('paired.loading'));
      attemptToken += 1;
      var thisAttempt = attemptToken;

      return execRef('bt-paired.sh', []).then(function (result) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        setBusy(false);
        if (!result.ok) {
          showError(tRef('paired.loadError', { error: result.errorText || tRef('common.unknownError') }));
          return;
        }
        var reply = result.replies[result.replies.length - 1];
        var devices = (reply && reply.devices) || [];
        renderDeviceList(devices);
      }).catch(function (err) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        setBusy(false);
        showError(tRef('paired.loadError', { error: err.message }));
      });
    }

    function handleToggleConnection(device, classified, wasConnected, label) {
      if (busy) {
        return;
      }
      clearError();
      var script = wasConnected ? 'bt-disconnect.sh' : 'bt-connect.sh';
      var busyMessage = wasConnected
        ? tRef('paired.disconnectingFrom', { device: label })
        : tRef('paired.connectingTo', { device: label });
      setBusy(true, busyMessage);
      attemptToken += 1;
      var thisAttempt = attemptToken;

      raceTimeout(execRef(script, [device.address, classified.profile]), ACTION_TIMEOUT_MS).then(function (result) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        if (!result.ok) {
          setBusy(false);
          var failKey = wasConnected ? 'paired.disconnectFailed' : 'paired.connectFailed';
          showError(tRef(failKey, { error: result.errorText || tRef('common.unknownError') }));
          return;
        }
        return load();
      }).catch(function (err) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        setBusy(false);
        var message;
        if (err.message === 'timed out') {
          message = wasConnected ? tRef('paired.disconnectTimedOut') : tRef('paired.connectTimedOut');
        } else {
          message = tRef(wasConnected ? 'paired.disconnectFailed' : 'paired.connectFailed', { error: err.message });
        }
        showError(message);
      });
    }

    function handleForget(device, classified, label) {
      if (busy) {
        return;
      }
      clearError();
      setBusy(true, tRef('paired.forgetting', { device: label }));
      attemptToken += 1;
      var thisAttempt = attemptToken;

      raceTimeout(execRef('bt-forget.sh', [device.address, classified.profile || '']), ACTION_TIMEOUT_MS).then(function (result) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        if (!result.ok) {
          setBusy(false);
          showError(tRef('paired.forgetFailed', { error: result.errorText || tRef('common.unknownError') }));
          return;
        }
        return load();
      }).catch(function (err) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        setBusy(false);
        var message = err.message === 'timed out'
          ? tRef('paired.forgetTimedOut')
          : tRef('paired.forgetFailed', { error: err.message });
        showError(message);
      });
    }

    load();

    return function cleanup() {
      attemptToken += 1;
    };
  }

  var api = { render: render };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.renderPaired = render;
  }
})(
  typeof window !== 'undefined' ? window : this,
  typeof window !== 'undefined' ? window.exec : require('../luna.js').exec,
  typeof window !== 'undefined' ? window.classify : require('../devices.js').classify,
  typeof window !== 'undefined' ? window.t : require('../i18n.js').t
);
