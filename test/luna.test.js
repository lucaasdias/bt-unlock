const test = require('node:test');
const assert = require('node:assert');
const { parseReplies, toExecResult } = require('../js/luna.js');

test('parseReplies splits NDJSON stdout into objects', () => {
  const stdout = '{"returnValue":true,"a":1}\n{"returnValue":true,"a":2}\n';
  assert.deepStrictEqual(parseReplies(stdout), [{returnValue:true,a:1},{returnValue:true,a:2}]);
});

test('parseReplies surfaces a returnValue:false reply as the ok:false case', () => {
  const stdout = '{"returnValue":false,"errorText":"boom"}\n';
  const result = toExecResult(parseReplies(stdout));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.errorText, 'boom');
});

test('toExecResult returns ok:true with all replies when none fail', () => {
  const replies = [{returnValue:true,a:1},{returnValue:true,a:2}];
  const result = toExecResult(replies);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.replies, replies);
  assert.strictEqual(result.errorText, undefined);
});
