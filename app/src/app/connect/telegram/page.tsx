import { Suspense } from "react";
import { Logo } from "@/components/shell/Logo";

const BOT = process.env.TELEGRAM_BOT_USERNAME ?? "";

/** Links the signed-in user's Telegram to ONBA Books: consent here, then /start CODE from their own Telegram. */
export default function ConnectTelegramPage({ searchParams }: PageProps<"/connect/telegram">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8 text-lg" />
      <div className="card w-full max-w-sm p-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Step searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  denied: "You didn't allow access, so nothing was connected.",
  expired: "That took too long. Start again.",
  failed: "Something went wrong. Start again.",
};

async function Step({ searchParams }: Pick<PageProps<"/connect/telegram">, "searchParams">) {
  const { code, error } = await searchParams;
  if (typeof code === "string" && /^[\w-]{10,64}$/.test(code)) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Last step: open Telegram</h1>
        <p className="text-sm text-zinc-500">
          Tap the button, then <strong>Start</strong> in the chat with @{BOT}. The link works once, for 15 minutes,
          and only from your own Telegram.
        </p>
        <a href={`https://t.me/${BOT}?start=${code}`} className="flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
          Open Telegram
        </a>
        <p className="text-xs text-zinc-500">On a computer without Telegram, send this to @{BOT}: <code className="break-all">/start {code}</code></p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Connect Telegram</h1>
      <p className="text-sm text-zinc-500">
        Send receipts, expenses, stays and reminders to ONBA Books from a Telegram chat. The assistant works with your own access.
      </p>
      {typeof error === "string" && ERRORS[error] && <p role="alert" className="text-sm text-red-600">{ERRORS[error]}</p>}
      <a href="/api/channels/link/start?channel=telegram" className="flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
        Connect Telegram
      </a>
    </div>
  );
}
