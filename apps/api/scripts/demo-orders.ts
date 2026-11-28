/**
 * Demo orders in every lifecycle stage (cycle 4), created through the public API so payments,
 * the financial journal, loyalty stamps, promotions and audit events follow the real rules.
 * Payments use the SANDBOX provider: no money moves.
 *
 * Local (development sign-in, never on staging):
 *   DEMO_API_URL=http://localhost:3000 DEMO_AUTH=dev pnpm --filter @beans/api demo:orders
 * Staging (real Supabase sign-in with the demo accounts):
 *   DEMO_API_URL=https://<staging-api> DEMO_AUTH=supabase SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   DEMO_CREDENTIALS=~/secure/beans-demo-credentials.json pnpm --filter @beans/api demo:orders
 *
 * Run `pnpm db:demo` (catalog and accounts) first. Each run adds a new set of orders. Orders
 * left "received" are cancelled and refunded by the acceptance timer after 120 seconds, and
 * "pending payment" ones expire with the payment hold: that is the real behaviour.
 */
import { api, devSession, supabaseSession, type Session } from "./demo-auth.js";

const API = (process.env.DEMO_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const mode = process.env.DEMO_AUTH ?? "dev";

function session(): Session {
  if (mode === "dev") return devSession(API);
  if (mode === "supabase") {
    const { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_CREDENTIALS } = process.env;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DEMO_CREDENTIALS) {
      throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY and DEMO_CREDENTIALS");
    }
    return supabaseSession(SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_CREDENTIALS);
  }
  throw new Error('DEMO_AUTH must be "dev" or "supabase"');
}

type Branch = {
  id: string;
  brandName: string;
  names: { en: string };
  modes: string[];
  availability: string;
};
type MenuProduct = {
  id: string;
  names?: { en: string };
  available?: boolean;
  groups?: { minCount?: number; options: { id: string }[] }[];
};
type Order = {
  id: string;
  status: string;
  version: number;
  pickupCode?: string | null;
  publicNumber?: string;
};

const OWNERS: Record<string, string> = {
  "Dune Lantern Coffee": "owner.demo@example.test",
  "Saltpan Roasters": "owner2.demo@example.test",
  "Mangrove Brew Bar": "owner3.demo@example.test",
  "Falcon Courtyard Café": "owner4.demo@example.test",
  "Pearl Tea & Coffee House": "owner5.demo@example.test",
};

interface Plan {
  stage: string;
  cafe: string;
  mode?: "in_store" | "curbside";
  outcome?: "succeed" | "fail" | "pending";
  promoCode?: string;
  customer?: string;
}

/** Ordered so that short-lived stages (received, pending payment) are created last. */
const PLANS: Plan[] = [
  { stage: "completed", cafe: "Dune Lantern Coffee", promoCode: "LANTERN15" },
  {
    stage: "completed",
    cafe: "Pearl Tea & Coffee House",
    mode: "curbside",
    customer: "customer-ar.demo@example.test",
  },
  { stage: "completed", cafe: "Falcon Courtyard Café" },
  { stage: "refunded_full", cafe: "Saltpan Roasters" },
  { stage: "refunded_partial", cafe: "Falcon Courtyard Café" },
  { stage: "rejected", cafe: "Mangrove Brew Bar", mode: "curbside" },
  { stage: "cancelled_by_admin", cafe: "Pearl Tea & Coffee House" },
  { stage: "payment_failed", cafe: "Dune Lantern Coffee", outcome: "fail" },
  { stage: "ready", cafe: "Mangrove Brew Bar" },
  { stage: "preparing", cafe: "Dune Lantern Coffee", mode: "curbside" },
  { stage: "accepted", cafe: "Pearl Tea & Coffee House" },
  { stage: "pending_payment", cafe: "Saltpan Roasters", outcome: "pending" },
  { stage: "received", cafe: "Dune Lantern Coffee" },
];

