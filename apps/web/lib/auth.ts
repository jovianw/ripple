// Auth.js (NextAuth v5) wiring: real accounts, database sessions.
//
// Uses its own Atlas user (MONGODB_URI_AUTH), readWrite scoped to exactly the four
// collections the adapter owns (users, accounts, sessions, verification_tokens).
// Design state (runs, boards, spec_requests, ...) still has exactly one writer:
// the worker (AGENTS.md "one writer"). This client never touches those collections.
//
// Google for most sign-ins, email magic links (via Resend) for anyone without a Google
// account. trustHost is required self-hosted (not on Vercel's own domain detection): without
// it, Auth.js v5 silently drops the session cookie on callback instead of throwing, which
// looks exactly like "sign-in does nothing."
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

export const authConfigured = (): boolean =>
  Boolean(
    process.env.MONGODB_URI_AUTH &&
      process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET &&
      process.env.AUTH_RESEND_KEY,
  );

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: MongoDBAdapter(authClient(), { databaseName: process.env.MONGODB_DB || "ripple" }),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    // Google verifies the email before issuing the token, so it's safe to attach a Google
    // sign-in to an existing account with the same email (e.g. someone who signed in with the
    // email magic link first) instead of throwing OAuthAccountNotLinked and forcing them to
    // remember which method they used the first time.
    Google({ allowDangerousEmailAccountLinking: true }),
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM || "Ripple <onboarding@resend.dev>",
    }),
  ],
  pages: { signIn: "/sign-in" },
}));
