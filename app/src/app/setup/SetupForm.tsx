"use client";

import { useActionState } from "react";
import { setUp, type SetupState } from "./actions";

const CURRENCIES = ["IDR", "AUD", "USD", "EUR", "SGD", "GBP"];

export function SetupForm({ hasOrg }: { hasOrg: boolean }) {
  const [state, action, pending] = useActionState<SetupState, FormData>(setUp, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      {!hasOrg && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">Your organization</legend>
          <Text name="orgName" label="Name" placeholder="e.g. Casa Lima or Lima Villas Management" />
          <Currency name="reportingCurrency" label="Report in" defaultValue="USD"
            hint="The currency of your monthly figures and owner statements." />
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">{hasOrg ? "Add your first villa" : "Your first villa"}</legend>
        <Text name="villaName" label="Villa name" placeholder="e.g. Villa Lima" />
        <Currency name="villaCurrency" label="Spends in" defaultValue="IDR"
          hint="The currency of most receipts for this villa." />
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button
        disabled={pending}
        className="h-10 rounded-lg bg-brand-600 px-3 btn-label shadow-sm hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}

const field = "h-10 w-full rounded-lg border-0 border-b border-zinc-300 bg-transparent px-0.5 text-sm outline-none focus:border-brand-600 dark:border-zinc-700 dark:bg-transparent";

function Text({ name, label, placeholder }: { name: string; label: string; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <input name={name} required placeholder={placeholder} className={field} />
    </label>
  );
}

function Currency({ name, label, defaultValue, hint }: { name: string; label: string; defaultValue: string; hint: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <select name={name} defaultValue={defaultValue} className={field}>
        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
      </select>
      <span className="mt-1 block text-xs text-zinc-500">{hint}</span>
    </label>
  );
}
