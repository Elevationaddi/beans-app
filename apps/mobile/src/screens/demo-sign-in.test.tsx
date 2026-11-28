import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { mockApi, renderScreen, testSession } from "../test-utils";
import { SignInScreen } from "./SignInScreen";

// A private staging build: demo accounts may sign in with a password (cycle 4).
jest.mock("../lib/config", () => ({
  config: {
    apiUrl: "http://localhost:3000",
    supabaseUrl: "https://project.supabase.test",
    supabaseAnonKey: "anon-key-for-tests",
    devAuth: false,
    demoPasswordSignIn: true,
  },
}));

describe("C01: staging demo-account sign-in", () => {
  it("signs a demo account in with its password, alongside the email code", async () => {
    const calls = mockApi({
      "POST /auth/v1/token": () => ({
        body: { access_token: "access", refresh_token: "refresh", expires_in: 3600 },
      }),
      "GET /v1/me": () => ({ body: { data: testSession.profile } }),
    });
    await renderScreen("SignIn", SignInScreen as never, undefined);
    expect(screen.getByTestId("otp-target")).toBeTruthy();
    expect(screen.getByText("Demo account (private staging)")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("demo-email"), " Customer.Demo@example.test ");
    await fireEvent.changeText(screen.getByTestId("demo-password"), "fictional-password");
    await fireEvent.press(screen.getByTestId("demo-sign-in-submit"));
    await waitFor(() => expect(calls.some((c) => c.path === "/v1/me")).toBe(true));
    expect(calls.find((c) => c.path === "/auth/v1/token")?.body).toEqual({
      email: "customer.demo@example.test",
      password: "fictional-password",
    });
  });
});
