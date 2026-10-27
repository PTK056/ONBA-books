import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/shell/Logo";
import { APP_URL } from "@/lib/app-url";
import { classifyRedirect } from "@/lib/oauth/destination";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { ConsentForm } from "./ConsentForm";

/** Supabase's OAuth server sends the user here when an assistant (WhatsApp agent, Claude…) asks for access. */
export default function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8 text-lg" />
      <div className="card w-full max-w-sm p-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Consent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Consent({ searchParams }: Pick<PageProps<"/oauth/consent">, "searchParams">) {
  const { authorization_id: id } = await searchParams;
  if (typeof id !== "string" || !id) return <Problem text="This link is incomplete. Start the connection again from your assistant." />;

  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);
  if (org.kind === "none") redirect("/setup");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <Problem text="This request has expired. Start the connection again from your assistant." />;
  if (!("authorization_id" in data)) redirect(data.redirect_url); // already allowed earlier

  const client = data.client.name || "An assistant";
  const dest = classifyRedirect(data.redirect_uri, APP_URL);
  if (dest.kind === "invalid") return <Problem text="This app's return address is not safe, so Splyce won't connect it." />;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">Connect {client}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {client} wants to work in Splyce as <strong>{data.user.email}</strong>.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
        <li>• Read {org.name}&apos;s villas, entries and figures</li>
        <li>• Send receipts to your review queue</li>
        <li>• Add expenses, income, stays and tasks</li>
      </ul>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Access goes to <strong className="font-mono text-xs">{dest.host}</strong>
        {dest.kind === "local" && " (an app on this computer)"}.
      </p>
      {dest.kind !== "known" && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {dest.kind === "local"
            ? `Only allow this if you just started the connection yourself, from an app on this computer.`
            : `Splyce doesn't know this app. Any app can call itself “${client}”: only allow it if you set it up yourself and trust ${dest.host}.`}
        </p>
      )}
      <p className="text-xs text-zinc-500">
        It acts with your own access: it can do nothing you can&apos;t. Receipts still wait for your review.
      </p>
      <ConsentForm authorizationId={data.authorization_id} />
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return <p role="alert" className="text-sm text-red-600">{text}</p>;
}
