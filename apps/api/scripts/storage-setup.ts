/**
 * Creates (or corrects) the private Supabase Storage bucket for merchant documents.
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET from the
 * environment and prints no secret. Run once per Supabase project:
 *   pnpm --filter @beans/api storage:setup
 */
import { MAX_DOCUMENT_BYTES } from "@beans/contracts";
import { SupabaseObjectStorage } from "../src/files/supabase-storage.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "merchant-documents";
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const result = await new SupabaseObjectStorage(url, key, bucket).ensureBucket(MAX_DOCUMENT_BYTES);
console.log(
  `Bucket "${bucket}" ${result}: private, ${MAX_DOCUMENT_BYTES} bytes max, PDF/PNG/JPEG only.`,
);
