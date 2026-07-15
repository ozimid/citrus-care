// Thin expo-image-manipulator wrapper around the pure resize math in photo.ts
// (same pure/side-effectful split as auth-state.ts vs auth.ts). Untested by
// design — README testing policy: expo modules are exercised via `expo export`
// bundling, the math via photo.test.ts.

import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { JPEG_QUALITY, resizeActionsFor, type PhotoSize } from "./photo";

export interface PreparedPhoto {
  uri: string;
  width: number;
  height: number;
}

/** Downscale to max 1600px on the long side and re-encode as JPEG q0.85 —
 * exactly what the web uploader produces (apps/web/app/_lib/image-utils.ts),
 * so the assess pipeline sees identical input from both clients. Photos
 * already within bounds are still re-encoded to JPEG (normalizes HEIC). */
export async function downscalePhoto(uri: string, size: PhotoSize): Promise<PreparedPhoto> {
  const context = ImageManipulator.manipulate(uri);
  for (const action of resizeActionsFor(size)) {
    context.resize(action.resize);
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return { uri: result.uri, width: result.width, height: result.height };
}
