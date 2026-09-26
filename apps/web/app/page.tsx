import { RunConsole } from "@/components/run-console";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-xl font-semibold">Ripple</h1>
        <p className="mt-1 max-w-2xl text-sm text-secondary">
          A self-improving harness that designs circuit boards from a spec, checks
          them against a hidden spec it never sees, and redesigns itself based on
          what fails.
        </p>
      </header>

      <RunConsole />
    </main>
  );
}
