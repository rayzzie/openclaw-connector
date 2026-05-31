/**
 * Uploads media bytes to object storage and returns a publicly fetchable URL.
 *
 * Kept as an interface so the media-resolution logic is testable with a fake,
 * and so the concrete S3 client (and its dependency) lives only in
 * `s3-uploader.ts`.
 */
export type UploadOptions = {
  contentType?: string;
  /** File extension without the dot, used to build a tidy object key. */
  ext?: string;
};

export interface ObjectUploader {
  upload(body: Uint8Array, opts?: UploadOptions): Promise<string>;
}

/** Random, collision-resistant object key, optionally suffixed with an extension. */
export function buildObjectKey(ext?: string, prefix = "media"): string {
  const rand = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const clean = (ext ?? "").replace(/^\.+/, "").toLowerCase();
  return clean ? `${prefix}/${rand}.${clean}` : `${prefix}/${rand}`;
}
