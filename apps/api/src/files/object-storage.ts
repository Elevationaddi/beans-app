import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FileTokenSigner } from "./signed-token.js";

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export interface UploadLink {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

/** Private object storage. Objects are never public; access is through short-lived links. */
export interface ObjectStorage {
  createUploadLink(input: {
    uploadId: string;
    objectKey: string;
    mime: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<UploadLink>;
  createDownloadLink(input: {
    uploadId: string;
    objectKey: string;
    mime: string;
    expiresAt: Date;
  }): Promise<string>;
  stat(objectKey: string): Promise<{ size: number } | null>;
  read(objectKey: string): Promise<Buffer>;
}

export class PayloadTooLargeError extends Error {}

/**
 * Development storage on the local disk, with links that point back at this API and carry
 * an HMAC token. Refused in production by the config check.
 */
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly publicUrl: string,
    readonly signer: FileTokenSigner,
  ) {
    this.root = resolve(rootDir);
  }

  async createUploadLink(input: {
    uploadId: string;
    objectKey: string;
    mime: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<UploadLink> {
    const token = this.signer.sign({
      action: "put",
      ...this.grantFields(input),
      maxBytes: input.maxBytes,
    });
    return {
      url: `${this.publicUrl}/v1/uploads/${input.uploadId}/content?token=${token}`,
      method: "PUT",
      headers: { "Content-Type": input.mime },
    };
  }

  async createDownloadLink(input: {
    uploadId: string;
    objectKey: string;
    mime: string;
    expiresAt: Date;
  }): Promise<string> {
    const token = this.signer.sign({ action: "get", ...this.grantFields(input), maxBytes: 0 });
    return `${this.publicUrl}/v1/uploads/${input.uploadId}/download?token=${token}`;
  }

  /**
   * Streams at most maxBytes into the object. A larger body is drained and discarded (so the
   * client gets a clean 413 instead of a reset connection) and nothing is stored.
   */
  async write(objectKey: string, body: Readable, maxBytes: number): Promise<number> {
    const target = this.pathFor(objectKey);
    const partial = `${target}.partial`;
    await mkdir(dirname(target), { recursive: true });
    let received = 0;
    const limited = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        // Past the limit: keep reading (drain) but stop passing bytes to the file.
        callback(null, received > maxBytes ? undefined : chunk);
      },
    });
    try {
      await pipeline(body, limited, createWriteStream(partial));
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    if (received > maxBytes) {
      await rm(partial, { force: true });
      throw new PayloadTooLargeError(`more than ${maxBytes} bytes`);
    }
    await rename(partial, target);
    return received;
  }

  async stat(objectKey: string): Promise<{ size: number } | null> {
    try {
      return { size: (await stat(this.pathFor(objectKey))).size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  read(objectKey: string): Promise<Buffer> {
    return readFile(this.pathFor(objectKey));
  }

  private grantFields(input: {
    uploadId: string;
    objectKey: string;
    mime: string;
    expiresAt: Date;
  }) {
    return {
      uploadId: input.uploadId,
      objectKey: input.objectKey,
      mime: input.mime,
      exp: Math.floor(input.expiresAt.getTime() / 1000),
    };
  }

  /** Keys are server-generated, but refuse anything escaping the storage root regardless. */
  private pathFor(objectKey: string): string {
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(this.root + sep)) throw new Error("object key escapes storage root");
    return path;
  }
}
