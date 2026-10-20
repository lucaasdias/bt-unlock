// app.js — entry point. Wires the router and its screens into the page.
//
// Runs on DOMContentLoaded so it works regardless of where the <script>
// tag sits in index.html.
(function (global) {
  'use strict';

  function start() {
    var container = document.getElementById('app');
    if (!container) {
      return;
    }
    var router = global.createRouter({
      status: { label: 'Status', render: global.render },
      discover: { label: 'Discover', render: global.renderDiscover }
    });
    router.mount(container, 'status');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);
