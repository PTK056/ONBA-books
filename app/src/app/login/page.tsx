import { Suspense } from "react";
import { Logo } from "@/components/shell/Logo";
import { LoginForm } from "./LoginForm";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8 text-lg" />
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mb-5 mt-1 text-sm text-zinc-500">We&apos;ll e-mail you a link and a code. New here? The same link creates your account.</p>
        <Suspense>
          <Form searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="mt-6 text-xs text-zinc-400">Bookkeeping for short-term-rental villas</p>
    </main>
  );
}

async function Form({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next, error } = await searchParams;
  return (
    <>
      {error === "link" && (
        <p role="alert" className="text-sm text-red-600">That sign-in link has expired or was already used. Ask for a new one.</p>
      )}
      <LoginForm next={typeof next === "string" ? next : "/overview"} />
    </>
  );
}
