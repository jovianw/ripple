import Link from "next/link";
import { signInEmailAction, signInGoogleAction } from "@/lib/auth-actions";

export const metadata = { title: "Ripple · sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <Link href="/" className="text-[15px] font-medium tracking-[0.08em] text-ink hover:text-accent">
        Ripple
      </Link>
      <p className="text-[13px] text-dim">Sign in to build boards and keep your own history.</p>

      {error ? <p className="text-[12px] text-bad">Sign-in failed ({error}). Try again.</p> : null}

      <form action={signInGoogleAction} className="w-full">
        <button
          type="submit"
          className="w-full rounded-md bg-accent px-5 py-2 text-[13px] font-semibold text-[#06121f] hover:opacity-90"
        >
          Continue with Google
        </button>
      </form>

      <div className="flex w-full items-center gap-3 text-[11px] text-faint">
        <span className="h-px flex-1 bg-hair" />
        or
        <span className="h-px flex-1 bg-hair" />
      </div>

      <form action={signInEmailAction} className="flex w-full flex-col gap-2">
        <label htmlFor="email" className="sr-only">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-sm border border-line bg-raised px-3 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="w-full rounded-md border border-line-strong px-5 py-2 text-[13px] font-semibold text-dim hover:border-accent hover:text-accent"
        >
          Continue with email
        </button>
      </form>
    </div>
  );
}
