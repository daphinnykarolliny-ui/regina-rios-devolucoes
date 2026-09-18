import { describe, it, expect } from "vitest";
import { getHealthStatus } from "./health";

describe("getHealthStatus", () => {
  it("reports ok with an ISO timestamp", () => {
    const result = getHealthStatus();
    expect(result.status).toBe("ok");
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
