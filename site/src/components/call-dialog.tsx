"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { LiveCall, type CallEvent } from "@/lib/live-call";

type Phase = "form" | "connecting" | "live" | "ended";
type Line = { role: "caller" | "agent"; text: string };

const wsBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/^http/, "ws");

export function CallDialog({ slug, hotelName, onClose }: { slug: string; hotelName: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("form");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [tool, setTool] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const call = useRef<LiveCall | null>(null);
  const orb = useRef<HTMLDivElement>(null);
  const captions = useRef<HTMLDivElement>(null);

  const onEvent = useCallback((e: CallEvent) => {
    if (e.type === "ready") setPhase("live");
    else if (e.type === "transcript") {
      setLines((l) => {
        const last = l[l.length - 1];
        if (last && last.role === e.role) return [...l.slice(0, -1), { role: e.role, text: last.text + e.text }];
        return [...l, { role: e.role, text: e.text }];
      });
    } else if (e.type === "tool") {
      setTool(e.name);
      setTimeout(() => setTool(null), 2500);
    } else if (e.type === "error") {
      setError(e.message);
      setPhase((p) => (p === "live" ? "ended" : "form"));
    } else if (e.type === "ended") {
      setSummary(e.summary ?? null);
      setPhase("ended");
    }
  }, []);

  async function start() {
    setError(null);
    setLines([]);
    setSeconds(0);
    setSummary(null);
    setPhase("connecting");
    const qs = new URLSearchParams({ hotel: slug });
    if (phone.trim()) qs.set("phone", phone.trim());
    if (email.trim()) qs.set("email", email.trim());
    const c = new LiveCall(`${wsBase}/api/live?${qs}`, onEvent);
    call.current = c;
    try {
      await c.start();
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "NotFoundError");
      setError(denied ? "We couldn't access your microphone. Allow it in your browser's address bar and try again." : "Could not start the call.");
      setPhase("form");
    }
  }

  function hangUp() { call.current?.hangUp(); setPhase("ended"); }
  function close() { call.current?.hangUp(); onClose(); }

  // Animate the orb straight from the audio levels (no React re-render per frame).
  useEffect(() => {
    if (phase !== "live") return;
    let raf = 0;
    const tick = () => {
      const lvl = call.current?.level ?? 0;
      if (orb.current) orb.current.style.transform = `scale(${1 + lvl * 0.55})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => { captions.current?.scrollTo({ top: captions.current.scrollHeight, behavior: "smooth" }); }, [lines]);
  useEffect(() => () => call.current?.hangUp(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const lastTwo = lines.slice(-2);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Call ${hotelName}`} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-[#0f2b21] text-white shadow-2xl">
        <button onClick={close} aria-label="Close" className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full bg-white/10 text-lg hover:bg-white/20">×</button>

        <div className="px-8 pb-2 pt-8 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-white/60">{phase === "live" ? `Connected · ${mm}:${ss}` : phase === "connecting" ? "Connecting…" : phase === "ended" ? "Call ended" : "Reservations"}</p>
          <h2 className="mt-1 font-serif text-2xl">{hotelName}</h2>
        </div>

        {phase === "form" && (
          <form className="space-y-4 p-8 pt-4" onSubmit={(e) => { e.preventDefault(); void start(); }}>
            <p className="text-center text-sm text-white/70">Talk to our reservations assistant. It can check availability, book your stay and email you the payment link.</p>
            <label className="block text-sm">
              <span className="text-white/70">Your mobile number <span className="text-white/40">(optional)</span></span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+91 98765 43210" className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 outline-none placeholder:text-white/30 focus:border-white/50" />
            </label>
            <label className="block text-sm">
              <span className="text-white/70">Email for your confirmation <span className="text-white/40">(optional)</span></span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 outline-none placeholder:text-white/30 focus:border-white/50" />
            </label>
            {error && <p className="rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100">{error}</p>}
            <button className="flex w-full items-center justify-center gap-2 rounded-full bg-[#3ecf8e] py-3.5 font-medium text-[#06281a] transition hover:brightness-110">📞 Start call</button>
            <p className="text-center text-xs text-white/40">Your browser will ask to use the microphone. Headphones give the best sound.</p>
          </form>
        )}

        {(phase === "connecting" || phase === "live") && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid place-items-center py-8">
              <div className="relative grid size-36 place-items-center">
                {phase === "connecting" && <span className="ring absolute inset-0 rounded-full bg-[#3ecf8e]/40" />}
                <div ref={orb} className="size-28 rounded-full bg-gradient-to-br from-[#7ff0bd] to-[#1f8a5f] shadow-[0_0_60px_rgba(62,207,142,0.55)] transition-transform duration-75" />
              </div>
            </div>
            <div ref={captions} className="min-h-[88px] flex-1 space-y-2 overflow-y-auto px-8 pb-2 text-center">
              {lastTwo.map((l, i) => (
                <p key={`${lines.length}-${i}`} className={clsx("text-balance leading-snug", l.role === "agent" ? "text-lg text-white" : "text-sm text-white/55")}>
                  {l.role === "caller" && <span className="mr-1 text-white/35">You:</span>}{l.text}
                </p>
              ))}
              {phase === "live" && lines.length === 0 && <p className="text-sm text-white/50">Say hello…</p>}
            </div>
            <p className="h-6 text-center text-xs text-[#7ff0bd]">{tool ? `⚙ ${tool.replaceAll("_", " ")}…` : ""}</p>
            <div className="flex items-center justify-center gap-5 p-6 pt-2">
              <button onClick={() => { const m = !muted; setMuted(m); call.current?.setMuted(m); }} disabled={phase !== "live"} aria-pressed={muted}
                className={clsx("grid size-14 place-items-center rounded-full text-xl transition disabled:opacity-40", muted ? "bg-white text-black" : "bg-white/12 hover:bg-white/20")} title={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🎙"}</button>
              <button onClick={hangUp} className="grid size-16 place-items-center rounded-full bg-[#e5484d] text-2xl transition hover:brightness-110" title="Hang up" aria-label="Hang up">📞</button>
            </div>
          </div>
        )}

        {phase === "ended" && (
          <div className="space-y-4 p-8 pt-4 text-center">
            {error && <p className="rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100">{error}</p>}
            <p className="text-white/80">{summary ?? "Thanks for calling."}</p>
            <p className="text-sm text-white/50">If you booked, check your email for the payment link.</p>
            <div className="flex gap-3">
              <button onClick={() => setPhase("form")} className="flex-1 rounded-full bg-white/12 py-3 hover:bg-white/20">Call again</button>
              <button onClick={onClose} className="flex-1 rounded-full bg-[#3ecf8e] py-3 font-medium text-[#06281a]">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
