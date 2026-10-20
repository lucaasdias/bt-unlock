// luna.js — the one and only channel every screen uses to reach a root
// script. No framework, no bundler: loaded as a plain <script> tag, so it
// attaches its functions to `window` in the browser and exports them via
// CommonJS under Node (for `node --test`).
(function (global) {
  'use strict';

  var APP_ID = 'org.lucaasdias.btunlock';
  var EXEC_SERVICE_URI = 'luna://org.webosbrew.hbchannel.service/exec';
  var SCRIPTS_DIR = '/media/developer/apps/usr/palm/applications/' + APP_ID + '/scripts';

  // parseReplies(stdout: string) -> object[]
  //   Splits NDJSON stdout (one JSON object per line, as produced by
  //   scripts/bt-common.sh's run_luna) into parsed objects. Empty lines
  //   (including the trailing newline) are dropped.
  function parseReplies(stdout) {
    return String(stdout)
      .split('\n')
      .filter(function (line) {
        return line.trim().length > 0;
      })
      .map(function (line) {
        return JSON.parse(line);
      });
  }

  // toExecResult(replies: object[]) -> {ok, replies, errorText?}
  //   ok:false (with the last failing reply's errorText) if any reply has
  //   returnValue:false; otherwise ok:true.
  function toExecResult(replies) {
    var failures = replies.filter(function (reply) {
      return reply.returnValue === false;
    });
    if (failures.length > 0) {
      return {
        ok: false,
        replies: replies,
        errorText: failures[failures.length - 1].errorText
      };
    }
    return { ok: true, replies: replies };
  }

  // shellEscape(arg) -> string
  //   Wraps arg in single quotes, escaping any embedded single quotes, so
  //   it is safe to splice into the shell command string sent to `exec`.
  function shellEscape(arg) {
    return "'" + String(arg).replace(/'/g, "'\\''") + "'";
  }

  // callLunaService(uri, params) -> Promise<object>
  //   Calls a Luna service via the native PalmServiceBridge, which webOS
  //   injects into every app's page — no bundled service-bridge library
  //   needed, and it works back to very old webOS versions.
  function callLunaService(uri, params) {
    return new Promise(function (resolve) {
      var bridge = new PalmServiceBridge(); // eslint-disable-line no-undef
      bridge.onservicecallback = function (msgString) {
        var response;
        try {
          response = JSON.parse(msgString);
        } catch (e) {
          response = { returnValue: false, errorText: 'Invalid JSON from service: ' + e.message };
        }
        bridge.cancel();
        resolve(response);
      };
      bridge.call(uri, JSON.stringify(params));
    });
  }

  // exec(scriptName, args) -> Promise<{ok, replies, errorText?}>
  //   Runs a root script under scripts/ via Homebrew Channel's already
  //   elevated exec service, then parses its NDJSON stdout. If the exec
  //   call itself fails (Homebrew Channel not elevated, etc.), resolves
  //   to {ok:false, errorText} without attempting to parse stdoutString.
  function exec(scriptName, args) {
    args = args || [];
    var scriptPath = SCRIPTS_DIR + '/' + scriptName;
    var escapedArgs = args.map(shellEscape).join(' ');
    var command = escapedArgs ? 'sh ' + scriptPath + ' ' + escapedArgs : 'sh ' + scriptPath;

    return callLunaService(EXEC_SERVICE_URI, { command: command }).then(function (reply) {
      if (reply.returnValue === false) {
        return { ok: false, errorText: reply.errorText };
      }
      return toExecResult(parseReplies(reply.stdoutString || ''));
    });
  }

  var api = {
    parseReplies: parseReplies,
    toExecResult: toExecResult,
    exec: exec
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.parseReplies = parseReplies;
    global.toExecResult = toExecResult;
    global.exec = exec;
  }
})(typeof window !== 'undefined' ? window : this);
