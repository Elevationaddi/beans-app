import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";

/** Optimistic concurrency failure on the cart (docs/07: stale versions answer 409). */
export function staleCart(current: number): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    "CONFLICT",
    "Your cart changed, for example on another device. Reload it and try again.",
    { expectedVersion: [`Current version is ${current}`] },
  );
}

export function featureDisabled(field: string, what: string): ApiError {
  return new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "FEATURE_DISABLED",
    `${what} is not available yet`,
    { [field]: ["Not available yet"] },
  );
}

export function semantic(message: string, fieldErrors: Record<string, string[]>): ApiError {
  return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", message, fieldErrors);
}

export const branchClosed = (message: string) =>
  new ApiError(HttpStatus.CONFLICT, "BRANCH_CLOSED", message);

export const slotFull = () =>
  new ApiError(
    HttpStatus.CONFLICT,
    "SLOT_FULL",
    "That pickup time is fully booked. Choose another time.",
  );

export const outOfStock = (fieldErrors?: Record<string, string[]>) =>
  new ApiError(
    HttpStatus.CONFLICT,
    "OUT_OF_STOCK",
    "Something in your cart is sold out. Review your cart.",
    fieldErrors,
  );

export const priceChanged = () =>
  new ApiError(
    HttpStatus.CONFLICT,
    "PRICE_CHANGED",
    "Prices or options changed since your quote. Review your cart and get a new quote.",
  );

export const quoteExpired = (message = "This quote has expired. Get a new quote.") =>
  new ApiError(HttpStatus.CONFLICT, "QUOTE_EXPIRED", message);