const auth = session();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: {
  stage: string;
  cafe: string;
  branch: string;
  status: string;
  number?: string;
  note?: string;
}[] = [];

/** The planned café's open branch, or any open café when it is closed (opening hours differ). */
async function openBranch(token: string, cafe: string, wanted: string): Promise<Branch | null> {
  const branches = await api<Branch[]>(API, "GET", "/v1/branches?limit=50", token);
  const usable = branches.filter(
    (b) => b.availability === "open" && b.modes.includes(wanted) && OWNERS[b.brandName],
  );
  return usable.find((b) => b.brandName === cafe) ?? usable[0] ?? null;
}

async function place(
  plan: Plan,
): Promise<{ order: Order; branch: Branch; customer: string } | string> {
  const customer = plan.customer ?? "customer.demo@example.test";
  const token = await auth.token(customer);
  const wanted = plan.mode ?? "in_store";
  const branch = await openBranch(token, plan.cafe, wanted);
  if (!branch) return `no demo café is open for ${wanted} right now (opening hours)`;
  const menu = await api<{ categories: { products: MenuProduct[] }[] }>(
    API,
    "GET",
    `/v1/branches/${branch.id}/menu`,
    token,
  );
  const product = menu.categories.flatMap((c) => c.products).find((p) => p.available !== false);
  if (!product) return "no available product";
  const optionIds = (product.groups ?? [])
    .filter((g) => (g.minCount ?? 0) > 0)
    .map((g) => g.options[0]!.id);
  const cart = await api<{ id: string; version: number }>(API, "PUT", "/v1/cart", token, {
    branchId: branch.id,
  });
  const filled = await api<{ id: string; version: number }>(API, "POST", "/v1/cart/items", token, {
    productId: product.id,
    quantity: 2,
    optionIds,
    expectedVersion: cart.version,
  });
  let vehicleId: string | undefined;
  if (wanted === "curbside") {
    const vehicles = await api<{ id: string }[]>(API, "GET", "/v1/vehicles", token);
    vehicleId =
      vehicles[0]?.id ??
      (
        await api<{ id: string }>(API, "POST", "/v1/vehicles", token, {
          plate: "D 12345",
          plateRegion: "abu_dhabi",
          color: "White",
          model: "Demo sedan",
        })
      ).id;
  }
  const quote = await api<{ id: string }>(API, "POST", "/v1/quotes", token, {
    cartId: filled.id,
    cartVersion: filled.version,
    mode: wanted,
    ...(vehicleId && { vehicleId }),
    ...(plan.promoCode && { promoCode: plan.promoCode }),
  });
  const checkout = await api<{ orderId: string }>(API, "POST", "/v1/checkout", token, {
    quoteId: quote.id,
    sandboxOutcome: plan.outcome ?? "succeed",
  });
  // The sandbox provider confirms through its signed webhook; wait for the result.
  let order = await api<Order>(API, "GET", `/v1/orders/${checkout.orderId}`, token);
  for (let i = 0; i < 20 && plan.outcome !== "pending" && order.status === "pending_payment"; i++) {
    await sleep(500);
    order = await api<Order>(API, "GET", `/v1/orders/${checkout.orderId}`, token);
  }
  return { order, branch, customer };
}

async function staffStep(cafe: string, orderId: string, body: Record<string, unknown>) {
  const token = await auth.token(OWNERS[cafe]!);
  const current = await api<Order>(API, "GET", `/v1/merchant/orders/${orderId}`, token);
  return api<Order>(API, "POST", `/v1/merchant/orders/${orderId}/transition`, token, {
    ...body,
    expectedVersion: current.version,
  });
}

async function advance(
  cafe: string,
  order: Order,
  customer: string,
  to: "accepted" | "preparing" | "ready" | "completed",
) {
  await staffStep(cafe, order.id, { action: "accept", etaMinutes: 10 });
  if (to === "accepted") return;
  await staffStep(cafe, order.id, { action: "start" });
  if (to === "preparing") return;
  await staffStep(cafe, order.id, { action: "ready" });
  if (to === "ready") return;
  const mine = await api<Order>(API, "GET", `/v1/orders/${order.id}`, await auth.token(customer));
  await staffStep(cafe, order.id, { action: "complete", pickupCode: mine.pickupCode });
}

