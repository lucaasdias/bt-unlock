const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../js/devices.js');

test('classifies the DualShock 4 class-of-device captured live on the TV as a gamepad over HID', () => {
  assert.deepStrictEqual(classify(9480), { kind: 'gamepad', profile: 'hid', iconId: 'gamepad' });
});

test('classifies a computer-major-class value (0x000100) as unsupported with no profile', () => {
  const result = classify(0x000100); // Major Device Class 1 (Computer), not a peripheral or audio class
  assert.strictEqual(result.profile, null);
  assert.strictEqual(result.kind, 'unsupported');
});

test('classifies a value with no Major Device Class bits set (service bits only) as unsupported', () => {
  const result = classify(0x200000); // Audio service class bit only, Major Device Class 0 (Miscellaneous)
  assert.strictEqual(result.profile, null);
  assert.strictEqual(result.kind, 'unsupported');
});

test('classifies a keyboard peripheral (0x2540) as keyboard over HID', () => {
  assert.deepStrictEqual(classify(0x2540), { kind: 'keyboard', profile: 'hid', iconId: 'keyboard' });
});

test('classifies a pointing-device peripheral (0x2580) as mouse over HID', () => {
  assert.deepStrictEqual(classify(0x2580), { kind: 'mouse', profile: 'hid', iconId: 'mouse' });
});

test('classifies an audio/video headset (0x200404) as audio over A2DP', () => {
  assert.deepStrictEqual(classify(0x200404), { kind: 'audio', profile: 'a2dp', iconId: 'audio' });
});
