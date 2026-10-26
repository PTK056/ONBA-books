import { NextResponse, type NextRequest } from "next/server";
import { encrypt, randomToken } from "@/lib/channels/crypto";
import { authorizeUrl } from "@/lib/channels/oauth";

// Starts the OAuth flow that lets Splyce act for the signed-in user in a chat channel.
// PKCE verifier and state travel in a sealed, short-lived cookie.
export async function GET(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel");
  if (channel !== "telegram") return new NextResponse("Unknown channel", { status: 400 });
  const state = randomToken();
  const verifier = randomToken(48);
  const res = NextResponse.redirect(authorizeUrl(state, verifier));
  res.cookies.set("onba_link", encrypt(JSON.stringify({ state, verifier, channel })), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/channels/link", maxAge: 900,
  });
  return res;
}
