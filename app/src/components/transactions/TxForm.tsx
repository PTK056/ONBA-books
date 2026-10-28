"use client";

import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTransaction, type TxInput, updateTransaction } from "@/app/(app)/transactions/actions";
import { parseAmount } from "@/components/review/amount";
import { money } from "@/components/overview/format";
import { uploadEvidenceFile } from "@/lib/receipts/upload";
import type { Split } from "@/lib/split/book";
import { weightedShares } from "@/lib/split/shares";
import { createClient } from "@/lib/supabase/client";

interface Props {
  mode: "create" | "edit";
  id?: string;
  organizationId: string;
  reportingCurrency: string;
  villas: { id: string; name: string; currency: string }[];
  categories: { id: string; name: string; kind: string }[];
  initial?: Partial<TxInput>;
  /** The real villas, to split a shared expense between them (new entries, two villas or more). */
  splitVillas?: { id: string; name: string }[];
}

const field = "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900";

/** Add an expense or income by hand (optionally with its receipt), or correct an existing entry. */
export function TxForm({ mode, id, organizationId, reportingCurrency, villas, categories, initial, splitVillas = [] }: Props) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const firstVilla = initial?.villaId ?? villas[0]?.id ?? "";
  const [direction, setDirection] = useState<"in" | "out">(initial?.direction ?? "out");
  const [date, setDate] = useState(initial?.date ?? today);
  const [amountText, setAmountText] = useState(initial?.amount ? String(initial.amount) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? villas.find((v) => v.id === firstVilla)?.currency ?? reportingCurrency);
  const [rateText, setRateText] = useState(initial?.fxRate && initial.currency !== reportingCurrency ? String(initial.fxRate) : "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [villaId, setVillaId] = useState(firstVilla);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [file, setFile] = useState<File | null>(null);
  const canSplit = mode === "create" && splitVillas.length >= 2;
  const [splitting, setSplitting] = useState(false);
  const [splitMode, setSplitMode] = useState<Split["mode"]>("equal");
  const [splitIds, setSplitIds] = useState<string[]>(splitVillas.map((v) => v.id));
  const [percents, setPercents] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const kind = direction === "out" ? "expense" : "income";
  const amount = parseAmount(amountText, currency);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount === null || amount <= 0) return setError("Enter the amount.");
    const input: TxInput = {
      direction, date, amount, currency, villaId, description,
      categoryId: categoryId || null,
      fxRate: currency === reportingCurrency ? null : rateText ? parseAmount(rateText, "") : null,
    };
    const split: Split | undefined = splitting
      ? { villaIds: splitIds, mode: splitMode, percents: splitMode === "percent" ? splitIds.map((v) => Number(percents[v] || 0)) : undefined }
      : undefined;
    if (split && split.villaIds.length < 2) return setError("Choose at least two villas to split between.");
    start(async () => {
      let uploaded: { path: string; mimeType: string } | null = null;
      if (file) {
        try { uploaded = await uploadEvidenceFile(createClient(), organizationId, file); }
        catch (err) { return setError(err instanceof Error ? err.message : "Upload failed"); }
      }
      const r = mode === "create" ? await createTransaction(input, uploaded, split) : await updateTransaction(id!, input);
      if (!r.ok) return setError(r.error);
      router.push(`/transactions/${r.id}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="inline-flex w-fit rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
        {(["out", "in"] as const).map((d) => (
          <button
            key={d} type="button" onClick={() => { setDirection(d); setCategoryId(""); }}
            className={`rounded-md px-4 py-1.5 ${direction === d ? "bg-white font-medium shadow-sm dark:bg-zinc-900" : "text-zinc-500"}`}
          >
            {d === "out" ? "Expense" : "Income"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Label text="Date"><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} /></Label>
        <Label text="Villa">
          {splitting
            ? <p className="flex h-10 items-center text-sm text-zinc-500">Split between villas, below</p>
            : (
              <select value={villaId} onChange={(e) => setVillaId(e.target.value)} className={field}>
                {villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
          {canSplit && (
            <span className="mt-1.5 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={splitting} onChange={(e) => setSplitting(e.target.checked)} />
              Shared by several villas: split it
            </span>
          )}
        </Label>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Label text="Amount">
            <input inputMode="decimal" required value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="1,000,000" className={`${field} text-right tabular-nums`} />
          </Label>
          <Label text="Currency">
            <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} className={`${field} uppercase`} />
          </Label>
        </div>
        <Label text="Category">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
            <option value="">— No category —</option>
            {categories.filter((c) => c.kind === kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Label>
        {currency.length === 3 && currency !== reportingCurrency && (
          <Label text={`Rate ${currency} → ${reportingCurrency}`}>
            <input inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} placeholder="Last rate used if empty" className={`${field} tabular-nums`} />
          </Label>
        )}
        <Label text="Description" wide>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Electricity token, PLN" className={field} />
        </Label>
      </div>

      {splitting && (
        <SplitBox
          villas={splitVillas} ids={splitIds} setIds={setSplitIds} mode={splitMode} setMode={setSplitMode}
          percents={percents} setPercents={setPercents} amount={amount} currency={currency}
        />
      )}

      {mode === "create" && (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
          <Paperclip size={16} className="text-zinc-400" />
          <span className="flex-1 truncate">{file ? file.name : "Attach the receipt or invoice (optional, you can add it later)"}</span>
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">Cancel</button>
        <button disabled={pending} className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">
          {pending ? "Saving…" : mode === "create" ? `Add ${direction === "out" ? "expense" : "income"}` : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Label({ text, wide, children }: { text: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{text}</span>
      {children}
    </label>
  );
}

/** Which villas share the expense, and how: equal shares, by nights booked that month, or by percentage. */
function SplitBox({ villas, ids, setIds, mode, setMode, percents, setPercents, amount, currency }: {
  villas: { id: string; name: string }[]; ids: string[]; setIds: (x: string[]) => void;
  mode: Split["mode"]; setMode: (m: Split["mode"]) => void;
  percents: Record<string, string>; setPercents: (p: Record<string, string>) => void;
  amount: number | null; currency: string;
}) {
  const chosen = villas.filter((v) => ids.includes(v.id));
  const shares = amount && chosen.length && mode !== "nights"
    ? weightedShares(amount, chosen.map((v) => (mode === "equal" ? 1 : Number(percents[v.id] || 0))))
    : null;
  const total = chosen.reduce((s, v) => s + Number(percents[v.id] || 0), 0);
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : villas.map((v) => v.id).filter((x) => x === id || ids.includes(x)));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {([["equal", "Equal shares"], ["nights", "By nights booked that month"], ["percent", "By percentage"]] as const).map(([m, label]) => (
          <label key={m} className="flex items-center gap-1.5">
            <input type="radio" name="split-mode" checked={mode === m} onChange={() => setMode(m)} /> {label}
          </label>
        ))}
      </div>
      <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
        {villas.map((v) => {
          const i = chosen.findIndex((c) => c.id === v.id);
          return (
            <div key={v.id} className="flex items-center gap-3 py-1.5">
              <label className="flex flex-1 items-center gap-2">
                <input type="checkbox" checked={i >= 0} onChange={() => toggle(v.id)} /> {v.name}
              </label>
              {mode === "percent" && i >= 0 && (
                <span className="flex items-center gap-1">
                  <input inputMode="decimal" value={percents[v.id] ?? ""} onChange={(e) => setPercents({ ...percents, [v.id]: e.target.value })}
                    className="h-8 w-16 rounded-md border border-zinc-300 px-2 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900" aria-label={`${v.name} %`} />%
                </span>
              )}
              <span className="w-32 text-right tabular-nums text-zinc-500">
                {i >= 0 && shares ? `${money(shares[i], currency)} ${currency}` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">
        {mode === "nights" && "Shares follow the nights booked in each villa during the month of the date; they are worked out when you save."}
        {mode === "percent" && Math.abs(total - 100) > 0.01 && `The percentages add up to ${total}%, not 100%.`}
        {mode !== "nights" && " One entry is saved per villa, each with a copy of the receipt."}
      </p>
    </div>
  );
}
