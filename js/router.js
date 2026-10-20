// router.js — tiny screen switcher + remote-control (D-pad) focus manager.
//
// Owns a small nav bar (one button per registered screen) above the
// active screen's own container, so individual screens don't need to
// know about each other or about navigation chrome. A screen's render
// function is called as render(container, navigate), where navigate(name)
// switches to another registered screen (e.g. Discover linking back to
// Status when the adapter is off). If render returns a function, the
// router calls it right before tearing the screen down (e.g. Discover
// uses this to stop its polling timer rather than leaking it once the
// user has navigated away).
//
// Task 8 adds D-pad semantics on top of that, entirely inside the router
// so screens stay unaware of it (no screen file needs any change):
//   - Up/Down move logical focus between the active screen's own rows
//     (buttons inside its container — the top nav bar is not part of
//     this; see switchScreen below).
//   - Left/Right/Back move between the three registered screens, in
//     registration order (wrapping around), reusing the exact same
//     navigate() path the nav bar's own click handlers use.
//   - Enter/OK activates (clicks) whatever row currently has focus.
// A screen's content is frequently rebuilt out from under the user (e.g.
// Discover's ~2s poll calls list.innerHTML = '' and rebuilds every row,
// which silently blurs whatever had focus back to <body>). A
// MutationObserver on the active screen's container is how the router
// notices that happening and restores focus — to the same row index, if
// one still exists — without any of the screens' own code having to
// cooperate or even know this exists.
//
// Loaded as a plain <script> tag in the browser (attaches `createRouter`
// to `window`) and exported via CommonJS under Node.
(function (global) {
  'use strict';

  // Remote keycodes, verified against webOS's own D-pad mapping (and kept
  // permissive with the standard DOM `key` names too, since this runs
  // inside a plain webview and both have shown up across webOS versions
  // in the wild): Up/Down/Left/Right/Enter are the obvious ones; Back is
  // the remote's dedicated back button, keyCode 461 on webOS, which has
  // no single standard `key` string across browsers/platforms.
  var KEYCODE = { UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, ENTER: 13, BACK: 461 };
  var KEY_NAMES = {
    UP: ['ArrowUp', 'Up'],
    DOWN: ['ArrowDown', 'Down'],
    LEFT: ['ArrowLeft', 'Left'],
    RIGHT: ['ArrowRight', 'Right'],
    ENTER: ['Enter'],
    BACK: ['Back', 'GoBack', 'XF86Back', 'BrowserBack']
  };

  function isKey(event, name) {
    return KEY_NAMES[name].indexOf(event.key) !== -1 || event.keyCode === KEYCODE[name];
  }

  // FOCUSABLE_SELECTOR intentionally only matches real, natively-focusable
  // controls (buttons; any future [tabindex] row) — every row this app's
  // screens render today is a <button>, so nothing else is needed.
  var FOCUSABLE_SELECTOR = 'button, [tabindex]';

  // createRouter(screens: {[name]: {label?: string, render(container, navigate) -> (void|Function)}})
  //   -> {mount(root, initialName), navigate(root, name)}
  function createRouter(screens) {
    var activeContainer = null;
    var navButtons = {};
    var currentCleanup = null;
    var screenNames = Object.keys(screens);
    var currentName = null;
    var rootEl = null;
    var lastFocusedIndex = {}; // { [screenName]: number }
    var observer = null;
    var listenerAttached = false;

    // getFocusableRows() -> HTMLElement[]
    //   Only rows that are actually reachable right now: not disabled,
    //   not hidden (status.js hides its toggle button once the adapter
    //   is on; discover.js/paired.js disable every row while an action
    //   is in flight).
    function getFocusableRows() {
      if (!activeContainer) {
        return [];
      }
      var all = activeContainer.querySelectorAll(FOCUSABLE_SELECTOR);
      return Array.prototype.filter.call(all, function (el) {
        return !el.disabled && !el.hidden;
      });
    }

    // reconcileFocus() -> void
    //   Called after every DOM change inside the active screen (via the
    //   MutationObserver below) and right after a screen first renders.
    //   If focus is already on one of this screen's own rows, just
    //   remembers which index that is. Otherwise — most commonly because
    //   the row that had focus was just removed/rebuilt out from under
    //   the user — restores focus to that same index (clamped to however
    //   many rows exist now), so a poll/refresh never silently drops the
    //   user back to a focus-less page.
    function reconcileFocus() {
      if (!activeContainer) {
        return;
      }
      var rows = getFocusableRows();
      var active = document.activeElement;
      if (active && rows.indexOf(active) !== -1) {
        lastFocusedIndex[currentName] = rows.indexOf(active);
        return;
      }
      if (rows.length === 0) {
        return;
      }
      var idx = lastFocusedIndex[currentName] || 0;
      if (idx > rows.length - 1) {
        idx = rows.length - 1;
      }
      if (idx < 0) {
        idx = 0;
      }
      rows[idx].focus();
      lastFocusedIndex[currentName] = idx;
    }

    // moveFocus(delta: -1|1) -> void
    //   Up/Down handler. Clamps at the first/last row rather than
    //   wrapping — predictable behavior for a vertical list of rows.
    function moveFocus(delta) {
      var rows = getFocusableRows();
      if (rows.length === 0) {
        return;
      }
      var idx = rows.indexOf(document.activeElement);
      if (idx === -1) {
        idx = lastFocusedIndex[currentName] || 0;
      }
      idx += delta;
      if (idx < 0) {
        idx = 0;
      }
      if (idx > rows.length - 1) {
        idx = rows.length - 1;
      }
      rows[idx].focus();
      lastFocusedIndex[currentName] = idx;
    }

    // switchScreen(delta: -1|1) -> void
    //   Left/Right/Back handler. Wraps around (3 screens, so Right from
    //   the last one reaches the first, matching the nav bar's own
    //   left-to-right order).
    function switchScreen(delta) {
      var idx = screenNames.indexOf(currentName);
      if (idx === -1) {
        return;
      }
      var nextIdx = (idx + delta + screenNames.length) % screenNames.length;
      navigate(rootEl, screenNames[nextIdx]);
    }

    // activateFocused() -> void
    //   Enter/OK handler. Clicking the focused element reuses each row's
    //   own existing click handler verbatim — the router never needs to
    //   know what a row's action actually does.
    function activateFocused() {
      var active = document.activeElement;
      if (active && activeContainer && activeContainer.contains(active) && typeof active.click === 'function') {
        active.click();
      }
    }

    function handleKeydown(event) {
      if (isKey(event, 'UP')) {
        event.preventDefault();
        moveFocus(-1);
      } else if (isKey(event, 'DOWN')) {
        event.preventDefault();
        moveFocus(1);
      } else if (isKey(event, 'LEFT') || isKey(event, 'BACK')) {
        event.preventDefault();
        switchScreen(-1);
      } else if (isKey(event, 'RIGHT')) {
        event.preventDefault();
        switchScreen(1);
      } else if (isKey(event, 'ENTER')) {
        event.preventDefault();
        activateFocused();
      }
    }

    function navigate(root, name) {
      if (!screens[name] || typeof screens[name].render !== 'function') {
        throw new Error('router: unknown screen "' + name + '"');
      }
      if (typeof currentCleanup === 'function') {
        currentCleanup();
      }
      currentCleanup = null;

      Object.keys(navButtons).forEach(function (key) {
        navButtons[key].setAttribute('aria-current', key === name ? 'true' : 'false');
      });

      currentName = name;
      // Every screen switch starts fresh at the first row — remembering a
      // row position across unrelated screens would be more surprising
      // than useful, and this keeps "where's focus going to land" simple
      // to reason about (and to test on the real remote).
      lastFocusedIndex[name] = 0;

      activeContainer.innerHTML = '';
      currentCleanup = screens[name].render(activeContainer, function (nextName) {
        navigate(root, nextName);
      });
      reconcileFocus();
    }

    function mount(root, initialName) {
      root.innerHTML = '';
      rootEl = root;

      var nav = document.createElement('nav');
      nav.className = 'app-nav';
      Object.keys(screens).forEach(function (name) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'app-nav-button';
        button.textContent = screens[name].label || name;
        button.addEventListener('click', function () {
          navigate(root, name);
        });
        navButtons[name] = button;
        nav.appendChild(button);
      });
      root.appendChild(nav);

      activeContainer = document.createElement('div');
      activeContainer.className = 'app-screen';
      root.appendChild(activeContainer);

      if (typeof MutationObserver !== 'undefined' && !observer) {
        observer = new MutationObserver(reconcileFocus);
        observer.observe(activeContainer, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'hidden']
        });
      }

      if (!listenerAttached) {
        document.addEventListener('keydown', handleKeydown);
        listenerAttached = true;
      }

      navigate(root, initialName);
    }

    return { mount: mount, navigate: navigate };
  }

  var api = { createRouter: createRouter };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.createRouter = createRouter;
  }
})(typeof window !== 'undefined' ? window : this);
