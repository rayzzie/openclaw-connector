/**
 * OpenClaw's buffered block dispatcher delivers replies as `OutboundReplyPayload`
 * blocks. Beyond streamed text, a block may reference rich media by URL
 * (`mediaUrls`, plus a legacy single `mediaUrl`). We only ever pass URL
 * references downstream — the gateway streams them and never stores bytes.
 *
 * The real `openclaw` package ships `resolveOutboundMediaUrls` /
 * `hasOutboundMedia` from `openclaw/plugin-sdk/reply-payload`, but this
 * connector keeps `openclaw` as an optional, type-only peer dependency. To stay
 * buildable and testable without it installed, we mirror that contract here.
 */

export type OutboundReplyPayload = {
  text?: string;
  mediaUrls?: string[];
  mediaUrl?: string;
  replyToId?: string;
};

export type MediaKind = "image" | "audio" | "video";

/**
 * Merge `mediaUrls` with the legacy single `mediaUrl`, dropping empty /
 * non-string entries and de-duplicating while preserving first-seen order.
 */
export function resolveOutboundMediaUrls(payload: OutboundReplyPayload): string[] {
  const candidates: unknown[] = [];
  if (Array.isArray(payload.mediaUrls)) {
    candidates.push(...payload.mediaUrls);
  }
  if (payload.mediaUrl !== undefined) {
    candidates.push(payload.mediaUrl);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const url = candidate.trim();
    if (url.length === 0 || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function hasOutboundMedia(payload: OutboundReplyPayload): boolean {
  return resolveOutboundMediaUrls(payload).length > 0;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v"]);

/**
 * Best-effort media kind from the URL extension. Query strings and fragments
 * are ignored. Unknown extensions default to `image` — the most conservative
 * downlink (occupies only the video surface, does not gate TTS, persists until
 * a keyword interrupt); if decode fails the gateway reverts on its own.
 */
export function detectMediaKind(url: string): MediaKind {
  const ext = extensionOf(url);
  if (AUDIO_EXT.has(ext)) {
    return "audio";
  }
  if (VIDEO_EXT.has(ext)) {
    return "video";
  }
  if (IMAGE_EXT.has(ext)) {
    return "image";
  }
  return "image";
}

function extensionOf(url: string): string {
  // Strip query / fragment, then take the last path segment's extension.
  const path = url.split(/[?#]/, 1)[0] ?? "";
  const segment = path.split("/").pop() ?? "";
  const dot = segment.lastIndexOf(".");
  if (dot <= 0 || dot === segment.length - 1) {
    return "";
  }
  return segment.slice(dot + 1).toLowerCase();
}
