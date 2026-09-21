import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./verify";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const salt = "some-salt";
    const hash = hashPassword("correct-horse", salt);
    expect(verifyPassword("correct-horse", salt, hash)).toBe(true);
    expect(verifyPassword("wrong-password", salt, hash)).toBe(false);
  });
});
