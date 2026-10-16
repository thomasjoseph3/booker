// Scripted conversations with the real receptionist prompt, the real Gemini text model and the real MCP tools.
// Every reply is checked: each amount it says must come from a tool result (nothing invented or worked out by the
// model), prices must match what the pricing code itself says, earlier details must not be asked again, and the
// reply must sound spoken (short, no lists). The trace shows which tool gave each amount.
//
//   npm run eval:agent                 all scenarios
//   npm run eval:agent -- split mixed  only scenarios whose name contains one of these words
//
// Needs MongoDB, the MCP server (npm run mcp, or npm run dev) and Gemini keys. Text mode is the same prompt and tools as
// the voice call, but it cannot show how the audio model speaks or listens.
import mongoose from 'mongoose';
import { createAgent } from 'langchain';
import { config } from '../src/config.js';
import { Callback, Hotel } from '../src/models/index.js';
import { createModels } from '../src/agent/shared/model.js';
import { buildSystemPrompt } from '../src/agent/guest/prompt.js';
import { connectCallTools } from '../src/agent/guest/mcpClient.js';
import { callMcpTool, listMcpTools, toLangChainTools } from '../src/agent/shared/mcpTools.js';
import { findAmounts, numbersIn, sameAmount } from '../src/agent/shared/amounts.js';
import { searchAvailability } from '../src/modules/bookings/availability.js';

const CALLER = '+919900112233';
const DATES = { checkIn: '2026-11-20', checkOut: '2026-11-23' }; // Fri, Sat, Sun nights (weekend rates)
const quoteOf = async (hotel, extra, name) => {
  const r = await searchAvailability(hotel, { ...DATES, adults: 2, ...extra });
  return r.options.find((o) => o.name === name).quote;
};
const none = (...res) => res; // "must not match" list

// Each turn: what the caller says, and what must hold. `says` may be a function of the hotel (the pricing code is the oracle).
const SCENARIOS = [
  {
    name: 'weekday-price',
    turns: [
      { say: 'Hi, I want a room for tomorrow night for two of us. What do you have and how much?', tools: ['check_availability'] },
      { say: 'And which one is the cheapest?', notAsk: none(/how many (people|guests|adults)/i, /which (date|night)/i) },
    ],
  },
  {
    name: 'three-night-offer-total',
    turns: [
      { say: 'I need a Garden Cottage from 20 November to 23 November for two adults. What is the total?', tools: ['check_availability', 'price_stay'], mustSay: async (h) => (await quoteOf(h, {}, 'Garden Cottage')).total, mustMatch: [/10 ?(percent|%)|ten[- ]percent/i] },
      { say: 'How did you get that number? Explain the maths.', tools: ['price_stay', 'check_availability', 'calculate'], notAsk: none(/which (date|night)/i) },
      { say: 'What does each night cost then?', notAsk: none(/which (date|night)/i, /how many (people|guests|adults)/i) },
      { say: 'How much do I need to pay in advance?', mustSay: async (h) => (await quoteOf(h, {}, 'Garden Cottage')).advanceDue },
    ],
  },
  {
    name: 'near-miss-offer',
    turns: [
      { say: 'Garden Cottage, 20 to 22 November, two adults. Total price please?', tools: ['check_availability', 'price_stay'], mustMatch: [/(one more night|3 nights|three nights|third night|longer)/i] },
      { say: 'Okay then make it three nights, up to the 23rd. What is the price now?', tools: ['price_stay', 'check_availability'], mustSay: async (h) => (await quoteOf(h, {}, 'Garden Cottage')).total, notAsk: none(/how many (people|guests|adults)/i) },
    ],
  },
  {
    name: 'family-of-five',
    turns: [
      { say: 'We are two adults and three children, 20 to 23 November. What should we book?', tools: ['check_availability'] },
      { say: 'What would two Garden Cottages cost in total for those dates?', tools: ['price_stay'], notAsk: none(/which (date|night)/i, /how many (people|guests|adults|children)/i) },
    ],
  },
  {
    name: 'mixed-rooms',
    turns: [
      { say: 'For 20 to 23 November, I want one Garden Cottage for two adults and one Lake View Villa for two adults. Give me the grand total for both.', tools: ['price_stay'] },
      { say: 'And how much advance for both together?', notAsk: none(/which (date|night)/i) },
    ],
  },
  {
    name: 'split-cost',
    turns: [
      { say: 'Lake View Villa for 20 to 23 November, two adults. How much in total?', tools: ['check_availability', 'price_stay'] },
      { say: 'We are four friends sharing it. What does each person pay?', tools: ['calculate'], notAsk: none(/which (date|night)/i) },
    ],
  },
  {
    name: 'difference',
    turns: [
      { say: 'For 20 to 23 November, two adults: how much cheaper is the Garden Cottage than the Lake View Villa?', tools: ['check_availability', 'price_stay', 'calculate'] },
    ],
  },
  {
    name: 'history-followups',
    turns: [
      { say: 'Hi, I am Ravi. I need a Garden Cottage from 20 to 23 November for two adults.', tools: ['check_availability', 'price_stay'] },
      { say: 'And what about the Pool Villa for the same?', tools: ['check_availability', 'price_stay'], notAsk: none(/which (date|night)/i, /how many (people|guests|adults)/i, /check-?in/i) },
      { say: 'Hmm, what if I stay only two nights in the Pool Villa?', tools: ['price_stay', 'check_availability'], notAsk: none(/how many (people|guests|adults)/i, /which room/i) },
      { say: 'Go back to the Garden Cottage, what was the total again?', mustSay: async (h) => (await quoteOf(h, {}, 'Garden Cottage')).total },
    ],
  },
  {
    name: 'discount-haggle',
    turns: [
      { say: 'Lake View Villa 20 to 23 November for two. Can you give me a 20 percent discount?', tools: ['check_availability', 'price_stay', 'request_human_callback', 'list_special_rates'], notMatch: [/20 ?(percent|%)[^.]*(yes|sure|can do|approved)/i] },
    ],
  },
  {
    name: 'budget',
    turns: [
      { say: 'My budget is 25000 rupees total. For 20 to 23 November, two adults. What can I get?', tools: ['check_availability', 'price_stay'] },
    ],
  },
];

