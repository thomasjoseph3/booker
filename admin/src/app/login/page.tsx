import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-accent text-lg text-accent-ink">🏨</div>
          <h1 className="text-xl font-semibold">Hotel admin</h1>
          <p className="mt-1 text-muted">Bookings, calls and operations for your property</p>
        </div>
        <Suspense fallback={<div className="h-64 rounded-xl border border-line bg-panel" />}>
          <LoginFormLoader searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginFormLoader({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  return <LoginForm next={typeof sp.next === "string" ? sp.next : ""} expired={Boolean(sp.expired)} />;
}
