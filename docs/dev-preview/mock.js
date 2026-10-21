// mock.js — DEV-ONLY. Never shipped (docs/ is excluded from package.sh's
// IPK staging). Stands in for webOS's native PalmServiceBridge/PalmSystem
// so the real, unmodified app files (loaded by ./index.html) can run in a
// plain desktop browser for taking README screenshots.
//
// It intercepts calls to luna://org.webosbrew.hbchannel.service/exec (the
// only Luna service js/luna.js's exec() ever calls) by pattern-matching
// the shell command string the bridge receives — "sh <scripts-dir>/<name>
// [args...]" (see js/luna.js's exec()) — against this project's own
// scripts/*.sh, and returns realistic canned NDJSON (one JSON object per
// line in `stdoutString`, exactly what js/luna.js's parseReplies() expects)
// instead of making a real call.
(function (global) {
  'use strict';

  // ---- Demo data -------------------------------------------------------
  // classOfDevice values are real Bluetooth CoD integers that js/devices.js's
  // classify() maps to a supported kind/profile (cross-checked against
  // test/devices.test.js's own fixtures), so the real icons/labels render
  // correctly.
  var DISCOVERED_DEVICES = [
    { name: 'Controle Xbox Wireless', address: 'A4:C1:38:2E:9F:01', classOfDevice: 9480, paired: false, connectedProfiles: [] },
    { name: 'Teclado Logitech K400', address: 'E8:4E:06:71:3A:12', classOfDevice: 0x2540, paired: false, connectedProfiles: [] }
  ];

  var PAIRED_DEVICES = [
    { name: 'Controle DualShock 4', address: '2C:56:DC:88:14:7F', classOfDevice: 9480, paired: true, connectedProfiles: ['hid'] },
    { name: 'Headset JBL Tune 500BT', address: '90:89:5F:37:13:DA', classOfDevice: 0x200404, paired: true, connectedProfiles: [] },
    { name: 'Mouse Logitech M170', address: 'D0:7E:28:4B:9C:66', classOfDevice: 0x2580, paired: true, connectedProfiles: ['hid'] }
  ];

  // bt-paired.sh's own snapshot includes every known device (device/getStatus
  // lists paired and unpaired alike); the screen itself filters to paired:true.
  var ALL_DEVICES = DISCOVERED_DEVICES.concat(PAIRED_DEVICES);

  var LOG_LINES = [
    '2026-10-19T21:04:02Z bt-power.sh on: powering adapter on',
    '2026-10-19T21:04:03Z bt-startup.sh bootstrap: first run — enabling start-on-boot by default',
    '2026-10-19T21:05:11Z bt-discover.sh start: starting discovery and snapshotting device list',
    '2026-10-19T21:05:18Z bt-pair.sh: pairing with 2c:56:dc:88:14:7f',
    '2026-10-19T21:05:21Z bt-connect.sh: connecting 2c:56:dc:88:14:7f over hid',
    '2026-10-19T21:12:47Z bt-discover.sh start: starting discovery and snapshotting device list',
    '2026-10-19T21:13:02Z bt-pair.sh: pairing with 90:89:5f:37:13:da',
    '2026-10-19T21:13:05Z bt-connect.sh: connecting 90:89:5f:37:13:da over a2dp',
    '2026-10-20T08:41:10Z bt-paired.sh: snapshotting device list',
    '2026-10-20T08:41:52Z bt-startup.sh bootstrap: already bootstrapped, reporting current state'
  ].join('\n');

  // ---- Command parsing ---------------------------------------------------
  // js/luna.js's exec() sends: "sh " + scriptsDir + "/" + scriptName + " " +
  // shell-escaped args joined with spaces (each arg wrapped in single
  // quotes). None of this app's own arguments ever contain an embedded
  // single quote, so a simple '...'-segment scan is enough to recover them.
  function parseCommand(command) {
    var rest = String(command).replace(/^sh\s+/, '');
    var firstSpace = rest.indexOf(' ');
    var scriptPath = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
    var argsStr = firstSpace === -1 ? '' : rest.slice(firstSpace + 1);
    var scriptName = scriptPath.split('/').pop();
    var args = [];
    var re = /'([^']*)'/g;
    var match;
    while ((match = re.exec(argsStr)) !== null) {
      args.push(match[1]);
    }
    return { scriptName: scriptName, args: args };
  }

  // ---- Per-script canned replies -----------------------------------------
  // Each handler returns an array of reply objects; they are joined as
  // NDJSON (one per line) into stdoutString, mirroring scripts/bt-common.sh's
  // run_luna, which this project's real scripts call once per Luna request.
  var HANDLERS = {
    'bt-power.sh': function (args) {
      var sub = args[0];
      if (sub === 'status') {
        return [{ returnValue: true, subscribed: false, adapters: [{ powered: true, name: 'LG webOS TV' }] }];
      }
      return [{ returnValue: true }];
    },
    'bt-startup.sh': function () {
      return [{ returnValue: true, enabled: true }];
    },
    'bt-log.sh': function (args) {
      if (args[0] === 'tail') {
        return [{ returnValue: true, lines: LOG_LINES }];
      }
      return [{ returnValue: true, lines: '' }];
    },
    'bt-discover.sh': function (args) {
      var sub = args[0];
      if (sub === 'start') {
        // Mirrors the real script: one ack for adapter/startDiscovery, one
        // device/getStatus snapshot. Shown as just the newly-discovered,
        // not-yet-paired devices for a clean Discover screenshot (the
        // already-paired ones are what Paired.sh/paired.js show instead).
        return [
          { returnValue: true },
          { returnValue: true, devices: DISCOVERED_DEVICES }
        ];
      }
      return [{ returnValue: true }];
    },
    'bt-paired.sh': function () {
      return [{ returnValue: true, devices: ALL_DEVICES }];
    },
    'bt-pair.sh': function () {
      return [{ returnValue: true, subscribed: true }, { returnValue: true }];
    },
    'bt-connect.sh': function () {
      return [{ returnValue: true }];
    },
    'bt-disconnect.sh': function () {
      return [{ returnValue: true }];
    },
    'bt-forget.sh': function () {
      return [{ returnValue: true }];
    }
  };

  function buildStdout(scriptName, args) {
    var handler = HANDLERS[scriptName];
    var replies = handler ? handler(args) : [{ returnValue: false, errorText: 'mock: unknown script ' + scriptName }];
    return replies.map(function (reply) {
      return JSON.stringify(reply);
    }).join('\n') + '\n';
  }

  var EXEC_SERVICE_URI = 'luna://org.webosbrew.hbchannel.service/exec';

  // ---- PalmServiceBridge mock ---------------------------------------------
  // Mirrors the real bridge's async-callback shape (bridge.call(...) then
  // bridge.onservicecallback(jsonString) some time later) closely enough for
  // js/luna.js's callLunaService() to work completely unmodified.
  function PalmServiceBridge() {
    this.onservicecallback = null;
    this._cancelled = false;
  }

  PalmServiceBridge.prototype.call = function (uri, paramsJson) {
    var self = this;
    var params;
    try {
      params = JSON.parse(paramsJson);
    } catch (e) {
      params = {};
    }

    if (uri !== EXEC_SERVICE_URI) {
      global.setTimeout(function () {
        if (self._cancelled) {
          return;
        }
        self._deliver({ returnValue: false, errorText: 'mock: unsupported service ' + uri });
      }, 10);
      return;
    }

    var parsed = parseCommand(params.command || '');
    global.setTimeout(function () {
      if (self._cancelled) {
        return;
      }
      self._deliver({
        returnValue: true,
        stdoutString: buildStdout(parsed.scriptName, parsed.args)
      });
    }, 120); // small delay so loading/busy states are visible, same as a real Luna round trip
  };

  PalmServiceBridge.prototype._deliver = function (response) {
    if (typeof this.onservicecallback === 'function') {
      this.onservicecallback(JSON.stringify(response));
    }
  };

  PalmServiceBridge.prototype.cancel = function () {
    this._cancelled = true;
  };

  global.PalmServiceBridge = PalmServiceBridge;
  global.PalmSystem = { locale: 'pt-BR' };
})(typeof window !== 'undefined' ? window : this);
