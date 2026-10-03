// Auth.js (NextAuth v5) wiring: real accounts, database sessions.
//
// Uses its own Atlas user (MONGODB_URI_AUTH), readWrite scoped to exactly the four
// collections the adapter owns (users, accounts, sessions, verification_tokens).
// Design state (runs, boards, spec_requests, ...) still has exactly one writer:
// the worker (AGENTS.md "one writer"). This client never touches those collections.
//
// Google for most sign-ins, email magic links (via Resend) for anyone without a Google
// account — Resend is optional; a Google-only deployment is still "configured" (see
// authConfigured below) and only registers the Google provider.
//
// trustHost is the *local-dev* fallback: Auth.js reads it only when AUTH_URL isn't set
// (@auth/core/lib/utils/env.js createActionURL), and falls back to building callback and
// magic-link URLs from the request's Host header. That's fine on localhost, but in production
// set AUTH_URL explicitly (.env.example) — otherwise a forged Host header behind a
// misconfigured proxy could put an attacker's domain into a real user's magic-link email.
import { MongoClient } from "mongodb";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";

const globalForAuth = globalThis as unknown as { _rippleAuthMongo?: MongoClient };

function authClient(): MongoClient {
  const uri = process.env.MONGODB_URI_AUTH;
  if (!uri) {
    throw new Error(
      "MONGODB_URI_AUTH is not set. Add it to apps/web/.env.local locally, " +
        "and to the Vercel project's environment variables for deploys.",
    );
  }
  globalForAuth._rippleAuthMongo ??= new MongoClient(uri, { appName: "ripple-web-auth" });
  return globalForAuth._rippleAuthMongo;
}

const googleConfigured = (): boolean =>
  Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
const resendConfigured = (): boolean => Boolean(process.env.AUTH_RESEND_KEY);

/** True once the adapter can run and at least one sign-in method actually works. */
export const authConfigured = (): boolean =>
  Boolean(process.env.MONGODB_URI_AUTH) && (googleConfigured() || resendConfigured());

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: MongoDBAdapter(authClient(), { databaseName: process.env.MONGODB_DB || "ripple" }),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    // Google verifies the email before issuing the token, so it's safe to attach a Google
    // sign-in to an existing account with the same email (e.g. someone who signed in with the
    // email magic link first) instead of throwing OAuthAccountNotLinked and forcing them to
    // remember which method they used the first time.
    ...(googleConfigured() ? [Google({ allowDangerousEmailAccountLinking: true })] : []),
    ...(resendConfigured()
      ? [
          Resend({
            apiKey: process.env.AUTH_RESEND_KEY,
            from: process.env.EMAIL_FROM || "Ripple <onboarding@resend.dev>",
          }),
        ]
      : []),
  ],
  pages: { signIn: "/sign-in" },
}));
