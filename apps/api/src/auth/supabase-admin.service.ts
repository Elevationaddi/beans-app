import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

export const ACCOUNT_DELETED_TOPIC = "account.deleted";

/** Subjects made by the seed or development sign-in; they have no Supabase account. */
const LOCAL_SUBJECT = /^(seed|dev)-/;

/**
 * Server-only calls to the Supabase Auth admin API, with the service role key. Used to remove
 * the sign-in of an account the person deleted, so the email can no longer sign in to it.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger("SupabaseAdmin");

  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Deletes the Supabase Auth user. Idempotent: an already-deleted user (404) counts as done.
   * Throws on any other failure so the outbox retries it.
   */
  async deleteAuthUser(subject: string): Promise<"deleted" | "skipped"> {
    if (LOCAL_SUBJECT.test(subject)) return "skipped";
    const url = this.env.SUPABASE_URL;
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      if (this.env.NODE_ENV === "production") {
        throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to delete sign-ins");
      }
      this.logger.warn("Supabase admin is not configured; sign-in deletion skipped (development)");
      return "skipped";
    }
    const response = await fetch(
      `${url.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(subject)}`,
      { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } },
    );
    if (response.ok || response.status === 404) return "deleted";
    throw new Error(`Supabase admin delete failed: HTTP ${response.status}`);
  }
}
