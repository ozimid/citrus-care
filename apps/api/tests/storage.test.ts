import { describe, expect, it, vi, beforeEach } from "vitest";

// ---- @google-cloud/storage mock -------------------------------------------
const {
  getSignedUrlMock,
  downloadMock,
  deleteMock,
  getFilesMock,
  fileMock,
  bucketMock,
} = vi.hoisted(() => {
  const getSignedUrlMock = vi.fn();
  const downloadMock = vi.fn();
  const deleteMock = vi.fn();
  const getFilesMock = vi.fn();
  const fileMock = vi.fn().mockImplementation((path: string) => ({
    name: path,
    getSignedUrl: getSignedUrlMock,
    download: downloadMock,
    delete: deleteMock,
  }));
  const bucketMock = vi.fn().mockImplementation(() => ({
    file: fileMock,
    getFiles: getFilesMock,
  }));
  return {
    getSignedUrlMock,
    downloadMock,
    deleteMock,
    getFilesMock,
    fileMock,
    bucketMock,
  };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket(name: string) {
      return bucketMock(name);
    }
  },
}));

// ---- @supabase/supabase-js mock -------------------------------------------
const {
  createSignedUploadUrlMock,
  createSignedUrlMock,
  sbDownloadMock,
  removeMock,
  listMock,
  fromMock,
} = vi.hoisted(() => {
  const createSignedUploadUrlMock = vi.fn();
  const createSignedUrlMock = vi.fn();
  const sbDownloadMock = vi.fn();
  const removeMock = vi.fn();
  const listMock = vi.fn();
  const fromMock = vi.fn().mockImplementation(() => ({
    createSignedUploadUrl: createSignedUploadUrlMock,
    createSignedUrl: createSignedUrlMock,
    download: sbDownloadMock,
    remove: removeMock,
    list: listMock,
  }));
  return {
    createSignedUploadUrlMock,
    createSignedUrlMock,
    sbDownloadMock,
    removeMock,
    listMock,
    fromMock,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: fromMock } }),
}));

import {
  GcsStorage,
  SupabaseStorage,
  getStorage,
} from "../src/storage";

const FAKE_KEY = JSON.stringify({
  project_id: "test-project",
  client_email: "sa@test-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
});

beforeEach(() => {
  getSignedUrlMock.mockReset();
  downloadMock.mockReset();
  deleteMock.mockReset();
  getFilesMock.mockReset();
  fileMock.mockClear();
  bucketMock.mockClear();

  createSignedUploadUrlMock.mockReset();
  createSignedUrlMock.mockReset();
  sbDownloadMock.mockReset();
  removeMock.mockReset();
  listMock.mockReset();
  fromMock.mockClear();

  process.env.GCS_PHOTOS_BUCKET = "test-photos";
  process.env.GCS_SERVICE_ACCOUNT_KEY = FAKE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-db";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";
});

describe("GcsStorage", () => {
  it("getUploadUrl requests a v4 write URL with a short TTL and the exact contentType", async () => {
    getSignedUrlMock.mockResolvedValue(["https://signed.example/put"]);
    const url = await new GcsStorage().getUploadUrl("u1/t1/photo.jpg", "image/jpeg");
    expect(url).toBe("https://signed.example/put");
    expect(fileMock).toHaveBeenCalledWith("u1/t1/photo.jpg");
    const opts = getSignedUrlMock.mock.calls[0][0];
    expect(opts.version).toBe("v4");
    expect(opts.action).toBe("write");
    expect(opts.contentType).toBe("image/jpeg");
    expect(opts.expires).toBeGreaterThan(Date.now());
    expect(opts.expires).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
  });

  it("getReadUrl requests a v4 read URL respecting the requested TTL", async () => {
    getSignedUrlMock.mockResolvedValue(["https://signed.example/get"]);
    const url = await new GcsStorage().getReadUrl("u1/t1/photo.jpg", 3600);
    expect(url).toBe("https://signed.example/get");
    const opts = getSignedUrlMock.mock.calls[0][0];
    expect(opts.version).toBe("v4");
    expect(opts.action).toBe("read");
    expect(opts.expires).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 1000);
  });

  it("download returns the file contents as a Buffer", async () => {
    downloadMock.mockResolvedValue([Buffer.from("image-bytes")]);
    const buf = await new GcsStorage().download("u1/t1/photo.jpg");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("image-bytes");
  });

  it("deletePrefix deletes every matched file and ignores missing objects", async () => {
    getFilesMock.mockResolvedValue([
      [
        { name: "u1/t1/a.jpg", delete: deleteMock },
        { name: "u1/t1/b.jpg", delete: deleteMock },
      ],
    ]);
    deleteMock.mockResolvedValue([]);
    await new GcsStorage().deletePrefix("u1/t1/");
    expect(getFilesMock).toHaveBeenCalledWith({ prefix: "u1/t1/" });
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock.mock.calls[0][0]).toMatchObject({ ignoreNotFound: true });
  });

  it("listAll returns names with creation timestamps (null when absent)", async () => {
    getFilesMock.mockResolvedValue([
      [
        { name: "u1/t1/a.jpg", metadata: { timeCreated: "2026-07-01T00:00:00Z" } },
        { name: "u1/t1/b.jpg", metadata: {} },
      ],
    ]);
    const details = await new GcsStorage().listAll();
    expect(details).toEqual([
      { name: "u1/t1/a.jpg", createdAt: "2026-07-01T00:00:00Z" },
      { name: "u1/t1/b.jpg", createdAt: null },
    ]);
    expect(bucketMock).toHaveBeenCalledWith("test-photos");
  });
});

