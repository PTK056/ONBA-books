"use client";

import Script from "next/script";
import { useActionState, useEffect, useRef } from "react";
import { sendMagicLink, verifyCode, type LoginState } from "./actions";

// Cloudflare Turnstile: stops robots from spending the project's shared sign-in e-mail quota.
// Off until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; turn on captcha in Supabase Auth only after that.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
declare global {
  interface Window { turnstile?: { render(el: HTMLElement, opts: Record<string, string>): string; reset(id?: string): void } }
}

const input =
  "h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "h-10 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});
  // A token is good for one try: after an error, get a fresh one.
  useEffect(() => { if (state.error) window.turnstile?.reset(); }, [state]);

  if (state.sent) return <CodeForm sent={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="text-sm font-medium" htmlFor="email">Work e-mail</label>
      <input id="email" name="email" type="email" required autoComplete="email" autoFocus className={input} />
      {TURNSTILE_SITE_KEY && <Turnstile siteKey={TURNSTILE_SITE_KEY} />}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className={button}>
        {pending ? "Sending…" : "Send me a sign-in link"}
      </button>
    </form>
  );
}

/** The widget adds a hidden cf-turnstile-response field to the form; rendered explicitly so it survives client navigation. */
function Turnstile({ siteKey }: { siteKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const render = () => {
    if (box.current && window.turnstile && !box.current.hasChildNodes()) {
      window.turnstile.render(box.current, { sitekey: siteKey, size: "flexible", appearance: "interaction-only" });
    }
  };
  useEffect(render);
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={render} />
      <div ref={box} />
    </>
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
