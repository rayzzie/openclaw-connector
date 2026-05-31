import { describe, it, expect, vi } from "vitest";
import { createS3Uploader, publicUrlFor, type S3UploaderConfig } from "../src/s3-uploader.js";

const baseCfg: S3UploaderConfig = {
  endpoint: "http://obs-nmhhht6.cucloud.cn",
  region: "us-east-1",
  bucket: "ruanyanyuan-temp",
  accessKeyId: "ak",
  secretAccessKey: "sk",
};

describe("publicUrlFor", () => {
  it("builds a path-style url from endpoint + bucket by default", () => {
    expect(publicUrlFor(baseCfg, "media/abc.png")).toBe(
      "http://obs-nmhhht6.cucloud.cn/ruanyanyuan-temp/media/abc.png",
    );
  });

  it("uses an explicit publicBaseUrl when set", () => {
    expect(publicUrlFor({ ...baseCfg, publicBaseUrl: "https://cdn.example.com/" }, "media/abc.png")).toBe(
      "https://cdn.example.com/media/abc.png",
    );
  });

  it("normalizes slashes", () => {
    expect(publicUrlFor({ ...baseCfg, endpoint: "http://obs/" }, "/media/x")).toBe(
      "http://obs/ruanyanyuan-temp/media/x",
    );
  });
});

describe("createS3Uploader", () => {
  it("puts the object and returns its public url", async () => {
    const puts: { Bucket: string; Key: string; Body: Uint8Array; ContentType?: string }[] = [];
    const putObject = vi.fn(async (p: { Bucket: string; Key: string; Body: Uint8Array; ContentType?: string }) => {
      puts.push(p);
    });

    const uploader = createS3Uploader(baseCfg, putObject);
    const url = await uploader.upload(new Uint8Array([1, 2, 3]), { contentType: "image/png", ext: "png" });

    expect(puts).toHaveLength(1);
    expect(puts[0].Bucket).toBe("ruanyanyuan-temp");
    expect(puts[0].Key).toMatch(/^media\/.*\.png$/);
    expect(puts[0].ContentType).toBe("image/png");
    expect(Array.from(puts[0].Body)).toEqual([1, 2, 3]);
    expect(url).toBe(`http://obs-nmhhht6.cucloud.cn/ruanyanyuan-temp/${puts[0].Key}`);
  });
});
