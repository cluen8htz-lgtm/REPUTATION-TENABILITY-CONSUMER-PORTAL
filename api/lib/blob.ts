/**
 * blob.ts — storage abstraction for private client files.
 *
 * Every driver stores raw bytes under an opaque key. Files are NEVER served by
 * public URL: downloads stream through /api/files/*, which re-checks ownership
 * on every request (see api/files-route.ts). Drivers:
 *   - local: filesystem under STORAGE_DIR (default for development)
 *   - s3:    any S3-compatible bucket (AWS, R2, MinIO) via S3_BUCKET
 *   - kimi:  the original platform object storage (api/lib/storage.ts)
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "./env";

export interface BlobDriver {
  readonly name: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

const SAFE_SEGMENT = /[^\p{L}\p{N}._-]/gu;

/** Build a collision-proof key: `<prefix>/<yyyymm>/<random>-<sanitized name>`. */
export function makeKey(prefix: string, fileName: string): string {
  const base = path.basename(fileName).replace(SAFE_SEGMENT, "_").slice(-120) || "file";
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  return `${prefix.replace(/[^a-z0-9/_-]/gi, "_")}/${month}/${randomBytes(8).toString("hex")}-${base}`;
}

function assertKey(key: string) {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\") || key.includes("//")) {
    throw new Error("Invalid storage key");
  }
}

class LocalDriver implements BlobDriver {
  readonly name = "local";
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  private resolve(key: string) {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, bytes: Uint8Array) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return { key, size: bytes.byteLength };
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.resolve(key)));
  }
  async remove(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

class S3Driver implements BlobDriver {
  readonly name = "s3";
  private clientPromise: Promise<typeof import("@aws-sdk/client-s3") & { client: InstanceType<typeof import("@aws-sdk/client-s3").S3Client> }> | undefined;
  private load() {
    this.clientPromise ??= import("@aws-sdk/client-s3").then((mod) => ({
      ...mod,
      client: new mod.S3Client({
        region: env.s3Region,
        endpoint: env.s3Endpoint || undefined,
        forcePathStyle: Boolean(env.s3Endpoint),
      }),
    }));
    return this.clientPromise;
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    assertKey(key);
    const s3 = await this.load();
    await s3.client.send(new s3.PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: bytes, ContentType: contentType, ServerSideEncryption: env.s3Endpoint ? undefined : "AES256" }));
    return { key, size: bytes.byteLength };
  }
  async get(key: string) {
    const s3 = await this.load();
    const out = await s3.client.send(new s3.GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return new Uint8Array(await out.Body!.transformToByteArray());
  }
  async remove(key: string) {
    const s3 = await this.load();
    await s3.client.send(new s3.DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
  }
}

class KimiDriver implements BlobDriver {
  readonly name = "kimi";
  private async sdk() {
    return (await import("./storage")).storage;
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const saved = await (await this.sdk()).uploadFile({ fileContent: bytes, fileName: key, contentType });
    return { key: saved.key, size: saved.size };
  }
  async get(key: string) {
    return (await this.sdk()).readFile({ fileKey: key });
  }
  async remove(key: string) {
    await (await this.sdk()).deleteFile({ fileKey: key });
  }
}

function pickDriver(): BlobDriver {
  const requested = env.storageDriver || (env.s3Bucket ? "s3" : process.env.KIMI_AGENTGW_API_KEY ? "kimi" : "local");
  if (requested === "s3") return new S3Driver();
  if (requested === "kimi") return new KimiDriver();
  return new LocalDriver(path.resolve(env.storageDir));
}

let driver: BlobDriver | undefined;
export function blob(): BlobDriver {
  driver ??= pickDriver();
  return driver;
}

/** Test hook: swap the driver (e.g. an in-memory map). */
export function setBlobDriver(next: BlobDriver) {
  driver = next;
}

export class MemoryDriver implements BlobDriver {
  readonly name = "memory";
  readonly files = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    this.files.set(key, bytes);
    return { key, size: bytes.byteLength };
  }
  async get(key: string) {
    const value = this.files.get(key);
    if (!value) throw new Error("not found");
    return value;
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}

/** Decode a base64 upload and enforce the size ceiling. */
export function decodeUpload(contentBase64: string, maxBytes = 15_000_000): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(contentBase64, "base64"));
  if (bytes.byteLength === 0) throw new Error("Empty file");
  if (bytes.byteLength > maxBytes) throw new Error(`Files must be smaller than ${Math.round(maxBytes / 1_000_000)} MB.`);
  return bytes;
}

/** Sniff the real content type from magic bytes; never trust the browser alone. */
export function sniffContentType(bytes: Uint8Array, claimed?: string): string {
  const head = Buffer.from(bytes.subarray(0, 12));
  if (head.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (head[0] === 0x89 && head.subarray(1, 4).toString() === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (head.subarray(0, 3).toString() === "GIF") return "image/gif";
  if (head[0] === 0x50 && head[1] === 0x4b) return claimed && claimed.includes("officedocument") ? claimed : "application/zip";
  if (claimed && /^text\//.test(claimed)) return claimed;
  // Mostly printable → plain text
  const sample = bytes.subarray(0, 2048);
  let printable = 0;
  for (const byte of sample) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 128) printable++;
  if (sample.length && printable / sample.length > 0.95) return "text/plain";
  return claimed || "application/octet-stream";
}
