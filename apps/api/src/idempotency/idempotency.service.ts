import { createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface IdempotentOutcome {
  status: number;
  body: unknown;
  replayed: boolean;
}

/** Stable JSON with sorted keys, so semantically equal bodies hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function requestHash(body: unknown): string {
  return createHash("sha256").update(canonical(body)).digest("hex");
}

/**
 * Same actor + route + key + body returns the stored outcome; a different body is a 409
 * IDEMPOTENCY_CONFLICT; a concurrent duplicate while the first is running is a 409
 * REQUEST_IN_PROGRESS. Failed attempts release the key so the client can retry.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  validateKey(key: string | undefined): string {
    if (!key) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        "IDEMPOTENCY_KEY_REQUIRED",
        "This request needs an Idempotency-Key header",
      );
    }
    if (!KEY_PATTERN.test(key)) {
      throw ApiError.validation({
        "Idempotency-Key": ["Use 8-128 letters, digits, '-' or '_'"],
      });
    }
    return key;
  }

  async run(
    scope: { actorScope: string; route: string; key: string; body: unknown },
    handler: () => Promise<{ status: number; body: unknown }>,
  ): Promise<IdempotentOutcome> {
    const hash = requestHash(scope.body);
    const identity = { actorScope: scope.actorScope, route: scope.route, key: scope.key };

    const claimed = await this.claim(identity, hash);
    if (!claimed) {
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { actorScope_route_key: identity },
      });
      if (!existing) {
        // The holder failed and released the key between our insert and read: retry once.
        if (!(await this.claim(identity, hash))) throw this.inProgress();
      } else if (existing.requestHash !== hash) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_CONFLICT",
          "This Idempotency-Key was already used with a different request",
        );
      } else if (existing.status === "in_progress" || existing.responseCode === null) {
        throw this.inProgress();
      } else {
        return { status: existing.responseCode, body: existing.response, replayed: true };
      }
    }

    let outcome: { status: number; body: unknown };
    try {
      outcome = await handler();
    } catch (error) {
      await this.prisma.idempotencyKey.delete({ where: { actorScope_route_key: identity } });
      throw error;
    }
    await this.prisma.idempotencyKey.update({
      where: { actorScope_route_key: identity },
      data: {
        status: "completed",
        responseCode: outcome.status,
        response: (outcome.body ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
    return { ...outcome, replayed: false };
  }

  /** Inserts the in-progress row; false when the key already exists and has not expired. */
  private async claim(
    identity: { actorScope: string; route: string; key: string },
    hash: string,
  ): Promise<boolean> {
    // Expired keys are free to reuse.
    await this.prisma.idempotencyKey.deleteMany({
      where: { ...identity, expiresAt: { lte: new Date() } },
    });
    try {
      await this.prisma.idempotencyKey.create({
        data: { ...identity, requestHash: hash, expiresAt: new Date(Date.now() + RETENTION_MS) },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return false;
      throw error;
    }
  }

  private inProgress() {
    return new ApiError(
      HttpStatus.CONFLICT,
      "REQUEST_IN_PROGRESS",
      "An identical request is still being processed",
    );
  }
}
