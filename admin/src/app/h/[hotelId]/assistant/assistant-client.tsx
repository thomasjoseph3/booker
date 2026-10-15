"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { createAssistantChat, listAssistantChats, loadAssistantChat, sendAssistantMessage } from "@/lib/actions";
import type { AssistantChat, ChatMessage, ToolTrace } from "@/lib/types";
import { buttonClass, inputClass } from "@/components/ui";
import { RichText } from "@/components/rich-text";

const SUGGESTIONS = [
  "How is today looking?",
  "Which rooms are free this weekend and what do they cost?",
  "Any unpaid bookings, pending refunds or open callbacks?",
  "How did the AI phone agent do this week?",
  "Show me bookings arriving tomorrow",
];

// Minimal typings for the (webkit-prefixed in Chrome) Web Speech API.
type Recognition = { lang: string; interimResults: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null };
type RecognitionCtor = new () => Recognition;
const speechCtor = () => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const PANEL = "overflow-hidden rounded-xl border border-line bg-panel";
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function AssistantClient({ hotelId, initialChats, canSeeAll, meId }: { hotelId: string; initialChats: AssistantChat[]; canSeeAll: boolean; meId: string }) {
  const [chats, setChats] = useState(initialChats);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [active, setActive] = useState<AssistantChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [dictationLang, setDictationLang] = useState<"en-IN" | "ml-IN">("en-IN");
  const scroller = useRef<HTMLDivElement>(null);
  const recognition = useRef<Recognition | null>(null);

  // A conversation is read-only when it belongs to someone else (managers can review but not add to it).
  const readOnly = Boolean(active?.user && typeof active.user === "object" && active.user._id !== meId);
  const refreshList = useCallback(async (s: "mine" | "all") => {
    const r = await listAssistantChats(hotelId, s);
    if (r.ok) setChats(r.data);
  }, [hotelId]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); recognition.current?.stop(); }, []);

  async function open(chat: AssistantChat) {
    setError(null);
    setShowHistory(false);
    const r = await loadAssistantChat(hotelId, chat._id);
    if (!r.ok) return setError(r.message);
    setActive(r.data);
    setMessages(r.data.messages ?? []);
  }

  function newChat() {
    window.speechSynthesis?.cancel();
    setActive(null);
    setMessages([]);
    setError(null);
    setShowHistory(false);
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    window.speechSynthesis?.cancel();
    let chat = active;
    if (!chat) {
      const created = await createAssistantChat(hotelId);
      if (!created.ok) { setBusy(false); return setError(created.message); }
      chat = created.data;
      setActive(chat);
    }
    setMessages((m) => [...m, { role: "user", text: q, at: new Date().toISOString() }]);
    const r = await sendAssistantMessage(hotelId, chat._id, q);
    setBusy(false);
    if (!r.ok) {
      setMessages((m) => [...m, { role: "system", text: r.message, at: new Date().toISOString() }]);
      setError(r.message);
    } else {
      setMessages((m) => [...m, { role: "assistant", text: r.data.reply, at: new Date().toISOString(), tools: r.data.tools }]);
      if (speak && window.speechSynthesis) window.speechSynthesis.speak(new SpeechSynthesisUtterance(r.data.reply.replace(/\*\*/g, "")));
    }
    void refreshList(scope);
  }

  function dictate() {
    const Ctor = speechCtor();
    if (!Ctor) return setError("This browser has no speech recognition. Use Chrome or Edge, or type your question.");
    if (listening) return recognition.current?.stop();
    const r = new Ctor();
    r.lang = dictationLang;
    r.interimResults = true;
    r.onresult = (e) => setText(Array.from(e.results).map((x) => x[0].transcript).join(" "));
    r.onend = () => setListening(false);
    recognition.current = r;
    setListening(true);
    r.start();
  }

  async function changeScope(s: "mine" | "all") {
    setScope(s);
    await refreshList(s);
  }

  const history = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line p-3">
        <span className="font-medium">History</span>
        <button className={buttonClass("secondary", "!px-2.5 !py-1")} onClick={newChat}>＋ New</button>
      </div>
      {canSeeAll && (
        <div className="flex gap-1 border-b border-line p-2 text-xs">
          {(["mine", "all"] as const).map((s) => (
            <button key={s} onClick={() => changeScope(s)} className={clsx("flex-1 rounded-md px-2 py-1", scope === s ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-panel-2")}>{s === "mine" ? "My chats" : "Everyone"}</button>
          ))}
        </div>
      )}
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {chats.length === 0 && <li className="p-4 text-muted">No conversations yet.</li>}
        {chats.map((c) => (
          <li key={c._id}>
            <button onClick={() => open(c)} className={clsx("block w-full px-3 py-2.5 text-left hover:bg-panel-2", active?._id === c._id && "bg-accent-soft")}>
              <div className="truncate font-medium">{c.title}</div>
              <div className="text-xs text-muted">{c.user && scope === "all" ? `${c.user.name} · ` : ""}{when(c.lastMessageAt)} · {c.messageCount} msgs</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="lg:hidden">
        <button className={buttonClass("secondary", "w-full")} onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          {showHistory ? "Hide history" : `History (${chats.length})`}
        </button>
        {showHistory && <section className={clsx(PANEL, "mt-2 h-72")}>{history}</section>}
      </div>
      <section className={clsx(PANEL, "hidden h-[calc(100vh-190px)] min-h-[420px] lg:block")}>{history}</section>

      <section className={clsx(PANEL, "flex h-[calc(100dvh-260px)] min-h-[420px] flex-col lg:h-[calc(100vh-190px)]")}>
        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
          {messages.length === 0 && (
            <div className="mx-auto max-w-lg pt-6 text-center sm:pt-12">
              <p className="text-lg font-medium">What would you like to know?</p>
              <p className="mt-1 text-muted">I can look up live data for this property. Ask in English or Malayalam. I can&apos;t change anything, only report.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-panel px-3 py-1.5 text-left text-sm text-ink-2 hover:bg-panel-2">{s}</button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) => <Bubble key={i} m={m} />)}
          {busy && <div className="text-sm text-muted"><span className="animate-pulse">Looking that up…</span></div>}
        </div>
        {error && <p className="border-t border-line bg-bad-soft px-4 py-2 text-sm text-bad">{error}</p>}
        <form className="flex items-end gap-2 border-t border-line p-2 sm:p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <textarea
            className={clsx(inputClass, "max-h-32 min-h-[40px] resize-none")}
            rows={1}
            placeholder={readOnly ? "Read-only conversation" : "Ask a question…"}
            value={text}
            disabled={busy || readOnly}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          />
          <select aria-label="Dictation language" value={dictationLang} onChange={(e) => setDictationLang(e.target.value as "en-IN" | "ml-IN")} className={clsx(inputClass, "!w-auto !px-2")}>
            <option value="en-IN">EN</option>
            <option value="ml-IN">മല</option>
          </select>
          <button type="button" onClick={dictate} aria-pressed={listening} title="Dictate" className={buttonClass("secondary", clsx("!px-3", listening && "!bg-accent !text-accent-ink"))}>🎙</button>
          <button type="button" onClick={() => setSpeak((v) => !v)} aria-pressed={speak} title="Read answers aloud" className={buttonClass("secondary", clsx("hidden !px-3 sm:inline-flex", speak && "!bg-accent !text-accent-ink"))}>🔊</button>
          <button className={buttonClass("primary")} disabled={busy || readOnly || !text.trim()}>Send</button>
        </form>
      </section>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === "system") return <div className="mx-auto max-w-[95%] rounded-md bg-bad-soft px-3 py-1.5 text-center text-xs text-bad">⚠ {m.text}</div>;
  const mine = m.role === "user";
  return (
    <div className={clsx("flex", mine && "justify-end")}>
      <div className={clsx("max-w-[92%] rounded-2xl px-3.5 py-2 sm:max-w-[80%]", mine ? "rounded-br-sm bg-accent text-accent-ink" : "rounded-bl-sm bg-panel-2 text-ink")}>
        {mine ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : <RichText text={m.text} />}
        {!mine && m.tools && m.tools.length > 0 && <Sources tools={m.tools} ms={m.ms} model={m.model} />}
      </div>
    </div>
  );
}

/** What the assistant looked up to answer (for trust and debugging). */
function Sources({ tools, ms, model }: { tools: ToolTrace[]; ms?: number; model?: string }) {
  const failed = tools.some((t) => !t.ok);
  return (
    <details className="mt-2 text-xs text-muted">
      <summary className={clsx("cursor-pointer select-none", failed && "text-bad")}>
        Looked up {tools.length} thing{tools.length > 1 ? "s" : ""}{failed ? " (some failed)" : ""}{ms ? ` · ${(ms / 1000).toFixed(1)}s` : ""}
      </summary>
      <ul className="mt-1.5 space-y-1.5 font-mono">
        {tools.map((t, i) => (
          <li key={i} className="overflow-x-auto rounded bg-panel p-1.5">
            <span className={t.ok ? "text-ok" : "text-bad"}>{t.ok ? "✓" : "✗"}</span> {t.name}({Object.keys(t.args ?? {}).length ? JSON.stringify(t.args) : ""}) · {t.ms} ms
            {t.error && <div className="text-bad">{t.error}</div>}
          </li>
        ))}
      </ul>
      {model && <div className="mt-1">model: {model}</div>}
    </details>
  );
}
