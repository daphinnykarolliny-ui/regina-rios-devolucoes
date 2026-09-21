import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

describe("session tokens", () => {
  it("round-trips the username with the correct secret", () => {
    const token = createSessionToken("daphinny", "secret-1");
    expect(verifySessionToken(token, "secret-1")).toEqual({ username: "daphinny" });
  });

  it("rejects a token verified with the wrong secret", () => {
    const token = createSessionToken("daphinny", "secret-1");
    expect(verifySessionToken(token, "secret-2")).toBeNull();
  });

  it("rejects a tampered token", () => {
    const token = createSessionToken("daphinny", "secret-1");
    const tampered = token.replace(/.$/, token.endsWith("a") ? "b" : "a");
    expect(verifySessionToken(tampered, "secret-1")).toBeNull();
  });
});
