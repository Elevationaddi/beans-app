import type { MenuProduct } from "@beans/contracts";
import { dictionaries } from "../i18n";
import { addLine, type AddRequest, emptyCart, removeLine, replaceWith } from "../state/cart";
import { emptySelection, selectionProblems, toggleOption } from "./customizer";
import { formatFils, sumFils } from "./money";

describe("money", () => {
  it("formats integer fils without floating point", () => {
    expect(formatFils("1700", "en")).toBe("AED 17.00");
    expect(formatFils("5", "en")).toBe("AED 0.05");
    expect(formatFils("123456789", "en")).toBe("AED 1,234,567.89");
    expect(formatFils("2250", "ar")).toBe("22.50 د.إ");
    expect(sumFils(["1700", "4500", "5"])).toBe("6205");
  });
});

const product: MenuProduct = {
  id: "p1",
  names: { en: "Latte" },
  descriptions: {},
  priceFils: "1700",
  allergens: [],
  available: true,
  groups: [
    {
      id: "size",
      names: { en: "Size" },
      minCount: 1,
      maxCount: 1,
      options: [
        { id: "s", names: { en: "Small" }, deltaFils: "0", available: true },
        { id: "l", names: { en: "Large" }, deltaFils: "300", available: true },
      ],
    },
    {
      id: "extras",
      names: { en: "Extras" },
      minCount: 0,
      maxCount: 2,
      options: [
        { id: "a", names: { en: "A" }, deltaFils: "100", available: true },
        { id: "b", names: { en: "B" }, deltaFils: "100", available: true },
        { id: "c", names: { en: "C" }, deltaFils: "100", available: true },
      ],
    },
  ],
};

describe("customizer (C05: a missing required option blocks adding)", () => {
  it("reports a required group until it is chosen", () => {
    let selection = emptySelection(product);
    expect(selectionProblems(product, selection)).toEqual([
      { groupId: "size", kind: "too_few", count: 1 },
    ]);
    selection = toggleOption(selection, product.groups[0]!, "s");
    expect(selectionProblems(product, selection)).toEqual([]);
  });

  it("replaces the choice in single-choice groups and caps multi-choice groups", () => {
    const [size, extras] = product.groups as [MenuProduct["groups"][0], MenuProduct["groups"][0]];
    let selection = toggleOption(emptySelection(product), size, "s");
    selection = toggleOption(selection, size, "l");
    expect(selection["size"]).toEqual(["l"]);
    selection = toggleOption(
      toggleOption(toggleOption(selection, extras, "a"), extras, "b"),
      extras,
      "c",
    );
    expect(selection["extras"]).toEqual(["a", "b"]);
  });
});

const request = (branchId: string, key: string): AddRequest => ({
  branchId,
  branchName: `Branch ${branchId}`,
  menuVersion: "v1",
  line: {
    key,
    productId: "p1",
    name: "Latte",
    optionIds: [],
    optionNames: [],
    quantity: 1,
    unitFils: "1700",
    lineFils: "1700",
    notes: "",
  },
});

describe("cart (Q03: one branch per order)", () => {
  it("adds lines from the same branch", () => {
    const first = addLine(emptyCart, request("A", "1"));
    if (first.kind !== "added") throw new Error("expected added");
    const second = addLine(first.cart, request("A", "2"));
    expect(second.kind === "added" && second.cart.lines.map((l) => l.key)).toEqual(["1", "2"]);
  });

  it("asks for confirmation before switching branch, and never mixes branches", () => {
    const first = addLine(emptyCart, request("A", "1"));
    if (first.kind !== "added") throw new Error("expected added");
    expect(addLine(first.cart, request("B", "2"))).toEqual({
      kind: "needs_confirmation",
      currentBranch: "Branch A",
    });
    const replaced = replaceWith(request("B", "2"));
    expect(replaced.branchId).toBe("B");
    expect(replaced.lines.map((l) => l.key)).toEqual(["2"]);
  });

  it("empties to no branch when the last line is removed", () => {
    expect(removeLine(replaceWith(request("A", "1")), "1")).toEqual(emptyCart);
  });
});

describe("translations", () => {
  it("has every English key in Arabic, with the same placeholders", () => {
    for (const [key, english] of Object.entries(dictionaries.en)) {
      const arabic = dictionaries.ar[key as keyof typeof dictionaries.en];
      expect(arabic).toBeTruthy();
      const vars = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(arabic)).toEqual(vars(english));
    }
  });
});
