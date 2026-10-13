"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const db = await createClient();
  await db.auth.signOut();
  redirect("/login");
}
