import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { uploadResponseSchema, uploadTicketResponseSchema } from "@beans/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FilesService } from "../src/files/files.service.js";
import { SupabaseObjectStorage } from "../src/files/supabase-storage.js";
import { MerchantWorld } from "./merchant-world.js";

const SERVICE_KEY = "service-role-key-for-tests-only";
const BUCKET = "merchant-documents";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", "latin1");

/**
 * A stand-in for Supabase Storage with the behaviour that matters here: a private bucket that
 * needs the service key, single-use signed upload URLs that never overwrite, and expiring
 * signed download URLs.
 */
function fakeSupabase() {
  const objects = new Map<string, Buffer>();
  const uploadTokens = new Map<string, string>();
  const downloadTokens = new Map<string, string>();
  const buckets = new Map<string, unknown>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      const body = Buffer.concat(chunks);
      const authed = req.headers.apikey === SERVICE_KEY;
      const send = (status: number, json?: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      const match = (prefix: string) =>
        url.pathname.startsWith(prefix)
          ? decodeURIComponent(url.pathname.slice(prefix.length))
          : null;
      let key: string | null;
      if (req.method === "POST" && (key = match(`/storage/v1/object/upload/sign/${BUCKET}/`))) {
        if (!authed) return send(403);
        const token = randomUUID();
        uploadTokens.set(token, key);
        return send(200, { url: `/object/upload/sign/${BUCKET}/${key}?token=${token}` });
      }
      if (req.method === "PUT" && (key = match(`/storage/v1/object/upload/sign/${BUCKET}/`))) {
        if (uploadTokens.get(url.searchParams.get("token") ?? "") !== key) return send(400);
        if (objects.has(key)) return send(400, { error: "Duplicate" });
        objects.set(key, body);
        return send(200, { Key: `${BUCKET}/${key}` });
      }
      if (
        req.method === "GET" &&
        (key = match(`/storage/v1/object/info/authenticated/${BUCKET}/`))
      ) {
        if (!authed) return send(403);
        const object = objects.get(key);
        return object ? send(200, { size: object.length }) : send(404);
      }
      if (req.method === "GET" && (key = match(`/storage/v1/object/authenticated/${BUCKET}/`))) {
        if (!authed) return send(403);
        const object = objects.get(key);
        if (!object) return send(404);
        res.writeHead(200).end(object);
        return;
      }
      if (req.method === "POST" && (key = match(`/storage/v1/object/sign/${BUCKET}/`))) {
        if (!authed) return send(403);
        const token = randomUUID();
        downloadTokens.set(token, key);
        return send(200, { signedURL: `/object/sign/${BUCKET}/${key}?token=${token}` });
      }
      if (req.method === "GET" && (key = match(`/storage/v1/object/sign/${BUCKET}/`))) {
        if (downloadTokens.get(url.searchParams.get("token") ?? "") !== key) return send(400);
        res.writeHead(200).end(objects.get(key));
        return;
      }
      if (req.method === "GET" && match(`/storage/v1/object/public/`) !== null) {
        return send(400, { error: "Bucket not public" });
      }
      if (req.method === "POST" && url.pathname === "/storage/v1/bucket") {
        if (!authed) return send(403);
        const settings = JSON.parse(body.toString()) as { id: string };
        if (buckets.has(settings.id)) return send(409);
        buckets.set(settings.id, settings);
        return send(200, { name: settings.id });
      }
      if (req.method === "PUT" && (key = match(`/storage/v1/bucket/`))) {
        if (!authed) return send(403);
        buckets.set(key, { id: key, ...JSON.parse(body.toString()) });
        return send(200);
      }
      return send(404);
    });
  });
  return { server, objects, buckets };
}

