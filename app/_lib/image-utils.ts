const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function fileExtensionFromMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] ?? "bin";
}

export function storagePathFor(args: {
  userId: string;
  plantId: string;
  mime: string;
  name: string;
}): string {
  const ext = fileExtensionFromMime(args.mime);
  return `${args.userId}/${args.plantId}/${args.name}.${ext}`;
}


export function randomFileName(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

export async function downscaleImage(file: File): Promise<Blob> {
  if (typeof window === "undefined") return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif");
    if (isHeic) {
      throw new Error("HEIC photos are not supported in this browser. Please use JPEG or PNG, or convert in your Photos app.");
    }
    return file;
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise<Blob>((resolve) =>
    canvas.toBlob(
      (b) => resolve(b ?? file),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
}
