/**
 * Supabase Storage: signed upload URLs straight from the browser, public
 * reads from the bucket's CDN URL. The bucket should be public, with a file
 * size limit and allowed image types set on it (scripts/setup-supabase.ts).
 */
import type { ObjectStorage, StoredObject, UploadTicket } from "@imo/core/ports/platform";
import { safeStorageKey } from "@imo/core/ports/platform";
import { HttpError, type HttpClient } from "@imo/core/ports/runtime";

export class SupabaseStorage implements ObjectStorage {
  private readonly api: string;
  constructor(
    private readonly http: HttpClient,
    url: string,
    private readonly secretKey: string,
    private readonly bucket: string,
  ) {
    this.api = `${url.replace(/\/+$/, "")}/storage/v1`;
  }

  private headers() {
    return { apikey: this.secretKey };
  }

  async signUpload(key: string, options: { contentType: string; maxBytes: number }): Promise<UploadTicket> {
    if (!safeStorageKey(key)) throw new RangeError(`Unsafe storage key: ${key}`);
    const signed = (await this.http.json(`${this.api}/object/upload/sign/${this.bucket}/${key}`, {
      method: "POST",
      headers: this.headers(),
      body: {},
      timeoutMs: 10_000,
    })) as { url?: string };
    if (!signed?.url) throw new Error("Storage didn't return an upload URL");
    return {
      url: `${this.api}${signed.url}`,
      fields: { method: "PUT", "content-type": options.contentType },
      // Supabase signed upload URLs last two hours.
      expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    };
  }

  publicUrl(key: string) {
    return `${this.api}/object/public/${this.bucket}/${key}`;
  }

  async stat(key: string): Promise<StoredObject | null> {
    try {
      const info = (await this.http.json(`${this.api}/object/info/${this.bucket}/${key}`, {
        headers: this.headers(),
        timeoutMs: 10_000,
      })) as {
        size?: number;
        content_type?: string;
        metadata?: { size?: number; mimetype?: string; contentLength?: number };
      };
      const bytes = info?.metadata?.size ?? info?.metadata?.contentLength ?? info?.size;
      const contentType = info?.metadata?.mimetype ?? info?.content_type;
      return typeof bytes === "number" && contentType ? { bytes, contentType } : null;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }
  }

  async delete(key: string) {
    await this.http.json(`${this.api}/object/${this.bucket}`, {
      method: "DELETE",
      headers: this.headers(),
      body: { prefixes: [key] },
      timeoutMs: 10_000,
      idempotent: true,
    });
  }
}
