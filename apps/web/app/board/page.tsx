import { RippleDashboard } from "@/components/RippleDashboard";
import { AccountWidget } from "@/components/AccountWidget";
import { auth, authConfigured } from "@/lib/auth";

// Reads the session cookie: must render per-request, not prerender statically.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = authConfigured() ? await auth() : null;
  return <RippleDashboard accountSlot={<AccountWidget />} signedIn={!authConfigured() || Boolean(session?.user)} />;
}
