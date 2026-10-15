import crypto from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from '../config.js';
import * as hotels from '../modules/hotels/repository.js';
import { normalizePhone } from '../utils/misc.js';
import { appendTranscript, finishCall, openCallLog } from './callRecord.js';
import { buildSystemPrompt } from './prompt.js';
import { createSession } from './session.js';
import { geminiFunctionDeclarations } from './tools.js';
import { runTool } from './toolRunner.js';

/**
 * Real-time voice calls for the public website.
 *
 *   browser mic --PCM16 16kHz--> [this WebSocket] --> Gemini Live (audio in / audio out / tools)
 *   browser speaker <--PCM16 24kHz-- [this WebSocket] <--
 *
 * Binary frames carry audio. Text frames are small JSON events:
 *   server -> client: ready | interrupt | transcript {role,text} | tool {name,ok} | ended {summary,...} | error {message}
 *   client -> server: end | text {text}
 * Tools run here (server side) against /api/agent/*, so the Gemini key and agent key never reach the browser.
 */

const GEMINI_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
let active = 0;
const send = (ws, payload) => ws.readyState === WebSocket.OPEN && ws.send(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));

export function attachLiveAgent(server) {
  const wss = new WebSocketServer({ server, path: '/api/live', maxPayload: 512 * 1024 });
  wss.on('connection', (client, req) => {
    handleCall(client, req).catch((e) => {
      console.error('[live] failed:', e.message);
      send(client, { type: 'error', message: 'The call could not be connected.' });
      client.close();
    });
  });
  return wss;
}

async function handleCall(client, req) {
  const url = new URL(req.url, 'http://x');
  const hotelRef = (url.searchParams.get('hotel') || '').toLowerCase();
  const hotel = await hotels.findActiveBySlug(hotelRef);
  if (!hotel) {
    send(client, { type: 'error', message: 'This property is not available.' });
    return client.close();
  }
  if (!config.gemini.apiKey) {
    send(client, { type: 'error', message: 'Voice agent is not configured.' });
    return client.close();
  }
  if (active >= config.gemini.maxLiveCalls) {
    send(client, { type: 'error', message: 'All our lines are busy right now. Please try again in a moment.' });
    return client.close();
  }
  active++;

  const callerPhone = normalizePhone(url.searchParams.get('phone') || '') || '';
  const callerEmail = (url.searchParams.get('email') || '').trim().toLowerCase().slice(0, 120);
  const callId = `web-${crypto.randomBytes(5).toString('hex')}`;
  const greeting = hotel.agent?.greeting || `Hello, thank you for calling ${hotel.name}. How can I help you today?`;
  const session = createSession({ callerPhone, callerEmail: /^\S+@\S+\.\S+$/.test(callerEmail) ? callerEmail : undefined });
  await openCallLog(hotel, { callId, callerPhone, note: 'Website call' });

  const upstream = new WebSocket(`${GEMINI_WS}?key=${config.gemini.apiKey}`);
  let ready = false;
  let ended = false;
  const pending = []; // client audio that arrived before Gemini was ready
  const turn = { role: null, text: '' }; // transcript chunks of the current speaker
  const flush = async () => {
    if (turn.role && turn.text.trim()) await appendTranscript(hotel._id, callId, [{ role: turn.role, text: turn.text.trim() }]);
    turn.role = null;
    turn.text = '';
  };
  const addText = async (role, text) => {
    if (turn.role !== role) await flush();
    turn.role = role;
    turn.text += text;
    send(client, { type: 'transcript', role, text });
  };

  const end = async (reason) => {
    if (ended) return;
    ended = true;
    active--;
    clearTimeout(limit);
    await flush().catch(() => {});
    if (upstream.readyState <= WebSocket.OPEN) upstream.close();
    let result = {};
    try {
      result = await finishCall(hotel, callId, session);
    } catch (e) {
      console.error('[live] finish failed:', e.message);
    }
    send(client, { type: 'ended', reason, ...result });
    client.close();
  };
  const limit = setTimeout(() => end('time_limit'), config.gemini.maxLiveMinutes * 60 * 1000);

  upstream.on('open', () => {
    upstream.send(JSON.stringify({
      setup: {
        model: `models/${config.gemini.liveModel}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.7,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.gemini.liveVoice } } },
        },
        systemInstruction: { parts: [{ text: buildSystemPrompt(hotel, session) }] },
        tools: [{ functionDeclarations: geminiFunctionDeclarations }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }));
  });

  upstream.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.setupComplete) {
      ready = true;
      for (const chunk of pending.splice(0)) sendAudio(chunk);
      send(client, { type: 'ready', callId });
      upstream.send(JSON.stringify({ realtimeInput: { text: `[The call has just connected. Greet the caller now by saying: "${greeting}"]` } }));
      return;
    }
    const sc = m.serverContent;
    if (sc) {
      for (const part of sc.modelTurn?.parts || []) if (part.inlineData?.data) send(client, Buffer.from(part.inlineData.data, 'base64'));
      if (sc.interrupted) {
        send(client, { type: 'interrupt' });
        await flush();
      }
      if (sc.inputTranscription?.text) await addText('caller', sc.inputTranscription.text);
      if (sc.outputTranscription?.text) await addText('agent', sc.outputTranscription.text);
      if (sc.turnComplete) await flush();
    }
    if (m.toolCall?.functionCalls?.length) {
      const functionResponses = [];
      for (const fc of m.toolCall.functionCalls) {
        const result = await runTool(session, hotel, callId, fc.name, fc.args || {});
        send(client, { type: 'tool', name: fc.name, ok: !result.error });
        await appendTranscript(hotel._id, callId, [{ role: 'tool', text: `${fc.name}(${JSON.stringify(fc.args || {})}) → ${result.error ? `ERROR ${result.error}` : 'ok'}` }]);
        functionResponses.push({ id: fc.id, name: fc.name, response: { result } });
      }
      upstream.send(JSON.stringify({ toolResponse: { functionResponses } }));
    }
    if (m.goAway) console.warn('[live] Gemini sent goAway');
  });

  upstream.on('close', (code, reason) => {
    if (!ended && code !== 1000) console.error(`[live] Gemini closed ${code} ${reason.toString().slice(0, 200)}`);
    if (!ended) {
      if (!ready) send(client, { type: 'error', message: 'The voice service is unavailable right now.' });
      void end('upstream_closed');
    }
  });
  upstream.on('error', (e) => console.error('[live] Gemini socket error:', e.message));

  const sendAudio = (buf) => upstream.send(JSON.stringify({ realtimeInput: { audio: { data: buf.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));

  client.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!ready) pending.length < 200 && pending.push(data);
      else if (upstream.readyState === WebSocket.OPEN) sendAudio(data);
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'end') void end('hangup');
      else if (msg.type === 'text' && ready && typeof msg.text === 'string') {
        void addText('caller', `${msg.text.slice(0, 500)} `);
        upstream.send(JSON.stringify({ realtimeInput: { text: msg.text.slice(0, 500) } }));
      }
    } catch { /* ignore malformed frames */ }
  });
  client.on('close', () => void end('hangup'));
  client.on('error', () => void end('error'));
}
