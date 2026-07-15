import { randomUUID } from "node:crypto";

// Pure path helpers, copied (not imported) from apps/web/app/_lib/image-utils.ts
// so the API never reaches across the app boundary. The sign-upload route only
// permits jpeg/png/webp, so those are the only extensions that matter here.
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function fileExtensionFromMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] ?? "bin";
}

/**
 * Build the object path for a new photo. Constructed entirely server-side from
 * the authenticated user's id — a client-supplied path is never trusted. This
 * is the upload-side ownership boundary now that Storage RLS is gone.
 */
export function buildPhotoPath(args: {
  userId: string;
  plantId: string;
  mime: string;
}): string {
  const ext = fileExtensionFromMime(args.mime);
  return `${args.userId}/${args.plantId}/${randomUUID()}.${ext}`;
}
