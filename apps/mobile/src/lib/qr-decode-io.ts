// F39 Garden Walk — QR decoding, IO half (D-W12 / D-W15): NO Google ML Kit —
// none of expo-camera's barcode-scanner props or its still-image scan API. The
// user taps "Scan tag", the camera takes ONE still, the manipulator shrinks
// it to 800 px, jpeg-js turns the JPEG into RGBA pixels and jsqr reads them —
// both pure JS, so nothing here can talk to a native scanner or the network.
// Untested by policy (README): the decode itself and the tile geometry are
// pure (qr-decode.ts) and covered by qr-decode.test.ts.
//
// The returned payload is UNTRUSTED physical-world input (D-W13). This module
// never logs it, never stores it and never keeps it past the return; the
// caller normalizes and digests it at once (plant-tags.interpretScan) and
// only the digest ever reaches a plant record.

import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { decode as decodeJpeg } from "jpeg-js";
import type { PhotoSize } from "./photo";
import { downscalePhoto } from "./photo-io";
import { decodeQrFromRgba, scanTargets, type RgbaImage } from "./qr-decode";

/** Long side of the copy every decode runs on (D-W15): small enough that
 * jpeg-js + jsqr finish in a second or two on a mid-range phone, large enough
 * for a ≥ 40 mm code that fills a fifth of the frame. */
export const SCAN_MAX_DIMENSION = 800;

/** jpeg-js refuses anything we could not have made: an 800 px copy is under
 * 1 MP, so a file past these limits is not ours and is not decoded. */
const DECODE_LIMITS = {
  useTArray: true as const,
  formatAsRGBA: true,
  maxResolutionInMP: 4,
  maxMemoryUsageInMB: 96,
};

/** Read a JPEG file into RGBA pixels (jpeg-js). The bytes come straight from
 * expo-file-system — no base64 round trip. */
export async function readJpegRgba(uri: string): Promise<RgbaImage> {
  const bytes = await new File(uri).bytes();
  const decoded = decodeJpeg(bytes, DECODE_LIMITS);
  // Same memory, the view jsqr wants — no copy.
  const data = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
  return { data, width: decoded.width, height: decoded.height };
}

function deleteQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    console.error("[qr-decode-io] temp cleanup failed:", (e as Error).message);
  }
}

/** Crop one scan tile out of the 800 px copy and scale it back up to the
 * scan size: a code that covered a sixth of the frame now covers most of
 * it, which is what jsqr's finder-pattern search wants. */
async function cropTile(uri: string, tile: { x: number; y: number; w: number; h: number }): Promise<string> {
  const context = ImageManipulator.manipulate(uri).crop({
    originX: tile.x,
    originY: tile.y,
    width: tile.w,
    height: tile.h,
  });
  const upscale = tile.w >= tile.h ? { width: SCAN_MAX_DIMENSION } : { height: SCAN_MAX_DIMENSION };
  const image = await context.resize(upscale).renderAsync();
  const result = await image.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
  return result.uri;
}

/** How hard to look. jsqr is pure JS on the JS thread (Hermes, no JIT), and
 * every tile after the full frame costs a native crop + re-encode + another
 * jpeg-js decode + another jsqr pass — so the miss path, not the hit path,
 * is what a caller budgets. */
export interface DecodeOptions {
  /** scanTargets to try, coarse to fine: 1 = full frame only, 2 = + centre,
   * 6 (default) = + the four quadrants. */
  maxTiles?: number;
  /** Skip the tile retries once the full-frame pass alone has taken longer
   * than this — a slow phone must not pay six decodes per photo with no code. */
  budgetMs?: number;
}

/** The import path (rung 3): every photo of a roll goes through this and most
 * hold no code, so only the full frame and the centre are tried, and not even
 * the centre once the first pass shows the phone is slow. The deliberate
 * "Scan tag" still runs the full tile retry. NOTE: the Phase 0 probe (c) —
 * decode time and hit rate at 800 px — has not been measured on a device
 * yet (docs/design/garden-walk.md §6); these numbers are a ceiling, not a
 * measurement. */
export const IMPORT_SCAN_OPTIONS: DecodeOptions = { maxTiles: 2, budgetMs: 1000 };

/** Decode a QR code from a photo: one 800 px copy, decoded whole, then each
 * scanTargets tile (centre, quadrants) cropped from that copy and retried —
 * as far as `options` allow. Resolves to the RAW payload string — the caller
 * must normalize and digest it immediately — or null when no tile holds a
 * readable code. Every temp file this makes is deleted best-effort before it
 * returns. */
export async function decodeQrFromPhoto(uri: string, size: PhotoSize, options: DecodeOptions = {}): Promise<string | null> {
  let small = await downscalePhoto(uri, size, SCAN_MAX_DIMENSION);
  const temps: string[] = [small.uri];
  try {
    // A wrong `size` (0×0 from a picker, say) skips the resize; never hand
    // jpeg-js a full-resolution frame — shrink again from the real dims.
    if (Math.max(small.width, small.height) > SCAN_MAX_DIMENSION) {
      small = await downscalePhoto(small.uri, small, SCAN_MAX_DIMENSION);
      temps.push(small.uri);
    }
    const full = await readJpegRgba(small.uri);
    const startedAt = Date.now();
    const tiles = scanTargets(full.width, full.height).slice(0, options.maxTiles ?? Number.POSITIVE_INFINITY);
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if (index > 0 && options.budgetMs !== undefined && Date.now() - startedAt > options.budgetMs) return null;
      const isFullFrame = tile.x === 0 && tile.y === 0 && tile.w === full.width && tile.h === full.height;
      let hit: string | null;
      if (isFullFrame) {
        hit = decodeQrFromRgba(full);
      } else {
        const cropUri = await cropTile(small.uri, tile);
        temps.push(cropUri);
        hit = decodeQrFromRgba(await readJpegRgba(cropUri));
      }
      if (hit !== null) return hit;
    }
    return null;
  } finally {
    for (const temp of temps) deleteQuietly(temp);
  }
}

/** The camera surface this needs — expo-camera's CameraView satisfies it, and
 * so would a fake. */
export interface StillCamera {
  takePictureAsync(options: { quality: number }): Promise<{ uri: string; width: number; height: number } | undefined>;
}

/** The "Scan tag" moment (D-W15): one deliberate still at half quality (the
 * decode runs at 800 px anyway) → decodeQrFromPhoto. The full-size still is
 * deleted whatever happens; the payload, if any, is returned raw for the
 * caller to digest at once. */
export async function captureAndDecode(camera: StillCamera): Promise<string | null> {
  const shot = await camera.takePictureAsync({ quality: 0.5 });
  if (!shot) return null;
  try {
    return await decodeQrFromPhoto(shot.uri, { width: shot.width, height: shot.height });
  } finally {
    deleteQuietly(shot.uri);
  }
}
