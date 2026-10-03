"use server";

import { signIn, signOut } from "@/lib/auth";

// Without redirectTo, signIn() defaults to the referring page — which is /sign-in itself when
// the button lives there, so a *successful* sign-in looked identical to a failed one: it just
// landed back on the sign-in form.
export async function signInGoogleAction() {
  await signIn("google", { redirectTo: "/board" });
}

export async function signInEmailAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;
  await signIn("resend", { email, redirectTo: "/board" });
}

export async function signOutAction() {
  await signOut();
}
