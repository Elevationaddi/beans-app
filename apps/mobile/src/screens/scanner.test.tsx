import { act, fireEvent, screen } from "@testing-library/react-native";
import { tableTokenFromScan } from "../lib/table";
import { mockApi, renderScreen } from "../test-utils";
import { TableScreen } from "./TableScreen";

// expo-camera needs native code; this stand-in records the props the scanner passes.
let mockCamera: {
  onBarcodeScanned?: (e: { data: string }) => void;
  barcodeScannerSettings?: unknown;
};
let mockPermission: { granted: boolean; canAskAgain: boolean } | null;
const mockRequestPermission = jest.fn(async () => {
  mockPermission = { granted: true, canAskAgain: true };
});
jest.mock("expo-camera", () => ({
  CameraView: (props: typeof mockCamera) => {
    mockCamera = props;
    return null;
  },
  useCameraPermissions: () => [mockPermission, mockRequestPermission],
}));

const TOKEN = "t1.AbCdEfGhIjKlMnOpQrStUv.3.Zx9_Yw8-Vu7Ts6Rq5Po4";
const TABLE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("reading a table QR", () => {
  it("takes the code from the printed link or a bare code, and nothing else", () => {
    expect(tableTokenFromScan(`https://app.example.test/?table=${encodeURIComponent(TOKEN)}`)).toBe(
      TOKEN,
    );
    expect(tableTokenFromScan(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(tableTokenFromScan("https://evil.example/?table=not-a-code")).toBeNull();
    expect(tableTokenFromScan("https://pay.example/invoice/123")).toBeNull();
    expect(tableTokenFromScan(`javascript:alert(1)//?table=${TOKEN}`)).toBeNull();
    expect(tableTokenFromScan("WIFI:S:cafe;T:WPA;P:secret;;")).toBeNull();
  });
});

describe("in-app table scanner", () => {
  beforeEach(() => {
    mockPermission = { granted: true, canAskAgain: true };
    mockCamera = {};
  });

  it("scans QR codes only, ignores other codes and checks the table with the server", async () => {
    const calls = mockApi({
      "GET /v1/tables/resolve": () => ({
        body: {
          data: {
            branchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            brandName: "Test Roasters",
            branchNames: { en: "Branch 1" },
            table: { id: TABLE_ID, label: "T7" },
          },
        },
      }),
    });
    await renderScreen("Table", TableScreen as never, undefined);
    await fireEvent.press(screen.getByTestId("table-scan"));
    expect(screen.getByTestId("scanner")).toBeTruthy();
    expect(mockCamera.barcodeScannerSettings).toEqual({ barcodeTypes: ["qr"] });

    await act(async () => mockCamera.onBarcodeScanned?.({ data: "https://pay.example/invoice/1" }));
    expect(await screen.findByText("That QR code is not a table code from this app.")).toBeTruthy();
    expect(calls.some((c) => c.path === "/v1/tables/resolve")).toBe(false);

    const link = `https://app.example.test/?table=${encodeURIComponent(TOKEN)}`;
    await act(async () => mockCamera.onBarcodeScanned?.({ data: link }));
    // A second frame of the same code is ignored.
    await act(async () => mockCamera.onBarcodeScanned?.({ data: link }));
    expect(await screen.findByText("Table T7")).toBeTruthy();
    const resolves = calls.filter((c) => c.path === "/v1/tables/resolve");
    expect(resolves).toHaveLength(1);
    expect(resolves[0]?.query.get("token")).toBe(TOKEN);
  });

  it("asks for the camera only when the scanner opens", async () => {
    mockPermission = { granted: false, canAskAgain: true };
    mockApi({});
    await renderScreen("Table", TableScreen as never, undefined);
    expect(mockRequestPermission).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("table-scan"));
    expect(screen.getByTestId("scan-permission")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("scan-allow"));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it("offers the phone's settings when the camera was refused for good", async () => {
    mockPermission = { granted: false, canAskAgain: false };
    mockApi({});
    await renderScreen("Table", TableScreen as never, undefined);
    await fireEvent.press(screen.getByTestId("table-scan"));
    expect(screen.getByTestId("scan-settings")).toBeTruthy();
  });
});
