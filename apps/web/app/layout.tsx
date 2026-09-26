import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ripple",
  description:
    "A self-improving harness that designs circuit boards from a spec, checks them against a hidden spec it never sees, and redesigns itself based on what fails.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
