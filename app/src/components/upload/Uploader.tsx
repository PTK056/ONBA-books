"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { QUOTA_MESSAGE, readBatches, type ReadSummary } from "@/lib/receipts/read";
import { uploadEvidenceFile } from "@/lib/receipts/upload";

type Status = "waiting" | "uploading" | "uploaded" | "failed";
interface Entry { key: string; file: File; status: Status; message?: string }
type Phase = "picking" | "uploading" | "reading" | "done";

interface Props {
  organizationId: string;
  villas: { id: string; name: string }[];
}

/** Pick photos or PDFs, upload them as one batch, then have the engine read them. */
export function Uploader({ organizationId, villas }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [villaId, setVillaId] = useState(villas.length === 1 ? villas[0].id : "");
  const [phase, setPhase] = useState<Phase>("picking");
  const [summary, setSummary] = useState<ReadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    setEntries((xs) => [
      ...xs,
      ...[...files].map((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, status: "waiting" as Status })),
    ]);
  };
  const update = (key: string, patch: Partial<Entry>) =>
    setEntries((xs) => xs.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  async function start() {
    setError(null);
    const db = createClient();
    setPhase("uploading");

    const { data: batch, error: batchErr } = await db.from("receipt_batches")
      .insert({ organization_id: organizationId, villa_id: villaId || null })
      .select("id").single();
    if (batchErr || !batch) {
      setError("Could not start the upload. Check your connection and try again.");
      setPhase("picking");
      return;
    }

    let uploaded = 0;
    for (const entry of entries) {
      if (entry.status === "uploaded") continue;
      update(entry.key, { status: "uploading", message: undefined });
      try {
        const { path, mimeType } = await uploadEvidenceFile(db, organizationId, entry.file);
        const { data: ev, error: evErr } = await db.from("evidence")
          .insert({ organization_id: organizationId, storage_path: path, mime_type: mimeType })
          .select("id").single();
        if (evErr || !ev) throw new Error("Could not save the file");
        const { error: itemErr } = await db.from("receipt_items")
          .insert({ organization_id: organizationId, batch_id: batch.id, evidence_id: ev.id });
        if (itemErr) throw new Error("Could not queue the file");
        update(entry.key, { status: "uploaded" });
        uploaded++;
      } catch (e) {
        update(entry.key, { status: "failed", message: e instanceof Error ? e.message : "Upload failed" });
      }
    }
    if (!uploaded) {
      setPhase("picking");
      return;
    }

    setPhase("reading");
    const total = await readBatches([batch.id]);
    setSummary(total);
    setPhase("done");
  }

  const busy = phase === "uploading" || phase === "reading";
  const pending = entries.filter((e) => e.status !== "uploaded").length;

  if (phase === "done" && summary) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-lg font-medium">
          {summary.read} receipt{summary.read === 1 ? "" : "s"} read
        </p>
        {summary.unreachable && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            The files are uploaded but the reading engine did not answer. Use “Read now” on the Review page.
          </p>
        )}
        {summary.quotaReached && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {QUOTA_MESSAGE} The rest are saved and wait in the Review page.
          </p>
        )}
        {(summary.failed > 0 || (summary.remaining > 0 && !summary.quotaReached)) && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {summary.failed > 0 && `${summary.failed} could not be read and will show as such in the review. `}
            {summary.remaining > 0 && `${summary.remaining} are still waiting; use “Read now” on the Review page.`}
          </p>
        )}
        <div className="flex gap-2">
          <Link href="/review" className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            Review them
          </Link>
          <button
            onClick={() => { setEntries([]); setSummary(null); setPhase("picking"); }}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Add more
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) add(e.dataTransfer.files); }}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center ${
          dragging ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        <p className="text-sm font-medium">Photos or PDFs of receipts, invoices and transfer slips</p>
        <p className="text-xs text-zinc-500">Drop them here, or</p>
        <button
          type="button" disabled={busy} onClick={() => input.current?.click()}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Choose files
        </button>
        <input
          ref={input} type="file" multiple hidden accept="image/*,application/pdf"
          onChange={(e) => { add(e.target.files); e.target.value = ""; }}
        />
      </div>

      {entries.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {entries.map((e) => (
            <li key={e.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{e.file.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <StatusLabel entry={e} />
                {phase === "picking" && e.status !== "uploaded" && (
                  <button
                    onClick={() => setEntries((xs) => xs.filter((x) => x.key !== e.key))}
                    aria-label={`Remove ${e.file.name}`}
                    className="rounded px-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                  >
                    ×
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {villas.length > 1 && (
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Villa</span>
          <select
            value={villaId} onChange={(e) => setVillaId(e.target.value)} disabled={busy}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Several villas — I&apos;ll choose per receipt</option>
            {villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <button
        onClick={start} disabled={busy || pending === 0}
        className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {phase === "uploading" ? "Uploading…"
          : phase === "reading" ? "Reading receipts… about 10 seconds each, 4 at a time"
          : pending ? `Upload and read ${pending} file${pending === 1 ? "" : "s"}` : "Choose files first"}
      </button>
    </div>
  );
}

function StatusLabel({ entry }: { entry: Entry }) {
  switch (entry.status) {
    case "waiting": return <span className="text-zinc-400">{(entry.file.size / 1e6).toFixed(1)} MB</span>;
    case "uploading": return <span className="text-zinc-500">Uploading…</span>;
    case "uploaded": return <span className="text-emerald-600">Uploaded</span>;
    case "failed": return <span className="text-red-600" title={entry.message}>{entry.message ?? "Failed"}</span>;
  }
}
