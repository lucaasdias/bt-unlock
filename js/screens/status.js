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
(function (global, execRef) {
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
    heading.textContent = 'Bluetooth';
    wrapper.appendChild(heading);

    var stateLabel = document.createElement('p');
    stateLabel.className = 'status-state';
    stateLabel.textContent = 'Checking adapter status...';
    wrapper.appendChild(stateLabel);

    var errorLabel = document.createElement('p');
    errorLabel.className = 'status-error';
    errorLabel.hidden = true;
    wrapper.appendChild(errorLabel);

    var toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'status-toggle';
    toggleButton.textContent = 'Turn on';
    wrapper.appendChild(toggleButton);

    container.appendChild(wrapper);

    function showError(message) {
      errorLabel.textContent = message;
      errorLabel.hidden = false;
    }

    function clearError() {
      errorLabel.hidden = true;
      errorLabel.textContent = '';
    }

    function refresh() {
      return isAdapterPowered().then(function (powered) {
        stateLabel.textContent = powered ? 'Adapter: on' : 'Adapter: off';
        toggleButton.hidden = powered;
        return powered;
      });
    }

    function handleToggle() {
      toggleButton.disabled = true;
      clearError();
      execRef('bt-power.sh', ['on']).then(function (result) {
        if (!result.ok) {
          showError('Could not turn on the adapter: ' + (result.errorText || 'unknown error'));
        }
        return refresh();
      }).catch(function (err) {
        showError('Could not turn on the adapter: ' + err.message);
      }).then(function () {
        toggleButton.disabled = false;
      });
    }

    toggleButton.addEventListener('click', handleToggle);

    refresh().catch(function (err) {
      stateLabel.textContent = 'Adapter: unknown';
      showError('Could not read adapter status: ' + err.message);
    });
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
})(typeof window !== 'undefined' ? window : this, typeof window !== 'undefined' ? window.exec : require('../luna.js').exec);
