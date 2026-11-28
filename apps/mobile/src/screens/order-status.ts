import type { OrderStatus } from "@beans/contracts";

/** Status colour, always shown with the status text (docs/09: never colour alone). */
export const orderTone: Record<OrderStatus, "success" | "warning" | "error"> = {
  pending_payment: "warning",
  payment_failed: "error",
  received: "warning",
  accepted: "success",
  preparing: "success",
  ready: "success",
  completed: "success",
  rejected: "error",
  cancelled: "error",
};

/** The steps a customer sees for an order that goes well. */
export const STEPS: OrderStatus[] = ["received", "accepted", "preparing", "ready", "completed"];
