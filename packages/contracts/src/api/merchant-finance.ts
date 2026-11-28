import { z } from "zod";
import { dataEnvelope, filsSchema, uuidSchema } from "./common.js";
import { payoutStatusSchema } from "./admin-finance.js";

/** B09: a business's own money, read from the immutable journal. Sandbox data only. */
export const merchantFinanceQuerySchema = z
  .strictObject({ merchantId: uuidSchema, from: z.iso.datetime(), to: z.iso.datetime() })
  .refine((q) => q.from < q.to, { message: "from must be before to", path: ["to"] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, {
    message: "At most 366 days",
    path: ["to"],
  });
export type MerchantFinanceQuery = z.infer<typeof merchantFinanceQuerySchema>;

export const merchantTransactionSchema = z.object({
  kind: z.enum(["sale", "refund"]),
  orderId: uuidSchema,
  publicNumber: z.string(),
  at: z.iso.datetime(),
  /** Amount kept from the customer (sale) or returned to the customer (refund). */
  amountFils: filsSchema,
  commissionFils: filsSchema,
  /** Change to what the platform owes the business: positive for sales, negative for refunds. */
  payableChangeFils: z.string().regex(/^-?\d+$/),
});
export type MerchantTransaction = z.infer<typeof merchantTransactionSchema>;

export const merchantFinanceSchema = z.object({
  period: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  salesFils: filsSchema,
  refundsFils: filsSchema,
  commissionFils: filsSchema,
  /** What the business earned in the period after commission and refunds. */
  netPayableFils: z.string().regex(/^-?\d+$/),
  /** Owed to the business now, all time, not yet paid out (pending funds). */
  balanceFils: z.string().regex(/^-?\d+$/),
  paidOutFils: filsSchema,
  commission: z.object({
    policyVersion: z.string().nullable(),
    rateBasisPoints: z.number().int().nullable(),
    vatExcluded: z.boolean(),
    sandbox: z.boolean(),
  }),
  transactions: z.array(merchantTransactionSchema),
  /** True when the list was cut at 500 rows; narrow the period to see the rest. */
  truncated: z.boolean(),
});
export type MerchantFinance = z.infer<typeof merchantFinanceSchema>;
export const merchantFinanceResponseSchema = dataEnvelope(merchantFinanceSchema);

export const merchantPayoutQuerySchema = z.strictObject({ merchantId: uuidSchema });
export const merchantPayoutSchema = z.object({
  id: uuidSchema,
  status: payoutStatusSchema,
  amountFils: filsSchema,
  periodEnd: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const merchantPayoutListResponseSchema = dataEnvelope(z.array(merchantPayoutSchema));
