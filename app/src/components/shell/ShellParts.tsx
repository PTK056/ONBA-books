import { LogOut } from "lucide-react";
import { connection } from "next/server";
import { signOut } from "@/app/auth/signout/actions";
import { getCurrentOrg, places, selectedPlace } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

import { PlaceSelect } from "./PlaceSelect";
import { Sidebar } from "./Sidebar";

// Session-dependent pieces of the sidebar, each streamed behind its own Suspense boundary.

/** The sidebar, with the admin-only pages when the user is an admin. */
export async function SidebarForRole(props: Omit<React.ComponentProps<typeof Sidebar>, "admin">) {
  const org = await getCurrentOrg();
  return <Sidebar {...props} admin={org.kind === "member" && org.role === "admin"} />;
}

export async function OrgName() {
  const org = await getCurrentOrg();
  return <>{org.kind === "member" ? org.name : "—"}</>;
}

/** The villa chooser; hidden when there is only one place to show. */
export async function PlacePicker({ compact }: { compact?: boolean }) {
  const org = await getCurrentOrg();
  if (org.kind !== "member") return null;
  const all = places(org);
  if (all.length < 2) return null;
  const selected = await selectedPlace(org);
  return <PlaceSelect places={all.map((p) => ({ id: p.id, name: p.name }))} selected={selected?.id ?? null} compact={compact} />;
}

export async function ReviewBadge() {
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role === "owner_viewer") return null;
  const db = await createClient();
  const { count } = await db.from("receipt_items").select("id", { count: "exact", head: true })
    .eq("organization_id", org.id).eq("status", "pending");
  if (!count) return null;
  return (
    <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold tabular-nums text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
      {count}
    </span>
  );
}

export async function UserMenu() {
  await connection(); // per-request: reads the session
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const email = (data?.claims?.email as string | undefined) ?? "";
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold uppercase text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
        {email.slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400" title={email}>{email}</span>
      <form action={signOut}>
        <button aria-label="Sign out" title="Sign out" className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900">
          <LogOut size={15} />
        </button>
      </form>
    </div>
  );
}
