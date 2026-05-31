import { buildObjectKey, type ObjectUploader, type UploadOptions } from "./object-uploader.js";

/**
 * Config for an S3-compatible object store (here: 联通云 OSS / China Unicom
 * Cloud, `cucloud.cn`). Mirrors the botocore config in `ltoss/upload_md.py`:
 * path-style addressing, s3v4 signing, plain-HTTP endpoint, AK/SK + optional STS
 * token. The bucket is public-read, so the returned URL is directly fetchable
 * by the gateway with no credentials.
 */
export type S3UploaderConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Override the public read base entirely (e.g. a CDN). Wins over urlStyle. */
  publicBaseUrl?: string;
  /**
   * Public-read URL layout. "path" → `${endpoint}/${bucket}/${key}` (generic
   * S3/MinIO default); "virtual" → `${scheme}://${bucket}.${host}/${key}`
   * (联通云 OSS serves public read on the virtual-hosted domain).
   */
  urlStyle?: "path" | "virtual";
  /** Object key prefix (default "media"). */
  keyPrefix?: string;
};

export type PutObjectParams = {
  Bucket: string;
  Key: string;
  Body: Uint8Array;
  ContentType?: string;
};

export type PutObjectFn = (params: PutObjectParams) => Promise<void>;

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");
const stripLeadingSlash = (s: string): string => s.replace(/^\/+/, "");

/** Public read URL for an object key (path-style by default). */
export function publicUrlFor(config: S3UploaderConfig, key: string): string {
  const k = stripLeadingSlash(key);
  if (config.publicBaseUrl) {
    return `${stripTrailingSlash(config.publicBaseUrl)}/${k}`;
  }
  if (config.urlStyle === "virtual") {
    const ep = stripTrailingSlash(config.endpoint);
    const sep = ep.indexOf("://");
    const scheme = sep >= 0 ? ep.slice(0, sep) : "http";
    const host = sep >= 0 ? ep.slice(sep + 3) : ep;
    return `${scheme}://${config.bucket}.${host}/${k}`;
  }
  return `${stripTrailingSlash(config.endpoint)}/${config.bucket}/${k}`;
}

/**
 * Build an uploader. `putObject` is injectable for testing; by default it
 * lazily constructs an `@aws-sdk/client-s3` client configured for the
 * S3-compatible endpoint (path-style, custom endpoint, optional STS token).
 */
export function createS3Uploader(config: S3UploaderConfig, putObject?: PutObjectFn): ObjectUploader {
  const put = putObject ?? defaultPutObject(config);
  return {
    async upload(body: Uint8Array, opts?: UploadOptions): Promise<string> {
      const key = buildObjectKey(opts?.ext, config.keyPrefix ?? "media");
      await put({ Bucket: config.bucket, Key: key, Body: body, ContentType: opts?.contentType });
      return publicUrlFor(config, key);
    },
  };
}

function defaultPutObject(config: S3UploaderConfig): PutObjectFn {
  let clientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | undefined;

  async function getClient() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
    });
  }

  return async (params: PutObjectParams) => {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    clientPromise ??= getClient();
    const client = await clientPromise;
    await client.send(new PutObjectCommand(params));
  };
}
