"use client";

import { useActionState } from "react";
import { sendMagicLink, verifyCode, type LoginState } from "./actions";

const input =
  "h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "h-10 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});

  if (state.sent) return <CodeForm sent={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="text-sm font-medium" htmlFor="email">Work e-mail</label>
      <input id="email" name="email" type="email" required autoComplete="email" autoFocus className={input} />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className={button}>
        {pending ? "Sending…" : "Send me a sign-in link"}
      </button>
    </form>
  );
}

function CodeForm({ sent }: { sent: LoginState }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(verifyCode, sent);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        We sent a link to <strong>{sent.sent}</strong>. Open it, or type the code from the e-mail here.
      </p>
      <label className="text-sm font-medium" htmlFor="code">Code</label>
      <input
        id="code" name="code" required autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={12}
        className={`${input} font-mono tracking-[0.3em]`}
      />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className={button}>
        {pending ? "Checking…" : "Sign in"}
      </button>
      <a href={`/login?next=${encodeURIComponent(sent.next ?? "/overview")}`} className="text-center text-xs text-zinc-500 hover:underline">
        Use another e-mail
      </a>
    </form>
  );
}
