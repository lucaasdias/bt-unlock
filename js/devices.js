// devices.js — decides, from a Bluetooth class-of-device (CoD) integer, what
// kind of device a scanned/paired entry is, which Luna profile to connect it
// with ('hid' or 'a2dp'), and which list icon to show. Pure logic, no Luna
// calls. Loaded as a plain <script> tag in the browser (attaches `classify`
// to `window`) and exported via CommonJS under Node (for `node --test`).
(function (global) {
  'use strict';

  // CoD layout (Bluetooth Assigned Numbers, Baseband spec Part B, sec. 1.2):
  //   bits  2-7   Minor Device Class
  //   bits  8-12  Major Device Class
  //   bits 13-23  Major Service Class (ignored here)
  var MAJOR_AUDIO_VIDEO = 0x04;
  var MAJOR_PERIPHERAL = 0x05;

  // Within the Peripheral major class, the top two bits of the minor class
  // (minor bits 4-5) say whether it is a keyboard, a pointing device, or a
  // combo of both. When both are 0, the low nibble names the device type.
  var PERIPHERAL_KEYBOARD = 0x1;
  var PERIPHERAL_POINTING = 0x2;
  var PERIPHERAL_COMBO = 0x3;
  var PERIPHERAL_TYPE_JOYSTICK = 0x1;
  var PERIPHERAL_TYPE_GAMEPAD = 0x2;

  var UNSUPPORTED = { kind: 'unsupported', profile: null, iconId: 'unknown' };

  // classify(classOfDevice: number) -> {kind, profile, iconId}
  //   kind: 'gamepad' | 'keyboard' | 'mouse' | 'audio' | 'unsupported'
  //   profile: 'hid' | 'a2dp' | null
  function classify(classOfDevice) {
    var major = (classOfDevice >> 8) & 0x1f;
    var minor = (classOfDevice >> 2) & 0x3f;

    if (major === MAJOR_AUDIO_VIDEO) {
      return { kind: 'audio', profile: 'a2dp', iconId: 'audio' };
    }

    if (major === MAJOR_PERIPHERAL) {
      var flags = (minor >> 4) & 0x3;
      if (flags === PERIPHERAL_KEYBOARD) {
        return { kind: 'keyboard', profile: 'hid', iconId: 'keyboard' };
      }
      if (flags === PERIPHERAL_POINTING) {
        return { kind: 'mouse', profile: 'hid', iconId: 'mouse' };
      }
      if (flags === PERIPHERAL_COMBO) {
        // A keyboard+pointing combo is far more often a keyboard with a
        // touchpad than the reverse, so it is shown and connected as a keyboard.
        return { kind: 'keyboard', profile: 'hid', iconId: 'keyboard' };
      }
      var type = minor & 0xf;
      if (type === PERIPHERAL_TYPE_JOYSTICK || type === PERIPHERAL_TYPE_GAMEPAD) {
        return { kind: 'gamepad', profile: 'hid', iconId: 'gamepad' };
      }
    }

    return UNSUPPORTED;
  }

  var api = {
    classify: classify
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.classify = classify;
  }
})(typeof window !== 'undefined' ? window : this);
