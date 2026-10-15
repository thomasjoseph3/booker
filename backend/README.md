# Backend API (Express + MongoDB)

All booking rules, payments, guest messaging, the AI voice agent and data for the platform.
See the root [README](../README.md) for setup, [docs/API.md](../docs/API.md) for every endpoint and
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how the code is organised (routes → services → repositories).

```bash
npm run dev          # http://localhost:4000
npm run seed         # reset DB + demo data   (--no-demo for properties only)
npm run smoke        # end-to-end test suite on a throwaway database
npm run lint         # ESLint, including the "only repositories import models" rule
npm run format       # Prettier
npm run demo:call    # simulated phone booking through the agent API (API must be running)
```
