// app.js — entry point. Wires the current default screen into the page.
//
// There is only one screen so far (status), so this doesn't need a router
// yet (Task 5 introduces js/router.js when Discover is added). Runs on
// DOMContentLoaded so it works regardless of where the <script> tag sits
// in index.html.
(function (global) {
  'use strict';

  function start() {
    var container = document.getElementById('app');
    if (!container) {
      return;
    }
    global.render(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);
