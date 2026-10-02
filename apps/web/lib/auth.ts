// Auth.js (NextAuth v5) wiring: real accounts, database sessions.
//
// Uses its own Atlas user (MONGODB_URI_AUTH), readWrite scoped to exactly the four
// collections the adapter owns (users, accounts, sessions, verification_tokens).
// Design state (runs, boards, spec_requests, ...) still has exactly one writer:
// the worker (AGENTS.md "one writer"). This client never touches those collections.
import { MongoClient } from "mongodb";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

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
  Boolean(process.env.MONGODB_URI_AUTH && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: MongoDBAdapter(authClient(), { databaseName: process.env.MONGODB_DB || "ripple" }),
  session: { strategy: "database" },
  providers: [GitHub],
  pages: { signIn: "/sign-in" },
}));
