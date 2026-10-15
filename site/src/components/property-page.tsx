import { money, type Property } from "@/lib/api";
import { CallButton } from "./call-button";

const TONES = ["from-[#1f5c46] to-[#3f8f6c]", "from-[#2d5b73] to-[#5aa0b8]", "from-[#6b4a2b] to-[#c0925b]", "from-[#4a3f6b] to-[#8d7fc0]"];
const addr = (p: Property) => [p.address?.line1, p.address?.line2, p.address?.city, p.address?.state].filter(Boolean).join(", ");

export function PropertyPage({ p }: { p: Property }) {
  const from = p.roomTypes.length ? Math.min(...p.roomTypes.map((r) => r.fromPrice)) : null;
  return (
    <>
      <header className="absolute inset-x-0 top-0 z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5 text-white">
        <span className="font-serif text-xl">{p.name}</span>
        <nav className="hidden gap-7 text-sm text-white/85 sm:flex">
          <a href="#rooms" className="hover:text-white">Rooms</a>
          <a href="#amenities" className="hover:text-white">Amenities</a>
          <a href="#faq" className="hover:text-white">FAQ</a>
          <a href="#find-us" className="hover:text-white">Find us</a>
        </nav>
      </header>

      <section className="relative isolate overflow-hidden bg-gradient-to-br from-[#0f2b21] via-[#1f5c46] to-[#3a7d62] px-5 pb-24 pt-40 text-white sm:pb-32 sm:pt-52">
        <div className="pointer-events-none absolute -right-24 -top-24 size-[480px] rounded-full bg-white/5 blur-3xl" />
        <div className="mx-auto max-w-6xl">
          {!!p.starRating && <p className="mb-4 text-sm tracking-[0.25em] text-[#e9c98b]">{"★".repeat(Math.round(p.starRating))}</p>}
          <h1 className="max-w-3xl font-serif text-5xl leading-[1.05] sm:text-7xl">{p.name}</h1>
          {p.description && <p className="mt-6 max-w-xl text-lg text-white/80">{p.description}</p>}
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <CallButton slug={p.slug} hotelName={p.name}><span className="rounded-full bg-white px-7 py-3.5 text-base font-medium text-[#0f2b21] shadow-lg hover:bg-white/90">📞 Call to book now</span></CallButton>
            <span className="text-sm text-white/70">Speak to our assistant, 24/7{from !== null && ` · rooms from ${money(p.currency, from)} / night`}</span>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-24 px-5 py-20">
        <section id="rooms">
          <h2 className="font-serif text-3xl">Rooms &amp; villas</h2>
          <p className="mt-2 text-ink-2">Tell us your dates on the call and we&apos;ll check live availability.</p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {p.roomTypes.map((r, i) => (
              <article key={r.id} className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
                <div className={`flex h-44 items-end bg-gradient-to-br ${TONES[i % TONES.length]} p-4`}>
                  <span className="rounded-full bg-black/25 px-3 py-1 text-xs text-white backdrop-blur">{[r.view, r.bedType].filter(Boolean).join(" · ")}</span>
                </div>
                <div className="space-y-3 p-5">
                  <h3 className="font-serif text-xl">{r.name}</h3>
                  {r.description && <p className="text-sm leading-relaxed text-ink-2">{r.description}</p>}
                  <p className="text-xs text-muted">Sleeps {r.maxAdults + r.maxChildren}{r.sizeSqft ? ` · ${r.sizeSqft} sq ft` : ""}</p>
                  <div className="flex items-end justify-between pt-1">
                    <p><span className="text-xs text-muted">from </span><span className="font-serif text-2xl">{money(p.currency, r.fromPrice)}</span><span className="text-xs text-muted"> / night</span></p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="amenities">
          <h2 className="font-serif text-3xl">Everything you need</h2>
          <ul className="mt-8 flex flex-wrap gap-3">
            {p.amenities.map((a) => <li key={a} className="rounded-full border border-line bg-card px-4 py-2 text-sm text-ink-2">{a}</li>)}
          </ul>
        </section>

        <section className="rounded-3xl bg-brand-soft p-8 text-center sm:p-14">
          <h2 className="font-serif text-3xl sm:text-4xl">Book in a two-minute call</h2>
          <p className="mx-auto mt-3 max-w-xl text-ink-2">No forms. Tell our assistant when you&apos;d like to stay and we&apos;ll hold your room and email you the payment link.</p>
          <div className="mt-7"><CallButton slug={p.slug} hotelName={p.name} /></div>
        </section>

        {p.faqs.length > 0 && (
          <section id="faq" className="grid gap-10 lg:grid-cols-[1fr_2fr]">
            <h2 className="font-serif text-3xl">Good to know</h2>
            <div className="divide-y divide-line rounded-2xl border border-line bg-card">
              {p.faqs.map((f) => (
                <details key={f.question} className="group p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-medium">{f.question}<span className="text-muted transition group-open:rotate-45">＋</span></summary>
                  <p className="mt-3 text-ink-2">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <section id="find-us" className="grid gap-6 rounded-2xl border border-line bg-card p-8 sm:grid-cols-3">
          <div><h3 className="text-xs uppercase tracking-widest text-muted">Address</h3><p className="mt-2">{addr(p)}</p>{p.address?.mapsUrl && <a href={p.address.mapsUrl} className="mt-2 inline-block text-sm text-brand underline" target="_blank" rel="noreferrer">Open in Maps</a>}</div>
          <div><h3 className="text-xs uppercase tracking-widest text-muted">Stay times</h3><p className="mt-2">Check-in from {p.checkInTime}</p><p>Check-out by {p.checkOutTime}</p></div>
          <div><h3 className="text-xs uppercase tracking-widest text-muted">Contact</h3>{p.contact?.phone && <p className="mt-2">{p.contact.phone}</p>}{p.contact?.email && <p className="text-ink-2">{p.contact.email}</p>}</div>
        </section>
      </main>

      <footer className="border-t border-line py-8 text-center text-sm text-muted">© {new Date().getFullYear()} {p.name}</footer>
      <CallButton slug={p.slug} hotelName={p.name} variant="floating" />
    </>
  );
}
