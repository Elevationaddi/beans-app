import { act, screen, waitFor } from "@testing-library/react-native";
import { mockApi, renderScreen, testSession } from "../test-utils";
import { OrderScreen } from "./OrderScreen";

jest.mock("../lib/config", () => ({
  config: {
    apiUrl: "http://localhost:3000",
    supabaseUrl: "https://project.supabase.test",
    supabaseAnonKey: "anon-key-for-tests",
    devAuth: false,
  },
}));

// A stand-in for the Supabase Realtime client: records joins and lets the test drive them.
const joined: {
  name: string;
  event: string;
  signal: () => void;
  status: (s: string) => void;
}[] = [];
const removed: string[] = [];
jest.mock("@supabase/realtime-js", () => ({
  RealtimeClient: jest.fn().mockImplementation(() => ({
    channel: (name: string) => {
      const entry = { name, event: "", signal: () => {}, status: (_: string) => {} };
      const channel = {
        on: (_type: string, filter: { event: string }, cb: () => void) => {
          entry.event = filter.event;
          entry.signal = cb;
          return channel;
        },
        subscribe: (cb: (s: string) => void) => {
          entry.status = cb;
          joined.push(entry);
          return channel;
        },
      };
      return channel;
    },
    removeChannel: async () => {
      removed.push("x");
    },
  })),
}));

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function order(status: string) {
  return {
    id: ORDER_ID,
    publicNumber: "A1B2",
    version: 4,
    status,
    mode: "in_store",
    brandName: "Test Roasters",
    branchNames: { en: "Branch 1" },
    etaAt: null,
    pickupAt: "2026-11-28T08:15:00.000Z",
    pickupCode: "4821",
    arrival: { arrivedAt: null, acknowledgedAt: null },
    fulfillment: {},
    items: [{ quantity: 1, names: { en: "Latte" }, totalFils: "1700", options: [], notes: null }],
    totals: { totalFils: "1700", taxIncludedFils: "81" },
    refunds: [],
    cancellationRequest: null,
    policyVersion: "sandbox-1",
  };
}

describe("C08: live order tracking", () => {
  beforeEach(() => {
    joined.length = 0;
    removed.length = 0;
  });

  it("joins the order's channel and refetches on each signal and after a rejoin", async () => {
    let status = "accepted";
    const calls = mockApi({
      [`GET /v1/orders/${ORDER_ID}`]: () => ({ body: { data: order(status) } }),
      [`GET /v1/orders/${ORDER_ID}/live`]: () => ({
        body: {
          data: {
            url: "https://project.supabase.test",
            channel: "order-0123456789abcdef",
            event: "order.updated",
          },
        },
      }),
    });
    const orderFetches = () => calls.filter((c) => c.path === `/v1/orders/${ORDER_ID}`).length;
    await renderScreen(
      "Order",
      OrderScreen as never,
      { orderId: ORDER_ID },
      { session: testSession },
    );
    await waitFor(() => expect(joined).toHaveLength(1));
    expect(joined[0]).toMatchObject({ name: "order-0123456789abcdef", event: "order.updated" });
    await act(async () => joined[0]!.status("SUBSCRIBED"));
    const before = orderFetches();

    status = "ready";
    await act(async () => joined[0]!.signal());
    expect(await screen.findByText("Your order is ready to collect.")).toBeTruthy();
    expect(orderFetches()).toBe(before + 1);

    // Dropped and rejoined: one refetch for anything missed while away.
    await act(async () => joined[0]!.status("CHANNEL_ERROR"));
    await act(async () => joined[0]!.status("SUBSCRIBED"));
    await waitFor(() => expect(orderFetches()).toBe(before + 2));
  });

  it("leaves no channel open for a finished order", async () => {
    mockApi({
      [`GET /v1/orders/${ORDER_ID}`]: () => ({ body: { data: order("completed") } }),
      [`GET /v1/orders/${ORDER_ID}/live`]: () => ({
        body: {
          data: {
            url: "https://project.supabase.test",
            channel: "order-0123456789abcdef",
            event: "order.updated",
          },
        },
      }),
    });
    await renderScreen(
      "Order",
      OrderScreen as never,
      { orderId: ORDER_ID },
      { session: testSession },
    );
    expect(await screen.findByText("4821")).toBeTruthy();
    // Any channel joined while the order was still loading has been left again.
    await waitFor(() => expect(removed).toHaveLength(joined.length));
  });
});
