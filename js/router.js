// router.js — tiny screen switcher.
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
// Loaded as a plain <script> tag in the browser (attaches `createRouter`
// to `window`) and exported via CommonJS under Node (for tests).
(function (global) {
  'use strict';

  // createRouter(screens: {[name]: {label?: string, render(container, navigate) -> (void|Function)}})
  //   -> {mount(root, initialName), navigate(root, name)}
  function createRouter(screens) {
    var activeContainer = null;
    var navButtons = {};
    var currentCleanup = null;

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

      activeContainer.innerHTML = '';
      currentCleanup = screens[name].render(activeContainer, function (nextName) {
        navigate(root, nextName);
      });
    }

    function mount(root, initialName) {
      root.innerHTML = '';

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
