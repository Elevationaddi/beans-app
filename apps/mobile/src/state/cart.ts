/**
 * The cart lives on the device until checkout (phase 6). It holds one branch only (C06):
 * adding from another branch asks the customer to confirm replacing the cart (Q03).
 * Line prices are the server's (`POST /v1/branches/{id}/items/price`), never computed here.
 */
export interface CartLine {
  key: string;
  productId: string;
  name: string;
  optionIds: string[];
  optionNames: string[];
  quantity: number;
  unitFils: string;
  lineFils: string;
  notes: string;
}

export interface Cart {
  branchId: string | null;
  branchName: string | null;
  menuVersion: string | null;
  lines: CartLine[];
}

export const emptyCart: Cart = { branchId: null, branchName: null, menuVersion: null, lines: [] };

export interface AddRequest {
  branchId: string;
  branchName: string;
  menuVersion: string;
  line: CartLine;
}

export type AddOutcome =
  { kind: "added"; cart: Cart } | { kind: "needs_confirmation"; currentBranch: string };

/** Adds a line, or reports that the cart belongs to another branch. */
export function addLine(cart: Cart, request: AddRequest): AddOutcome {
  if (cart.branchId && cart.branchId !== request.branchId && cart.lines.length > 0) {
    return { kind: "needs_confirmation", currentBranch: cart.branchName ?? "" };
  }
  return {
    kind: "added",
    cart: {
      branchId: request.branchId,
      branchName: request.branchName,
      menuVersion: request.menuVersion,
      lines: [...(cart.branchId === request.branchId ? cart.lines : []), request.line],
    },
  };
}

/** After the customer confirmed: start a new cart at the new branch with this line. */
export function replaceWith(request: AddRequest): Cart {
  return {
    branchId: request.branchId,
    branchName: request.branchName,
    menuVersion: request.menuVersion,
    lines: [request.line],
  };
}

export function removeLine(cart: Cart, key: string): Cart {
  const lines = cart.lines.filter((l) => l.key !== key);
  return lines.length === 0 ? emptyCart : { ...cart, lines };
}

export function itemCount(cart: Cart): number {
  return cart.lines.reduce((n, l) => n + l.quantity, 0);
}
