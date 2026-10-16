# Voice agent: how it works

A guest opens the hotel website, clicks **Call to book**, talks to an AI receptionist in the browser, and the
booking is created in the same database the admin dashboard uses. No phone line is involved yet.

## 1. The three apps

| App | Folder | Port | Tech | Who uses it |
|---|---|---|---|---|
| Backend API | `backend/` | 4000 | Node 20, Express 5, MongoDB (Mongoose), `ws`, `nodemailer`, `zod` | Everything talks to it |
| Admin dashboard | `admin/` | 3000 | Next.js 16, React 19, Tailwind 4 | Hotel staff: rooms, rates, bookings, call history |
| Guest website | `site/` | 3001 | Next.js 16, React 19, Tailwind 4, Web Audio API | Guests: browse and call to book |

The voice feature adds one backend module (`liveAgent.js`), one browser module (`live-call.ts`) and one UI
component (`call-dialog.tsx`). The booking logic (availability, pricing, holds, payments, cancellations) already
existed and is reused unchanged.

## 2. Technology choices and why

| Need | Choice | Why |
|---|---|---|
| Speech in and out | **Gemini Live** (`gemini-3.8-live`), a native-audio model | One model hears audio and speaks audio directly. No separate speech-to-text and text-to-speech steps, so lower latency, natural intonation, and the caller can interrupt it. |
| Browser to backend transport | **WebSocket** with raw PCM audio | Simple, no extra service or account. Uncompressed audio avoids encode and decode delay. |
| Microphone capture | **Web Audio API + AudioWorklet** | Runs on its own audio thread, so capture does not glitch when the page is busy. |
| Server WebSocket | **`ws`** npm package | Standard Node WebSocket server and client. |
| Tool calling | Gemini function calling, tools written in `backend/src/mcp/tools/guest.js` and run by the MCP server | The model decides when to check availability or book; the backend executes it against the real API. |
| Guest messages | **Nodemailer over SMTP** (Gmail app password for now) | WhatsApp setup was pending; email works immediately. `GUEST_CHANNELS` selects email, WhatsApp or both. |
| Tools, staff assistant, summaries | **LangChain** (`langchain`, `@langchain/core`, `@langchain/google-genai`) | One zod schema per tool; the staff assistant is a `createAgent` agent; summaries use structured output. The live audio path stays native (see ARCHITECTURE.md, "Where LangChain stops"). |

Not used (yet): LiveKit, Pipecat, Deepgram, ElevenLabs, a telephony provider. They are possible upgrades (section 8).

## 3. The call, step by step

```
Browser (site/)                          Backend (backend/)                         Google
mic -> AudioWorklet -> PCM16 16 kHz --WS--> liveAgent.js --WS--> Gemini Live
speaker <- scheduled PCM16 24 kHz   <-WS--  (relay + tools + logging) <-- audio, transcripts, tool calls
                                                |
                                                +--HTTP--> /api/agent/*  (availability, bookings, ...) -> MongoDB, email
```

1. **Start.** `call-dialog.tsx` creates a `LiveCall` (`site/src/lib/live-call.ts`) and calls `start()`.
2. **Microphone.** `getUserMedia` with echo cancellation, noise suppression and auto gain control.
3. **Capture worklet.** A small `AudioWorkletProcessor` (inline string in `live-call.ts`) resamples the mic
   to 16 kHz by linear interpolation, converts float samples to 16-bit integers, and posts a 512-sample chunk
   (about 32 ms) to the main thread, which sends it as a binary WebSocket frame.
4. **Backend accepts the socket** at `ws://host:4000/api/live?hotel=<slug>` (`attachLiveAgent` in
   `agent/liveAgent.js`, attached to the same HTTP server in `server.js`). It looks up the hotel, enforces
   `MAX_LIVE_CALLS`, creates a `CallLog`, and opens a second WebSocket to Google
   (`...BidiGenerateContent`).
5. **Setup message** to Gemini (the `setup` object in `liveAgent.js`):
   - `model`: `GEMINI_LIVE_MODEL`
   - `responseModalities: ['AUDIO']` and the prebuilt voice (`GEMINI_LIVE_VOICE`)
   - `systemInstruction`: built by `buildSystemPrompt()` in `agent/prompt.js` (hotel facts, speaking style, booking rules)
   - `tools`: function declarations built from the tool list the MCP server offers
   - `inputAudioTranscription` / `outputAudioTranscription`: text of both sides, used for captions and logs
6. **Greeting.** On `setupComplete` the backend sends a text turn telling the model to say the hotel's greeting.
7. **Audio relay.** Browser chunks are wrapped as `realtimeInput.audio` (base64, `audio/pcm;rate=16000`) and sent
   to Gemini. Gemini's reply audio (`serverContent.modelTurn.parts[].inlineData`, PCM 24 kHz) is decoded and
   forwarded to the browser as binary frames.
8. **Playback.** `LiveCall.play()` turns each chunk into an `AudioBuffer` and schedules it on the Web Audio clock
   right after the previous one (`playhead`), so playback is gapless while chunks are still arriving.
9. **Interruption (barge-in).** Gemini's voice-activity detection notices the caller talking over the agent and
   sends `serverContent.interrupted`. The backend sends `{type:'interrupt'}`; the browser stops every scheduled
   source immediately.
10. **Tools.** Gemini sends `toolCall.functionCalls`. The backend runs each via `runTool()` (in `agent/toolRunner.js`),
    which calls `http://127.0.0.1:4000/api/agent/...` with an in-process key, then returns a `toolResponse`. The
    model reads the result and speaks it. `create_booking` creates the booking, holds the room and sends the
    payment-link email.