async function refund(orderId: string, part: "full" | "half"): Promise<string> {
  const maker = await auth.token("finance.demo@example.test", { mfa: true });
  const checker = await auth.token("finance-checker.demo@example.test", { mfa: true });
  const detail = await api<{ payments: { id: string; status: string; amountFils: string }[] }>(
    API,
    "GET",
    `/v1/admin/orders/${orderId}`,
    await auth.token("ops.demo@example.test", { mfa: true }),
  );
  const payment =
    detail.payments.find((p) => p.status === "captured" || p.status === "succeeded") ??
    detail.payments[0];
  if (!payment) throw new Error("order has no payment");
  const amount = part === "full" ? BigInt(payment.amountFils) : BigInt(payment.amountFils) / 2n;
  const requested = await api<{ id: string }>(API, "POST", "/v1/admin/refunds", maker, {
    paymentId: payment.id,
    amountFils: amount.toString(),
    reason: `Demo ${part} refund (sandbox)`,
  });
  const approved = await api<{ status: string }>(
    API,
    "POST",
    `/v1/admin/refunds/${requested.id}/approve`,
    checker,
    {
      reason: "Demo: second person approves (maker-checker)",
    },
  );
  return `${part} refund of ${amount} fils: ${approved.status}`;
}

async function run(plan: Plan) {
  const placed = await place(plan);
  if (typeof placed === "string") {
    results.push({
      stage: plan.stage,
      cafe: plan.cafe,
      branch: "—",
      status: "skipped",
      note: placed,
    });
    return;
  }
  const { order, branch, customer } = placed;
  const cafe = branch.brandName;
  let note: string | undefined =
    cafe === plan.cafe ? undefined : `${plan.cafe} closed now; used ${cafe}`;
  switch (plan.stage) {
    case "completed":
      await advance(cafe, order, customer, "completed");
      break;
    case "refunded_full":
    case "refunded_partial":
      await advance(cafe, order, customer, "completed");
      note = [note, await refund(order.id, plan.stage === "refunded_full" ? "full" : "half")]
        .filter(Boolean)
        .join("; ");
      break;
    case "ready":
    case "preparing":
    case "accepted":
      await advance(cafe, order, customer, plan.stage);
      break;
    case "rejected":
      await staffStep(cafe, order.id, { action: "reject", reason: "Demo: out of cold brew" });
      break;
    case "cancelled_by_admin": {
      const ops = await auth.token("ops.demo@example.test", { mfa: true });
      const current = await api<Order>(API, "GET", `/v1/admin/orders/${order.id}`, ops);
      await api(API, "POST", `/v1/admin/orders/${order.id}/cancel`, ops, {
        reason: "Demo: customer called support to cancel",
        expectedVersion: current.version,
      });
      break;
    }
  }
  const final = await api<Order>(API, "GET", `/v1/orders/${order.id}`, await auth.token(customer));
  if (plan.stage === "payment_failed" && final.status === "pending_payment") {
    note = [note, "card declined; becomes payment_failed when the 10-minute hold ends"]
      .filter(Boolean)
      .join("; ");
  }
  results.push({
    stage: plan.stage,
    cafe,
    branch: branch.names.en,
    status: final.status,
    ...(final.publicNumber && { number: final.publicNumber }),
    ...(note && { note }),
  });
}

let failed = 0;
for (const plan of PLANS) {
  try {
    await run(plan);
  } catch (error) {
    failed++;
    results.push({
      stage: plan.stage,
      cafe: plan.cafe,
      branch: "—",
      status: "error",
      note: (error as Error).message,
    });
  }
}
console.table(results);
if (failed > 0) {
  console.error(`${failed} demo order(s) failed.`);
  process.exitCode = 1;
}
