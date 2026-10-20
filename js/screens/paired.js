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
(function (global, execRef, classifyRef) {
  'use strict';

  // Same anti-goal as discover.js (Task 5): `exec()` has no timeout of
  // its own, and a profile mismatch or unresponsive device can hang a
  // connect/disconnect call indefinitely (confirmed live in Task 5 for
  // bt-connect.sh). Every exec() call this screen makes that could hang
  // — connect, disconnect, and forget (which itself disconnects before
  // unpairing) — is raced against this timeout so the UI always comes
  // back to a usable state.
  var ACTION_TIMEOUT_MS = 20000;

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

    var heading = document.createElement('h1');
    heading.textContent = 'Paired devices';
    wrapper.appendChild(heading);

    var statusLabel = document.createElement('p');
    statusLabel.className = 'paired-status';
    wrapper.appendChild(statusLabel);

    var errorLabel = document.createElement('p');
    errorLabel.className = 'paired-error';
    errorLabel.hidden = true;
    wrapper.appendChild(errorLabel);

    var refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.textContent = 'Refresh';
    refreshButton.addEventListener('click', function () {
      load();
    });
    wrapper.appendChild(refreshButton);

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
        empty.textContent = 'No paired devices.';
        list.appendChild(empty);
        return;
      }

      paired.forEach(function (device) {
        var classified = classifyRef(device.classOfDevice || 0);
        var label = device.name && device.name.length > 0 ? device.name : device.address;
        var connectedProfiles = device.connectedProfiles || [];
        var connected = connectedProfiles.length > 0;

        var item = document.createElement('li');
        item.className = 'paired-device';

        var info = document.createElement('span');
        info.textContent = '[' + classified.iconId + '] ' + label + ' (' + classified.kind + ') — ' +
          (connected ? 'connected' : 'disconnected');
        item.appendChild(info);

        // A device whose class doesn't map to a supported profile (same
        // profile === null case discover.js filters out of its list)
        // can still be paired and still needs to be forgettable, but
        // there is no profile to connect/disconnect it over — only
        // Forget is offered for it.
        if (classified.profile !== null) {
          var toggleButton = document.createElement('button');
          toggleButton.type = 'button';
          toggleButton.textContent = connected ? 'Disconnect' : 'Reconnect';
          toggleButton.addEventListener('click', function () {
            handleToggleConnection(device, classified, connected, label);
          });
          item.appendChild(toggleButton);
        }

        var forgetButton = document.createElement('button');
        forgetButton.type = 'button';
        forgetButton.textContent = 'Forget';
        forgetButton.addEventListener('click', function () {
          handleForget(device, classified, label);
        });
        item.appendChild(forgetButton);

        list.appendChild(item);
      });
    }

    function load() {
      clearError();
      setBusy(true, 'Loading paired devices...');
      attemptToken += 1;
      var thisAttempt = attemptToken;

      return execRef('bt-paired.sh', []).then(function (result) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        setBusy(false);
        if (!result.ok) {
          showError('Could not load paired devices: ' + (result.errorText || 'unknown error'));
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
        showError('Could not load paired devices: ' + err.message);
      });
    }

    function handleToggleConnection(device, classified, wasConnected, label) {
      if (busy) {
        return;
      }
      clearError();
      var script = wasConnected ? 'bt-disconnect.sh' : 'bt-connect.sh';
      var actionLabel = wasConnected ? 'Disconnecting from ' : 'Connecting to ';
      setBusy(true, actionLabel + label + '...');
      attemptToken += 1;
      var thisAttempt = attemptToken;

      raceTimeout(execRef(script, [device.address, classified.profile]), ACTION_TIMEOUT_MS).then(function (result) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        if (!result.ok) {
          setBusy(false);
          showError((wasConnected ? 'Disconnect failed: ' : 'Connect failed: ') + (result.errorText || 'unknown error'));
          return;
        }
        return load();
      }).catch(function (err) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        setBusy(false);
        var message = err.message === 'timed out'
          ? (wasConnected ? 'Disconnecting timed out.' : 'Connecting timed out. The device may be out of range, or may not support this profile.')
          : (wasConnected ? 'Disconnect failed: ' : 'Connect failed: ') + err.message;
        showError(message);
      });
    }

    function handleForget(device, classified, label) {
      if (busy) {
        return;
      }
      clearError();
      setBusy(true, 'Forgetting ' + label + '...');
      attemptToken += 1;
      var thisAttempt = attemptToken;

      raceTimeout(execRef('bt-forget.sh', [device.address, classified.profile || '']), ACTION_TIMEOUT_MS).then(function (result) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        if (!result.ok) {
          setBusy(false);
          showError('Forget failed: ' + (result.errorText || 'unknown error'));
          return;
        }
        return load();
      }).catch(function (err) {
        if (thisAttempt !== attemptToken) {
          return;
        }
        setBusy(false);
        var message = err.message === 'timed out'
          ? 'Forgetting timed out.'
          : 'Forget failed: ' + err.message;
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
  typeof window !== 'undefined' ? window.classify : require('../devices.js').classify
);
