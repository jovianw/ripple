import { auth, authConfigured } from "@/lib/auth";
import { signInAction, signOutAction } from "@/lib/auth-actions";

/** Sign-in link when signed out, or the account's name/email + sign-out when signed in. Server-rendered. */
export async function AccountWidget() {
  if (!authConfigured()) {
    return <span className="text-[12px] text-faint">Sign-in not configured</span>;
  }

  const session = await auth();
  if (!session?.user) {
    return (
      <form action={signInAction}>
        <button type="submit" className="text-[12px] text-dim hover:text-accent">
          Sign in
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-faint">{session.user.name ?? session.user.email}</span>
      <form action={signOutAction}>
        <button type="submit" className="text-[12px] text-dim hover:text-accent">
          Sign out
        </button>
      </form>
    </div>
  );
}
