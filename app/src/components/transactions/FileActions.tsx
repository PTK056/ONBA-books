"use client";

import { Check, Download, Link2, MessageCircle, Paperclip, Share2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { attachReceipt, createShareLink, deleteTransaction } from "@/app/(app)/transactions/actions";
import { uploadEvidenceFile } from "@/lib/receipts/upload";
import { createClient } from "@/lib/supabase/client";

const button = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium";
const secondary = `${button} bg-white shadow-sm ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:bg-zinc-900 dark:ring-white/10 dark:hover:bg-zinc-800`;

/**
 * Download the file, or hand it to the phone's share sheet (AirDrop, Mail, WhatsApp…)
 * when the browser can share files; otherwise Share falls back to a download.
 */
export function ShareDownload({ evidenceId, name, mime, downloadUrl, label }: { evidenceId: string; name: string; mime: string; downloadUrl: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WhatsApp can't receive a file from a web page, so these send a 7-day download link.
  const link = async () => {
    setError(null);
    const r = await createShareLink(evidenceId);
    if (!r.ok) { setError(r.error); return null; }
    return r;
  };
  const whatsapp = async () => {
    const popup = window.open("", "_blank"); // opened now so the browser doesn't block it
    const r = await link();
    if (!r) { popup?.close(); return; }
    const text = `${label}\n${r.url}\n(link valid ${r.days} days)`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (popup) popup.location.href = url; else window.location.href = url;
  };
  const copy = async () => {
    const r = await link();
    if (!r) return;
    await navigator.clipboard.writeText(r.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const share = async () => {
    setBusy(true);
    try {
      const blob = await (await fetch(downloadUrl)).blob();
      const file = new File([blob], name, { type: mime });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
      } else {
        window.location.href = downloadUrl;
      }
    } catch {
      // The person closed the share sheet: nothing to do.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <a href={downloadUrl} className={secondary}><Download size={15} /> Download</a>
      <button onClick={share} disabled={busy} className={`${button} bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50`}>
        <Share2 size={15} /> {busy ? "Preparing…" : "Share"}
      </button>
      <button onClick={whatsapp} className={secondary} title="Send a download link on WhatsApp (valid 7 days)">
        <MessageCircle size={15} /> WhatsApp
      </button>
      <button onClick={copy} className={secondary} title="Copy a download link (valid 7 days)">
        {copied ? <><Check size={15} /> Copied</> : <><Link2 size={15} /> Copy link</>}
      </button>
      {error && <p role="alert" className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function AttachReceipt({ transactionId, organizationId, label = "Attach receipt" }: { transactionId: string; organizationId: string; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pick = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    start(async () => {
      try {
        const uploaded = await uploadEvidenceFile(createClient(), organizationId, file);
        const r = await attachReceipt(transactionId, uploaded);
        if (!r.ok) return setError(r.error);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      }
    });
  };
  return (
    <div>
      <button type="button" onClick={() => input.current?.click()} disabled={pending} className={`${secondary} disabled:opacity-50`}>
        <Paperclip size={15} /> {pending ? "Uploading…" : label}
      </button>
      <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function DeleteEntry({ id, shares = 0 }: { id: string; shares?: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:underline">
        <Trash2 size={14} /> Delete entry
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>{shares > 1 ? `Delete the ${shares} shares of this expense for good?` : "Delete this entry for good?"}</span>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          const r = await deleteTransaction(id);
          if (!r.ok) return setError(r.error);
          router.push("/transactions");
          router.refresh();
        })}
        className="rounded-md bg-red-600 px-3 py-1 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      <button onClick={() => setConfirming(false)} className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">Cancel</button>
      {error && <p role="alert" className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
