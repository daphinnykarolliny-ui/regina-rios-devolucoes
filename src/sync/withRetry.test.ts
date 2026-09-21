import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./withRetry";

describe("withRetry", () => {
  it("returns the result once the function succeeds within the retry budget", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });

    const result = await withRetry(fn, { retries: 3, delayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error once retries are exhausted", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });

    await expect(withRetry(fn, { retries: 2, delayMs: 1 })).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
