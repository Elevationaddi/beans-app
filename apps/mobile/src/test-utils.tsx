import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { render } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { LocalizedApp } from "./AppRoot";
import type { RootParams } from "./navigation/types";
import { AppStateProvider, type Prefs } from "./state/app-state";
import { type Cart, emptyCart } from "./state/cart";

export interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type Handler = (req: Recorded) => { status?: number; body: unknown };

/** Replaces fetch with handlers keyed by "METHOD /path"; records every request. */
export function mockApi(handlers: Record<string, Handler>): Recorded[] {
  const calls: Recorded[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const recorded: Recorded = {
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(recorded);
    const key = `${request.method} ${url.pathname}`;
    const handler = handlers[key];
    if (!handler)
      return new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: key, requestId: "t" } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    const result = handler(recorded);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

export const guestPrefs: Prefs = { onboarded: true, locale: "en", city: "abu_dhabi" };

/** The whole app (onboarding → tabs) with the given starting state. */
export async function renderApp(prefs: Prefs, cart: Cart = emptyCart) {
  return await render(
    <AppStateProvider initialPrefs={prefs} initialCart={cart}>
      <LocalizedApp />
    </AppStateProvider>,
  );
}

const Stack = createNativeStackNavigator<RootParams>();
const Placeholder = () => null;

/** One stack screen with params, inside the real providers. */
export async function renderScreen<K extends keyof RootParams>(
  name: K,
  component: ComponentType<never>,
  params: RootParams[K],
  options: { prefs?: Prefs; cart?: Cart } = {},
) {
  return await render(
    <AppStateProvider
      initialPrefs={options.prefs ?? guestPrefs}
      initialCart={options.cart ?? emptyCart}
    >
      <LocalizedApp>
        <Stack.Navigator>
          <Stack.Screen
            name={name}
            component={component as never}
            initialParams={params as never}
          />
          {name === "Cart" ? null : <Stack.Screen name="Cart" component={Placeholder} />}
        </Stack.Navigator>
      </LocalizedApp>
    </AppStateProvider>,
  );
}