describe("SupabaseStorage", () => {
  it("getUploadUrl returns the signed upload URL", async () => {
    createSignedUploadUrlMock.mockResolvedValue({
      data: { signedUrl: "https://sb.example/put", token: "tok", path: "p" },
      error: null,
    });
    const url = await new SupabaseStorage().getUploadUrl("u1/t1/p.jpg", "image/jpeg");
    expect(url).toBe("https://sb.example/put");
    expect(createSignedUploadUrlMock).toHaveBeenCalledWith("u1/t1/p.jpg");
  });

  it("getReadUrl passes the TTL through and returns the signed URL", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://sb.example/get" },
      error: null,
    });
    const url = await new SupabaseStorage().getReadUrl("u1/t1/p.jpg", 3600);
    expect(url).toBe("https://sb.example/get");
    expect(createSignedUrlMock).toHaveBeenCalledWith("u1/t1/p.jpg", 3600);
  });

  it("getUploadUrl throws (generic) when Supabase returns an error", async () => {
    createSignedUploadUrlMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      new SupabaseStorage().getUploadUrl("u1/t1/p.jpg", "image/jpeg"),
    ).rejects.toThrow();
  });

  it("download returns a Buffer from the blob", async () => {
    sbDownloadMock.mockResolvedValue({
      data: new Blob(["image-bytes"]),
      error: null,
    });
    const buf = await new SupabaseStorage().download("u1/t1/p.jpg");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("image-bytes");
  });

  it("deletePrefix lists under the prefix and removes the files plus the prefix itself", async () => {
    // A single file-as-prefix: list() returns [] (Supabase lists folders only).
    listMock.mockResolvedValue({ data: [], error: null });
    removeMock.mockResolvedValue({ data: [], error: null });
    await new SupabaseStorage().deletePrefix("u1/t1/orphan.jpg");
    expect(listMock).toHaveBeenCalledWith("u1/t1/orphan.jpg", expect.any(Object));
    expect(removeMock).toHaveBeenCalledWith(["u1/t1/orphan.jpg"]);
  });

  it("listAll recursively walks folders and maps created_at", async () => {
    listMock.mockImplementation((folder: string) => {
      if (folder === "") {
        return Promise.resolve({ data: [{ name: "u1", id: null }], error: null });
      }
      if (folder === "u1") {
        return Promise.resolve({ data: [{ name: "t1", id: null }], error: null });
      }
      if (folder === "u1/t1") {
        return Promise.resolve({
          data: [
            { name: "a.jpg", id: "f1", created_at: "2026-07-01T00:00:00Z" },
            { name: "b.jpg", id: "f2", created_at: null },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    const details = await new SupabaseStorage().listAll();
    expect(details).toEqual([
      { name: "u1/t1/a.jpg", createdAt: "2026-07-01T00:00:00Z" },
      { name: "u1/t1/b.jpg", createdAt: null },
    ]);
  });
});

describe("getStorage selection", () => {
  it("returns SupabaseStorage when GCS_PHOTOS_BUCKET is unset", () => {
    delete process.env.GCS_PHOTOS_BUCKET;
    expect(getStorage()).toBeInstanceOf(SupabaseStorage);
  });

  it("returns GcsStorage when GCS_PHOTOS_BUCKET is set", () => {
    process.env.GCS_PHOTOS_BUCKET = "test-photos";
    expect(getStorage()).toBeInstanceOf(GcsStorage);
  });
});
