# Guest website (Next.js)

Public hotel page with a **Call to book** button. The call is a real-time voice conversation with the AI
receptionist, streamed from the browser to the backend over a WebSocket (see [docs/VOICE_AGENT.md](../docs/VOICE_AGENT.md)).

```bash
npm run dev     # http://localhost:3001 (needs the backend on :4000)
```

Configuration (`.env.local`, copied from `.env.example` by `npm run setup`):

| Variable | Purpose |
|---|---|
| `API_URL` | Backend URL used by the server to load property info |
| `NEXT_PUBLIC_API_URL` | Backend URL used by the browser for the call WebSocket |
| `NEXT_PUBLIC_HOTEL_SLUG` | Property shown at `/` (other properties live at `/<slug>`) |

Use Chrome or Edge, and headphones for the best sound.
