"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { endVoiceCall, startVoiceCall, voiceTurn, type VoiceEnd } from "@/lib/actions";
import { buttonClass, Card, Field, inputClass } from "@/components/ui";

// Minimal typings for the (webkit-prefixed in Chrome) Web Speech API.
type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

type Line = { who: "agent" | "you" | "tool"; text: string };
type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready", connecting: "Connecting…", listening: "Listening…", thinking: "Agent is thinking…", speaking: "Agent is speaking…", ended: "Call ended",
};

export function TalkClient({ hotelId }: { hotelId: string }) {
  const [phone, setPhone] = useState("+919876543210");
  const [email, setEmail] = useState("");
  const [lang, setLang] = useState("en-IN");
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<VoiceEnd | null>(null);
  const supported = useSyncExternalStore(
    () => () => {},
    () => { const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }; return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition); },
    () => true,
  );
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const callId = useRef<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const mutedRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const inCall = phase !== "idle" && phase !== "ended";

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [lines, interim]);
  useEffect(() => {
    if (!inCall) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [inCall]);
  useEffect(() => () => { rec.current?.abort(); window.speechSynthesis?.cancel(); }, []);

  const listen = useCallback(() => {
    if (!callId.current || mutedRef.current) return;
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    let heard = "";
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
      heard = text.trim();
      setInterim(heard);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone access is blocked. Allow it in the browser address bar, or use the text box below.");
    };
    r.onend = () => {
      setInterim("");
      if (heard) void send(heard);
      else if (phaseRef.current === "listening" && callId.current && !mutedRef.current) setTimeout(listen, 200); // silence: keep listening
    };
    rec.current = r;
    setPhaseBoth("listening");
    try { r.start(); } catch { /* already started */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const speak = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) { listen(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 1.03;
    u.onend = () => { if (callId.current) listen(); };
    u.onerror = u.onend;
    setPhaseBoth("speaking");
    synth.speak(u);
  }, [lang, listen]);

  async function send(text: string) {
    if (!callId.current || !text.trim()) return;
    rec.current?.abort();
    window.speechSynthesis?.cancel();
    setLines((l) => [...l, { who: "you", text }]);
    setPhaseBoth("thinking");
    const r = await voiceTurn(hotelId, callId.current, text);
    if (!callId.current) return; // hung up meanwhile
    if (!r.ok) {
      setError(r.message);
      listen();
      return;
    }
    setError(null);
    setLines((l) => [
      ...l,
      ...r.data.tools.map((t): Line => ({ who: "tool", text: `${t.name}${t.ok ? "" : " (failed)"}` })),
      { who: "agent", text: r.data.reply },
    ]);
    speak(r.data.reply);
  }

  async function start() {
    setError(null); setSummary(null); setLines([]); setSeconds(0);
    setPhaseBoth("connecting");
    // Ask for the mic up front so the browser prompt doesn't interrupt the greeting.
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); }
    catch { setError("Microphone not available. You can still type to the agent below."); }
    const r = await startVoiceCall(hotelId, phone, email);
    if (!r.ok) { setError(r.message); setPhaseBoth("idle"); return; }
    callId.current = r.data.callId;
    setLines([{ who: "agent", text: r.data.greeting }]);
    speak(r.data.greeting);
  }

  async function hangUp() {
    const id = callId.current;
    callId.current = null;
    rec.current?.abort();
    window.speechSynthesis?.cancel();
    setInterim("");
    setPhaseBoth("ended");
    if (id) {
      const r = await endVoiceCall(hotelId, id);
      if (r.ok) setSummary(r.data); else setError(r.message);
    }
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) { rec.current?.abort(); if (phaseRef.current === "listening") setPhaseBoth("speaking"); }
    else if (phaseRef.current !== "thinking" && !window.speechSynthesis?.speaking) listen();
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card title="Caller">
        <div className="space-y-3">
          <Field label="Caller phone" hint="Acts as the caller ID the agent sees"><input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={inCall} /></Field>
          <Field label="Caller email (optional)" hint="Speech recognition is poor at emails. Fill this in and the agent will just confirm it.">
            <input className={inputClass} type="email" placeholder="guest@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={inCall} />
          </Field>
          <Field label="Language">
            <select className={inputClass} value={lang} onChange={(e) => setLang(e.target.value)} disabled={inCall}>
              <option value="en-IN">English (India)</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option>
              <option value="hi-IN">Hindi</option><option value="ml-IN">Malayalam</option><option value="ta-IN">Tamil</option>
            </select>
          </Field>
          {!inCall ? (
            <button className={buttonClass("primary", "w-full")} onClick={start}>📞 {phase === "ended" ? "Call again" : "Start call"}</button>
          ) : (
            <div className="flex gap-2">
              <button className={buttonClass("secondary", "flex-1")} onClick={toggleMute}>{muted ? "🔇 Unmute" : "🎙 Mute"}</button>
              <button className={buttonClass("danger", "flex-1")} onClick={hangUp}>Hang up</button>
            </div>
          )}
          {!supported && <p className="text-sm text-danger">This browser has no speech recognition. Use Chrome or Edge, or type to the agent.</p>}
        </div>
      </Card>

      <Card
        title={<span className="flex items-center gap-2"><span className={clsx("size-2.5 rounded-full", inCall ? "animate-pulse bg-accent" : "bg-muted")} />{PHASE_LABEL[phase]}{inCall && <span className="font-normal text-muted">· {mm}:{ss}</span>}</span>}
        pad={false}
      >
        <div ref={logRef} className="h-[420px] space-y-2 overflow-y-auto p-4">
          {lines.length === 0 && <p className="pt-24 text-center text-muted">Press <b>Start call</b>. The agent greets you, then just talk.<br />Try: “I want a room for this weekend for two adults.”</p>}
          {lines.map((l, i) =>
            l.who === "tool" ? (
              <p key={i} className="text-center text-xs text-muted">⚙ {l.text}</p>
            ) : (
              <div key={i} className={clsx("flex", l.who === "you" && "justify-end")}>
                <div className={clsx("max-w-[80%] rounded-2xl px-3.5 py-2", l.who === "you" ? "bg-accent text-accent-ink" : "bg-panel-2 text-ink")}>{l.text}</div>
              </div>
            ),
          )}
          {interim && <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl bg-accent-soft px-3.5 py-2 text-accent">{interim}…</div></div>}
        </div>
        {error && <p className="border-t border-line bg-panel-2 px-4 py-2 text-sm text-danger">{error}</p>}
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); const t = typed; setTyped(""); void send(t); }}>
          <input className={inputClass} placeholder={inCall ? "…or type what the caller says" : "Start a call to talk"} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!inCall} />
          <button className={buttonClass("secondary")} disabled={!inCall || !typed.trim() || phase === "thinking"}>Send</button>
        </form>
      </Card>

      {summary && (
        <Card title="Call summary" className="lg:col-span-2">
          <p>{summary.summary ?? "No summary."}</p>
          <p className="mt-2 text-sm text-muted">Outcome: <b>{summary.outcome}</b> · {summary.durationSec}s · <Link className="text-accent underline" href={`/h/${hotelId}/calls`}>see in Agent calls</Link> · <Link className="text-accent underline" href={`/h/${hotelId}/messages`}>messages sent</Link></p>
        </Card>
      )}
    </div>
  );
}
