"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { renameCompany, saveBankSettings, type Result } from "@/app/(app)/settings/actions";
import type { BankSettings, Bearer } from "@/lib/settings";

const field = "h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900";
const primary = "h-10 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50";

function useSave() {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const [pending, start] = useTransition();
  const save = (fn: () => Promise<Result>) => start(async () => {
    const r = await fn();
    setState(r.ok ? { saved: true } : { error: r.error });
    if (r.ok) router.refresh();
  });
  return { ...state, pending, save };
}

export function SettingsForms({ company, villaCount, bank }: { company: string; villaCount: number; bank: BankSettings }) {
  return (
    <div className="flex flex-col gap-6">
      <CompanyName name={company} />
      <BankForm bank={bank} villaCount={villaCount} company={company} />
    </div>
  );
}

function CompanyName({ name }: { name: string }) {
  const [value, setValue] = useState(name);
  const { error, saved, pending, save } = useSave();
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div>
        <h2 className="font-semibold">Your company</h2>
        <p className="text-sm text-zinc-500">
          Some costs belong to your company, not to a villa: bank fees, your accountant, your office, licences.
          Book them on the company so each villa&apos;s result stays accurate. Owners never see it.
        </p>
      </div>
      <form className="flex flex-col gap-1" action={() => save(() => renameCompany(value))}>
        <label htmlFor="company-name" className="text-sm font-medium">Its name, as it appears next to your villas</label>
        <div className="flex flex-wrap gap-2">
          <input id="company-name" className={`${field} min-w-64 flex-1`} value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="PT Onba Property Management" maxLength={80} />
          <button className={primary} disabled={pending || value.trim() === name}>Save</button>
        </div>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>}
    </section>
  );
}

function BankForm({ bank, villaCount, company }: { bank: BankSettings; villaCount: number; company: string }) {
  const [feesTo, setFeesTo] = useState<Bearer>(bank.feesTo);
  const [interestTo, setInterestTo] = useState<Bearer>(bank.interestTo);
  const { error, saved, pending, save } = useSave();
  const villas = villaCount > 1 ? `Shared between the ${villaCount} villas` : "The villa";
  const changed = feesTo !== bank.feesTo || interestTo !== bank.interestTo;
  const theCompany = company === "Company" ? "The company" : `${company} (the company)`;

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-semibold">Bank statements</h2>
        <p className="text-sm text-zinc-500">
          Where the month&apos;s bank charges go when you book them from the Bank page. Follow your management contracts.
        </p>
      </div>
      <form className="flex flex-col gap-4" action={() => save(() => saveBankSettings({ feesTo, interestTo }))}>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Bank fees (transfer and account fees)
          <select className={field} value={feesTo} onChange={(e) => setFeesTo(e.target.value as Bearer)}>
            <option value="company">{theCompany}</option>
            <option value="villas">{villas}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Bank interest (booked net of the tax the bank withholds)
          <select className={field} value={interestTo} onChange={(e) => setInterestTo(e.target.value as Bearer)}>
            <option value="company">{theCompany}</option>
            <option value="villas">{villas}</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          <button className={primary} disabled={pending || !changed}>Save</button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && !error && !changed && <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>}
        </div>
      </form>
    </section>
  );
}
