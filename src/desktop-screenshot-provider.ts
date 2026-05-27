import { execFile } from "node:child_process";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopFrameProvider, DesktopFrame } from "./desktop-frame-provider.js";
import type { Logger } from "./logger.js";

export class ScreenDesktopFrameProvider implements DesktopFrameProvider {
  private readonly ttlMs: number;
  private readonly logger: Logger | undefined;
  private readonly fallback: DesktopFrameProvider | undefined;

  constructor(options: { ttlMs?: number; logger?: Logger; fallback?: DesktopFrameProvider } = {}) {
    this.ttlMs = Math.max(500, options.ttlMs ?? 2000);
    this.logger = options.logger;
    this.fallback = options.fallback;
  }

  async capture(): Promise<DesktopFrame> {
    try {
      const data = await macosScreencapture();
      const { width, height } = readPngSize(data);
      return {
        surface: "desktop",
        mimeType: "image/png",
        data,
        width,
        height,
        ttlMs: this.ttlMs,
        timestampIso: new Date().toISOString(),
      };
    } catch (err) {
      this.logger?.warn("screen capture failed, using fallback", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (this.fallback) {
      return this.fallback.capture();
    }
    throw new Error("screen capture unavailable and no fallback configured");
  }
}

// Call /usr/sbin/screencapture with the full path to avoid PATH issues in
// LaunchAgent environments where /usr/sbin may not be on PATH.
async function macosScreencapture(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "uag-ss-"));
  const file = join(dir, "s.png");
  try {
    await runCommand("/usr/sbin/screencapture", ["-x", "-t", "png", file]);
    return await readFile(file);
  } finally {
    await unlink(file).catch(() => {});
    await rmdir(dir).catch(() => {});
  }
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

function readPngSize(buf: Buffer): { width: number; height: number } {
  // PNG layout: 8 magic bytes + 4 IHDR length + 4 "IHDR" = 16 bytes, then width (4) + height (4)
  if (buf.length < 24) {
    return { width: 640, height: 360 };
  }
  return {
    width: Math.max(1, buf.readUInt32BE(16)),
    height: Math.max(1, buf.readUInt32BE(20)),
  };
}
