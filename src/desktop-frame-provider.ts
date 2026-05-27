import { deflateSync } from "node:zlib";
import type { VisualFramePayload } from "./protocol.js";
import type { Logger } from "./logger.js";
import { ScreenDesktopFrameProvider } from "./desktop-screenshot-provider.js";

export type DesktopFrame = {
  surface: "desktop";
  mimeType: "image/png";
  data: Buffer;
  width: number;
  height: number;
  ttlMs: number;
  timestampIso: string;
};

export type FakeDesktopFrameProviderOptions = {
  width?: number;
  height?: number;
  ttlMs?: number;
  now?: () => Date;
};

export type DesktopFrameProvider = {
  capture(): Promise<DesktopFrame>;
};

export class FakeDesktopFrameProvider implements DesktopFrameProvider {
  private readonly width: number;
  private readonly height: number;
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(options: FakeDesktopFrameProviderOptions = {}) {
    this.width = Math.max(160, Math.floor(options.width ?? 640));
    this.height = Math.max(90, Math.floor(options.height ?? 360));
    this.ttlMs = Math.max(500, Math.floor(options.ttlMs ?? 2000));
    this.now = options.now ?? (() => new Date());
  }

  async capture(): Promise<DesktopFrame> {
    const timestampIso = this.now().toISOString();
    return {
      surface: "desktop",
      mimeType: "image/png",
      data: renderTimestampedPng(this.width, this.height, timestampIso),
      width: this.width,
      height: this.height,
      ttlMs: this.ttlMs,
      timestampIso,
    };
  }
}

export function desktopFrameToVisualPayload(frame: DesktopFrame): VisualFramePayload {
  return {
    type: "visual.frame",
    surface: frame.surface,
    mime_type: frame.mimeType,
    data_base64: frame.data.toString("base64"),
    ttl_ms: frame.ttlMs,
  };
}

function renderTimestampedPng(width: number, height: number, timestampIso: string): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  fillBackground(pixels, width, height);

  const scale = Math.max(2, Math.floor(width / 160));
  drawText(pixels, width, height, "DESKTOP", 20, 20, scale, [255, 255, 255, 255]);
  drawText(pixels, width, height, timestampIso, 20, 50 + scale * 10, scale, [145, 238, 255, 255]);
  drawBorder(pixels, width, height, [70, 210, 180, 255]);

  return encodePng(width, height, pixels, timestampIso);
}

function fillBackground(pixels: Buffer, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 18 + Math.floor((x / width) * 30);
      pixels[offset + 1] = 24 + Math.floor((y / height) * 45);
      pixels[offset + 2] = 44 + Math.floor(((x + y) / (width + height)) * 55);
      pixels[offset + 3] = 255;
    }
  }
}

function drawBorder(pixels: Buffer, width: number, height: number, color: Rgba): void {
  fillRect(pixels, width, height, 0, 0, width, 4, color);
  fillRect(pixels, width, height, 0, height - 4, width, 4, color);
  fillRect(pixels, width, height, 0, 0, 4, height, color);
  fillRect(pixels, width, height, width - 4, 0, 4, height, color);
}

function drawText(
  pixels: Buffer,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgba,
): void {
  let cursor = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[" "];
    drawGlyph(pixels, width, height, glyph, cursor, y, scale, color);
    cursor += (glyph[0].length + 1) * scale;
  }
}

function drawGlyph(
  pixels: Buffer,
  width: number,
  height: number,
  glyph: Glyph,
  x: number,
  y: number,
  scale: number,
  color: Rgba,
): void {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") {
        fillRect(pixels, width, height, x + col * scale, y + row * scale, scale, scale, color);
      }
    }
  }
}

function fillRect(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: Rgba,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + rectWidth);
  const y1 = Math.min(height, y + rectHeight);
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      const offset = (yy * width + xx) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
}

function encodePng(width: number, height: number, rgba: Buffer, timestampIso: string): Buffer {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from(`timestamp\0${timestampIso}`, "utf8")),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

type Rgba = readonly [number, number, number, number];
type Glyph = readonly string[];

const CRC_TABLE = buildCrcTable();

// ── Provider factory ─────────────────────────────────────────────────────────

export type DesktopFrameProviderConfig = {
  provider?: "screen" | "fake";
  ttlMs?: number;
};

export function createDesktopFrameProvider(
  config: DesktopFrameProviderConfig,
  logger?: Logger,
): DesktopFrameProvider {
  const fake = new FakeDesktopFrameProvider({ ttlMs: config.ttlMs });
  if (config.provider !== "screen") {
    return fake;
  }
  return new ScreenDesktopFrameProvider({ ttlMs: config.ttlMs, logger, fallback: fake });
}

const FONT: Record<string, Glyph> = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
  ":": ["0", "1", "0", "0", "0", "1", "0"],
  ".": ["0", "0", "0", "0", "0", "1", "0"],
  "0": ["111", "101", "101", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "010", "010", "111"],
  "2": ["111", "001", "001", "111", "100", "100", "111"],
  "3": ["111", "001", "001", "111", "001", "001", "111"],
  "4": ["101", "101", "101", "111", "001", "001", "001"],
  "5": ["111", "100", "100", "111", "001", "001", "111"],
  "6": ["111", "100", "100", "111", "101", "101", "111"],
  "7": ["111", "001", "001", "010", "010", "010", "010"],
  "8": ["111", "101", "101", "111", "101", "101", "111"],
  "9": ["111", "101", "101", "111", "001", "001", "111"],
  "D": ["110", "101", "101", "101", "101", "101", "110"],
  "E": ["111", "100", "100", "111", "100", "100", "111"],
  "K": ["101", "101", "110", "100", "110", "101", "101"],
  "O": ["111", "101", "101", "101", "101", "101", "111"],
  "P": ["110", "101", "101", "110", "100", "100", "100"],
  "S": ["111", "100", "100", "111", "001", "001", "111"],
  "T": ["111", "010", "010", "010", "010", "010", "010"],
  "Z": ["111", "001", "001", "010", "100", "100", "111"],
};
