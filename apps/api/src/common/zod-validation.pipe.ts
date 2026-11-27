import { type PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { ApiError } from "./api-error.js";

/** Validates and parses input with a contract schema. Unknown fields are rejected. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join(".") : "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw ApiError.validation(fieldErrors);
  }
}
