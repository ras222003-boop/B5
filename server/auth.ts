import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { createPool } from "mysql2/promise";
import { SignJWT, importPKCS8 } from "jose";
import { authOriginPolicy } from "./authOrigins";
import { databaseConnectionOptions } from "./databaseConfig";

if (!process.env.MANUS_JWT_SECRET) throw new Error("MANUS_JWT_SECRET is required for Basira accounts");

export const pool = createPool(databaseConnectionOptions(process.env));
export type SocialProvider = "google" | "microsoft" | "apple" | "facebook";
export const providerReady: Record<SocialProvider, boolean> = {
  google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
  apple: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
  facebook: Boolean(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET),
};

// Keep the application's signing key cryptographically separated from platform JWTs.
const secret = createHash("sha256").update(`basira-account-session-v1:${process.env.MANUS_JWT_SECRET}`).digest("hex");
// Secure is the default; only the explicit local development command uses HTTP cookies.
const { production, baseURL, trustedOrigins } = authOriginPolicy({
  nodeEnv: process.env.NODE_ENV, publicURL: process.env.BASIRA_PUBLIC_URL,
});
const apple = providerReady.apple ? {
  apple: async () => {
    const clientId = process.env.APPLE_CLIENT_ID!;
    const key = await importPKCS8(process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n"), "ES256");
    const now = Math.floor(Date.now() / 1000);
    const clientSecret = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_KEY_ID! })
      .setIssuer(process.env.APPLE_TEAM_ID!)
      .setSubject(clientId)
      .setAudience("https://appleid.apple.com")
      .setIssuedAt(now)
      .setExpirationTime(now + 150 * 24 * 60 * 60)
      .sign(key);
    return { clientId, clientSecret };
  },
} : {};

export const auth = betterAuth({
  appName: "بصيرة · Aurum Nexus",
  database: pool,
  secret,
  baseURL,
  trustedOrigins,
  advanced: {
    cookiePrefix: "basira",
    useSecureCookies: production,
    defaultCookieAttributes: { httpOnly: true, secure: production, sameSite: production ? "none" : "lax" },
    database: { validateSchema: false }, // Startup runs the committed additive migrations first.
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  socialProviders: {
    ...(providerReady.google ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } } : {}),
    ...(providerReady.microsoft ? { microsoft: { clientId: process.env.MICROSOFT_CLIENT_ID!, clientSecret: process.env.MICROSOFT_CLIENT_SECRET!, tenantId: "common" } } : {}),
    ...apple,
    ...(providerReady.facebook ? { facebook: { clientId: process.env.FACEBOOK_CLIENT_ID!, clientSecret: process.env.FACEBOOK_CLIENT_SECRET! } } : {}),
  },
});
