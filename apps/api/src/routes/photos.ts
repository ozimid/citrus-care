import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "../auth";
import { getStorage } from "../storage";
import { buildPhotoPath } from "../storage/paths";

// Client always uploads a canvas-re-encoded JPEG, but PNG/WebP pass-throughs
// exist for browsers where the re-encode fails.
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const READ_URL_TTL_SEC = 3600;

const signUploadSchema = z.object({
  plantId: z.string().min(1),
  mime: z.string().min(1),
});

const photos = new Hono();

// POST /photos/sign-upload — mint a signed upload URL for a NEW photo.
// The server constructs the object path from the authenticated user's id; a
// client-supplied path is never trusted (Storage RLS is gone).
photos.post("/sign-upload", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = signUploadSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid input" }, 400);
  }
  const mime = parsed.data.mime.toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    return c.json({ error: "Unsupported image type" }, 400);
  }

  const auth = await getAuth(c.req.raw);
  if (!auth) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const { supabase, user } = auth;

  // RLS-filtered read doubles as the ownership check: another user's plant is
  // invisible to this client, so the row comes back null.
  const { data: plant } = await supabase
    .from("plants")
    .select("id")
    .eq("id", parsed.data.plantId)
    .maybeSingle();
  if (!plant) {
    return c.json({ error: "Plant not found" }, 404);
  }

  const photoPath = buildPhotoPath({
    userId: user.id,
    plantId: parsed.data.plantId,
    mime,
  });

  try {
    const uploadUrl = await getStorage().getUploadUrl(photoPath, mime);
    return c.json({ photoPath, uploadUrl });
  } catch (e) {
    console.error("[/photos/sign-upload] signing failed:", (e as Error).message);
    return c.json({ error: "Failed to prepare upload." }, 500);
  }
});

// GET /photos?path=... — read proxy. <img> tags point here. Auth via cookie
// (web) or Bearer (mobile); ownership-check the path; 302 to a signed read URL.
photos.get("/", async (c) => {
  const path = c.req.query("path");
  if (!path) {
    return c.json({ error: "Invalid input" }, 400);
  }

  const auth = await getAuth(c.req.raw);
  if (!auth) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const { user } = auth;

  if (!path.startsWith(user.id + "/")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  try {
    const url = await getStorage().getReadUrl(path, READ_URL_TTL_SEC);
    return c.redirect(url, 302);
  } catch (e) {
    console.error("[/photos GET] read URL failed:", (e as Error).message);
    return c.json({ error: "Failed to load photo." }, 500);
  }
});

// DELETE /photos?prefix=... — remove every object under a prefix. Called by the
// web deletePlant server action after the DB rows are gone.
photos.delete("/", async (c) => {
  const prefix = c.req.query("prefix");
  if (!prefix) {
    return c.json({ error: "Invalid input" }, 400);
  }

  const auth = await getAuth(c.req.raw);
  if (!auth) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const { user } = auth;

  if (!prefix.startsWith(user.id + "/")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  try {
    await getStorage().deletePrefix(prefix);
    return c.json({ ok: true });
  } catch (e) {
    console.error("[/photos DELETE] delete failed:", (e as Error).message);
    return c.json({ error: "Failed to delete photos." }, 500);
  }
});

export default photos;
