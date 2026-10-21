// test/helpers/fake-dom.js — a tiny, hand-rolled DOM just big enough to
// run js/router.js's actual code under `node --test`, with no added
// dependency (this project ships with zero npm packages — no
// package.json at all — on purpose: a plain webOS webview, no bundler,
// no framework; pulling in jsdom just for this one test file would be
// the first dependency this whole project has ever had). It implements
// only what router.js itself touches: element creation, appendChild,
// className/textContent/disabled/hidden, innerHTML = '' (clear),
// querySelectorAll('button, [tabindex]'), click()/focus()/blur(),
// addEventListener/dispatchEvent on both elements and `document`, and a
// MutationObserver whose callback fires as a microtask after a mutation
// — matching real DOM timing closely enough for router.js's own
// MutationObserver-based focus recovery to be exercised for real.
//
// NOT a general-purpose DOM shim — anything router.js doesn't use
// (styles, events beyond click/keydown, real `hidden`/`disabled`
// attribute reflection quirks, etc.) is deliberately left out.
'use strict';

function createFakeDom() {
  var activeElement;
  var body;
  var documentListeners = {};
  var observers = [];
  var notifyScheduled = false;

  function scheduleNotify() {
    if (notifyScheduled) {
      return;
    }
    notifyScheduled = true;
    Promise.resolve().then(function () {
      notifyScheduled = false;
      // Snapshot first: a callback may itself trigger further mutations
      // (router.js's reconcileFocus() does, via .focus() changing
      // activeElement — that doesn't mutate the DOM, so it's harmless,
      // but copying the array is cheap insurance against surprises).
      observers.slice().forEach(function (observer) {
        observer.callback([]);
      });
    });
  }

  function detachIfActiveWithin(removedNodes) {
    function contains(node, target) {
      while (target) {
        if (target === node) {
          return true;
        }
        target = target.parentNode;
      }
      return false;
    }
    var stillAttached = activeElement && removedNodes.some(function (node) {
      return contains(node, activeElement);
    });
    if (stillAttached) {
      activeElement = body;
    }
  }

  function matchesPart(el, part) {
    if (part.charAt(0) === '.') {
      var cls = part.slice(1);
      // Checks both the `className` property AND a `class` attribute
      // set via setAttribute() — real SVG elements' `className` is a
      // read-only SVGAnimatedString, so js/screens/settings.js's QR-code
      // SVG sets its class via setAttribute('class', ...) instead, same
      // as it would have to against a real browser DOM.
      var classFromProperty = ' ' + (el._className || '') + ' ';
      var classFromAttr = ' ' + (el._attrs['class'] || '') + ' ';
      return classFromProperty.indexOf(' ' + cls + ' ') !== -1 || classFromAttr.indexOf(' ' + cls + ' ') !== -1;
    }
    if (part.charAt(0) === '[') {
      var attr = part.slice(1, -1);
      return Object.prototype.hasOwnProperty.call(el._attrs, attr);
    }
    return el.tagName === part.toUpperCase();
  }

  function matchesSelector(el, selector) {
    var parts = selector.split(',').map(function (s) { return s.trim(); });
    return parts.some(function (part) { return matchesPart(el, part); });
  }

  function FakeElement(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._attrs = {};
    this._disabled = false;
    this._hidden = false;
    this._className = '';
    this._textContent = '';
    this._listeners = {};
    this.type = undefined;
  }

  Object.defineProperties(FakeElement.prototype, {
    disabled: {
      get: function () { return this._disabled; },
      set: function (value) {
        this._disabled = !!value;
        if (this._disabled && activeElement === this) {
          activeElement = body;
        }
        scheduleNotify();
      }
    },
    hidden: {
      get: function () { return this._hidden; },
      set: function (value) {
        this._hidden = !!value;
        if (this._hidden && activeElement === this) {
          activeElement = body;
        }
        scheduleNotify();
      }
    },
    className: {
      get: function () { return this._className; },
      set: function (value) { this._className = value; }
    },
    textContent: {
      get: function () { return this._textContent; },
      set: function (value) { this._textContent = value; }
    },
    innerHTML: {
      get: function () { return ''; },
      set: function (value) {
        if (value !== '') {
          throw new Error('fake-dom: innerHTML only supports assigning "" (clear)');
        }
        var removed = this.children;
        this.children = [];
        removed.forEach(function (child) { child.parentNode = null; });
        detachIfActiveWithin(removed);
        scheduleNotify();
      }
    }
  });

  FakeElement.prototype.appendChild = function (child) {
    child.parentNode = this;
    this.children.push(child);
    scheduleNotify();
    return child;
  };

  FakeElement.prototype.setAttribute = function (name, value) {
    this._attrs[name] = String(value);
  };

  FakeElement.prototype.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
  };

  FakeElement.prototype.querySelectorAll = function (selector) {
    var results = [];
    function walk(el) {
      el.children.forEach(function (child) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        walk(child);
      });
    }
    walk(this);
    return results;
  };

  FakeElement.prototype.contains = function (other) {
    var node = other;
    while (node) {
      if (node === this) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  };

  FakeElement.prototype.addEventListener = function (type, fn) {
    this._listeners[type] = this._listeners[type] || [];
    this._listeners[type].push(fn);
  };

  FakeElement.prototype.click = function () {
    if (this._disabled) {
      return;
    }
    var listeners = this._listeners.click || [];
    var self = this;
    listeners.forEach(function (fn) {
      fn.call(self, { type: 'click', target: self });
    });
  };

  FakeElement.prototype.focus = function () {
    if (this._disabled || this._hidden) {
      return;
    }
    activeElement = this;
  };

  FakeElement.prototype.blur = function () {
    if (activeElement === this) {
      activeElement = body;
    }
  };

  body = new FakeElement('body');
  activeElement = body;

  var fakeDocument = {
    createElement: function (tagName) {
      return new FakeElement(tagName);
    },
    // createElementNS(ns, tagName) — added for test/settings.test.js's
    // QR-code SVG rendering (js/screens/settings.js uses it to build an
    // inline <svg>). This shim has no real namespace concept at all
    // (nothing here ever renders to a real DOM/screen), so it's just an
    // alias for createElement — router.js, the only other consumer of
    // this fake document, never calls it.
    createElementNS: function (ns, tagName) {
      return new FakeElement(tagName);
    },
    get activeElement() {
      return activeElement;
    },
    body: body,
    addEventListener: function (type, fn) {
      documentListeners[type] = documentListeners[type] || [];
      documentListeners[type].push(fn);
    },
    dispatchEvent: function (event) {
      var listeners = documentListeners[event.type] || [];
      listeners.forEach(function (fn) { fn(event); });
    }
  };

  function FakeMutationObserver(callback) {
    this.callback = callback;
  }
  FakeMutationObserver.prototype.observe = function () {
    observers.push(this);
  };
  FakeMutationObserver.prototype.disconnect = function () {
    var idx = observers.indexOf(this);
    if (idx !== -1) {
      observers.splice(idx, 1);
    }
  };

  // fireKey(key, keyCode) -> void
  //   Dispatches a minimal fake keydown "event" — just the fields
  //   router.js's handleKeydown() actually reads (key, keyCode,
  //   preventDefault), same as a real KeyboardEvent would supply them.
  function fireKey(key, keyCode) {
    fakeDocument.dispatchEvent({
      type: 'keydown',
      key: key,
      keyCode: keyCode,
      preventDefault: function () {}
    });
  }

  // flush() -> Promise<void>
  //   Waits out the MutationObserver's microtask-batched callback (see
  //   scheduleNotify above), the same way a real test against a real
  //   browser DOM would need to await a tick after a mutation.
  function flush() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  return {
    document: fakeDocument,
    MutationObserver: FakeMutationObserver,
    fireKey: fireKey,
    flush: flush
  };
}

module.exports = { createFakeDom: createFakeDom };
