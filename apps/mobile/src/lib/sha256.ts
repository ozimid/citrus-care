// Pure SHA-256 (FIPS 180-4) over the UTF-8 bytes of a string → lowercase hex.
//
// Why hand-rolled: the only caller is plant-tags' codeDigest (F39, D-W4/D-W13),
// which fingerprints a scanned sticker payload so the payload itself is never
// stored. Hermes ships no WebCrypto digest, expo-crypto would be a new native
// dependency (D-W12 says none), and a compare-only fingerprint needs nothing
// more. Pinned to the FIPS vectors and cross-checked against node:crypto in
// sha256.test.ts. Not a general-purpose crypto library: one input shape
// (string), one output shape (hex), no HMAC, no streaming.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** UTF-8 encode without TextEncoder (not guaranteed on every Hermes build).
 * Lone surrogates become U+FFFD, matching TextEncoder and node:crypto. */
function utf8Bytes(input: string): Uint8Array {
  // Worst case is 3 bytes per UTF-16 unit (a 4-byte code point spans two units).
  const buf = new Uint8Array(input.length * 3);
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    let cp = input.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const lo = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      } else {
        cp = 0xfffd;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }
    if (cp < 0x80) {
      buf[n++] = cp;
    } else if (cp < 0x800) {
      buf[n++] = 0xc0 | (cp >> 6);
      buf[n++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      buf[n++] = 0xe0 | (cp >> 12);
      buf[n++] = 0x80 | ((cp >> 6) & 0x3f);
      buf[n++] = 0x80 | (cp & 0x3f);
    } else {
      buf[n++] = 0xf0 | (cp >> 18);
      buf[n++] = 0x80 | ((cp >> 12) & 0x3f);
      buf[n++] = 0x80 | ((cp >> 6) & 0x3f);
      buf[n++] = 0x80 | (cp & 0x3f);
    }
  }
  return buf.subarray(0, n);
}

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 of the UTF-8 encoding of `input`, as 64 lowercase hex characters. */
export function sha256Hex(input: string): string {
  const msg = utf8Bytes(input);
  const len = msg.length;
  // Pad: 0x80, zeros, then the 64-bit big-endian bit length, to a 64-byte multiple.
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLen = len * 8; // exact up to 2^53 — far past any string a phone holds
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = H0.slice();
  const w = new Int32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getInt32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15];
      const w2 = w[t - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  let hex = "";
  for (const word of h) hex += (word >>> 0).toString(16).padStart(8, "0");
  return hex;
}
