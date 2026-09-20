import { describe, expect, it } from "vitest";
import { decodeQrFromRgba, scanTargets, type RgbaImage } from "./qr-decode";

// F39 D-W15: no Google ML Kit anywhere. A code is decoded by jsqr from the RGBA
// pixels of a deliberately captured still (jpeg-js in the -io half). This is
// the pure half: pixels in, payload string (or null) out. The fixture is a
// version-2, EC-level-H QR for "CC1-TEST01", generated offline with toqr and
// verified against jsqr, rendered here at 8 px per module with a 4-module
// quiet zone.

const FIXTURE = [
  "#######...#..#..#.#######",
  "#.....#....#...##.#.....#",
  "#.###.#..##....##.#.###.#",
  "#.###.#..###..#...#.###.#",
  "#.###.#.#.#..#..#.#.###.#",
  "#.....#...###.....#.....#",
  "#######.#.#.#.#.#.#######",
  "........###..##..........",
  "..##..#####.#.#####.#....",
  "#.##....##..######...#.#.",
  ".#########..####.#..##.#.",
  "##.##...#.##.##.##.#..###",
  ".###.##.#..#.##.#.#####.#",
  "....#..#.##..#...#..####.",
  ".#.##.##.##.###..###.###.",
  "#..#...#.##.##.#...#...#.",
  "..#####.####..#.######.#.",
  "........#.##..#.#...###..",
  "#######.##..##.##.#.##.##",
  "#.....#..##.#.###...##.##",
  "#.###.#..##.#.#######.#.#",
  "#.###.#.#..#.#####.#....#",
  "#.###.#.#.####.###.###.#.",
  "#.....#...#######...###..",
  "#######.......##.##....##",
];

function renderQr(rows: string[], scale: number, quiet: number, invert = false): RgbaImage {
  const n = rows.length;
  const width = (n + 2 * quiet) * scale;
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      let dark = mx >= 0 && my >= 0 && mx < n && my < n && rows[my][mx] === "#";
      if (invert) dark = !dark;
      const v = dark ? 0 : 255;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function noise(width: number, height: number, seed: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  let s = seed;
  for (let i = 0; i < width * height; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = s % 256;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe("decodeQrFromRgba", () => {
  it("decodes the fixture QR to its payload", () => {
    expect(decodeQrFromRgba(renderQr(FIXTURE, 8, 4))).toBe("CC1-TEST01");
  });

  it("decodes a light-on-dark (inverted) code — stickers on black anodized tags", () => {
    expect(decodeQrFromRgba(renderQr(FIXTURE, 8, 4, true))).toBe("CC1-TEST01");
  });

  it("decodes at other module sizes", () => {
    expect(decodeQrFromRgba(renderQr(FIXTURE, 4, 4))).toBe("CC1-TEST01");
    expect(decodeQrFromRgba(renderQr(FIXTURE, 11, 6))).toBe("CC1-TEST01");
  });

  it("returns null on noise, on a blank frame, and on an empty image", () => {
    expect(decodeQrFromRgba(noise(200, 200, 12345))).toBeNull();
    const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    expect(decodeQrFromRgba({ data: blank, width: 64, height: 64 })).toBeNull();
    expect(decodeQrFromRgba({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull();
  });

  it("returns null (never throws) when the buffer does not match the dimensions", () => {
    expect(decodeQrFromRgba({ data: new Uint8ClampedArray(10), width: 100, height: 100 })).toBeNull();
    expect(decodeQrFromRgba({ data: new Uint8ClampedArray(400), width: -10, height: 10 })).toBeNull();
    expect(decodeQrFromRgba({ data: new Uint8ClampedArray(400), width: 10.5, height: 10 })).toBeNull();
  });
});

describe("scanTargets", () => {
  it("lists the full frame, then the centre 60 %, then the 2×2 quadrants", () => {
    expect(scanTargets(800, 600)).toEqual([
      { x: 0, y: 0, w: 800, h: 600 },
      { x: 160, y: 120, w: 480, h: 360 },
      { x: 0, y: 0, w: 400, h: 300 },
      { x: 400, y: 0, w: 400, h: 300 },
      { x: 0, y: 300, w: 400, h: 300 },
      { x: 400, y: 300, w: 400, h: 300 },
    ]);
  });

  it("tiles odd dimensions exactly, with integer rectangles that stay inside the frame", () => {
    const targets = scanTargets(801, 601);
    for (const r of targets) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x + r.w).toBeLessThanOrEqual(801);
      expect(r.y + r.h).toBeLessThanOrEqual(601);
    }
    const [, , tl, tr, bl, br] = targets;
    expect(tl.w + tr.w).toBe(801);
    expect(tl.h + bl.h).toBe(601);
    expect(br.x).toBe(tl.w);
    expect(br.y).toBe(tl.h);
  });

  it("returns only the full frame for a frame too small to tile", () => {
    expect(scanTargets(3, 3)).toEqual([{ x: 0, y: 0, w: 3, h: 3 }]);
    expect(scanTargets(0, 0)).toEqual([]);
  });
});
