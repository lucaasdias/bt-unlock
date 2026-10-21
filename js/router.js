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
// Task 9 (superseding Task 8's original "Left/Right/Back globally
// switches screens" model, after the human partner caught a real
// confusion on the physical remote: Left/Right on a paired-device row
// with two action buttons — Disconnect/Reconnect + Forget, laid out
// horizontally — switched the whole screen away instead of moving
// between those buttons, because Left/Right meant "change screen"
// everywhere) replaces it with the three-level tab-bar model every real
// TV Settings app (Android TV, webOS Settings, tvOS Settings) uses:
//
//   1. A persistent tab bar (nav) — Left/Right moves between tabs and
//      switches the active screen LIVE as focus moves (no separate
//      Enter needed; this matches how TV tab bars actually behave).
//   2. Down from the tab bar enters that screen's content area, landing
//      on its first row (or the row it remembers from last time it was
//      in this screen's content). Up from a content area's first row —
//      or Back from anywhere in a content area — returns focus to the
//      tab bar, to the currently-active tab.
//   3. Inside a content area, Up/Down moves between rows (clamped, no
//      wrap). For a row with more than one focusable action in it
//      (paired.js's rows: Disconnect/Reconnect + Forget), Left/Right
//      moves between THAT row's own buttons instead of touching the
//      screen at all. A row with only one action (discover.js — the
//      whole row is a single "select to pair" button) has nothing to
//      move to, so Left/Right there is a harmless no-op, not a special
//      case the router needs to know about. Enter/OK still activates
//      whichever element currently has focus, same as before.
//
// Rows are discovered generically: any focusable element inside the
// active screen whose nearest ancestor (up to the screen container)
// carries the shared `device-row` class (see css/app.css /
// js/screens/discover.js / js/screens/paired.js) is grouped with its
// row-mates; everything else is its own one-element row. No screen file
// needs to tell the router anything about this — the same DOM/class
// contract Task 9's design system already introduced for styling is
// what the router reads to find row groups.
//
// A screen's content is frequently rebuilt out from under the user (e.g.
// Discover's ~2s poll calls list.innerHTML = '' and rebuilds every row,
// which silently blurs whatever had focus back to <body>). A
// MutationObserver on the active screen's container is how the router
// notices that happening and restores focus — to the same row/column, if
// one still exists — without any of the screens' own code having to
// cooperate or even know this exists. This reconciliation only runs while
// focus is logically inside the content area (not while the user has
// deliberately moved up to the tab bar) — see focusLevel below.
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

  // ROW_CLASS — the shared class (css/app.css's `.device-row`) that marks
  // an element as a row container whose own focusable descendants should
  // be grouped together for Left/Right-between-actions purposes. Plain
  // string/class-list check rather than Element.prototype.closest() so
  // this works unchanged against test/helpers/fake-dom.js's minimal DOM.
  var ROW_CLASS = 'device-row';

  function hasRowClass(el) {
    var cls = el && el.className;
    return (' ' + (cls || '') + ' ').indexOf(' ' + ROW_CLASS + ' ') !== -1;
  }

  // SCROLLABLE_CLASS — css/app.css's `.scrollable-content` (today just
  // status.js's log viewer `<pre>`). A focusable element carrying this
  // class is still an ordinary row for Up/Down-between-rows purposes,
  // but while it has focus, Up/Down scroll its own content FIRST,
  // falling through to the normal moveRow() behavior only once it's
  // scrolled all the way to that edge (or has nothing to scroll at all)
  // — this is new territory for this app (nothing scrollable existed
  // before this round), so rather than inventing a separate input-
  // handling path alongside the existing tab-bar/content model, this is
  // the smallest possible extension to the same handleKeydown() this
  // file already has: one extra check before UP/DOWN fall through to
  // moveRow(), with no new state machine, no new focus level, nothing
  // that needed touching in navigate()/mount()/enterContent()/etc.
  var SCROLLABLE_CLASS = 'scrollable-content';

  function isScrollable(el) {
    var cls = el && el.className;
    return (' ' + (cls || '') + ' ').indexOf(' ' + SCROLLABLE_CLASS + ' ') !== -1;
  }

  // SCROLL_STEP_PX — how far one Up/Down press scrolls a focused
  // scrollable element. Matches this app's generous, couch-distance
  // spacing scale rather than a small desktop-sized increment.
  var SCROLL_STEP_PX = 60;

  // tryScroll(el, delta) -> boolean
  //   delta is -1 (Up) or 1 (Down). Returns true if `el` actually
  //   scrolled (so the caller should swallow the key instead of also
  //   moving rows); false if `el` was already at that edge — nothing
  //   left to scroll that direction — or has no scrollable overflow at
  //   all, in which case Up/Down should fall through to the normal
  //   row-to-row behavior exactly as if this element weren't scrollable.
  //   scrollTop/scrollHeight/clientHeight are plain numeric properties
  //   on any real HTMLElement (and, for tests, on
  //   test/helpers/fake-dom.js's FakeElement too — nothing special
  //   needed there, they're just ordinary assignable properties); a
  //   real browser also auto-clamps an out-of-range scrollTop
  //   assignment on its own, but this clamps explicitly too so the
  //   fake-DOM test environment (which does no such clamping) behaves
  //   the same way.
  function tryScroll(el, delta) {
    var before = el.scrollTop || 0;
    var max = Math.max((el.scrollHeight || 0) - (el.clientHeight || 0), 0);
    if (delta < 0) {
      if (before <= 0) {
        return false;
      }
      el.scrollTop = Math.max(0, before - SCROLL_STEP_PX);
      return true;
    }
    if (before >= max) {
      return false;
    }
    el.scrollTop = Math.min(max, before + SCROLL_STEP_PX);
    return true;
  }

  // createRouter(screens: {[name]: {label?: string, render(container, navigate) -> (void|Function)}})
  //   -> {mount(root, initialName), navigate(root, name)}
  function createRouter(screens) {
    var activeContainer = null;
    var navButtons = {};
    var currentCleanup = null;
    var screenNames = Object.keys(screens);
    var currentName = null;
    var rootEl = null;
    // { [screenName]: {row: number, col: number} } — remembered per
    // screen so returning to a screen's content (via the tab bar) lands
    // back where the user left it, same spirit as Task 8's lastFocusedIndex.
    var lastFocusedIndex = {};
    // 'nav' | 'content' — which of the two focus levels is currently
    // "live". Starts 'nav': the tab bar is the top of the hierarchy, so a
    // freshly mounted app (and every freshly switched-to screen) starts
    // there, same as every real TV Settings app's own tab bar.
    var focusLevel = 'nav';
    var observer = null;
    var listenerAttached = false;

    // getFocusableRowElements() -> HTMLElement[]
    //   Only rows that are actually reachable right now: not disabled,
    //   not hidden (status.js hides its toggle button once the adapter
    //   is on; discover.js/paired.js disable every row while an action
    //   is in flight).
    function getFocusableRowElements() {
      if (!activeContainer) {
        return [];
      }
      var all = activeContainer.querySelectorAll(FOCUSABLE_SELECTOR);
      return Array.prototype.filter.call(all, function (el) {
        return !el.disabled && !el.hidden;
      });
    }

    // findRowKey(el) -> HTMLElement
    //   Walks up from a focusable element to the nearest ancestor (within
    //   the active screen's own container) carrying ROW_CLASS — that
    //   ancestor is the "row" every focusable element inside it shares,
    //   for Left/Right-between-actions grouping (paired.js's
    //   Disconnect/Reconnect + Forget buttons, both inside one
    //   `.device-row` <li>). If nothing matches (discover.js's own rows,
    //   whose <button> wrapper *is* the row and has no row-mates; or
    //   status.js's single toggle button), the element is its own
    //   one-item row — exactly Task 8's original flat-list behavior for
    //   every screen that doesn't have multi-action rows.
    function findRowKey(el) {
      var node = el.parentNode;
      while (node && node !== activeContainer) {
        if (hasRowClass(node)) {
          return node;
        }
        node = node.parentNode;
      }
      return el;
    }

    // getRowGroups() -> HTMLElement[][]
    //   The active screen's focusable elements, grouped into rows in
    //   document order (so Up/Down walks rows top-to-bottom and Left/Right
    //   walks a row's own actions left-to-right, matching the visual
    //   layout css/app.css renders).
    function getRowGroups() {
      var elements = getFocusableRowElements();
      var groups = [];
      var keys = [];
      elements.forEach(function (el) {
        var key = findRowKey(el);
        var idx = keys.indexOf(key);
        if (idx === -1) {
          keys.push(key);
          groups.push([el]);
        } else {
          groups[idx].push(el);
        }
      });
      return groups;
    }

    function clamp(value, min, max) {
      if (value < min) {
        return min;
      }
      if (value > max) {
        return max;
      }
      return value;
    }

    // currentRowCol(groups) -> {row, col}
    //   Where focus logically is within the active screen's row groups:
    //   wherever document.activeElement actually is, if it's one of
    //   them; otherwise the remembered position (clamped to however many
    //   rows/columns exist now), the same fallback Task 8's
    //   reconcileFocus used for the flat-list case.
    function currentRowCol(groups) {
      var active = document.activeElement;
      for (var r = 0; r < groups.length; r += 1) {
        var c = groups[r].indexOf(active);
        if (c !== -1) {
          return { row: r, col: c };
        }
      }
      var remembered = lastFocusedIndex[currentName] || { row: 0, col: 0 };
      var row = clamp(remembered.row, 0, groups.length - 1);
      var col = clamp(remembered.col, 0, groups[row].length - 1);
      return { row: row, col: col };
    }

    function focusRowCol(groups, row, col) {
      groups[row][col].focus();
      lastFocusedIndex[currentName] = { row: row, col: col };
    }

    // reconcileFocus() -> void
    //   Called after every DOM change inside the active screen (via the
    //   MutationObserver below). Only acts while focus is logically
    //   inside the content area (focusLevel === 'content') — if the user
    //   has deliberately moved up to the tab bar, a poll/refresh
    //   happening in the screen behind it must never yank focus back
    //   into content out from under them. When in content: if focus is
    //   already on one of this screen's own rows, just remembers where;
    //   otherwise — most commonly because the row that had focus was
    //   just removed/rebuilt out from under the user — restores it to
    //   the same row/column (clamped to however many exist now), so a
    //   poll/refresh never silently drops the user to a focus-less page.
    function reconcileFocus() {
      if (!activeContainer || focusLevel !== 'content') {
        return;
      }
      var groups = getRowGroups();
      var active = document.activeElement;
      for (var r = 0; r < groups.length; r += 1) {
        var c = groups[r].indexOf(active);
        if (c !== -1) {
          lastFocusedIndex[currentName] = { row: r, col: c };
          return;
        }
      }
      if (groups.length === 0) {
        return;
      }
      var pos = currentRowCol(groups);
      focusRowCol(groups, pos.row, pos.col);
    }

    // enterNav() -> void
    //   Up from a content area's first row, or Back from anywhere in a
    //   content area: focus moves to the tab bar, onto whichever tab is
    //   currently active (the screen itself doesn't change).
    function enterNav() {
      focusLevel = 'nav';
      var button = navButtons[currentName];
      if (button) {
        button.focus();
      }
    }

    // enterContent() -> void
    //   Down from the tab bar: focus moves into the active screen's
    //   content, landing on the row/column it remembers (first row by
    //   default — navigate() resets the memory on every screen switch).
    //   A screen with zero focusable rows (e.g. Discover before the
    //   first poll resolves) has nothing to focus; blur explicitly so
    //   focus doesn't appear stuck on the tab bar while logically
    //   "inside" an empty content area.
    function enterContent() {
      focusLevel = 'content';
      var groups = getRowGroups();
      if (groups.length === 0) {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
        return;
      }
      var pos = currentRowCol(groups);
      focusRowCol(groups, pos.row, pos.col);
    }

    // moveRow(delta: -1|1) -> void
    //   Up/Down handler while inside a content area. Clamps at the last
    //   row; Up past the first row exits to the tab bar (enterNav())
    //   instead of clamping, per the three-level model.
    function moveRow(delta) {
      var groups = getRowGroups();
      if (groups.length === 0) {
        return;
      }
      var pos = currentRowCol(groups);
      var row = pos.row + delta;
      if (row < 0) {
        enterNav();
        return;
      }
      row = clamp(row, 0, groups.length - 1);
      var col = clamp(pos.col, 0, groups[row].length - 1);
      focusRowCol(groups, row, col);
    }

    // moveCol(delta: -1|1) -> void
    //   Left/Right handler while inside a content area: moves between a
    //   single row's own action buttons (paired.js's Disconnect/Reconnect
    //   + Forget). Clamps rather than wrapping or crossing into another
    //   row — a row with only one action (discover.js, status.js) simply
    //   has nowhere to go, so this is a harmless no-op there.
    function moveCol(delta) {
      var groups = getRowGroups();
      if (groups.length === 0) {
        return;
      }
      var pos = currentRowCol(groups);
      var col = clamp(pos.col + delta, 0, groups[pos.row].length - 1);
      focusRowCol(groups, pos.row, col);
    }

    // switchTab(delta: -1|1) -> void
    //   Left/Right handler while on the tab bar. Wraps around (3 screens,
    //   so Right from the last one reaches the first) and switches the
    //   active screen immediately — real TV tab bars don't wait for a
    //   separate Enter to commit a tab change.
    function switchTab(delta) {
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
    //   know what a row's action actually does. Only meaningful inside a
    //   content area; the tab bar switches live on Left/Right already, so
    //   Enter on a tab has nothing additional to do.
    function activateFocused() {
      var active = document.activeElement;
      if (active && activeContainer && activeContainer.contains(active) && typeof active.click === 'function') {
        active.click();
      }
    }

    function handleKeydown(event) {
      if (isKey(event, 'UP')) {
        event.preventDefault();
        if (focusLevel === 'content') {
          if (isScrollable(document.activeElement) && tryScroll(document.activeElement, -1)) {
            return;
          }
          moveRow(-1);
        }
      } else if (isKey(event, 'DOWN')) {
        event.preventDefault();
        if (focusLevel === 'nav') {
          enterContent();
        } else {
          if (isScrollable(document.activeElement) && tryScroll(document.activeElement, 1)) {
            return;
          }
          moveRow(1);
        }
      } else if (isKey(event, 'LEFT')) {
        event.preventDefault();
        if (focusLevel === 'nav') {
          switchTab(-1);
        } else {
          moveCol(-1);
        }
      } else if (isKey(event, 'RIGHT')) {
        event.preventDefault();
        if (focusLevel === 'nav') {
          switchTab(1);
        } else {
          moveCol(1);
        }
      } else if (isKey(event, 'BACK')) {
        event.preventDefault();
        if (focusLevel === 'content') {
          enterNav();
        }
      } else if (isKey(event, 'ENTER')) {
        event.preventDefault();
        if (focusLevel === 'content') {
          activateFocused();
        }
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
      lastFocusedIndex[name] = { row: 0, col: 0 };

      activeContainer.innerHTML = '';
      currentCleanup = screens[name].render(activeContainer, function (nextName) {
        navigate(root, nextName);
      });

      // Switching screens — whether via the tab bar's own Left/Right or
      // via a screen calling navigate() itself (e.g. discover.js's "Go to
      // Status" button when the adapter is off) — always lands focus back
      // on the tab bar, on the newly active tab. This is the one
      // consistent rule the three-level model needs for "what happens
      // when the active screen changes," rather than having two different
      // behaviors depending on how navigate() was reached.
      focusLevel = 'nav';
      if (navButtons[name]) {
        navButtons[name].focus();
      }
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
