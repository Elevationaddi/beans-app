import type { MerchantApplication } from "@beans/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export const applicationInclude = {
  documents: { include: { upload: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.MerchantInclude;

export type MerchantWithDocuments = Prisma.MerchantGetPayload<{
  include: typeof applicationInclude;
}>;

/** A DATE column as YYYY-MM-DD (stored at UTC midnight). */
export function toLocalDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** YYYY-MM-DD to the Date Prisma writes into a DATE column. */
export function fromLocalDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Fields a business must complete before it can submit (cycle 4 manual verification). */
export function missingForSubmission(merchant: MerchantWithDocuments): Record<string, string[]> {
  const missing: Record<string, string[]> = {};
  const required = "Required before submitting";
  if (!merchant.licenseAuthority) missing["licenseAuthority"] = [required];
  if (!merchant.licenseExpiresOn) missing["licenseExpiresOn"] = [required];
  if (!merchant.emirate) missing["emirate"] = [required];
  if (!merchant.declaredBranchCount) missing["declaredBranchCount"] = [required];
  const rep = (merchant.representative ?? {}) as Record<string, unknown>;
  if (!rep["name"] || !rep["position"] || !rep["email"] || !rep["phone"]) {
    missing["representative"] = [required];
  }
  return missing;
}

export function toApplicationView(
  merchant: MerchantWithDocuments,
  documentsAccepted: boolean,
): MerchantApplication {
  const contact = (merchant.contact ?? {}) as MerchantApplication["contact"];
  const representative = (merchant.representative ?? {}) as MerchantApplication["representative"];
  return {
    id: merchant.id,
    legalName: merchant.legalName,
    brandName: merchant.brandName,
    licenseNumber: merchant.licenseNumber,
    contact,
    licenseAuthority: merchant.licenseAuthority,
    licenseExpiresOn: toLocalDate(merchant.licenseExpiresOn),
    emirate: merchant.emirate,
    representative,
    declaredBranchCount: merchant.declaredBranchCount,
    description: merchant.description,
    documentsAccepted,
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
