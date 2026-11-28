import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { CreateUploadRequest, UploadView } from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/api-error.js";
import type { Actor } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Upload } from "../generated/prisma/client.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";
import { DisabledFileScanner, FILE_SCANNER, type FileScanner } from "./file-scanner.js";
import {
  LocalObjectStorage,
  OBJECT_STORAGE,
  type ObjectStorage,
  PayloadTooLargeError,
} from "./object-storage.js";

const UPLOAD_LINK_TTL_MS = 15 * 60 * 1000;
const DOWNLOAD_LINK_TTL_MS = 5 * 60 * 1000;
const MAX_DOCUMENTS_PER_MERCHANT = 20;
export const FILE_SCAN_TOPIC = "file.scan_requested";

export function toUploadView(upload: Upload): UploadView {
  return {
    id: upload.id,
    status: upload.status,
    mime: upload.mime as UploadView["mime"],
    size: upload.actualSize ?? upload.declaredSize,
    rejectionReason: upload.status === "rejected" ? upload.scanResult : null,
  };
}

/**
 * Upload lifecycle: ticket (pending) → bytes received → complete (quarantined) → checked
 * (clean or rejected). Only clean files ever get download links.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(FILE_SCANNER) private readonly scanner: FileScanner,
  ) {}

  /** False while no malware scanner is approved: applications carry no attachments. */
  get documentsAccepted(): boolean {
    return !(this.scanner instanceof DisabledFileScanner);
  }

  async createMerchantDocumentUpload(actor: Actor, input: CreateUploadRequest) {
    const merchant = await this.access.requireOwner(actor.userId, input.merchantId);
    if (this.scanner instanceof DisabledFileScanner) {
      // No malware scanner approved yet: refuse before any bytes are accepted (docs/27 L1).
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        "FEATURE_DISABLED",
        "Document uploads are not available yet. Please contact the platform team.",
      );
    }
    if (merchant.status !== "draft") {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "INVALID_TRANSITION",
        "Documents can only be added while the application is a draft",
      );
    }
    const existing = await this.prisma.merchantDocument.count({
      where: { merchantId: merchant.id },
    });
    if (existing >= MAX_DOCUMENTS_PER_MERCHANT) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "CONFLICT",
        `An application can hold at most ${MAX_DOCUMENTS_PER_MERCHANT} documents`,
      );
    }

    const id = randomUUID();
    const objectKey = `merchants/${merchant.id}/documents/${id}`;
    const expiresAt = new Date(Date.now() + UPLOAD_LINK_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.upload.create({
        data: {
          id,
          ownerId: actor.userId,
          merchantId: merchant.id,
          purpose: "merchant_document",
          objectKey,
          mime: input.mime,
          declaredSize: input.size,
          expiresAt,
        },
      });
      await tx.merchantDocument.create({
        data: { merchantId: merchant.id, uploadId: id, type: input.documentType, objectKey },
      });
    });
    const link = await this.storage.createUploadLink({
      uploadId: id,
      objectKey,
      mime: input.mime,
      maxBytes: input.size,
      expiresAt,
    });
    return {
      id,
      uploadUrl: link.url,
      method: link.method,
      headers: link.headers,
      maxBytes: input.size,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Local storage only: accept bytes for a signed upload link. */
  async receiveContent(
    uploadId: string,
    token: string,
    contentType: string | undefined,
    contentLength: string | undefined,
    body: Readable,
  ): Promise<UploadView> {
    if (!(this.storage instanceof LocalObjectStorage)) throw ApiError.notFound();
    const grant = this.storage.signer.verify(token, "put", uploadId);
    if (!grant) throw ApiError.forbidden("This upload link is invalid or has expired");
    if ((contentType ?? "").split(";")[0]?.trim().toLowerCase() !== grant.mime) {
      throw ApiError.validation({ "Content-Type": [`Expected ${grant.mime}`] });
    }
    const upload = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.objectKey !== grant.objectKey) throw ApiError.notFound();
    if (upload.status !== "pending") {
      throw new ApiError(HttpStatus.CONFLICT, "CONFLICT", "This upload has already been completed");
    }
    const declaredLength = Number(contentLength ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > grant.maxBytes) {
      throw new ApiError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "BAD_REQUEST",
        `The file is larger than the ${grant.maxBytes} bytes declared`,
      );
    }
    try {
      await this.storage.write(upload.objectKey, body, grant.maxBytes);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        throw new ApiError(
          HttpStatus.PAYLOAD_TOO_LARGE,
          "BAD_REQUEST",
          `The file is larger than the ${grant.maxBytes} bytes declared`,
        );
      }
      throw error;
    }
    return toUploadView(upload);
  }

  async complete(actor: Actor, uploadId: string): Promise<UploadView> {
    const upload = await this.prisma.upload.findFirst({
      where: { id: uploadId, ownerId: actor.userId },
    });
    if (!upload) throw ApiError.notFound("Upload not found");
    if (upload.status !== "pending") return toUploadView(upload);
    if (upload.expiresAt < new Date()) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "CONFLICT",
        "This upload link has expired; request a new one",
      );
    }
    const object = await this.storage.stat(upload.objectKey);
    if (!object)
      throw new ApiError(HttpStatus.CONFLICT, "CONFLICT", "The file has not been received yet");
    if (object.size !== upload.declaredSize) {
      const rejected = await this.prisma.upload.update({
        where: { id: upload.id },
        data: {
          status: "rejected",
          actualSize: object.size,
          scanResult: "File size does not match the declared size",
        },
      });
      return toUploadView(rejected);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.upload.updateMany({
        where: { id: upload.id, status: "pending" },
        data: { status: "quarantined", actualSize: object.size },
      });
      if (changed.count === 1) {
        await this.outbox.enqueue(tx, {
          topic: FILE_SCAN_TOPIC,
          aggregateId: upload.id,
          dedupeKey: `${FILE_SCAN_TOPIC}:${upload.id}`,
          payload: { uploadId: upload.id },
        });
      }
      return tx.upload.findUniqueOrThrow({ where: { id: upload.id } });
    });
    return toUploadView(updated);
  }

  /** Runs the file check for a quarantined upload. Safe to call more than once. */
  async scan(uploadId: string): Promise<void> {
    const upload = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.status !== "quarantined") return;
    const bytes = await this.storage.read(upload.objectKey);
    const verdict = await this.scanner.scan(bytes, upload.mime);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.upload.updateMany({
        where: { id: upload.id, status: "quarantined" },
        data: verdict.clean
          ? { status: "clean", sha256, scanResult: null }
          : { status: "rejected", sha256, scanResult: verdict.reason },
      });
      if (changed.count === 1) {
        await this.audit.record(
          {
            actorId: null,
            action: verdict.clean ? "file.scan_passed" : "file.scan_rejected",
            targetType: "upload",
            targetId: upload.id,
            requestId: `scan:${upload.id}`,
            after: {
              merchantId: upload.merchantId,
              mime: upload.mime,
              size: bytes.length,
              sha256,
              ...(verdict.clean ? {} : { reason: verdict.reason }),
            },
          },
          tx,
        );
      }
    });
    if (!verdict.clean) this.logger.warn(`Upload ${upload.id} rejected: ${verdict.reason}`);
  }

  /** A short-lived download link for a clean file; null for anything else. */
  async downloadLink(upload: Upload): Promise<string | null> {
    if (upload.status !== "clean") return null;
    return this.storage.createDownloadLink({
      uploadId: upload.id,
      objectKey: upload.objectKey,
      mime: upload.mime,
      expiresAt: new Date(Date.now() + DOWNLOAD_LINK_TTL_MS),
    });
  }

  /** Local storage only: serve a clean file for a signed download link. */
  async readForDownload(uploadId: string, token: string): Promise<{ bytes: Buffer; mime: string }> {
    if (!(this.storage instanceof LocalObjectStorage)) throw ApiError.notFound();
    const grant = this.storage.signer.verify(token, "get", uploadId);
    if (!grant) throw ApiError.forbidden("This download link is invalid or has expired");
    const upload = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.objectKey !== grant.objectKey || upload.status !== "clean")
      throw ApiError.notFound();
    return { bytes: await this.storage.read(upload.objectKey), mime: upload.mime };
  }
}
