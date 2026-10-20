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

  function start() {
    var container = document.getElementById('app');
    if (!container) {
      return;
    }
    global.setLocale(detectLocale());
    var router = global.createRouter({
      status: { label: global.t('nav.status'), render: global.render },
      discover: { label: global.t('nav.discover'), render: global.renderDiscover },
      paired: { label: global.t('nav.paired'), render: global.renderPaired }
    });
    router.mount(container, 'status');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);
