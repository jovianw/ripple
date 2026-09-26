import { HarnessDashboard } from "@/components/harness/HarnessDashboard";

export const metadata = { title: "Ripple · harness" };

export default async function HarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board } = await searchParams;
  return <HarnessDashboard sessionBoardId={board ?? null} />;
}
