import type { MenuGroup, MenuProduct } from "@beans/contracts";

/** Choices per group, as option IDs. */
export type Selection = Record<string, string[]>;

/** The default selection: nothing chosen. Required groups must be chosen by the customer. */
export function emptySelection(product: MenuProduct): Selection {
  return Object.fromEntries(product.groups.map((g) => [g.id, []]));
}

/** Toggles an option, honouring single-choice groups (max 1 replaces the choice). */
export function toggleOption(selection: Selection, group: MenuGroup, optionId: string): Selection {
  const current = selection[group.id] ?? [];
  if (current.includes(optionId)) {
    return { ...selection, [group.id]: current.filter((id) => id !== optionId) };
  }
  if (group.maxCount === 1) return { ...selection, [group.id]: [optionId] };
  if (current.length >= group.maxCount) return selection;
  return { ...selection, [group.id]: [...current, optionId] };
}

export interface GroupProblem {
  groupId: string;
  kind: "too_few" | "too_many";
  count: number;
}

/** Groups whose choices do not meet min/max. Adding to the cart is blocked while any remain. */
export function selectionProblems(product: MenuProduct, selection: Selection): GroupProblem[] {
  return product.groups.flatMap((group): GroupProblem[] => {
    const chosen = (selection[group.id] ?? []).length;
    if (chosen < group.minCount)
      return [{ groupId: group.id, kind: "too_few", count: group.minCount }];
    if (chosen > group.maxCount)
      return [{ groupId: group.id, kind: "too_many", count: group.maxCount }];
    return [];
  });
}

export function chosenOptionIds(product: MenuProduct, selection: Selection): string[] {
  return product.groups.flatMap((g) => selection[g.id] ?? []);
}
