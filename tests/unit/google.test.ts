import { beforeAll, describe, expect, it } from "vitest";
import * as jose from "jose";

process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.DATABASE_URL ??= "mysql://unused@127.0.0.1/unused";

let verify: typeof import("../../api/auth/google").verifyGoogleIdToken;
let keys: jose.JWTVerifyGetKey;
let privateKey: CryptoKey;

async function token(claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string } = {}) {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? "https://accounts.google.com")
    .setAudience(opts.aud ?? "test-client.apps.googleusercontent.com")
    .setSubject("1234567890")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await jose.generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  const jwk = { ...(await jose.exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  keys = jose.createLocalJWKSet({ keys: [jwk] });
  verify = (await import("../../api/auth/google")).verifyGoogleIdToken;
});

describe("verifyGoogleIdToken", () => {
  it("accepts a valid, verified token and normalizes the email", async () => {
    const profile = await verify(await token({ email: "Client@Example.COM", email_verified: true, name: "Client One" }), keys);
    expect(profile).toEqual({ sub: "1234567890", email: "client@example.com", name: "Client One", picture: null });
  });
  it("rejects a token issued for another app", async () => {
    await expect(verify(await token({ email: "a@b.co", email_verified: true }, { aud: "someone-else" }), keys)).rejects.toThrow();
  });
  it("rejects unverified emails", async () => {
    await expect(verify(await token({ email: "a@b.co", email_verified: false }), keys)).rejects.toThrow(/not verified/);
  });
  it("rejects other issuers and expired tokens", async () => {
    await expect(verify(await token({ email: "a@b.co", email_verified: true }, { iss: "https://evil.example" }), keys)).rejects.toThrow();
    await expect(verify(await token({ email: "a@b.co", email_verified: true }, { exp: "-1m" }), keys)).rejects.toThrow();
  });
});
