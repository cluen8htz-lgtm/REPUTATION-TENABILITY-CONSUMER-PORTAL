import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { appReturnPage, challengeFor, isAppChallenge, issueAppCode, redeemAppCode } from "../../api/auth/app-handoff";

const verifier = () => randomBytes(48).toString("base64url");

describe("scanner app Google handoff", () => {
  it("redeems a code once, only with the matching verifier", async () => {
    const v = verifier();
    const challenge = challengeFor(v);
    expect(isAppChallenge(challenge)).toBe(true);
    const code = await issueAppCode("google:123", challenge);
    expect(await redeemAppCode(code, verifier())).toBeNull();
    expect(await redeemAppCode(code, v)).toBe("google:123");
    expect(await redeemAppCode(code, v)).toBeNull();
  });

  it("rejects tampered codes and malformed challenges", async () => {
    const v = verifier();
    const code = await issueAppCode("local:a@b.test", challengeFor(v));
    expect(await redeemAppCode(code.slice(0, -2) + "xx", v)).toBeNull();
    expect(isAppChallenge("short")).toBe(false);
    expect(isAppChallenge("a".repeat(42) + "=")).toBe(false);
  });

  it("builds an escaped return page for the app scheme", () => {
    const html = appReturnPage({ error: "invite_only" });
    expect(html).toContain("rtscanner://auth?error=invite_only");
    expect(appReturnPage({ code: 'x"<y' })).not.toContain('x"<y');
  });
});
