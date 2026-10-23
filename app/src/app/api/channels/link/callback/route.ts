import { NextResponse, type NextRequest } from "next/server";
import { decrypt } from "@/lib/channels/crypto";
import { createPendingLink } from "@/lib/channels/links";
import { APP_URL, exchangeCode } from "@/lib/channels/oauth";

// OAuth redirect: trades the code for the user's tokens, then shows the one-time code to send from the chat.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const back = (search: string) => {
    const res = NextResponse.redirect(`${APP_URL}/connect/telegram${search}`);
    res.cookies.delete({ name: "onba_link", path: "/api/channels/link" });
    return res;
  };
  let saved: { state: string; verifier: string; channel: "telegram" };
  try { saved = JSON.parse(decrypt(request.cookies.get("onba_link")?.value ?? "")); } catch { return back("?error=expired"); }
  if (q.get("error")) return back("?error=denied");
  if (!q.get("code") || q.get("state") !== saved.state) return back("?error=expired");
  try {
    const tokens = await exchangeCode(q.get("code")!, saved.verifier);
    const code = await createPendingLink(saved.channel, tokens);
    return back(`?code=${code}`);
  } catch (e) {
    console.error("[link] callback:", e);
    return back("?error=failed");
  }
}
