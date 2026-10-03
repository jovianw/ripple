import { HarnessDashboard } from "@/components/harness/HarnessDashboard";
import { AccountWidget } from "@/components/AccountWidget";

export const metadata = { title: "Ripple · harness" };
// Reads the session cookie via AccountWidget: must render per-request, not prerender statically.
export const dynamic = "force-dynamic";

export default async function HarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board } = await searchParams;
  return <HarnessDashboard sessionBoardId={board ?? null} accountSlot={<AccountWidget />} />;
}
