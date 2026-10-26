import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/mcp and the OAuth metadata authenticate with a bearer token, the Telegram webhook with its
// secret header, the cron with CRON_SECRET: none of them uses the session cookie.
const PUBLIC_PATHS = ["/login", "/auth/", "/api/mcp", "/.well-known/", "/api/channels/telegram", "/api/cron/"];

/** Refreshes the Supabase session on every navigation and sends signed-out users to /login. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  if (!data?.claims && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`; // keep e.g. ?authorization_id=
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets (icons included) and the dev-only preview.
    "/((?!_next/static|_next/image|favicon.ico|apple-icon|dev/|dev-fixtures/|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
