// qrcode.js — a small, from-scratch QR Code (Model 2) encoder.
//
// This project has zero npm dependencies by design (no package.json,
// no bundler). Rather than vendoring a third-party QR library to satisfy
// Task 9's "Get Help" QR code request, this is a minimal hand-written
// implementation of the public QR Code specification, scoped down to
// exactly what this app needs: byte-mode encoding of a short ASCII URL,
// error-correction level L, versions 1-5 only (all single-Reed-Solomon-
// block at level L, which avoids implementing codeword interleaving
// across multiple blocks — a real source of bugs this app's one short
// Help-URL use case doesn't need to risk). A fixed mask pattern (0) is
// used rather than evaluating all 8 and scoring them for "best" — the
// QR spec permits any of the 8 masks; a reader determines which one was
// used from the format-info bits and undoes it, so an arbitrarily chosen
// valid mask is exactly as scannable as the "optimal" one, and skipping
// the masking-penalty-scoring step removes another large, error-prone
// chunk of the algorithm this app's single fixed use case doesn't need.
//
// IMPORTANT CAVEAT (see task-9-report.md): this was written from the
// public QR Model 2 spec and reference-implementation structure, not
// copied from an existing library, and could not be verified against a
// physical QR scanner from this environment. js/screens/settings.js
// always shows the plain-text URL next to the generated QR code as a
// fallback, specifically because of this. If the QR code does not scan
// correctly on a real device, the plain URL text is the reliable path.
//
// Loaded as a plain <script> tag in the browser (attaches
// `generateQRMatrix` to `window`) and exported via CommonJS under Node
// (for `node --test`) — same dual-export convention as every other file
// in this project.
(function (global) {
  'use strict';

  // ---- GF(256) arithmetic (primitive polynomial x^8+x^4+x^3+x^2+1 = 0x11D,
  // generator 2) — the field Reed-Solomon error correction is computed over. ----
  var GF_EXP = new Array(512);
  var GF_LOG = new Array(256);
  (function buildGfTables() {
    var x = 1;
    for (var i = 0; i < 255; i += 1) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) {
        x ^= 0x11D;
      }
    }
    for (var j = 255; j < 512; j += 1) {
      GF_EXP[j] = GF_EXP[j - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) {
      return 0;
    }
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  // polyMultiply(a, b) -> number[]
  //   Both polynomials are arrays of GF(256) coefficients, highest-degree
  //   term first (index 0).
  function polyMultiply(a, b) {
    var result = new Array(a.length + b.length - 1).fill(0);
    for (var i = 0; i < a.length; i += 1) {
      for (var j = 0; j < b.length; j += 1) {
        result[i + j] ^= gfMul(a[i], b[j]);
      }
    }
    return result;
  }

  // rsGeneratorPoly(ecCount) -> number[]
  //   The Reed-Solomon generator polynomial of degree `ecCount`:
  //   product_{i=0}^{ecCount-1} (x - 2^i), with subtraction == addition
  //   == XOR in this field.
  function rsGeneratorPoly(ecCount) {
    var g = [1];
    for (var i = 0; i < ecCount; i += 1) {
      g = polyMultiply(g, [1, GF_EXP[i]]);
    }
    return g;
  }

  // rsEncode(dataCodewords, ecCount) -> number[] (length ecCount)
  //   Polynomial long division of dataCodewords*x^ecCount by the
  //   generator polynomial; the remainder is the error-correction
  //   codewords.
  function rsEncode(dataCodewords, ecCount) {
    var generator = rsGeneratorPoly(ecCount);
    var result = dataCodewords.concat(new Array(ecCount).fill(0));
    for (var i = 0; i < dataCodewords.length; i += 1) {
      var coef = result[i];
      if (coef !== 0) {
        for (var j = 0; j < generator.length; j += 1) {
          result[i + j] ^= gfMul(generator[j], coef);
        }
      }
    }
    return result.slice(dataCodewords.length);
  }

  // ---- Bit buffer ----
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.putBits = function (value, length) {
    for (var i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  };
  BitBuffer.prototype.toBytes = function () {
    var bytes = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j += 1) {
        b = (b << 1) | (this.bits[i + j] || 0);
      }
      bytes.push(b);
    }
    return bytes;
  };

  // ---- Version table: versions 1-5, error-correction level L, all a
  // single Reed-Solomon block (see file header for why that's a
  // deliberate scope limit). align lists the alignment-pattern center
  // coordinates (both as row and column candidates, all pairs except
  // the one that overlaps the top-left finder pattern). ----
  var VERSIONS = [
    { version: 1, size: 21, dataBytes: 19, ecBytes: 7, align: [] },
    { version: 2, size: 25, dataBytes: 34, ecBytes: 10, align: [6, 18] },
    { version: 3, size: 29, dataBytes: 55, ecBytes: 15, align: [6, 22] },
    { version: 4, size: 33, dataBytes: 80, ecBytes: 20, align: [6, 26] },
    { version: 5, size: 37, dataBytes: 108, ecBytes: 26, align: [6, 30] }
  ];

  // pickVersion(byteLength) -> version entry | null
  //   Smallest version (1-5) whose data capacity fits a byte-mode
  //   payload of this length (mode indicator + 8-bit count + data,
  //   ignoring the optional 4-bit terminator, which is only added if it
  //   fits — so this is a safe, slightly-conservative capacity check).
  function pickVersion(byteLength) {
    var requiredBits = 4 + 8 + byteLength * 8;
    for (var i = 0; i < VERSIONS.length; i += 1) {
      if (VERSIONS[i].dataBytes * 8 >= requiredBits) {
        return VERSIONS[i];
      }
    }
    return null;
  }

  function buildDataCodewords(bytes, versionInfo) {
    var buf = new BitBuffer();
    buf.putBits(0x4, 4); // byte-mode indicator
    buf.putBits(bytes.length, 8); // count indicator (8 bits for versions 1-9)
    for (var i = 0; i < bytes.length; i += 1) {
      buf.putBits(bytes[i], 8);
    }
    var capacityBits = versionInfo.dataBytes * 8;
    if (buf.bits.length + 4 <= capacityBits) {
      buf.putBits(0, 4); // terminator, only if it fits
    }
    while (buf.bits.length % 8 !== 0) {
      buf.bits.push(0);
    }
    var padBytes = [0xEC, 0x11];
    var k = 0;
    while (buf.bits.length < capacityBits) {
      buf.putBits(padBytes[k % 2], 8);
      k += 1;
    }
    return buf.toBytes();
  }

  // ---- Module matrix construction ----
  function createMatrix(size) {
    var m = [];
    for (var r = 0; r < size; r += 1) {
      m.push(new Array(size).fill(null));
    }
    return m;
  }

  function createReserved(size) {
    var r = [];
    for (var i = 0; i < size; i += 1) {
      r.push(new Array(size).fill(false));
    }
    return r;
  }

  function markReservedBlock(reserved, r0, c0, r1, c1) {
    for (var r = r0; r <= r1; r += 1) {
      for (var c = c0; c <= c1; c += 1) {
        if (r >= 0 && c >= 0 && r < reserved.length && c < reserved.length) {
          reserved[r][c] = true;
        }
      }
    }
  }

  function placeFinderPattern(m, reserved, row, col) {
    var size = m.length;
    for (var r = -1; r <= 7; r += 1) {
      for (var c = -1; c <= 7; c += 1) {
        var rr = row + r;
        var cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) {
          continue;
        }
        var dark = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        m[rr][cc] = dark ? 1 : 0;
        reserved[rr][cc] = true;
      }
    }
  }

  function placeTimingPatterns(m, reserved) {
    var size = m.length;
    for (var i = 8; i < size - 8; i += 1) {
      var dark = i % 2 === 0 ? 1 : 0;
      if (m[6][i] === null) {
        m[6][i] = dark;
        reserved[6][i] = true;
      }
      if (m[i][6] === null) {
        m[i][6] = dark;
        reserved[i][6] = true;
      }
    }
  }

  function placeAlignmentPattern(m, reserved, row, col) {
    for (var r = -2; r <= 2; r += 1) {
      for (var c = -2; c <= 2; c += 1) {
        var dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        m[row + r][col + c] = dark ? 1 : 0;
        reserved[row + r][col + c] = true;
      }
    }
  }

  function placeAlignmentPatterns(m, reserved, alignCoords) {
    if (alignCoords.length === 0) {
      return;
    }
    // For versions 2-6 (this encoder's whole range beyond version 1),
    // VERSIONS' align list is always [6, X]: 6 is the coordinate value
    // adjacent to/overlapping a finder pattern on that axis, X is the
    // one real alignment-pattern position away from all three finders.
    // A combination with EITHER coordinate equal to 6 overlaps a finder
    // pattern's own bounding box — not just the (6,6) pair, which was
    // this encoder's original (wrong) assumption, caught by diffing
    // this encoder's output against a reference implementation's matrix
    // for the same input/version/mask (see task-9-report.md): only the
    // single (X, X) combination is a real, valid alignment-pattern
    // position for these versions, which also matches the well-known
    // fact that QR versions 2-6 each have exactly one alignment
    // pattern, not up to four.
    for (var i = 0; i < alignCoords.length; i += 1) {
      for (var j = 0; j < alignCoords.length; j += 1) {
        var row = alignCoords[i];
        var col = alignCoords[j];
        if (row === 6 || col === 6) {
          continue;
        }
        placeAlignmentPattern(m, reserved, row, col);
      }
    }
  }

  // getFormatBits(maskPattern) -> number (15-bit value)
  //   BCH(15,5) encoding of the 5-bit (EC level || mask pattern) value,
  //   generator polynomial 0x537, XORed with the fixed mask 0x5412 —
  //   the standard QR "format information" construction. EC level L is
  //   indicator value 1 (the 2-bit values are L=01, M=00, Q=11, H=10).
  function getFormatBits(maskPattern) {
    var ecIndicator = 1; // level L
    var data = (ecIndicator << 3) | maskPattern;
    var rem = data << 10;
    var g = 0x537;
    for (var i = 14; i >= 10; i -= 1) {
      if ((rem >> i) & 1) {
        rem ^= g << (i - 10);
      }
    }
    var bits = (data << 10) | rem;
    return bits ^ 0x5412;
  }

  function placeFormatInfo(m, reserved, maskPattern) {
    var size = m.length;
    var bits = getFormatBits(maskPattern);
    // bit(i) reads MSB-first against the coordinate lists below: array
    // index 0 in each list gets bit 14 (the most significant bit), not
    // bit 0. Caught the same way as the alignment-pattern bug above —
    // diffing this encoder's output against a reference implementation
    // for the same input showed getFormatBits() itself was already
    // correct (its 15-bit value matched the reference exactly), but
    // this placement loop was reading it LSB-first instead of
    // MSB-first.
    function bit(i) {
      return (bits >> (14 - i)) & 1;
    }
    // First copy, around the top-left finder pattern.
    var firstCopyCoords = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    for (var i = 0; i < firstCopyCoords.length; i += 1) {
      var r1 = firstCopyCoords[i][0];
      var c1 = firstCopyCoords[i][1];
      m[r1][c1] = bit(i);
      reserved[r1][c1] = true;
    }
    // Second copy, split across the top-right and bottom-left finder
    // patterns' border.
    var secondCopyCoords = [
      [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
      [size - 5, 8], [size - 6, 8], [size - 7, 8],
      [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
      [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]
    ];
    for (var j = 0; j < secondCopyCoords.length; j += 1) {
      var r2 = secondCopyCoords[j][0];
      var c2 = secondCopyCoords[j][1];
      m[r2][c2] = bit(j);
      reserved[r2][c2] = true;
    }
  }

  function placeDarkModule(m, reserved, versionNumber) {
    var row = 4 * versionNumber + 9;
    m[row][8] = 1;
    reserved[row][8] = true;
  }

  // maskBit(r, c) -> 0 | 1
  //   Mask pattern 0 — see the file header for why a fixed mask is used
  //   instead of evaluating/scoring all 8.
  function maskBit(r, c) {
    return (r + c) % 2 === 0 ? 1 : 0;
  }

  function placeData(m, reserved, dataBytes) {
    var size = m.length;
    var bits = [];
    for (var i = 0; i < dataBytes.length; i += 1) {
      for (var b = 7; b >= 0; b -= 1) {
        bits.push((dataBytes[i] >> b) & 1);
      }
    }
    var bitIndex = 0;
    var direction = -1; // -1 = moving up, 1 = moving down
    var row = size - 1;
    var col = size - 1;
    while (col > 0) {
      if (col === 6) {
        col -= 1;
      }
      for (;;) {
        for (var dc = 0; dc < 2; dc += 1) {
          var cc = col - dc;
          if (!reserved[row][cc]) {
            var value = bitIndex < bits.length ? bits[bitIndex] : 0;
            bitIndex += 1;
            var masked = maskBit(row, cc) ? (value ^ 1) : value;
            m[row][cc] = masked;
          }
        }
        row += direction;
        if (row < 0 || row >= size) {
          row -= direction;
          direction = -direction;
          break;
        }
      }
      col -= 2;
    }
  }

  // generateQRMatrix(text: string) -> number[][] | null
  //   Builds the full module matrix (1 = dark, 0 = light) for `text`
  //   (ASCII/Latin-1 byte mode only). Returns null if the text doesn't
  //   fit in this encoder's supported version range (1-5, level L,
  //   108 bytes max) — callers should fall back to showing the text
  //   plainly rather than failing.
  function generateQRMatrix(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i += 1) {
      bytes.push(text.charCodeAt(i) & 0xFF);
    }
    var versionInfo = pickVersion(bytes.length);
    if (!versionInfo) {
      return null;
    }

    var dataCodewords = buildDataCodewords(bytes, versionInfo);
    var ecCodewords = rsEncode(dataCodewords, versionInfo.ecBytes);
    var allCodewords = dataCodewords.concat(ecCodewords);

    var size = versionInfo.size;
    var matrix = createMatrix(size);
    var reserved = createReserved(size);

    placeFinderPattern(matrix, reserved, 0, 0);
    placeFinderPattern(matrix, reserved, 0, size - 7);
    placeFinderPattern(matrix, reserved, size - 7, 0);
    // Separator strips around each finder pattern (always light) —
    // already produced as a side effect of placeFinderPattern's -1..7
    // loop range, which marks the one-module border light and reserved.
    placeTimingPatterns(matrix, reserved);
    placeAlignmentPatterns(matrix, reserved, versionInfo.align);
    placeDarkModule(matrix, reserved, versionInfo.version);
    placeFormatInfo(matrix, reserved, 0);
    placeData(matrix, reserved, allCodewords);

    return matrix;
  }

  var api = { generateQRMatrix: generateQRMatrix };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.generateQRMatrix = generateQRMatrix;
  }
})(typeof window !== 'undefined' ? window : this);
