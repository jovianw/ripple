"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/lib/auth-actions";

interface SessionUser {
  name?: string | null;
  email?: string | null;
}

/**
 * Client-side twin of AccountWidget, for the one page (the public landing page) that must stay
 * statically prerendered: a server AccountWidget calls auth(), which reads the session cookie and
 * forces the whole page dynamic (a MongoDB round trip on every cold view, including judges'/
 * reviewers' first load). This fetches Auth.js's own /api/auth/session endpoint after mount instead,
 * so the page shell stays static and only this one small island does per-viewer work.
 */
export function AccountWidgetClient() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setUser(data?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (user === undefined) return null; // loading: no flash of "Sign in" before we know

  if (!user) {
    return (
      <Link href="/sign-in" className="text-[12px] text-dim hover:text-accent">
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-faint">{user.name ?? user.email}</span>
      <form action={signOutAction}>
        <button type="submit" className="text-[12px] text-dim hover:text-accent">
          Sign out
        </button>
      </form>
    </div>
  );
}
