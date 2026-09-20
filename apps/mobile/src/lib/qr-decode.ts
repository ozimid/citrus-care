// F39 D-W15: QR codes are decoded on the phone by jsqr from RGBA pixels — no
// Google ML Kit (its terms send usage metrics to Google), no live scanning,
// no expo-camera barcode settings. The user taps "Scan tag", the app takes ONE
// still, downscales it to 800 px, and this pure half turns pixels into a
// payload string (or null). The pixels come from jpeg-js in qr-decode-io.ts;
// the payload goes straight into plant-tags' normalizeCode → codeDigest and is
// never kept. QR only in v1 (DataMatrix / Code-128 are a Phase 7 dependency).

import jsQR from "jsqr";

export interface RgbaImage {
  /** RGBA, row-major, 4 bytes per pixel — exactly width × height × 4 long. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ScanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The decoded payload, or null when the frame holds no readable QR. Tries
 * both polarities (a silver-on-black anodized tag reads inverted). Never
 * throws: a malformed buffer is a miss, not a crash in the viewfinder. */
export function decodeQrFromRgba(img: RgbaImage): string | null {
  const { data, width, height } = img;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (data.length < width * height * 4) return null;
  try {
    const result = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
    const payload = result?.data;
    return typeof payload === "string" && payload.length > 0 ? payload : null;
  } catch (e) {
    console.error("[qr-decode] decoder threw:", (e as Error).message);
    return null;
  }
}

/** Tiles that must hold at least this many pixels a side to be worth a retry. */
const MIN_TILE_PX = 8;

/** Where to look when the full frame misses, coarse to fine: the whole frame,
 * the centre 60 % (a sticker the user aimed at), then the 2×2 quadrants (a
 * sticker off to one side, now at twice the relative size). Coordinates only —
 * the -io half crops the 800 px copy and calls decodeQrFromRgba per tile. */
export function scanTargets(width: number, height: number): ScanRect[] {
  if (!(width > 0 && height > 0)) return [];
  const full: ScanRect = { x: 0, y: 0, w: width, h: height };
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  if (halfW < MIN_TILE_PX || halfH < MIN_TILE_PX) return [full];
  const cx = Math.round(width * 0.2);
  const cy = Math.round(height * 0.2);
  const centre: ScanRect = {
    x: cx,
    y: cy,
    w: Math.min(Math.round(width * 0.6), width - cx),
    h: Math.min(Math.round(height * 0.6), height - cy),
  };
  return [
    full,
    centre,
    { x: 0, y: 0, w: halfW, h: halfH },
    { x: halfW, y: 0, w: width - halfW, h: halfH },
    { x: 0, y: halfH, w: halfW, h: height - halfH },
    { x: halfW, y: halfH, w: width - halfW, h: height - halfH },
  ];
}
