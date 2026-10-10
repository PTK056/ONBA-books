import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ReviewQueue } from "@/components/review/ReviewQueue";
import { loadReviewQueue } from "@/lib/review/data";
import { acceptItem, rejectItem } from "./actions";

export default function ReviewPage({ searchParams }: PageProps<"/review">) {
  return (
    <main className="flex h-dvh flex-col">
      <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading receipts…</p>}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Queue({ searchParams }: Pick<PageProps<"/review">, "searchParams">) {
  const { org } = await searchParams;
  const data = await loadReviewQueue(typeof org === "string" ? org : undefined);
  if (data.kind === "signed_out") redirect("/login?next=/review");
  if (data.kind === "no_organization") {
    return <p className="p-6 text-sm text-zinc-600">You don&apos;t review receipts for any organization yet.</p>;
  }
  return <ReviewQueue items={data.items} options={data.options} accept={acceptItem} reject={rejectItem} />;
}
