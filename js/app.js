// app.js — entry point. Wires the router and its screens into the page.
//
// Runs on DOMContentLoaded so it works regardless of where the <script>
// tag sits in index.html.
(function (global) {
  'use strict';

  // detectLocale() -> string
  //   webOS exposes the TV's system locale on window.PalmSystem.locale;
  //   navigator.language is the fallback both for plain browsers (no
  //   PalmSystem at all) and for a PalmSystem build that hasn't set
  //   .locale for some reason. setLocale() (js/i18n.js) normalizes
  //   whatever comes back to one of this app's three shipped locales.
  function detectLocale() {
    if (global.PalmSystem && global.PalmSystem.locale) {
      return global.PalmSystem.locale;
    }
    return navigator.language;
  }

  // getOverrideLocale() -> string | null
  //   js/screens/settings.js's manual language picker persists its
  //   choice in localStorage (this app's only persistent-storage use) —
  //   checked here BEFORE detectLocale(), so a manual override always
  //   wins over auto-detection once set. Wrapped in try/catch the same
  //   way settings.js's own storage access is: a blocked/unavailable
  //   localStorage (private mode, some webview configs) just means no
  //   override, falling back to detectLocale(), never a thrown error.
  function getOverrideLocale() {
    try {
      return global.localStorage ? global.localStorage.getItem(global.LOCALE_OVERRIDE_STORAGE_KEY) : null;
    } catch (e) {
      return null;
    }
  }

  // start(initialScreen?: string) -> void
  //   Builds the router fresh and mounts it. Takes an optional starting
  //   screen (defaulting to 'status', the original behavior) so
  //   settings.js's language-override handler can call this again via
  //   `global.reinitApp('settings')` after switching locales — the tab
  //   bar's own labels are only ever set once, at router.js's mount()
  //   time, so a live locale switch needs the whole router rebuilt to
  //   actually show the new language everywhere, not just re-rendering
  //   whichever single screen is already active.
  function start(initialScreen) {
    var container = document.getElementById('app');
    if (!container) {
      return;
    }
    global.setLocale(getOverrideLocale() || detectLocale());
    var router = global.createRouter({
      status: { label: global.t('nav.status'), render: global.render },
      discover: { label: global.t('nav.discover'), render: global.renderDiscover },
      paired: { label: global.t('nav.paired'), render: global.renderPaired },
      settings: { label: global.t('nav.settings'), render: global.renderSettings }
    });
    router.mount(container, initialScreen || 'status');
  }

  // Exposed so settings.js can trigger a full app rebuild after a live
  // locale change, without js/app.js needing to know anything about
  // settings.js, and without touching js/router.js's own API.
  global.reinitApp = start;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      start();
    });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);
