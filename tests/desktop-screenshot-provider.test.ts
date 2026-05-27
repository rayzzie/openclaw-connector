import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScreenDesktopFrameProvider } from "../src/desktop-screenshot-provider.js";
import { FakeDesktopFrameProvider } from "../src/desktop-frame-provider.js";

// Build a minimal valid PNG buffer (1x1) for testing.
function fakePng(width = 1, height = 1): Buffer {
  const buf = Buffer.alloc(24);
  // PNG signature
  Buffer.from("89504e470d0a1a0a", "hex").copy(buf, 0);
  // IHDR chunk: 4-byte length + "IHDR" + width + height
  buf.writeUInt32BE(13, 8);
  Buffer.from("49484452", "hex").copy(buf, 12); // "IHDR"
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe("ScreenDesktopFrameProvider", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a PNG DesktopFrame when screenshot-desktop succeeds", async () => {
    const pngData = fakePng(1280, 720);
    vi.doMock("screenshot-desktop", () => ({
      default: async () => pngData,
    }));

    const provider = new ScreenDesktopFrameProvider({ ttlMs: 1500 });
    const frame = await provider.capture();

    expect(frame.surface).toBe("desktop");
    expect(frame.mimeType).toBe("image/png");
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(720);
    expect(frame.ttlMs).toBe(1500);
    expect(typeof frame.timestampIso).toBe("string");
    expect(frame.data).toBe(pngData);
  });

  it("falls back to the fallback provider when screenshot-desktop is unavailable", async () => {
    vi.doMock("screenshot-desktop", () => {
      throw new Error("module not found");
    });

    const fallback = new FakeDesktopFrameProvider({ width: 320, height: 180, ttlMs: 500 });
    const provider = new ScreenDesktopFrameProvider({ ttlMs: 2000, fallback });

    const frame = await provider.capture();

    expect(frame.surface).toBe("desktop");
    expect(frame.mimeType).toBe("image/png");
    expect(frame.width).toBe(320);
    expect(frame.height).toBe(180);
  });

  it("falls back when screenshot-desktop capture throws", async () => {
    vi.doMock("screenshot-desktop", () => ({
      default: async () => { throw new Error("capture failed"); },
    }));

    const fallback = new FakeDesktopFrameProvider({ width: 640, height: 360, ttlMs: 1000 });
    const provider = new ScreenDesktopFrameProvider({ ttlMs: 2000, fallback });

    const frame = await provider.capture();

    expect(frame.width).toBe(640);
    expect(frame.height).toBe(360);
  });

  it("throws when screenshot-desktop is unavailable and no fallback is configured", async () => {
    vi.doMock("screenshot-desktop", () => {
      throw new Error("module not found");
    });

    const provider = new ScreenDesktopFrameProvider({ ttlMs: 2000 });

    await expect(provider.capture()).rejects.toThrow("no fallback");
  });

  it("uses a default ttlMs of 2000 when none is specified", async () => {
    const pngData = fakePng(800, 600);
    vi.doMock("screenshot-desktop", () => ({
      default: async () => pngData,
    }));

    const provider = new ScreenDesktopFrameProvider();
    const frame = await provider.capture();

    expect(frame.ttlMs).toBe(2000);
  });

  it("reads width and height from PNG IHDR header", async () => {
    const pngData = fakePng(1920, 1080);
    vi.doMock("screenshot-desktop", () => ({
      default: async () => pngData,
    }));

    const provider = new ScreenDesktopFrameProvider({ ttlMs: 2000 });
    const frame = await provider.capture();

    expect(frame.width).toBe(1920);
    expect(frame.height).toBe(1080);
  });
});
