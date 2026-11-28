import type {
  Benefit,
  CancellationRequestView,
  Fulfillment,
  LocalizedText,
  MerchantOrder,
  OrderStatus,
} from "@beans/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export const merchantOrderInclude = {
  items: { orderBy: { lineNo: "asc" } },
  cancellationRequests: { where: { status: "open" }, select: { id: true } },
} satisfies Prisma.OrderInclude;

export type MerchantOrderRow = Prisma.OrderGetPayload<{ include: typeof merchantOrderInclude }>;

export interface LineSnapshot {
  names: LocalizedText;
  options: MerchantOrder["items"][number]["options"];
  notes: string | null;
  unitFils: string;
}

/** Staff view: what to make and for whom to look out, with no contact or payment data. */
export function toMerchantOrder(row: MerchantOrderRow): MerchantOrder {
  const fulfillment = row.fulfillmentSnapshot as unknown as Fulfillment;
  return {
    id: row.id,
    publicNumber: row.publicNumber,
    branchId: row.branchId,
    status: row.status,
    version: row.version,
    mode: row.mode,
    asap: fulfillment.asap,
    pickupAt: fulfillment.pickupAt,
    etaAt: row.etaAt?.toISOString() ?? null,
    acceptBy: row.status === "received" ? (row.acceptBy?.toISOString() ?? null) : null,
    items: row.items.map((item) => {
      const snap = item.snapshot as unknown as LineSnapshot;
      return {
        productId: item.productId,
        names: snap.names,
        quantity: item.quantity,
        options: snap.options,
        notes: snap.notes,
      };
    }),
    vehicle: row.mode === "curbside" ? fulfillment.vehicle : null,
    table: row.mode === "dine_in" ? (fulfillment.table ?? null) : null,
    benefit: (row.benefit as unknown as Benefit | null) ?? null,
    arrival: {
      arrivedAt: row.arrivedAt?.toISOString() ?? null,
      acknowledgedAt: row.arrivalAckAt?.toISOString() ?? null,
    },
    cancellationRequested: row.cancellationRequests.length > 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCancellationRequest(row: {
  id: string;
  orderId: string;
  status: CancellationRequestView["status"];
  orderStatus: OrderStatus;
  reason: string;
  resolutionReason: string | null;
  createdAt: Date;
}): CancellationRequestView {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    orderStatus: row.orderStatus,
    reason: row.reason,
    resolutionReason: row.resolutionReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toOrderRefund(row: {
  id: string;
  kind: "manual" | "late_capture" | "order_cancelled";
  status: "requested" | "approved" | "rejected" | "submitted" | "succeeded" | "failed";
  amountFils: bigint;
  createdAt: Date;
}) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amountFils: row.amountFils.toString(),
    currency: "AED" as const,
    createdAt: row.createdAt.toISOString(),
  };
}
