import { ApiError } from "./api-error.js";

/** Opaque keyset cursor over (createdAt, id). Encoded so clients cannot depend on its shape. */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id])).toString(
    "base64url",
  );
}

export function decodeCursor(value: string | undefined): Cursor | undefined {
  if (!value) return undefined;
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as [
      string,
      string,
    ];
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || typeof id !== "string") throw new Error("bad cursor");
    return { createdAt: date, id };
  } catch {
    throw ApiError.validation({ cursor: ["Invalid cursor"] });
  }
}

/** Opaque offset cursor, for result sets ranked in memory (such as distance). */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

export function decodeOffsetCursor(value: string | undefined): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { o?: unknown };
    if (typeof parsed.o !== "number" || !Number.isInteger(parsed.o) || parsed.o < 0)
      throw new Error("bad");
    return parsed.o;
  } catch {
    throw ApiError.validation({ cursor: ["Invalid cursor"] });
  }
}