const SENTENCES = (t) => (t.match(/[^.!?]+[.!?]+/g) ?? [t]).length;
const retriable = (e) => /503|429|quota|rate.?limit|RESOURCE_EXHAUSTED|high demand|Recursion limit/i.test(String(e?.message ?? e));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => `INR ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

async function runScenario(hotel, sc, models) {
  const callId = `eval-${sc.name}-${Date.now()}`;
  const client = await connectCallTools({ hotel, callId, callerPhone: CALLER });
  const results = []; // every tool call: { name, args, text }
  const tools = toLangChainTools(
    await listMcpTools(client),
    async (t, args) => {
      const text = JSON.stringify(await callMcpTool(client, t.name, args));
      results.push({ name: t.name, args, text });
      return text;
    },
    { validate: true },
  );
  const system = buildSystemPrompt(hotel, { callerPhone: CALLER });
  let messages = [];
  const said = [];
  const report = [];
  for (const turn of sc.turns) {
    messages.push({ role: 'user', content: turn.say });
    said.push(turn.say);
    const before = results.length;
    let reply;
    let failure;
    for (let attempt = 0; attempt < 6 && reply === undefined; attempt++) {
      for (const model of models) {
        try {
          results.length = before;
          const r = await createAgent({ model, tools, systemPrompt: system }).invoke({ messages }, { recursionLimit: 16 });
          messages = r.messages;
          reply = r.messages.at(-1).text?.trim();
          break;
        } catch (e) {
          failure = e;
        }
      }
      if (reply === undefined) {
        if (!retriable(failure)) break;
        await sleep(4000 * (attempt + 1));
      }
    }
    const turnTools = results.slice(before);
    const problems = [];
    if (reply === undefined) {
      report.push({ turn, reply: '(no reply)', turnTools, problems: [`the model did not answer: ${String(failure?.message).slice(0, 80)}`], amounts: [] });
      break;
    }

    // 1. Every amount said must come from a tool result (or the caller's own words), and we show which tool.
    const allowed = new Set([...results.flatMap((r) => [...numbersIn(r.text)]), ...said.flatMap((s) => [...numbersIn(s)])]);
    const amounts = findAmounts(reply).map((a) => {
      const src = [...results].reverse().find((r) => [...numbersIn(r.text)].some((n) => sameAmount(n, a.value)));
      const ok = [...allowed].some((n) => sameAmount(n, a.value));
      if (!ok) problems.push(`invented amount: "${a.text}" is in no tool result`);
      return { ...a, source: src ? src.name : ok ? 'caller' : '—' };
    });
    // 2. The price must match what the pricing code says.
    if (turn.mustSay) {
      const want = [].concat(await turn.mustSay(hotel));
      for (const w of want) if (!amounts.some((a) => sameAmount(a.value, w))) problems.push(`should say ${money(w)} but said ${amounts.map((a) => a.value).join(', ') || 'no amount'}`);
    }
    // 3. History: no questions about things already told.
    for (const re of turn.notAsk ?? []) if (re.test(reply) && /\?/.test(reply)) problems.push(`asked again about something already said (${re})`);
    for (const re of turn.mustMatch ?? []) if (!re.test(reply)) problems.push(`missing: ${re}`);
    for (const re of turn.notMatch ?? []) if (re.test(reply)) problems.push(`must not say: ${re}`);
    // 4. Sounds spoken.
    if (SENTENCES(reply) > 5) problems.push(`too long for a phone call (${SENTENCES(reply)} sentences)`);
    if (/[*#]|^\s*[-•]\s|\n\s*[-•\d]+[.)]\s/m.test(reply)) problems.push('uses lists or markdown');
    if (/as an ai|language model/i.test(reply)) problems.push('talks like an AI');
    report.push({ turn, reply, turnTools, problems, amounts });
  }
  await client.close();
  return { callId, report };
}

const argv = process.argv.slice(2);
await mongoose.connect(config.mongoUri ?? process.env.MONGODB_URI ?? process.env.MONGO_URI);
const hotel = await Hotel.findOne();
const m = createModels({ temperature: 0.4 });
const models = [m.primary, ...(m.fallbacks ?? [])];
const chosen = SCENARIOS.filter((s) => !argv.length || argv.some((a) => s.name.includes(a)));

let failed = 0;
let checked = 0;
for (const sc of chosen) {
  console.log(`\n━━ ${sc.name}`);
  const { report } = await runScenario(hotel, sc, models);
  for (const { turn, reply, turnTools, problems, amounts } of report) {
    checked++;
    console.log(`\n  CALLER: ${turn.say}`);
    for (const t of turnTools) console.log(`    tool  ${t.name}(${JSON.stringify(t.args)})`);
    console.log(`  AGENT : ${reply}`);
    for (const a of amounts) console.log(`    amount ${money(a.value)}  ← ${a.source}`);
    if (problems.length) {
      failed++;
      for (const p of problems) console.log(`    ✗ ${p}`);
    } else console.log('    ✓ ok');
  }
}
await Callback.deleteMany({ callId: /^eval-/ });
console.log(`\n${checked - failed}/${checked} turns passed`);
await mongoose.disconnect();
process.exit(failed ? 1 : 0);