11. **Transcript and logs.** Transcript text chunks are streamed to the browser as captions and written to the
    `CallLog` when the speaker changes.
12. **End.** On hang up, `finishCall()` (`agent/callRecord.js`) computes the outcome (booked, cancelled, inquiry, ...), asks Gemini for a
    short summary and sentiment, and links created bookings to the call.

## 4. Protocol between browser and backend

Binary frames are audio. Text frames are JSON events.

| Direction | Message | Meaning |
|---|---|---|
| server to client | `ready` | Gemini is connected; the greeting starts |
| server to client | `transcript {role, text}` | Caption chunk (`caller` or `agent`) |
| server to client | `tool {name, ok}` | A tool ran (UI shows a small hint) |
| server to client | `interrupt` | Drop queued audio, the caller spoke |
| server to client | `ended {summary, outcome, durationSec}` | Call finished |
| server to client | `error {message}` | Could not connect, busy, etc. |
| client to server | `end` | Hang up |
| client to server | `text {text}` | Typed message (fallback) |

## 5. File map

| File | Responsibility |
|---|---|
| `backend/src/agent/liveAgent.js` | WebSocket server, Gemini Live relay, tool execution, transcript logging |
| `backend/src/agent/prompt.js` | System prompt: persona, speaking style, booking rules, property facts |
| `backend/src/mcp/tools/guest.js` | Tool definitions (name, description, JSON schema, which HTTP endpoint implements it) |
| `backend/src/agent/toolRunner.js` | LangChain tools for one call: each runs the agent API request and logs it |
| `backend/src/agent/routes.js` | The booking API the agent uses as tools (`/api/agent/*`) |
| `backend/src/agent/callRecord.js` | Call log: open, append transcript, close with outcome and summary |
| `backend/src/agent/shared/model.js`, `schema.js` | LangChain chat models with fallbacks; zod to provider JSON schema |
| `backend/src/agent/staff/` | The separate, read-only staff assistant (see ARCHITECTURE.md) |
| `backend/src/modules/notifications/` | Guest messages by email and/or WhatsApp |
| `backend/src/modules/public/` | Unauthenticated property info for the website |
| `site/src/lib/live-call.ts` | Browser audio engine: mic capture, WebSocket, gapless playback, level meter |
| `site/src/components/call-dialog.tsx` | Call screen: orb, captions, mute, hang up |
| `site/src/components/property-page.tsx` | Landing page: rooms, amenities, FAQ |
| `admin/src/app/h/[hotelId]/assistant/` | The staff assistant chat page with conversation history |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the backend is layered.

## 6. Configuration (`backend/.env`)

```
GEMINI_API_KEY=            # Google AI Studio key
GEMINI_LIVE_MODEL=gemini-3.8-live
GEMINI_LIVE_VOICE=Aoede
MAX_LIVE_CALLS=5           # concurrent calls
MAX_LIVE_MINUTES=10        # per call
GEMINI_MODEL=gemini-2.5-flash            # text agent and summaries
GEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite
GUEST_CHANNELS=email       # email, whatsapp, or email,whatsapp
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM
```

Run: `npm run dev` in `backend/`, `admin/` and `site/` (MongoDB must be running; `npm run seed` in `backend/`).

## 7. Language

The agent answers in the language the caller is speaking, and follows them if they switch (Malayalam, English, or the
Malayalam-English mix many callers use). Gemini Live hears the caller's audio directly, so no language setting is needed
and the output language is deliberately not forced. The rules live in `agent/shared/language.js` and are used by both
agents' prompts; the staff assistant also answers typed Malayalam in Malayalam, and its dictation button has an EN/മല switch.

- The greeting is fixed text per property (`hotel.agent.greeting`), because the agent cannot know the language before the caller speaks.
- Exact things stay clear in any language: booking codes and email addresses are read letter by letter, phone numbers digit by digit, and tool arguments keep their required formats.
- Each call log stores the main language spoken (English, Malayalam, Mixed, ...) and an English summary, so staff can read it. Analytics shows caller languages.
- The live transcript of a Malayalam caller is produced by the speech model in romanised form (for example "enikku naala rathrikku..."); the agent's own replies are transcribed in Malayalam script.
- Verified with real spoken Malayalam (Gemini text-to-speech fed into a live call): the agent answered in Malayalam, then switched to English when the caller did.

## 8. Known limits of the current setup

- Gemini Live models are **preview**; behaviour and quotas can change. A free key has low rate limits.
- `/api/live` is public (guests need it). Before launch: per-IP rate limiting, allowed origins, and abuse limits.
- Echo: without headphones the agent can hear itself. Browser echo cancellation helps but is not perfect.
- Speech quality in Malayalam depends on the model and voice and needs real listening tests.
- No real phone number yet.
- Room images are not in the seed data, so the site shows gradients.

## 9. Possible upgrades

- **Phone calls:** a telephony provider (Twilio, Exotel, Plivo) streaming call audio into the same relay, or
  LiveKit SIP.
- **LiveKit** for production WebRTC transport (better on bad networks than a plain WebSocket).
- **Pipeline alternative:** streaming STT (Deepgram or Sarvam) + LLM + streaming TTS (Cartesia or ElevenLabs),
  for full control over voice and Indian languages. Worth comparing on Malayalam.
- Human handoff to a live line, call recording, analytics on call outcomes.
