import { Storage } from "@google-cloud/storage";
import type { PhotoStorage, StoredObject } from "./index";

// GCS implementation. The only module that touches @google-cloud/storage.
// Security model: GCS has no per-object RLS, so every caller must pass a path
// that is either (a) constructed server-side from the authenticated user's id,
// or (b) sourced from a Postgres row already RLS-filtered to that user. The
// /photos routes enforce the user.id + "/" prefix before any call lands here.

const SIGNED_UPLOAD_TTL_MS = 5 * 60 * 1000;

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export class GcsStorage implements PhotoStorage {
  private cachedStorage: Storage | null = null;

  private storage(): Storage {
    if (this.cachedStorage) return this.cachedStorage;
    // Fly.io has no GCP Application Default Credentials — the service-account
    // key JSON is provided whole via env (see .env.example / fly secrets).
    const key = JSON.parse(requiredEnv("GCS_SERVICE_ACCOUNT_KEY"));
    this.cachedStorage = new Storage({
      projectId: key.project_id,
      credentials: {
        client_email: key.client_email,
        private_key: key.private_key,
      },
    });
    return this.cachedStorage;
  }

  private bucket() {
    return this.storage().bucket(requiredEnv("GCS_PHOTOS_BUCKET"));
  }

  async getUploadUrl(path: string, contentType: string): Promise<string> {
    const [url] = await this.bucket()
      .file(path)
      .getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + SIGNED_UPLOAD_TTL_MS,
        contentType,
      });
    return url;
  }

  async getReadUrl(path: string, expirySec: number): Promise<string> {
    const [url] = await this.bucket()
      .file(path)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expirySec * 1000,
      });
    return url;
  }

  async download(path: string): Promise<Buffer> {
    const [buf] = await this.bucket().file(path).download();
    return buf;
  }

  async deletePrefix(prefix: string): Promise<void> {
    const [files] = await this.bucket().getFiles({ prefix });
    await Promise.all(
      files.map((f) => f.delete({ ignoreNotFound: true })),
    );
  }

  async listAll(): Promise<StoredObject[]> {
    const [files] = await this.bucket().getFiles();
    return files.map((f) => ({
      name: f.name,
      createdAt: f.metadata?.timeCreated ?? null,
    }));
  }
}
