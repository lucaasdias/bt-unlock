// test/qrcode.test.js — structural sanity checks for js/qrcode.js's
// from-scratch QR Code encoder.
//
// This test file does NOT prove the output scans with a real camera —
// nothing in this project's test infra can do that — but it does lock in
// something much stronger than "didn't crash": while implementing
// js/qrcode.js, its output was diffed module-by-module against the
// `qrcode` Python package (a real, independent, widely-used reference
// encoder) for the exact same input/version/error-correction level/mask
// pattern, across every version 1-5 capacity boundary, and came back
// byte-for-byte IDENTICAL every time (see task-9-report.md for the full
// verification log). The snapshot below is that verified-correct matrix
// for this app's actual Help-URL input, hard-coded as a size + per-row
// bit-string fingerprint — a regression guard against this exact,
// independently-verified result silently drifting if the encoder is
// ever touched again, without needing to re-run that external
// verification process as part of this test suite (this project has no
// Python dependency, and never should).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { generateQRMatrix } = require('../js/qrcode.js');

var HELP_URL = 'https://github.com/lucaasdias/bt-unlock';

function matrixToRowStrings(matrix) {
  return matrix.map(function (row) {
    return row.join('');
  });
}

test('generateQRMatrix returns a square matrix sized for the app\'s actual Help URL', () => {
  const matrix = generateQRMatrix(HELP_URL);
  assert.ok(matrix, 'should not fall back to null for a URL this short');
  assert.strictEqual(matrix.length, 29, 'version 3 (29x29) for a 40-character byte-mode payload at EC level L');
  matrix.forEach(function (row) {
    assert.strictEqual(row.length, 29, 'every row must be exactly as wide as the matrix is tall');
  });
});

test('the finder pattern (nested square) is present in all three corners', () => {
  const matrix = generateQRMatrix(HELP_URL);
  // The outermost ring of each 7x7 finder pattern is solid dark; a
  // cheap, position-agnostic sanity check that doesn't depend on the
  // exact snapshot below: the whole top row of each finder square (top
  // row of the matrix at both the left and right corners, and the top
  // row of the bottom-left finder) must be all dark.
  var size = matrix.length;
  var topLeftRow = matrix[0].slice(0, 7);
  var topRightRow = matrix[0].slice(size - 7, size);
  var bottomLeftTopRow = matrix[size - 7].slice(0, 7);
  [topLeftRow, topRightRow, bottomLeftTopRow].forEach(function (row) {
    assert.ok(row.every(function (v) { return v === 1; }), 'finder pattern top border should be solid dark: ' + row.join(''));
  });
});

test('byte-exact snapshot against an independently-verified reference matrix', () => {
  // This is the literal matrix verified bit-for-bit against the
  // `qrcode` Python package (version 3, EC level L, mask pattern 0) —
  // see the file header. Any difference here means the encoder's output
  // for this app's actual Help URL has changed since that verification.
  const matrix = generateQRMatrix(HELP_URL);
  const rows = matrixToRowStrings(matrix);
  const expected = [
    '11111110001001110011001111111',
    '10000010010000110101101000001',
    '10111010100100000001101011101',
    '10111010010010100011001011101',
    '10111010010010110011001011101',
    '10000010001110010101101000001',
    '11111110101010101010101111111',
    '00000000100101101111100000000',
    '11101111100011011100011000100',
    '11000001010110001110101001001',
    '01000110101111100110111010111',
    '00010101011011111111100110010',
    '01000110001100100101111001011',
    '01101001001100001100111001001',
    '00111111010001000000001011011',
    '10010001001100011100111001010',
    '11001011011010011101101101011',
    '01110100001111000000011001101',
    '10110011110110101010010110011',
    '01000101001011111111111111010',
    '10001011011100100101111110000',
    '00000000110100101101100010111',
    '11111110110001001011101011011',
    '10000010100100000110100011001',
    '10111010111010001100111110011',
    '10111010011111001110100110111',
    '10111010100110100111000111001',
    '10000010110011101111110010010',
    '11111110101100111111110110011'
  ];
  assert.strictEqual(rows.length, expected.length);
  rows.forEach(function (row, i) {
    assert.strictEqual(row, expected[i], 'row ' + i + ' differs from the verified snapshot');
  });
});

test('falls back to null past this encoder\'s supported capacity (versions 1-5 only)', () => {
  const tooLong = new Array(200).fill('x').join('');
  const matrix = generateQRMatrix(tooLong);
  assert.strictEqual(matrix, null, 'callers must fall back to showing the plain text instead');
});

test('a short string still produces a valid (smallest-version) matrix', () => {
  const matrix = generateQRMatrix('hi');
  assert.ok(matrix);
  assert.strictEqual(matrix.length, 21, 'version 1 for a very short payload');
});
