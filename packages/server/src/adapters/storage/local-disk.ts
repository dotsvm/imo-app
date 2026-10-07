/**
 * Uploads on local disk, served by the API itself: for development and
 * self-hosting. The browser PUTs to a signed URL (an HMAC over key, type,
 * size limit and expiry); reads come back through GET /api/v1/uploads/….
 * Each object keeps a small sidecar with its type and size.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  safeStorageKey,
  type ObjectStorage,
  type StoredObject,
  type UploadTicket,
} from "@imo/core/ports/platform";
import type { Clock } from "@imo/core/ports/runtime";

const TICKET_MS = 10 * 60_000;

export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;
  constructor(
    root: string,
    private readonly secret: string,
    private readonly clock: Clock,
    private readonly base = "/api/v1/uploads",
  ) {
    this.root = resolve(root);
  }

  private path(key: string) {
    if (!safeStorageKey(key)) throw new RangeError(`Unsafe storage key: ${key}`);
    const file = join(this.root, key);
    if (!file.startsWith(this.root + "/")) throw new RangeError(`Unsafe storage key: ${key}`);
    return file;
  }

  private mac(key: string, contentType: string, maxBytes: number, expires: number) {
    return createHmac("sha256", this.secret)
      .update(`upload.${key}.${contentType}.${maxBytes}.${expires}`)
      .digest("base64url");
  }

  async signUpload(key: string, options: { contentType: string; maxBytes: number }): Promise<UploadTicket> {
    this.path(key);
    const expires = this.clock.now().getTime() + TICKET_MS;
    const token = `${expires}.${options.maxBytes}.${this.mac(key, options.contentType, options.maxBytes, expires)}`;
    return {
      url: `${this.base}/${key}?token=${token}`,
      fields: { method: "PUT", "content-type": options.contentType },
      expiresAt: new Date(expires).toISOString(),
    };
  }

  publicUrl(key: string) {
    return `${this.base}/${key}`;
  }

  async stat(key: string): Promise<StoredObject | null> {
    try {
      return JSON.parse(await readFile(`${this.path(key)}.meta.json`, "utf8")) as StoredObject;
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    const file = this.path(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  serve = {
    accept: async (key: string, token: string, contentType: string, body: ReadableStream<Uint8Array>) => {
      const file = this.path(key);
      const [expires, maxBytes, mac] = token.split(".");
      const expected = Buffer.from(this.mac(key, contentType, Number(maxBytes), Number(expires)));
      const given = Buffer.from(mac ?? "");
      if (
        expected.length !== given.length ||
        !timingSafeEqual(expected, given) ||
        Number(expires) < this.clock.now().getTime()
      )
        throw new RangeError("Upload ticket is invalid or expired");
      await mkdir(dirname(file), { recursive: true });
      const partial = `${file}.${randomUUID()}.part`;
      let bytes = 0;
      const limit = Number(maxBytes);
      try {
        await new Promise<void>((done, fail) => {
          const out = createWriteStream(partial);
          const input = Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>);
          input.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > limit) input.destroy(new RangeError(`Upload exceeds ${limit} bytes`));
          });
          input.on("error", fail);
          out.on("error", fail);
          out.on("finish", () => done());
          input.pipe(out);
        });
        if (bytes === 0) throw new RangeError("Upload is empty");
        await rename(partial, file);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
      const stored = { contentType, bytes };
      await writeFile(`${file}.meta.json`, JSON.stringify(stored));
      return stored;
    },
    open: async (key: string) => {
      const meta = await this.stat(key);
      if (!meta) return null;
      const stream = Readable.toWeb(createReadStream(this.path(key))) as unknown as ReadableStream<Uint8Array>;
      return { ...meta, body: stream };
    },
  };
}
