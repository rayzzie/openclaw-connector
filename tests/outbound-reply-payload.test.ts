import { describe, it, expect } from "vitest";
import {
  resolveOutboundMediaUrls,
  hasOutboundMedia,
  detectMediaKind,
} from "../src/outbound-reply-payload.js";

describe("resolveOutboundMediaUrls", () => {
  it("returns [] when no media fields present", () => {
    expect(resolveOutboundMediaUrls({ text: "hi" })).toEqual([]);
  });

  it("collects mediaUrls array", () => {
    expect(
      resolveOutboundMediaUrls({ mediaUrls: ["https://a/x.png", "https://a/y.mp3"] }),
    ).toEqual(["https://a/x.png", "https://a/y.mp3"]);
  });

  it("includes legacy single mediaUrl", () => {
    expect(resolveOutboundMediaUrls({ mediaUrl: "https://a/x.jpg" })).toEqual([
      "https://a/x.jpg",
    ]);
  });

  it("merges mediaUrls + legacy mediaUrl, de-duplicating and preserving order", () => {
    expect(
      resolveOutboundMediaUrls({
        mediaUrls: ["https://a/x.png", "https://a/y.mp4"],
        mediaUrl: "https://a/x.png",
      }),
    ).toEqual(["https://a/x.png", "https://a/y.mp4"]);
  });

  it("drops empty / non-string / whitespace entries", () => {
    expect(
      resolveOutboundMediaUrls({
        // @ts-expect-error intentionally malformed
        mediaUrls: ["https://a/x.png", "", "   ", 42, null],
        mediaUrl: "",
      }),
    ).toEqual(["https://a/x.png"]);
  });
});

describe("hasOutboundMedia", () => {
  it("is false without media", () => {
    expect(hasOutboundMedia({ text: "hi" })).toBe(false);
  });
  it("is true with a media url", () => {
    expect(hasOutboundMedia({ mediaUrl: "https://a/x.png" })).toBe(true);
  });
});

describe("detectMediaKind", () => {
  it("detects images", () => {
    for (const u of ["https://a/x.png", "https://a/x.JPG", "https://a/x.jpeg", "https://a/x.webp", "https://a/x.gif"]) {
      expect(detectMediaKind(u)).toBe("image");
    }
  });
  it("detects audio", () => {
    for (const u of ["https://a/x.mp3", "https://a/x.wav", "https://a/x.m4a", "https://a/x.aac", "https://a/x.flac"]) {
      expect(detectMediaKind(u)).toBe("audio");
    }
  });
  it("detects video", () => {
    for (const u of ["https://a/x.mp4", "https://a/x.mov", "https://a/x.webm", "https://a/x.mkv"]) {
      expect(detectMediaKind(u)).toBe("video");
    }
  });
  it("ignores query strings when reading the extension", () => {
    expect(detectMediaKind("https://oss.example.com/a/song.mp3?token=abc&exp=123")).toBe("audio");
  });
  it("defaults unknown extensions to image", () => {
    expect(detectMediaKind("https://a/file-no-ext")).toBe("image");
  });
});
