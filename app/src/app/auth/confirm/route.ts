import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Target of the magic link: exchanges the one-time token for a session. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/overview";
  const target = request.nextUrl.clone();
  target.search = "";

  const code = searchParams.get("code");
  if ((tokenHash && type) || code) {
    const supabase = await createClient();
    // Default e-mail template (PKCE) sends ?code=; a custom template can send ?token_hash=&type=.
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! });
    if (!error) {
      // next may carry a query string (e.g. /oauth/consent?authorization_id=…), so resolve it as a URL.
      const dest = new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/overview", target.origin);
      return NextResponse.redirect(dest);
    }
  }
  target.pathname = "/login";
  target.search = "?error=link";
  return NextResponse.redirect(target);
}
