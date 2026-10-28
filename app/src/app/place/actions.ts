"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ALL_PLACES, getCurrentOrg, PLACE_COOKIE, places } from "@/lib/org";

/** Remembers the villa (or company) chosen in the sidebar; null = all of them, also remembered. */
export async function choosePlace(id: string | null) {
  const org = await getCurrentOrg();
  if (org.kind !== "member") return;
  const value = id && places(org).some((p) => p.id === id) ? id : ALL_PLACES;
  (await cookies()).set(PLACE_COOKIE, value, { path: "/", maxAge: 365 * 86_400, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}
