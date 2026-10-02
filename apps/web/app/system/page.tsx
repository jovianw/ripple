import { SystemConsole } from "@/components/system/SystemConsole";
import { AccountWidget } from "@/components/AccountWidget";

export const metadata = { title: "Ripple · system" };
// Reads the session cookie via AccountWidget: must render per-request, not prerender statically.
export const dynamic = "force-dynamic";

export default function SystemPage() {
  return <SystemConsole accountSlot={<AccountWidget />} />;
}
