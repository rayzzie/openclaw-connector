import type { DesktopFrameProvider, DesktopFrame } from "./desktop-frame-provider.js";
import type { Logger } from "./logger.js";

type ScreenshotFn = (opts?: { format?: string }) => Promise<Buffer>;

export class ScreenDesktopFrameProvider implements DesktopFrameProvider {
  private readonly ttlMs: number;
  private readonly logger: Logger | undefined;
  private readonly fallback: DesktopFrameProvider | undefined;
  // undefined = not yet attempted; null = load failed
  private _fn: ScreenshotFn | null | undefined = undefined;

  constructor(options: { ttlMs?: number; logger?: Logger; fallback?: DesktopFrameProvider } = {}) {
    this.ttlMs = Math.max(500, options.ttlMs ?? 2000);
    this.logger = options.logger;
    this.fallback = options.fallback;
  }

  async capture(): Promise<DesktopFrame> {
    const fn = await this._load();
    if (fn) {
      try {
        const data = await fn({ format: "png" });
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
    }
    if (this.fallback) {
      return this.fallback.capture();
    }
    throw new Error("screen capture unavailable and no fallback configured");
  }

  private async _load(): Promise<ScreenshotFn | null> {
    if (this._fn !== undefined) {
      return this._fn;
    }
    try {
      // screenshot-desktop is CJS; Node.js ESM dynamic import surfaces module.exports as default.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await import("screenshot-desktop") as any;
      this._fn = (mod.default ?? mod) as ScreenshotFn;
      this.logger?.info("screenshot-desktop loaded");
    } catch (err) {
      this.logger?.warn("screenshot-desktop unavailable, will use fallback", {
        error: err instanceof Error ? err.message : String(err),
      });
      this._fn = null;
    }
    return this._fn;
  }
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
