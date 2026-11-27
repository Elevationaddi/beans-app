import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma, type User } from "../generated/prisma/client.js";
import type { VerifiedToken } from "./token-verifier.js";

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Finds the user for a verified token, creating the row on first sign-in. Email and phone
   * are copied from the token only when the row is created; the auth provider stays the
   * source of truth for contact details.
   */
  async resolve(token: VerifiedToken): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { authSubject: token.subject } });
    if (existing) return existing;
    try {
      return await this.prisma.user.create({
        data: { authSubject: token.subject, email: token.email, phone: token.phone },
      });
    } catch (error) {
      // Two first requests raced; the other one created the row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return this.prisma.user.findUniqueOrThrow({ where: { authSubject: token.subject } });
      }
      throw error;
    }
  }
}
