/**
 * Gives the fictional demo accounts real Supabase sign-ins on STAGING (cycle 4), so testers can
 * sign in without development sign-in and without a sending domain for email codes.
 *
 * For every demo account created by `pnpm db:demo` (auth_subject "seed-demo-…"):
 *   1. creates a confirmed Supabase Auth user with a long random password (no email is sent),
 *   2. links the database user to it (auth_subject = Supabase user id),
 *   3. for administrators, enrols an authenticator (TOTP) factor, because the admin console
 *      requires two-step verification.
 * Passwords and authenticator secrets go ONLY into the local file named by DEMO_CREDENTIALS,
 * written with owner-only permissions, outside the repository. Nothing secret is printed.
 *
 * Restriction: switch off public sign-ups in the staging Supabase project (Authentication >
 * Sign In / Providers > "Allow new users to sign up" off). Then only these provisioned demo
 * accounts can sign in at all.
 *
 *   DATABASE_URL=<staging session pooler URL> SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   DEMO_CREDENTIALS=$HOME/secure/beans-demo-credentials.json \
 *   pnpm --filter @beans/api demo:provision
 *
 * Re-running is safe: accounts already in the credentials file are skipped.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { gotrue, totp, type Credentials } from "./demo-auth.js";

const {
  DATABASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  DEMO_CREDENTIALS,
} = process.env;
if (
  !DATABASE_URL ||
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !SUPABASE_ANON_KEY ||
  !DEMO_CREDENTIALS
) {
  console.error(
    "Set DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY and DEMO_CREDENTIALS.",
  );
  process.exit(1);
}
if (process.env.DEPLOY_ENV === "production") {
  console.error("Refusing: demo accounts never go into production.");
  process.exit(1);
}
const repoRoot = resolve(import.meta.dirname, "../../..");
const credentialsPath = resolve(DEMO_CREDENTIALS);
if (credentialsPath.startsWith(repoRoot + "/")) {
  console.error("DEMO_CREDENTIALS must be outside the repository (it holds passwords).");
  process.exit(1);
}

const base = SUPABASE_URL.replace(/\/$/, "");
const adminHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
};

async function admin<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}/auth/v1/admin${path}`, {
    method,
    headers: adminHeaders,
    body: body === undefined ? null : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `Supabase admin ${method} ${path.split("?")[0]} → ${response.status} ${String(json["msg"] ?? json["error_code"] ?? "")}`,
    );
  }
  return json as T;
}

/** Finds an existing Supabase user by email (staging projects are small; pages of 200). */
async function findUser(email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const result = await admin<{ users: { id: string; email?: string }[] }>(
      "GET",
      `/users?page=${page}&per_page=200`,
    );
    const found = result.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (result.users.length < 200) return null;
  }
  return null;
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
const credentials: Credentials = existsSync(credentialsPath)
  ? (JSON.parse(readFileSync(credentialsPath, "utf8")) as Credentials)
  : {};
const save = () =>
  writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });

const demoUsers = await prisma.user.findMany({
  where: {
    OR: [
      { authSubject: { startsWith: "seed-demo-" } },
      { email: { in: Object.keys(credentials) } },
    ],
    status: "active",
  },
  include: { adminRoles: true, memberships: { select: { role: true } } },
  orderBy: { email: "asc" },
});
if (demoUsers.length === 0) {
  console.error("No demo accounts found. Run pnpm db:demo against this database first.");
  process.exit(1);
}

const report: { email: string; kind: string; result: string }[] = [];
try {
  for (const user of demoUsers) {
    const email = user.email!;
    const kind =
      user.adminRoles.length > 0
        ? `admin (${user.adminRoles.map((r) => r.role).join(", ")})`
        : user.memberships.length > 0
          ? `business (${user.memberships.map((m) => m.role).join(", ")})`
          : "customer";
    const known = credentials[email];
    if (
      known &&
      user.authSubject === known.userId &&
      (user.adminRoles.length === 0 || known.factorId)
    ) {
      report.push({ email, kind, result: "already provisioned" });
      continue;
    }
    const password = randomBytes(18).toString("base64url");
    let supabaseId = await findUser(email);
    if (supabaseId) {
      await admin("PUT", `/users/${supabaseId}`, { password, email_confirm: true });
    } else {
      const created = await admin<{ id: string }>("POST", "/users", {
        email,
        password,
        email_confirm: true,
        app_metadata: { demo: true },
        user_metadata: { name: user.displayName },
      });
      supabaseId = created.id;
    }
    await prisma.user.update({ where: { id: user.id }, data: { authSubject: supabaseId } });
    credentials[email] = { userId: supabaseId, password };
    save();

    if (user.adminRoles.length > 0) {
      const session = await gotrue<{ access_token: string }>(
        base,
        SUPABASE_ANON_KEY,
        "/token?grant_type=password",
        {
          email,
          password,
        },
      );
      const factor = await gotrue<{ id: string; totp: { secret: string; uri: string } }>(
        base,
        SUPABASE_ANON_KEY,
        "/factors",
        { factor_type: "totp", friendly_name: `demo-${Date.now()}` },
        session.access_token,
      );
      const challenge = await gotrue<{ id: string }>(
        base,
        SUPABASE_ANON_KEY,
        `/factors/${factor.id}/challenge`,
        {},
        session.access_token,
      );
      await gotrue(
        base,
        SUPABASE_ANON_KEY,
        `/factors/${factor.id}/verify`,
        { challenge_id: challenge.id, code: totp(factor.totp.secret) },
        session.access_token,
      );
      credentials[email] = {
        userId: supabaseId,
        password,
        totpSecret: factor.totp.secret,
        factorId: factor.id,
      };
      save();
    }
    report.push({
      email,
      kind,
      result: user.adminRoles.length > 0 ? "provisioned + authenticator" : "provisioned",
    });
  }
} finally {
  await prisma.$disconnect();
}
console.table(report);
console.log(
  `Passwords and authenticator secrets are in ${credentialsPath} (owner-only). Never commit or send it.`,
);
