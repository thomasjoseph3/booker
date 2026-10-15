# Backend API (Express + MongoDB)

All booking rules, payments, WhatsApp messaging and data for the platform.
See the root [README](../README.md) for setup and [docs/API.md](../docs/API.md) for every endpoint.

```bash
npm run dev     # http://localhost:4000
npm run seed    # reset DB + demo data   (--no-demo for properties only)
npm run smoke   # end-to-end test suite on a throwaway database
npm run demo:call  # simulated phone booking through the agent API (API must be running)
```
