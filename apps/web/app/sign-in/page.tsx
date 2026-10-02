import Link from "next/link";
import { signInAction } from "@/lib/auth-actions";

export const metadata = { title: "Ripple · sign in" };

export default function SignInPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <Link href="/" className="text-[15px] font-medium tracking-[0.08em] text-ink hover:text-accent">
        Ripple
      </Link>
      <p className="text-[13px] text-dim">Sign in to build boards and keep your own history.</p>
      <form action={signInAction}>
        <button
          type="submit"
          className="rounded-md bg-accent px-5 py-2 text-[13px] font-semibold text-[#06121f] hover:opacity-90"
        >
          Continue with GitHub
        </button>
      </form>
    </div>
  );
}
