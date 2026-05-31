import { detectMediaKind, type MediaKind } from "./outbound-reply-payload.js";
import { buildObjectKey, type ObjectUploader } from "./object-uploader.js";

export type MediaRefClass = "remote" | "data" | "local";

/** http(s) → remote (passthrough); data: → inline bytes; anything else → a local path. */
export function classifyMediaRef(ref: string): MediaRefClass {
  if (/^https?:\/\//i.test(ref)) {
    return "remote";
  }
  if (/^data:/i.test(ref)) {
    return "data";
  }
  return "local";
}

export type ResolveMediaDeps = {
  uploader?: ObjectUploader;
  /** Reads a local file into bytes. Defaults to node:fs/promises readFile. */
  readFile?: (path: string) => Promise<Uint8Array>;
};

export type ResolvedMedia = { url: string; kind: MediaKind };

/**
 * Turn an OpenClaw outbound media reference into a publicly fetchable URL plus
 * its media kind. Remote URLs pass through untouched; local files and data:
 * URLs are uploaded to object storage (URL-only ever leaves this connector —
 * the gateway never receives bytes). Returns null when an upload is needed but
 * no uploader is configured.
 */
export async function resolveMediaRefToUrl(
  ref: string,
  deps: ResolveMediaDeps,
): Promise<ResolvedMedia | null> {
  const cls = classifyMediaRef(ref);

  if (cls === "remote") {
    return { url: ref, kind: detectMediaKind(ref) };
  }

  if (!deps.uploader) {
    return null;
  }

  if (cls === "data") {
    const parsed = parseDataUrl(ref);
    if (!parsed) {
      return null;
    }
    const ext = extFromContentType(parsed.contentType);
    const url = await deps.uploader.upload(parsed.bytes, {
      contentType: parsed.contentType,
      ext,
    });
    return { url, kind: mediaKindFromContentType(parsed.contentType) };
  }

  // local
  const path = ref.replace(/^file:\/\//i, "");
  const readFile = deps.readFile ?? defaultReadFile;
  const bytes = await readFile(path);
  const ext = extensionOf(path);
  const url = await deps.uploader.upload(bytes, {
    contentType: contentTypeFromExt(ext),
    ext,
  });
  return { url, kind: detectMediaKind(path) };
}

async function defaultReadFile(path: string): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(path));
}

function parseDataUrl(ref: string): { contentType: string; bytes: Uint8Array } | null {
  // data:[<mediatype>][;base64],<data>
  const comma = ref.indexOf(",");
  if (comma < 0) {
    return null;
  }
  const meta = ref.slice(5, comma); // strip "data:"
  const data = ref.slice(comma + 1);
  const isBase64 = /;base64/i.test(meta);
  const contentType = meta.split(";", 1)[0] || "application/octet-stream";
  const bytes = isBase64
    ? new Uint8Array(Buffer.from(data, "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(data), "utf8"));
  return { contentType, bytes };
}

function extensionOf(path: string): string {
  const segment = path.split(/[?#]/, 1)[0]?.split("/").pop() ?? "";
  const dot = segment.lastIndexOf(".");
  return dot > 0 && dot < segment.length - 1 ? segment.slice(dot + 1).toLowerCase() : "";
}

function mediaKindFromContentType(mime: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith("audio/")) {
    return "audio";
  }
  if (m.startsWith("video/")) {
    return "video";
  }
  return "image";
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function extFromContentType(mime: string): string | undefined {
  return EXT_BY_MIME[mime.toLowerCase()];
}

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);

function contentTypeFromExt(ext: string): string | undefined {
  return MIME_BY_EXT[ext];
}

// re-export so callers can build keys without importing object-uploader directly
export { buildObjectKey };
