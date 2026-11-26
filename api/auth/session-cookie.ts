import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { signSessionToken } from "../kimi/session";

/** Serialized Set-Cookie header that signs the browser in as `unionId`. */
export async function sessionSetCookie(requestHeaders: Headers, unionId: string): Promise<string> {
  const token = await signSessionToken({ unionId, clientId: env.appId });
  const opts = getSessionCookieOptions(requestHeaders);
  return cookie.serialize(Session.cookieName, token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: opts.secure,
    maxAge: Session.maxAgeMs / 1000,
  });
}
