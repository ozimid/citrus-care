// Photo downscale math. Constants and scaling rule MUST mirror
// apps/web/app/_lib/image-utils.ts (max 1600px long side, JPEG q0.85) so a
// photo assessed from mobile is byte-comparable to one from web. Pure module —
// the actual expo-image-manipulator call lives in photo-io.ts (thin, exercised
// by `expo export` bundling, per the README testing policy).

export const MAX_DIMENSION = 1600;
export const JPEG_QUALITY = 0.85;

export interface PhotoSize {
  width: number;
  height: number;
}

export function needsDownscale(size: PhotoSize): boolean {
  return Math.max(size.width, size.height) > MAX_DIMENSION;
}

/** Same math as the web downscaler: scale = min(1, 1600/longSide), Math.round. */
export function targetSize(size: PhotoSize): PhotoSize {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(size.width, size.height));
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  };
}

export type ResizeAction = { resize: { width: number } } | { resize: { height: number } };

/** expo-image-manipulator resize actions: give it only the long side and it
 * preserves aspect ratio; no action at all when the photo is already small. */
export function resizeActionsFor(size: PhotoSize): ResizeAction[] {
  if (!needsDownscale(size)) return [];
  return size.width >= size.height
    ? [{ resize: { width: MAX_DIMENSION } }]
    : [{ resize: { height: MAX_DIMENSION } }];
}
