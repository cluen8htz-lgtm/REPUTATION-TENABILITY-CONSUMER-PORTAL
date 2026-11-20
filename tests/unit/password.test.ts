import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, hashPassword, passwordProblem, verifyPassword } from "../../api/lib/password";

describe("passwords", () => {
  it("generates temporary passwords that pass the policy and are unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toHaveLength(16);
      expect(passwordProblem(pw)).toBeNull();
      seen.add(pw);
    }
    expect(seen.size).toBe(200);
  });
  it("hashes and verifies", async () => {
    const hash = await hashPassword("Correct-Horse-9");
    expect(await verifyPassword("Correct-Horse-9", hash)).toBe(true);
    expect(await verifyPassword("wrong-Horse-9", hash)).toBe(false);
  });
  it("rejects weak passwords", () => {
    expect(passwordProblem("short")).not.toBeNull();
    expect(passwordProblem("alllowercaseletters")).not.toBeNull();
  });
});
