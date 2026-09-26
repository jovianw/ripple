import Link from "next/link";

type Tab = "board" | "harness" | "system";

const TABS: { id: Tab; label: string; href: string }[] = [
  { id: "board", label: "Board", href: "/board" },
  { id: "harness", label: "Harness", href: "/harness" },
  { id: "system", label: "System", href: "/system" },
];

/** Top-level page tabs, shared by every header so order and styling agree. */
export function NavTabs({ active }: { active?: Tab }) {
  return (
    <nav className="flex items-center gap-1 rounded-md border border-line-soft bg-raised p-0.5 text-[13px]">
      {TABS.map((tab) =>
        tab.id === active ? (
          <span
            key={tab.id}
            aria-current="page"
            className="rounded-[5px] bg-accent/15 px-3 py-1 font-medium text-accent"
          >
            {tab.label}
          </span>
        ) : (
          <Link
            key={tab.id}
            href={tab.href}
            className="rounded-[5px] px-3 py-1 text-dim hover:bg-white/5 hover:text-ink"
          >
            {tab.label}
          </Link>
        ),
      )}
    </nav>
  );
}
