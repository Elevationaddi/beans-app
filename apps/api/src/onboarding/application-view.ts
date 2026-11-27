import type { MerchantApplication } from "@beans/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export const applicationInclude = {
  documents: { include: { upload: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.MerchantInclude;

export type MerchantWithDocuments = Prisma.MerchantGetPayload<{
  include: typeof applicationInclude;
}>;

export function toApplicationView(merchant: MerchantWithDocuments): MerchantApplication {
  const contact = (merchant.contact ?? {}) as MerchantApplication["contact"];
  return {
    id: merchant.id,
    legalName: merchant.legalName,
    brandName: merchant.brandName,
    licenseNumber: merchant.licenseNumber,
    contact,
    status: merchant.status,
    reviewNote: merchant.reviewNote,
    submittedAt: merchant.submittedAt?.toISOString() ?? null,
    reviewedAt: merchant.reviewedAt?.toISOString() ?? null,
    documents: merchant.documents.map((doc) => ({
      id: doc.id,
      uploadId: doc.uploadId,
      type: doc.type,
      fileStatus: doc.upload.status,
      reviewStatus: doc.reviewStatus,
      createdAt: doc.createdAt.toISOString(),
    })),
  };
}
