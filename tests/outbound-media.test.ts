import { describe, it, expect, vi } from "vitest";
import { classifyMediaRef, resolveMediaRefToUrl } from "../src/outbound-media.js";
import type { ObjectUploader } from "../src/object-uploader.js";

function fakeUploader(urlToReturn = "http://obs/bucket/key.bin") {
  const upload = vi.fn(async (_body: Uint8Array, _opts: { contentType?: string; ext?: string }) => urlToReturn);
  const uploader: ObjectUploader = { upload };
  return { uploader, upload };
}

describe("classifyMediaRef", () => {
  it("treats http/https as remote", () => {
    expect(classifyMediaRef("http://a/x.png")).toBe("remote");
    expect(classifyMediaRef("https://a/x.png")).toBe("remote");
  });
  it("treats data: urls as data", () => {
    expect(classifyMediaRef("data:image/png;base64,QQ==")).toBe("data");
  });
  it("treats file:// and bare paths as local", () => {
    expect(classifyMediaRef("file:///tmp/x.png")).toBe("local");
    expect(classifyMediaRef("/tmp/x.mp3")).toBe("local");
    expect(classifyMediaRef("./out/clip.mp4")).toBe("local");
  });
});

describe("resolveMediaRefToUrl", () => {
  it("passes remote urls through without uploading", async () => {
    const { uploader, upload } = fakeUploader();
    const r = await resolveMediaRefToUrl("https://a/song.mp3", { uploader });
    expect(r).toEqual({ url: "https://a/song.mp3", kind: "audio" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("reads a local file path, uploads it, returns the public url + kind", async () => {
    const { uploader, upload } = fakeUploader("http://obs/bucket/abc.png");
    const readFile = vi.fn(async (_p: string) => new Uint8Array([1, 2, 3]));
    const r = await resolveMediaRefToUrl("/tmp/cat.png", { uploader, readFile });
    expect(r).toEqual({ url: "http://obs/bucket/abc.png", kind: "image" });
    expect(readFile).toHaveBeenCalledWith("/tmp/cat.png");
    expect(upload.mock.calls[0][0]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("strips the file:// scheme before reading", async () => {
    const { uploader } = fakeUploader("http://obs/bucket/x.mp4");
    const readFile = vi.fn(async (_p: string) => new Uint8Array([9]));
    const r = await resolveMediaRefToUrl("file:///tmp/clip.mp4", { uploader, readFile });
    expect(r?.kind).toBe("video");
    expect(readFile).toHaveBeenCalledWith("/tmp/clip.mp4");
  });

  it("decodes a data: url and uploads the bytes with its content-type", async () => {
    const { uploader, upload } = fakeUploader("http://obs/bucket/x.png");
    const r = await resolveMediaRefToUrl("data:image/png;base64,AQID", { uploader }); // AQID = [1,2,3]
    expect(r?.kind).toBe("image");
    expect(Array.from(upload.mock.calls[0][0] as Uint8Array)).toEqual([1, 2, 3]);
    expect((upload.mock.calls[0][1] as { contentType?: string }).contentType).toBe("image/png");
  });

  it("returns null for local/data media when no uploader is configured", async () => {
    expect(await resolveMediaRefToUrl("/tmp/x.png", {})).toBeNull();
    expect(await resolveMediaRefToUrl("data:image/png;base64,AQID", {})).toBeNull();
  });
});
