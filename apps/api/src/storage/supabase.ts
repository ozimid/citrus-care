import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PhotoStorage, StoredObject } from "./index";

// Supabase Storage implementation — preserves today's behavior. Uses a
// service-role client against the `photos` bucket. This module is the ONLY
// place in apps/api that holds the service-role key for storage; the /photos
// routes have already auth+ownership-checked every path that reaches here.

const BUCKET = "photos";
const LIST_PAGE_SIZE = 1000;

export class SupabaseStorage implements PhotoStorage {
  private cachedClient: SupabaseClient | null = null;

  private client(): SupabaseClient {
    if (this.cachedClient) return this.cachedClient;
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("Missing Supabase service-role env for storage");
    }
    this.cachedClient = createClient(url, key);
    return this.cachedClient;
  }

  private bucket() {
    return this.client().storage.from(BUCKET);
  }

  async getUploadUrl(path: string, _contentType: string): Promise<string> {
    // Supabase returns an absolute URL that accepts a direct PUT of the bytes;
    // the content type is negotiated on upload, so _contentType is unused here.
    const { data, error } = await this.bucket().createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to sign upload URL");
    }
    return data.signedUrl;
  }

  async getReadUrl(path: string, expirySec: number): Promise<string> {
    const { data, error } = await this.bucket().createSignedUrl(
      path,
      expirySec,
    );
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to sign read URL");
    }
    return data.signedUrl;
  }

  async download(path: string): Promise<Buffer> {
    const { data, error } = await this.bucket().download(path);
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to download object");
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async deletePrefix(prefix: string): Promise<void> {
    const normalized = prefix.replace(/\/+$/, "");
    // Collect every file under the prefix. `walk` returns [] when the prefix
    // is itself a single file path (Supabase lists folders only), so we also
    // include the normalized path directly — this lets cleanup delete an
    // individual orphan file by passing its full path as the "prefix".
    const children = await this.walk(normalized);
    const paths = children.map((c) => c.name);
    paths.push(normalized);
    const unique = [...new Set(paths)];
    if (unique.length === 0) return;
    const { error } = await this.bucket().remove(unique);
    if (error) throw new Error(error.message);
  }

  async listAll(): Promise<StoredObject[]> {
    return this.walk("");
  }

  /** Recursively list every file under `folder` as flat full paths. */
  private async walk(folder: string): Promise<StoredObject[]> {
    const { data, error } = await this.bucket().list(folder, {
      limit: LIST_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    const out: StoredObject[] = [];
    for (const entry of data ?? []) {
      const full = folder ? `${folder}/${entry.name}` : entry.name;
      // Supabase returns a null `id` for pseudo-folders and a real id for files.
      if (entry.id) {
        out.push({ name: full, createdAt: entry.created_at ?? null });
      } else {
        out.push(...(await this.walk(full)));
      }
    }
    return out;
  }
}
