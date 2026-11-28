import { api, call } from "./api";
import { useRemote } from "./use-remote";

/** Whether ordering is open platform-wide (emergency pause) and which features are on. */
export function usePlatformStatus() {
  return useRemote(async () => (await call(api.GET("/v1/platform/status"))).data, []);
}
