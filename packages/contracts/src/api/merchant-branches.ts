import { z } from "zod";
import { dataEnvelope, listEnvelope, uuidSchema } from "./common.js";

export const branchStatusSchema = z.enum(["draft", "active", "paused", "closed"]);
export const fulfilmentModeSchema = z.enum(["in_store", "curbside", "dine_in"]);

export const branchHoursSchema = z.object({
  /** ISO weekday: 1 = Monday ... 7 = Sunday, in the branch timezone. */
  weekday: z.number().int().min(1).max(7),
  opens: z.string().regex(/^\d{2}:\d{2}$/),
  closes: z.string().regex(/^\d{2}:\d{2}$/),
});

export const merchantBranchSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  address: z.string(),
  timezone: z.string(),
  status: branchStatusSchema,
  modes: z.array(fulfilmentModeSchema),
  capacity: z.number().int(),
  hours: z.array(branchHoursSchema),
});
export type MerchantBranch = z.infer<typeof merchantBranchSchema>;

export const merchantBranchListResponseSchema = listEnvelope(merchantBranchSchema);
export const merchantBranchResponseSchema = dataEnvelope(merchantBranchSchema);
