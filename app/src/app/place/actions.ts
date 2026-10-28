"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentOrg, PLACE_COOKIE, places } from "@/lib/org";

/** Remembers the villa (or company) chosen in the sidebar; null shows all of them again. */
export async function choosePlace(id: string | null) {
  const org = await getCurrentOrg();
  const store = await cookies();
  if (org.kind !== "member" || !id || !places(org).some((p) => p.id === id)) store.delete(PLACE_COOKIE);
  else store.set(PLACE_COOKIE, id, { path: "/", maxAge: 365 * 86_400, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}
