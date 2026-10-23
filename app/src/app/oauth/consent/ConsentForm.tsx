"use client";

import { useActionState } from "react";
import { decide, type ConsentState } from "./actions";

export function ConsentForm({ authorizationId }: { authorizationId: string }) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(decide, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="authorization_id" value={authorizationId} />
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button
        name="decision" value="approve" disabled={pending}
        className="h-10 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
      >
        Allow access
      </button>
      <button
        name="decision" value="deny" disabled={pending}
        className="h-10 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Deny
      </button>
    </form>
  );
}
