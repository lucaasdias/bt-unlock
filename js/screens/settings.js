// settings.js — Screen 4: app settings (language override, help/QR code).
//
// Two independent features, neither touching any Luna/exec call:
//
//   1. Manual language override. js/app.js auto-detects the TV's locale
//      (Task 7's detectLocale()) on every startup; this screen lets the
//      user override that with an explicit pt-BR/en/es choice, persisted
//      in localStorage (this app has no other persistent storage layer)
//      under js/i18n.js's shared LOCALE_OVERRIDE_STORAGE_KEY, so app.js's
//      startup sequence can check it before falling back to
//      detectLocale(). Picking a language calls setLocale() immediately,
//      then asks app.js to fully re-render (global.reinitApp) so every
//      screen's labels — including the tab bar's, set once at mount —
//      actually reflect the new language live, not just this screen.
//   2. A QR code (js/qrcode.js, this project's own from-scratch encoder
//      — see that file's header for why) linking to the project's repo,
//      plus the plain URL text as a fallback/safety net next to it.
//
// Round 3 of this screen's own history: it started as an inline panel
// behind a "Get Help" button, then became a full-screen modal (the
// inline version got visually cut off at a legible/scannable size), and
// is now this — a docked side panel, always visible, no button at all.
// Per the human partner's own instruction: make it look and behave like
// status.js's Log viewer box (always-visible panel docked to one side,
// bounded to fit the screen, no show/hide trigger), for consistency
// between the two screens' two-column layouts. Since it's just another
// row-less, non-interactive panel now (same as status.js's log box
// minus the scrolling — a QR code has no reason to scroll), there is no
// focus-trapping/modal machinery left to maintain: this screen went
// back to being an ordinary part of the normal tab-bar/content model,
// nothing router.js needs to know about.
//
// Loaded as a plain <script> tag in the browser (attaches
// `renderSettings` to `window`) and exported via CommonJS under Node.
(function (global, setLocaleRef, getLocaleRef, tRef, generateQRMatrixRef, storageRef, overrideKeyRef) {
  'use strict';

  // HELP_URL — the project's repo. Not pushed/public yet (a deliberate,
  // separate decision gated on the human partner's own go-ahead) — the
  // QR/link will 404 until then. That's expected and does not block
  // shipping this panel; see task-9-report.md.
  var HELP_URL = 'https://github.com/lucaasdias/bt-unlock';

  // LANGUAGE_OPTIONS — this app's three shipped locales (js/i18n.js's
  // SHIPPED_LOCALES, hardcoded here rather than read off that constant:
  // the display label and the value don't share a single key, since
  // "pt-BR" isn't itself an i18n lookup key, so there's nothing to gain
  // from importing the raw array here too).
  var LANGUAGE_OPTIONS = [
    { code: 'pt-BR', labelKey: 'settings.languagePtBR' },
    { code: 'en', labelKey: 'settings.languageEn' },
    { code: 'es', labelKey: 'settings.languageEs' }
  ];

  function safeStorageGet(key) {
    try {
      return storageRef ? storageRef.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      if (storageRef) {
        storageRef.setItem(key, value);
      }
    } catch (e) {
      // Private-mode/blocked storage: the override simply won't persist
      // across restarts, same graceful-degradation spirit as every other
      // storage access in this app's design. The locale still changes
      // live for the rest of this session either way.
    }
  }

  // buildQrSvg(text) -> SVGElement | null
  //   Renders js/qrcode.js's module matrix as an inline <svg> with a
  //   `viewBox` but no fixed pixel width/height — css/app.css's
  //   `.help-qr-svg` sizes it with `width: 100%; height: auto`, so it
  //   scales down to fit whatever bounded container it's placed in
  //   (the whole point of this round: the old fixed 320x320 size is
  //   exactly what overflowed past the screen edge before). Returns
  //   null if the matrix couldn't be generated (see js/qrcode.js's own
  //   header for when/why) or this environment has no
  //   createElementNS — either way, callers fall back to the plain URL
  //   text, which is always shown regardless.
  function buildQrSvg(text) {
    var matrix = null;
    try {
      matrix = generateQRMatrixRef(text);
    } catch (e) {
      matrix = null;
    }
    if (!matrix || typeof document.createElementNS !== 'function') {
      return null;
    }
    var size = matrix.length;
    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('class', 'help-qr-svg');
    var bg = document.createElementNS(svgNs, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(size));
    bg.setAttribute('height', String(size));
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);
    for (var r = 0; r < size; r += 1) {
      for (var c = 0; c < size; c += 1) {
        if (matrix[r][c]) {
          var rect = document.createElementNS(svgNs, 'rect');
          rect.setAttribute('x', String(c));
          rect.setAttribute('y', String(r));
          rect.setAttribute('width', '1');
          rect.setAttribute('height', '1');
          rect.setAttribute('fill', '#000000');
          svg.appendChild(rect);
        }
      }
    }
    return svg;
  }

  // render(container: HTMLElement) -> void
  function render(container) {
    container.innerHTML = '';

    var wrapper = document.createElement('div');
    wrapper.className = 'settings-screen';

    var heading = document.createElement('h1');
    heading.textContent = tRef('settings.heading');
    wrapper.appendChild(heading);

    // Two columns — same `.status-columns`/`.status-main`/
    // `.status-log-panel` structure status.js's own two-column layout
    // uses (language + override controls on the left, the Help/QR
    // panel docked to the right, same visual pattern as status.js's Log
    // viewer box), reused verbatim rather than inventing a parallel set
    // of settings-specific classes for the exact same layout.
    var settingsColumns = document.createElement('div');
    settingsColumns.className = 'status-columns';

    var settingsMain = document.createElement('div');
    settingsMain.className = 'status-main';

    var settingsHelpPanel = document.createElement('div');
    settingsHelpPanel.className = 'status-log-panel';

    settingsColumns.appendChild(settingsMain);
    settingsColumns.appendChild(settingsHelpPanel);
    wrapper.appendChild(settingsColumns);

    // ---- Language override (left column) ----
    var languageHeading = document.createElement('h2');
    languageHeading.className = 'section-heading';
    languageHeading.textContent = tRef('settings.languageHeading');
    settingsMain.appendChild(languageHeading);

    // `device-row` (not just `status-row`) is deliberate: it's the same
    // class js/router.js's findRowKey() keys off to group paired.js's
    // Disconnect/Forget buttons into one Left/Right-navigable row — per
    // the human partner's live feedback, the three language buttons
    // should behave the same way (one row, Left/Right between them),
    // not as three separate Up/Down rows. `.language-row.device-row` in
    // css/app.css resets the card-styling `.device-row` normally carries
    // (meant for a device-list entry, not a plain button group) back to
    // this plain row's own look.
    var languageRow = document.createElement('div');
    languageRow.className = 'status-row device-row language-row';

    var languageButtons = {};
    LANGUAGE_OPTIONS.forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = tRef(option.labelKey);
      button.addEventListener('click', function () {
        applyLocale(option.code);
      });
      languageButtons[option.code] = button;
      languageRow.appendChild(button);
    });
    settingsMain.appendChild(languageRow);

    function refreshLanguageButtons() {
      var current = getLocaleRef();
      LANGUAGE_OPTIONS.forEach(function (option) {
        var button = languageButtons[option.code];
        button.className = 'btn btn-compact ' + (option.code === current ? 'btn-primary' : 'btn-secondary');
      });
    }

    function applyLocale(code) {
      safeStorageSet(overrideKeyRef, code);
      setLocaleRef(code);
      if (typeof global.reinitApp === 'function') {
        // Rebuilds the whole app (tab bar labels included — they're
        // only set once, at router.js's mount() time) in the new
        // language, landing back on this same screen rather than
        // app.js's own default 'status' start screen.
        global.reinitApp('settings');
      } else {
        // Under `node --test` (no app.js/router present) or if app.js
        // somehow hasn't run yet: at least keep this screen itself
        // correct.
        refreshLanguageButtons();
      }
    }

    refreshLanguageButtons();

    // ---- Help / QR code (right column, docked panel — always visible,
    // no show/hide trigger, matching status.js's Log box: nothing to
    // refresh or toggle here either, so unlike the log panel this one
    // doesn't even need its own header-row button). ----
    var helpHeading = document.createElement('h2');
    helpHeading.className = 'section-heading';
    helpHeading.textContent = tRef('settings.helpHeading');
    settingsHelpPanel.appendChild(helpHeading);

    var qrPanel = document.createElement('div');
    qrPanel.className = 'help-qr-panel';

    var qrHolder = document.createElement('div');
    qrHolder.className = 'help-qr';
    var svg = buildQrSvg(HELP_URL);
    if (svg) {
      qrHolder.appendChild(svg);
    }
    // If svg is null (see js/qrcode.js's header for when that can
    // happen), qrHolder is simply left empty — the plain URL text right
    // below it is the fallback either way, not a special case to handle
    // here.
    qrPanel.appendChild(qrHolder);

    var helpUrlText = document.createElement('p');
    helpUrlText.className = 'help-url';
    helpUrlText.textContent = HELP_URL;
    qrPanel.appendChild(helpUrlText);

    settingsHelpPanel.appendChild(qrPanel);

    container.appendChild(wrapper);
  }

  var api = { render: render };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.renderSettings = render;
  }
})(
  typeof window !== 'undefined' ? window : this,
  typeof window !== 'undefined' ? window.setLocale : require('../i18n.js').setLocale,
  typeof window !== 'undefined' ? window.getLocale : require('../i18n.js').getLocale,
  typeof window !== 'undefined' ? window.t : require('../i18n.js').t,
  typeof window !== 'undefined' ? window.generateQRMatrix : require('../qrcode.js').generateQRMatrix,
  typeof window !== 'undefined' ? window.localStorage : null,
  typeof window !== 'undefined' ? window.LOCALE_OVERRIDE_STORAGE_KEY : require('../i18n.js').LOCALE_OVERRIDE_STORAGE_KEY
);
