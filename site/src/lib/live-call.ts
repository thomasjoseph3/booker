/**
 * Browser side of a live voice call: streams the mic to the backend as 16 kHz PCM16 and plays the
 * agent's 24 kHz PCM16 replies gaplessly. Barge-in is handled server side: when the caller talks over
 * the agent the server sends "interrupt" and we drop everything that is still queued.
 */

export type CallEvent =
  | { type: "ready" }
  | { type: "transcript"; role: "caller" | "agent"; text: string }
  | { type: "tool"; name: string; ok: boolean }
  | { type: "interrupt" }
  | { type: "busy"; on: boolean }
  | { type: "ended"; summary?: string; outcome?: string; durationSec?: number }
  | { type: "error"; message: string };

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.pos = 0; this.acc = 0; this.ratio = sampleRate / 16000; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    // resample to 16 kHz by linear interpolation
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = ch[i], b = i + 1 < ch.length ? ch[i + 1] : a;
      this.buf.push(a + (b - a) * f);
    }
    this.pos -= ch.length;
    while (this.buf.length >= 512) {
      const out = new Int16Array(512);
      for (let i = 0; i < 512; i++) out[i] = Math.max(-1, Math.min(1, this.buf[i])) * 32767;
      this.buf.splice(0, 512);
      this.port.postMessage({ pcm: out.buffer, level: Math.sqrt(sum / ch.length) }, [out.buffer]);
    }
    return true;
  }
}
registerProcessor("capture", Capture);
`;

export class LiveCall {
  private ws?: WebSocket;
  private mic?: MediaStream;
  private inCtx?: AudioContext;
  private outCtx?: AudioContext;
  private analyser?: AnalyserNode;
  private playhead = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private micLevel = 0;
  private muted = false;
  private closed = false;

  constructor(private url: string, private onEvent: (e: CallEvent) => void) {}

  /** 0..1 loudness of whoever is currently louder; used to animate the orb. */
  get level() {
    let out = 0;
    if (this.analyser) {
      const d = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(d);
      let s = 0;
      for (const v of d) s += ((v - 128) / 128) ** 2;
      out = Math.sqrt(s / d.length) * 3;
    }
    return Math.min(1, Math.max(out, this.muted ? 0 : this.micLevel * 4));
  }
  get speaking() { return this.sources.size > 0; }

  async start() {
    // Browsers (iOS Safari especially) only let audio start inside the user's tap. Create and unlock both audio
    // contexts first, synchronously, before anything is awaited; then ask for the mic.
    this.outCtx = new AudioContext();
    this.inCtx = new AudioContext();
    const unlocked = Promise.all([this.outCtx.resume(), this.inCtx.resume()]);
    // Mic next, so a permission problem fails before we open a line.
    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await unlocked;
    this.analyser = this.outCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.outCtx.destination);

    const blob = new Blob([WORKLET], { type: "application/javascript" });
    await this.inCtx.audioWorklet.addModule(URL.createObjectURL(blob));
    const node = new AudioWorkletNode(this.inCtx, "capture");
    this.inCtx.createMediaStreamSource(this.mic).connect(node);

    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      this.micLevel = e.data.level;
      if (!this.muted && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(e.data.pcm);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        const ev = JSON.parse(e.data) as CallEvent;
        if (ev.type === "interrupt") this.flushPlayback();
        this.onEvent(ev);
        if (ev.type === "ended" || ev.type === "error") this.teardown(ev.type === "ended");
      } else this.play(e.data as ArrayBuffer);
    };
    ws.onclose = () => { if (!this.closed) { this.teardown(); this.onEvent({ type: "ended" }); } };
    ws.onerror = () => this.onEvent({ type: "error", message: "Could not reach the reservations line." });
  }

  sendText(text: string) { this.ws?.send(JSON.stringify({ type: "text", text })); }
  setMuted(m: boolean) { this.muted = m; }
  hangUp() { this.flushPlayback(); if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "end" })); else this.teardown(); }

  private play(buf: ArrayBuffer) {
    const ctx = this.outCtx;
    if (!ctx || !this.analyser) return;
    const pcm = new Int16Array(buf, 0, Math.floor(buf.byteLength / 2));
    const audio = ctx.createBuffer(1, pcm.length, 24000);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.analyser);
    this.playhead = Math.max(this.playhead, ctx.currentTime + 0.04);
    src.start(this.playhead);
    this.playhead += audio.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  private flushPlayback() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.playhead = 0;
  }

  /** `drain`: let the agent finish its last sentence (the server hung up after its goodbye) before closing the audio. */
  private teardown(drain = false) {
    this.closed = true;
    this.muted = true;
    this.mic?.getTracks().forEach((t) => t.stop());
    void this.inCtx?.close().catch(() => {});
    const finish = () => {
      this.flushPlayback();
      void this.outCtx?.close().catch(() => {});
      this.ws?.close();
    };
    const wait = drain && this.outCtx ? Math.min(10, Math.max(0, this.playhead - this.outCtx.currentTime)) : 0;
    if (wait > 0) setTimeout(finish, wait * 1000 + 250);
    else finish();
  }
}
