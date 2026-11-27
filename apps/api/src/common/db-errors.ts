import { Prisma } from "../generated/prisma/client.js";

interface DriverCause {
  originalCode?: string;
  code?: string;
  message?: string;
  constraint?: string;
}

function driverCause(error: unknown): DriverCause | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = error.meta as { driverAdapterError?: { cause?: DriverCause } } | undefined;
  return meta?.driverAdapterError?.cause;
}

/** The PostgreSQL SQLSTATE behind a Prisma error, when the driver reported one. */
export function postgresCode(error: unknown): string | undefined {
  const cause = driverCause(error);
  return cause?.originalCode ?? cause?.code;
}

/** A CHECK constraint or check-raising trigger rejected the write (SQLSTATE 23514). */
export function isCheckViolation(error: unknown, nameOrText?: string): boolean {
  if (postgresCode(error) !== "23514") return false;
  return nameOrText === undefined || (driverCause(error)?.message ?? "").includes(nameOrText);
}

/** An exclusion constraint rejected the write, such as overlapping opening hours (23P01). */
export function isExclusionViolation(error: unknown): boolean {
  return postgresCode(error) === "23P01";
}

/** A unique constraint rejected the write. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    postgresCode(error) === "23505"
  );
}
