import { describe, expect, it } from "vitest";
import { storagePathFor, fileExtensionFromMime } from "@/app/_lib/image-utils";

describe("storagePathFor", () => {
  it("namespaces under user/tree with a unique filename and right ext", () => {
    const p = storagePathFor({
      userId: "user-1",
      treeId: "tree-2",
      mime: "image/jpeg",
      name: "abc123",
    });
    expect(p).toBe("user-1/tree-2/abc123.jpg");
  });

  it("falls back to .bin for unknown mime", () => {
    const p = storagePathFor({
      userId: "u",
      treeId: "t",
      mime: "weird/thing",
      name: "x",
    });
    expect(p).toBe("u/t/x.bin");
  });
});

describe("fileExtensionFromMime", () => {
  it("maps common image mimes", () => {
    expect(fileExtensionFromMime("image/jpeg")).toBe("jpg");
    expect(fileExtensionFromMime("image/png")).toBe("png");
    expect(fileExtensionFromMime("image/webp")).toBe("webp");
    expect(fileExtensionFromMime("image/heic")).toBe("heic");
    expect(fileExtensionFromMime("image/heif")).toBe("heif");
  });
  it("falls back to bin", () => {
    expect(fileExtensionFromMime("anything/else")).toBe("bin");
  });
});
