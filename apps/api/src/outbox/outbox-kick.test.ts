import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { outboxKick } from "../bootstrap.js";

function run(method: string, status: number) {
  let kicks = 0;
  const middleware = outboxKick({ kick: () => (kicks += 1) });
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  let nextCalled = false;
  middleware({ method }, res, () => (nextCalled = true));
  expect(nextCalled).toBe(true);
  expect(kicks).toBe(0); // never before the response is finished
  res.emit("finish");
  return kicks;
}

describe("dispatch right after a write (serverless outbox)", () => {
  it("kicks the outbox once a successful write response is sent", () => {
    expect(run("POST", 201)).toBe(1);
    expect(run("PUT", 200)).toBe(1);
    expect(run("PATCH", 200)).toBe(1);
    expect(run("DELETE", 204)).toBe(1);
  });

  it("does nothing for reads or failed writes", () => {
    expect(run("GET", 200)).toBe(0);
    expect(run("POST", 409)).toBe(0);
    expect(run("POST", 500)).toBe(0);
  });
});
