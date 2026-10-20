import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export interface BlobStore {
  readonly description: string;
  put(key: string, bytes: Buffer, contentType: string, options?: { retainUntil?: Date }): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class LocalBlobStore implements BlobStore {
  readonly description: string;

  constructor(private readonly root: string) {
    this.description = `local disk (${root})`;
  }

  private pathFor(key: string): string {
    const path = normalize(join(this.root, key));
    if (!path.startsWith(normalize(this.root))) throw new Error(`Invalid blob key ${key}`);
    return path;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/**
 * S3 evidence storage. With S3_OBJECT_LOCK_MODE set (bucket must have Object
 * Lock enabled), originals are WORM-protected until their retention date.
 */
export class S3BlobStore implements BlobStore {
  readonly description: string;
  private readonly s3: S3Client;

  constructor(
    region: string,
    private readonly bucket: string,
    private readonly lockMode: "off" | "GOVERNANCE" | "COMPLIANCE",
  ) {
    this.s3 = new S3Client({ region });
    this.description = `Amazon S3 (s3://${bucket}${lockMode === "off" ? "" : `, Object Lock ${lockMode}`})`;
  }

  async put(key: string, bytes: Buffer, contentType: string, options?: { retainUntil?: Date }): Promise<void> {
    const lock =
      this.lockMode !== "off" && options?.retainUntil
        ? { ObjectLockMode: this.lockMode, ObjectLockRetainUntilDate: options.retainUntil }
        : {};
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType, ServerSideEncryption: "AES256", ...lock }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return response.Body ? Buffer.from(await response.Body.transformToByteArray()) : null;
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
