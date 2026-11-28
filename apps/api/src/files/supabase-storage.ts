import { documentMimeSchema } from "@beans/contracts";
import type { ObjectStorage, UploadLink } from "./object-storage.js";

/** Types the bucket accepts: the same list the upload request schema allows. */
export const DOCUMENT_MIME_TYPES: string[] = documentMimeSchema.options;

/**
 * Supabase Storage (Free plan) with one PRIVATE bucket. Nothing in it is public: the browser
 * uploads straight to Supabase with a one-time signed upload URL (so files never pass through
 * a Vercel function and its 4.5 MB body limit), and reading needs either the server-only service
 * role key or a short-lived signed download URL, which the API hands out only for files that
 * passed the file check. Size and type are enforced three times: the upload request schema, the
 * bucket's own limits, and the size and signature checks when the upload completes.
 */
export class SupabaseObjectStorage implements ObjectStorage {
  private readonly base: string;

  constructor(
    supabaseUrl: string,
    private readonly serviceKey: string,
    readonly bucket: string,
  ) {
    this.base = `${supabaseUrl.replace(/\/$/, "")}/storage/v1`;
  }

  async createUploadLink(input: { objectKey: string; mime: string }): Promise<UploadLink> {
    // Signed upload URLs are single-path and expire after two hours on Supabase's side; the
    // API's own 15-minute window is enforced when the upload completes.
    const { url } = await this.json<{ url: string }>(
      "POST",
      `/object/upload/sign/${this.bucket}/${this.path(input.objectKey)}`,
      {},
    );
    return { url: `${this.base}${url}`, method: "PUT", headers: { "Content-Type": input.mime } };
  }

  async createDownloadLink(input: { objectKey: string; expiresAt: Date }): Promise<string> {
    const expiresIn = Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000));
    const { signedURL } = await this.json<{ signedURL: string }>(
      "POST",
      `/object/sign/${this.bucket}/${this.path(input.objectKey)}`,
      { expiresIn },
    );
    return `${this.base}${signedURL}`;
  }

  async stat(objectKey: string): Promise<{ size: number } | null> {
    const response = await this.request(
      "GET",
      `/object/info/authenticated/${this.bucket}/${this.path(objectKey)}`,
    );
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) throw new Error(`Supabase Storage info failed: HTTP ${response.status}`);
    const info = (await response.json()) as { size?: unknown; metadata?: { size?: unknown } };
    const size = Number(info.size ?? info.metadata?.size);
    if (!Number.isFinite(size)) throw new Error("Supabase Storage info has no size");
    return { size };
  }

  async read(objectKey: string): Promise<Buffer> {
    const response = await this.request(
      "GET",
      `/object/authenticated/${this.bucket}/${this.path(objectKey)}`,
    );
    if (!response.ok) throw new Error(`Supabase Storage read failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Creates the bucket as private with size and type limits, or brings an existing one back to
   * those settings. Safe to run more than once (`pnpm --filter @beans/api storage:setup`).
   */
  async ensureBucket(maxBytes: number): Promise<"created" | "updated"> {
    const settings = {
      public: false,
      file_size_limit: maxBytes,
      allowed_mime_types: DOCUMENT_MIME_TYPES,
    };
    const created = await this.request("POST", "/bucket", {
      id: this.bucket,
      name: this.bucket,
      ...settings,
    });
    if (created.ok) return "created";
    const updated = await this.request("PUT", `/bucket/${this.bucket}`, settings);
    if (!updated.ok)
      throw new Error(`Supabase Storage bucket setup failed: HTTP ${updated.status}`);
    return "updated";
  }

  /** Keys are server-generated UUID paths; encode each segment anyway. */
  private path(objectKey: string): string {
    if (objectKey.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new Error("invalid object key");
    }
    return objectKey.split("/").map(encodeURIComponent).join("/");
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method,
      headers: {
        apikey: this.serviceKey,
        authorization: `Bearer ${this.serviceKey}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  private async json<T>(method: string, path: string, body: unknown): Promise<T> {
    const response = await this.request(method, path, body);
    if (!response.ok)
      throw new Error(`Supabase Storage ${path.split("/")[1]} failed: HTTP ${response.status}`);
    return (await response.json()) as T;
  }
}