describe("merchant documents in a private Supabase Storage bucket", () => {
  const fake = fakeSupabase();
  let server: Server;
  let base: string;
  let world: MerchantWorld;

  beforeAll(async () => {
    server = fake.server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    world = await MerchantWorld.create({
      STORAGE_DRIVER: "supabase",
      SUPABASE_URL: base,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    });
  });

  afterAll(async () => {
    await world.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function draftOwner() {
    const merchant = await world.prisma.merchant.create({
      data: {
        legalName: `Storage LLC ${randomUUID().slice(0, 6)}`,
        brandName: `Storage ${randomUUID().slice(0, 6)}`,
        licenseNumber: `STO-${randomUUID().slice(0, 12)}`,
        status: "draft",
      },
    });
    const owner = await world.person({ merchantId: merchant.id, role: "owner" });
    return { merchant, owner };
  }

  async function upload(token: string, merchantId: string, bytes: Buffer) {
    const ticket = uploadTicketResponseSchema.parse(
      (
        await world
          .post("/v1/uploads", token, {
            purpose: "merchant_document",
            merchantId,
            documentType: "trade_license",
            mime: "application/pdf",
            size: bytes.length,
          })
          .expect(201)
      ).body,
    ).data;
    return ticket;
  }

  it("uploads straight to the bucket, keeps the file closed until checked, then signs a short link", async () => {
    const { merchant, owner } = await draftOwner();
    const ticket = await upload(owner.token, merchant.id, PDF);
    expect(ticket.uploadUrl.startsWith(`${base}/storage/v1/object/upload/sign/${BUCKET}/`)).toBe(
      true,
    );
    expect(ticket.uploadUrl).toContain(`merchants/${merchant.id}/documents/${ticket.id}`);

    // Before the bytes arrive, completing is refused.
    await world.post(`/v1/uploads/${ticket.id}/complete`, owner.token).expect(409);

    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.headers,
      body: PDF,
    });
    expect(put.status).toBe(200);
    // The signed upload URL cannot replace the file afterwards.
    const again = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.headers,
      body: PDF,
    });
    expect(again.status).toBe(400);

    const completed = uploadResponseSchema.parse(
      (await world.post(`/v1/uploads/${ticket.id}/complete`, owner.token).expect(200)).body,
    ).data;
    expect(completed.status).toBe("quarantined");

    const files = world.app.get(FilesService);
    const row = () => world.prisma.upload.findUniqueOrThrow({ where: { id: ticket.id } });
    // Quarantined: no link for anyone, and the bucket is not public.
    expect(await files.downloadLink(await row())).toBeNull();
    const key = `merchants/${merchant.id}/documents/${ticket.id}`;
    expect((await fetch(`${base}/storage/v1/object/public/${BUCKET}/${key}`)).status).toBe(400);
    expect((await fetch(`${base}/storage/v1/object/authenticated/${BUCKET}/${key}`)).status).toBe(
      403,
    );

    await files.scan(ticket.id);
    const clean = await row();
    expect(clean.status).toBe("clean");
    const link = await files.downloadLink(clean);
    expect(link).toMatch(new RegExp(`^${base}/storage/v1/object/sign/${BUCKET}/`));
    const download = await fetch(link!);
    expect(Buffer.from(await download.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("rejects a file whose size or content does not match what was declared", async () => {
    const { merchant, owner } = await draftOwner();
    const short = await upload(owner.token, merchant.id, PDF);
    await fetch(short.uploadUrl, { method: "PUT", headers: short.headers, body: PDF.subarray(4) });
    const sized = uploadResponseSchema.parse(
      (await world.post(`/v1/uploads/${short.id}/complete`, owner.token).expect(200)).body,
    ).data;
    expect(sized.status).toBe("rejected");

    const fakePdf = Buffer.from("MZ this is not a pdf at all", "latin1");
    const disguised = await upload(owner.token, merchant.id, fakePdf);
    await fetch(disguised.uploadUrl, { method: "PUT", headers: disguised.headers, body: fakePdf });
    await world.post(`/v1/uploads/${disguised.id}/complete`, owner.token).expect(200);
    await world.app.get(FilesService).scan(disguised.id);
    const row = await world.prisma.upload.findUniqueOrThrow({ where: { id: disguised.id } });
    expect(row.status).toBe("rejected");
    expect(await world.app.get(FilesService).downloadLink(row)).toBeNull();
  });

  it("sets the bucket up as private with size and type limits, and is safe to rerun", async () => {
    const storage = new SupabaseObjectStorage(base, SERVICE_KEY, "setup-check");
    await expect(storage.ensureBucket(10 * 1024 * 1024)).resolves.toBe("created");
    await expect(storage.ensureBucket(10 * 1024 * 1024)).resolves.toBe("updated");
    expect(fake.buckets.get("setup-check")).toMatchObject({
      public: false,
      file_size_limit: 10 * 1024 * 1024,
      allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
    });
    await expect(
      new SupabaseObjectStorage(base, "wrong-key-wrong-key-wrong", "x-bucket").ensureBucket(1),
    ).rejects.toThrow(/HTTP 403/);
  });
});
