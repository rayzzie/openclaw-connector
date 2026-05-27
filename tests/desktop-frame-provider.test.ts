import { describe, expect, it } from "vitest";
import {
  FakeDesktopFrameProvider,
  createDesktopFrameProvider,
  desktopFrameToVisualPayload,
} from "../src/desktop-frame-provider.js";

const PNG_SIGNATURE = "89504e470d0a1a0a";

describe("FakeDesktopFrameProvider", () => {
  it("generates a timestamped PNG frame for the desktop surface", async () => {
    const provider = new FakeDesktopFrameProvider({
      width: 320,
      height: 180,
      ttlMs: 2500,
      now: () => new Date("2026-05-27T09:30:15.000Z"),
    });

    const frame = await provider.capture();

    expect(frame.surface).toBe("desktop");
    expect(frame.mimeType).toBe("image/png");
    expect(frame.width).toBe(320);
    expect(frame.height).toBe(180);
    expect(frame.ttlMs).toBe(2500);
    expect(frame.timestampIso).toBe("2026-05-27T09:30:15.000Z");
    expect(Buffer.from(frame.data.subarray(0, 8)).toString("hex")).toBe(PNG_SIGNATURE);
    expect(readPngSize(frame.data)).toEqual({ width: 320, height: 180 });
    expect(frame.data.includes(Buffer.from(frame.timestampIso))).toBe(true);
  });

  it("converts a frame into a visual.frame payload", async () => {
    const provider = new FakeDesktopFrameProvider({
      now: () => new Date("2026-05-27T09:31:00.000Z"),
    });

    const frame = await provider.capture();
    const payload = desktopFrameToVisualPayload(frame);

    expect(payload).toMatchObject({
      type: "visual.frame",
      surface: "desktop",
      mime_type: "image/png",
      ttl_ms: frame.ttlMs,
    });
    expect(Buffer.from(payload.data_base64, "base64").equals(frame.data)).toBe(true);
  });

  it("changes image bytes as the timestamp changes", async () => {
    let tick = 0;
    const provider = new FakeDesktopFrameProvider({
      now: () => new Date(`2026-05-27T09:31:0${tick++}.000Z`),
    });

    const first = await provider.capture();
    const second = await provider.capture();

    expect(first.timestampIso).not.toBe(second.timestampIso);
    expect(first.data.equals(second.data)).toBe(false);
  });
});

describe("createDesktopFrameProvider", () => {
  it("returns FakeDesktopFrameProvider when provider is 'fake'", async () => {
    const provider = createDesktopFrameProvider({ provider: "fake", ttlMs: 1500 });
    const frame = await provider.capture();
    expect(frame.surface).toBe("desktop");
    expect(frame.mimeType).toBe("image/png");
    expect(frame.ttlMs).toBe(1500);
  });

  it("returns FakeDesktopFrameProvider when provider is omitted", async () => {
    const provider = createDesktopFrameProvider({});
    const frame = await provider.capture();
    expect(frame.surface).toBe("desktop");
    expect(frame.mimeType).toBe("image/png");
  });

  it("returns a provider with fallback when provider is 'screen'", async () => {
    // screenshot-desktop is unavailable in test (no real desktop); the returned
    // ScreenDesktopFrameProvider should fall back to FakeDesktopFrameProvider.
    const provider = createDesktopFrameProvider({ provider: "screen", ttlMs: 999 });
    const frame = await provider.capture();
    // The result is whatever succeeds (fake frame on CI/headless).
    expect(frame.surface).toBe("desktop");
    expect(frame.mimeType).toBe("image/png");
  });
});

function readPngSize(data: Buffer): { width: number; height: number } {
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}
