import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ripple — agentic PCB design",
  description:
    "Ripple designs, checks, and repairs printed circuit boards with a team of agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
