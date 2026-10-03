import Link from "next/link";

import { NavTabs } from "@/components/NavTabs";
import { AccountWidgetClient } from "@/components/AccountWidgetClient";

// Held-out ablation from docs/report: same cheap model, four held-out specs,
// memory writes off. Each spec is one segment, so a board is a 25-point step.
const HELD_OUT = [
  { id: "h01", name: "USB-C humidity node" },
  { id: "h02", name: "MCU temperature logger" },
  { id: "h03", name: "RC low-pass" },
  { id: "h04", name: "Dual LED driver" },
];

const RESULTS: { label: string; note: string; passed: string[] }[] = [
  { label: "Bare model", note: "No harness", passed: [] },
  { label: "v0 harness", note: "Loop, checks, critic", passed: ["h03", "h04"] },
  { label: "Evolved harness", note: "Learned rules and library", passed: ["h02", "h03", "h04"] },
];

const STEPS = [
  {
    title: "Describe",
    body: "Write the board you want in plain English: “USB-C powered temperature sensor with a status LED.”",
  },
  {
    title: "Design and check",
    body: "Agents plan the board in tscircuit, autoroute it, and run DRC plus hidden checks it never sees. A critic diagnoses each failure and the board is repaired.",
  },
  {
    title: "Evolve",
    body: "A meta-agent rewrites the harness itself (rules, context, tools, model routing), and a gate keeps a change only if the next batch scores better.",
  },
];

function RippleMark() {
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28" aria-hidden>
      {[0, 1.2, 2.4].map((delay) => (
        <circle
          key={delay}
          className="ripple-ring"
          style={{ animationDelay: `${delay}s` }}
          cx="60"
          cy="60"
          r="56"
          fill="none"
          stroke="#4ec9e0"
          strokeWidth="2.5"
        />
      ))}
      <circle cx="60" cy="60" r="28" fill="none" stroke="#43a0b5" strokeWidth="6" />
      <circle cx="60" cy="60" r="13" fill="#4ec9e0" />
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <header className="flex h-12 shrink-0 items-center justify-between">
        <div className="flex items-center gap-3 sm:gap-5">
          <span className="text-[15px] font-medium tracking-[0.08em] text-ink">Ripple</span>
          <NavTabs />
        </div>
        <div className="flex items-center gap-5">
          <AccountWidgetClient />
          <Link
            href="/board"
            className="hidden rounded-md bg-accent px-4 py-1.5 text-[13px] font-semibold text-[#06121f] hover:opacity-90 sm:inline-block"
          >
            Start a build →
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="flex flex-col items-start gap-8 pb-16 pt-20 sm:flex-row sm:items-center sm:gap-12">
          <RippleMark />
          <div className="max-w-2xl">
            <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[48px]">
              Circuit boards from plain English.
            </h1>
            <p className="mt-4 text-[16px] leading-relaxed text-dim">
              Ripple designs a PCB from a spec, grades it against hidden requirements it never sees,
              and rewrites its own harness based on what fails. The model doesn’t get smarter; the
              harness does.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/board"
                className="rounded-md bg-accent px-5 py-2.5 text-[14px] font-semibold text-[#06121f] hover:opacity-90"
              >
                Start a build →
              </Link>
              <Link
                href="/harness"
                className="rounded-md border border-line-soft px-5 py-2.5 text-[14px] text-ink hover:border-accent hover:text-accent"
              >
                See how the harness evolves
              </Link>
            </div>
          </div>
        </section>

        <section className="border-t border-hair py-12">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.14em] text-dim">How it works</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-md border border-line-soft bg-raised p-5">
                <div className="font-mono text-[12px] text-accent">0{i + 1}</div>
                <div className="mt-2 text-[16px] font-medium text-ink">{step.title}</div>
                <p className="mt-2 text-[13px] leading-relaxed text-dim">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-hair py-12">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.14em] text-dim">
            Same model, better harness
          </h2>
          <p className="mt-2 text-[13px] text-dim">
            Held-out specs passed, out of 4. Same cheap model (GPT-4o-mini) in every condition; hover a
            segment for the spec.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {RESULTS.map((r, i) => {
              const best = i === RESULTS.length - 1;
              return (
                <div
                  key={r.label}
                  className={`rounded-md border p-5 ${best ? "border-accent/50 bg-accent/5" : "border-line-soft bg-raised"}`}
                >
                  <div className="text-[13px] text-dim">{r.label}</div>
                  <div className="mt-1 text-[32px] font-semibold leading-none text-ink">
                    {r.passed.length}
                    <span className="text-[18px] font-normal text-dim"> / {HELD_OUT.length}</span>
                  </div>
                  <div
                    className="mt-4 flex gap-[2px]"
                    role="img"
                    aria-label={`${r.label}: ${r.passed.length} of ${HELD_OUT.length} held-out specs passed`}
                  >
                    {HELD_OUT.map((spec) => {
                      const ok = r.passed.includes(spec.id);
                      return (
                        <div
                          key={spec.id}
                          title={`${spec.id} ${spec.name}: ${ok ? "passed" : "failed"}`}
                          className="group relative h-6 flex-1 cursor-default py-2"
                        >
                          <div className={`h-2 rounded-[4px] ${ok ? "bg-accent" : "bg-accent/15"}`} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 text-[12px] text-dim">{r.note}</div>
                </div>
              );
            })}
          </div>
          <table className="sr-only">
            <caption>Held-out specs passed by condition</caption>
            <thead>
              <tr>
                <th>Condition</th>
                {HELD_OUT.map((s) => (
                  <th key={s.id}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESULTS.map((r) => (
                <tr key={r.label}>
                  <th>{r.label}</th>
                  {HELD_OUT.map((s) => (
                    <td key={s.id}>{r.passed.includes(s.id) ? "passed" : "failed"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      <footer className="border-t border-hair py-6 text-[12px] text-dim">
        Built at the MongoDB Harness Engineering &amp; Model Wrangling Hackathon · tscircuit, MongoDB
        Atlas, Next.js on Vercel
      </footer>
    </div>
  );
}
