import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { mockApi, renderScreen, testSession } from "../test-utils";
import { ProfileScreen } from "./ProfileScreen";
import { SignInScreen } from "./SignInScreen";

// Supabase email sign-in configured (cycle 3: email only, no SMS provider).
jest.mock("../lib/config", () => ({
  config: {
    apiUrl: "http://localhost:3000",
    supabaseUrl: "https://project.supabase.test",
    supabaseAnonKey: "anon-key-for-tests",
    devAuth: false,
  },
}));

describe("C01: email sign-in", () => {
  it("offers email only and verifies the emailed code", async () => {
    const calls = mockApi({
      "POST /auth/v1/otp": () => ({ body: {} }),
      "POST /auth/v1/verify": () => ({
        body: { access_token: "access", refresh_token: "refresh", expires_in: 3600 },
      }),
      "GET /v1/me": () => ({ body: { data: testSession.profile } }),
    });
    await renderScreen("SignIn", SignInScreen as never, undefined);
    expect(screen.queryByText("Phone number")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("otp-target"), "not-an-email");
    expect(screen.getByTestId("otp-send").props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId("otp-target"), " Customer@Example.test ");
    await fireEvent.press(screen.getByTestId("otp-send"));
    await screen.findByTestId("otp-code");
    expect(calls.find((c) => c.path === "/auth/v1/otp")?.body).toEqual({
      email: "customer@example.test",
      create_user: true,
    });
    await fireEvent.changeText(screen.getByTestId("otp-code"), "123456");
    await fireEvent.press(screen.getByTestId("otp-verify"));
    await waitFor(() => expect(calls.some((c) => c.path === "/v1/me")).toBe(true));
    expect(calls.find((c) => c.path === "/auth/v1/verify")?.body).toEqual({
      email: "customer@example.test",
      token: "123456",
      type: "email",
    });
  });
});

describe("C12: delete account", () => {
  it("needs DELETE typed, calls the API, then signs out", async () => {
    const calls = mockApi({
      "POST /v1/me/deletion": () => ({ body: { data: { deleted: true } } }),
    });
    await renderScreen("Profile" as never, ProfileScreen as never, undefined as never, {
      session: testSession,
    });
    await fireEvent.press(screen.getByTestId("privacy-deletion"));
    expect(screen.getByTestId("delete-account-submit").props.accessibilityState?.disabled).toBe(
      true,
    );
    await fireEvent.changeText(screen.getByTestId("delete-account-confirm-text"), "DELETE");
    await fireEvent.press(screen.getByTestId("delete-account-submit"));
    await waitFor(() => expect(screen.queryByTestId("sign-out")).toBeNull());
    expect(calls.find((c) => c.path === "/v1/me/deletion")?.body).toEqual({ confirm: "DELETE" });
  });

  it("shows the server's refusal and stays signed in while an order is open", async () => {
    mockApi({
      "POST /v1/me/deletion": () => ({
        status: 409,
        body: {
          error: {
            code: "CONFLICT",
            message: "You have an order in progress.",
            requestId: "t",
          },
        },
      }),
    });
    await renderScreen("Profile" as never, ProfileScreen as never, undefined as never, {
      session: testSession,
    });
    await fireEvent.press(screen.getByTestId("privacy-deletion"));
    await fireEvent.changeText(screen.getByTestId("delete-account-confirm-text"), "DELETE");
    await fireEvent.press(screen.getByTestId("delete-account-submit"));
    expect(await screen.findByText(/order in progress/)).toBeTruthy();
    expect(screen.getByTestId("sign-out")).toBeTruthy();
  });
});
