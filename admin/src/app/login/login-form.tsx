"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-panel p-6 shadow-sm">
      {expired && !state.error && <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">Your session expired. Please sign in again.</p>}
      <input type="hidden" name="next" value={next} />
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-2">Email</span>
        <input name="email" type="email" required autoComplete="username" defaultValue={state.email}
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 outline-none focus:border-accent" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-2">Password</span>
        <input name="password" type="password" required autoComplete="current-password"
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 outline-none focus:border-accent" />
      </label>
      {state.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-bad">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-xs text-muted">Demo: manager@lakesidepalms.local / Admin@123</p>
    </form>
  );
}
