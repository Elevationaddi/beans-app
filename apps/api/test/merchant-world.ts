import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { JWKS } from "../src/auth/token-verifier.js";
import type { MembershipRole, PrismaClient } from "../src/generated/prisma/client.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";
import { addMember, createTenant, testPrisma } from "./fixtures.js";
import { TestIssuer } from "./tokens.js";

/** One API instance plus helpers to arrange merchants, members and signed-in calls. */
export class MerchantWorld {
  readonly prisma: PrismaClient = testPrisma();

  private constructor(
    readonly app: INestApplication,
    readonly issuer: TestIssuer,
  ) {}

  static async create(
    env: NodeJS.ProcessEnv = {},
    overrides: { provide: unknown; useValue: unknown }[] = [],
  ): Promise<MerchantWorld> {
    const issuer = await TestIssuer.create();
    const app = await createTestApp(testEnv(env), {
      overrides: [{ provide: JWKS, useValue: issuer.jwks }, ...overrides],
    });
    return new MerchantWorld(app, issuer);
  }

  async close(): Promise<void> {
    await this.app.close();
    await this.prisma.$disconnect();
  }

  tenant(label: string) {
    return createTenant(this.prisma, label);
  }

  /** A signed-in user with an email address, optionally a member of a merchant. */
  async person(
    membership?: {
      merchantId: string;
      role: MembershipRole;
      branchIds?: string[];
      catalogDelegated?: boolean;
    },
    email = `staff-${randomUUID().slice(0, 8)}@example.test`,
  ) {
    const user = await this.prisma.user.create({
      data: { authSubject: `test-${randomUUID()}`, email },
    });
    const member = membership
      ? await addMember(this.prisma, { userId: user.id, ...membership })
      : undefined;
    if (member && membership?.catalogDelegated) {
      await this.prisma.membership.update({
        where: { id: member.id },
        data: { catalogDelegated: true },
      });
    }
    const token = await this.issuer.token({ sub: user.authSubject, email });
    return { user, membership: member, token, email };
  }

  get(path: string, token: string) {
    return request(this.app.getHttpServer()).get(path).set("Authorization", `Bearer ${token}`);
  }
  post(path: string, token: string, body?: object) {
    return request(this.app.getHttpServer())
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }
  patch(path: string, token: string, body: object) {
    return request(this.app.getHttpServer())
      .patch(path)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }
  put(path: string, token: string, body: object) {
    return request(this.app.getHttpServer())
      .put(path)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }
}

/** Today plus `days`, as a Dubai calendar date. */
export function dubaiDate(days = 0): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(date);
}
