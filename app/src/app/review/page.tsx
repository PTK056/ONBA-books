import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ReadPending } from "@/components/review/ReadPending";
import { ReviewQueue } from "@/components/review/ReviewQueue";
import { getCurrentOrg } from "@/lib/org";
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
    // Owner viewers belong to an organization but have nothing to review.
    if ((await getCurrentOrg()).kind === "none") redirect("/setup");
    return <p className="p-6 text-sm text-zinc-600">Receipt review is done by your organization&apos;s admins and staff.</p>;
  }
  return (
    <>
      <ReadPending unread={data.unread} />
      <ReviewQueue items={data.items} options={data.options} accept={acceptItem} reject={rejectItem} />
    </>
  );
}
