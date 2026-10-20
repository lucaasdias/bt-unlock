// i18n.js — locale loading and string lookup.
//
// Every screen calls `t(key, vars?)` instead of hardcoding a literal UI
// string. `setLocale(code)` picks which of this app's three shipped
// locale files (locales/en.json, locales/pt-BR.json, locales/es.json)
// is active; `t()` looks the key up there, falling back to English if
// the key is missing from the active locale, then to the key itself if
// it is missing from English too (so a typo'd/never-added key shows up
// as a readable string during manual testing instead of throwing or
// going blank).
//
// Loaded as a plain <script> tag in the browser (attaches `t` and
// `setLocale` to `window`) and exported via CommonJS under Node (for
// `node --test`). Locale JSON is loaded two different ways depending on
// environment, since there is no bundler to inline it for either one:
// under Node, `require()` reads the .json file straight off disk; in the
// browser, a synchronous XHR reads it from the app's own packaged
// `locales/` directory (same origin, no network — this is a local webOS
// app, not a hosted page, so a blocking request here is a few ms against
// the filesystem, not a network round trip).
(function (global) {
  'use strict';

  var FALLBACK_LOCALE = 'en';
  var SHIPPED_LOCALES = ['en', 'pt-BR', 'es'];

  var cache = {};
  var activeLocale = FALLBACK_LOCALE;

  function isNodeEnv() {
    return typeof module !== 'undefined' && !!module.exports;
  }

  function loadLocaleNode(code) {
    try {
      // eslint-disable-next-line global-require
      return require('../locales/' + code + '.json');
    } catch (e) {
      return null;
    }
  }

  function loadLocaleBrowser(code) {
    try {
      var xhr = new XMLHttpRequest(); // eslint-disable-line no-undef
      // Synchronous on purpose: locale data must be available before the
      // very first render, and this is a local file read (packaged with
      // the app), not a network request.
      xhr.open('GET', 'locales/' + code + '.json', false);
      xhr.send(null);
      // file:// responses report status 0, not 200.
      if (xhr.status === 200 || xhr.status === 0) {
        return JSON.parse(xhr.responseText);
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function ensureLoaded(code) {
    if (cache[code]) {
      return cache[code];
    }
    var data = isNodeEnv() ? loadLocaleNode(code) : loadLocaleBrowser(code);
    if (data) {
      cache[code] = data;
    }
    return data;
  }

  // normalizeLocale(code) -> 'en' | 'pt-BR' | 'es'
  //   webOS/browsers report locale as e.g. "pt-BR", "pt_BR", "es-ES",
  //   "en-US" — this app only ships the three locales above, so anything
  //   else (missing, malformed, or a language this app hasn't been
  //   translated into) normalizes to English.
  function normalizeLocale(code) {
    if (!code) {
      return FALLBACK_LOCALE;
    }
    var normalized = String(code).replace('_', '-');
    var language = normalized.split('-')[0].toLowerCase();
    if (language === 'pt') {
      return 'pt-BR';
    }
    if (language === 'es') {
      return 'es';
    }
    return FALLBACK_LOCALE;
  }

  // setLocale(code: string) -> string
  //   Normalizes `code` to one of this app's shipped locales, loads it
  //   (and English, always needed as the fallback), and makes it active.
  //   Returns the normalized locale actually applied.
  function setLocale(code) {
    activeLocale = normalizeLocale(code);
    ensureLoaded(activeLocale);
    ensureLoaded(FALLBACK_LOCALE);
    return activeLocale;
  }

  function interpolate(str, vars) {
    if (!vars) {
      return str;
    }
    return str.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match;
    });
  }

  // t(key: string, vars?: object) -> string
  function t(key, vars) {
    var activeData = cache[activeLocale] || {};
    var fallbackData = cache[FALLBACK_LOCALE] || {};
    var value;
    if (Object.prototype.hasOwnProperty.call(activeData, key)) {
      value = activeData[key];
    } else if (Object.prototype.hasOwnProperty.call(fallbackData, key)) {
      value = fallbackData[key];
    } else {
      value = key;
    }
    return interpolate(value, vars);
  }

  // Eagerly load English so t() works even before any setLocale() call
  // (e.g. a test or screen that runs before app.js's startup detection).
  ensureLoaded(FALLBACK_LOCALE);

  var api = {
    t: t,
    setLocale: setLocale,
    normalizeLocale: normalizeLocale,
    SHIPPED_LOCALES: SHIPPED_LOCALES
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.t = t;
    global.setLocale = setLocale;
  }
})(typeof window !== 'undefined' ? window : this);
