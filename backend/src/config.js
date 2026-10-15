import crypto from 'node:crypto';
import 'dotenv/config';

const port = Number(process.env.PORT || 4000);

// GEMINI_API_KEY plus optional GEMINI_API_KEY_2 ... GEMINI_API_KEY_10; extra keys (ideally from separate projects) are rotated when one hits its quota
const geminiKeys = [
  ...new Set(
    [process.env.GEMINI_API_KEY, ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`])]
      .map((k) => k?.trim())
      .filter(Boolean),
  ),
];

export const config = {
  env: process.env.NODE_ENV || 'development',
  port,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hotel_agent',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  adminUrl: process.env.ADMIN_URL || 'http://localhost:3000',
  agentMasterKey: process.env.AGENT_MASTER_KEY || '',
  // In-process key the built-in (browser) voice agent uses to call the agent API; regenerated on every boot
  internalAgentKey: crypto.randomBytes(24).toString('hex'),
  gemini: {
    apiKeys: geminiKeys,
    liveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
    liveVoice: process.env.GEMINI_LIVE_VOICE || 'Aoede',
    maxLiveCalls: Number(process.env.MAX_LIVE_CALLS || 5),
    maxLiveMinutes: Number(process.env.MAX_LIVE_MINUTES || 10),
    // Tried in order; later ones are used when an earlier one is rate limited
    models: [
      process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      ...(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(','),
    ]
      .map((m) => m.trim())
      .filter(Boolean),
  },
  paymentProvider: process.env.PAYMENT_PROVIDER || 'mock',
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  holdSweepSeconds: Number(process.env.HOLD_SWEEP_SECONDS || 60),
  // Guest phone numbers without a "+" prefix are assumed to be in this country
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '91',
  // Which channels guest messages go out on: comma list of whatsapp,email
  guestChannels: (process.env.GUEST_CHANNELS || 'whatsapp')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean),
  email: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM,
    // Dev/demo: send every guest email here instead of the guest's own address
    overrideTo: process.env.EMAIL_OVERRIDE_TO,
  },
  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || 'log',
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
    templates: {
      payment_link: process.env.WHATSAPP_TEMPLATE_PAYMENT_LINK,
      confirmed: process.env.WHATSAPP_TEMPLATE_CONFIRMED,
      modified: process.env.WHATSAPP_TEMPLATE_MODIFIED,
      cancelled: process.env.WHATSAPP_TEMPLATE_CANCELLED,
      expired: process.env.WHATSAPP_TEMPLATE_EXPIRED,
      payment_issue: process.env.WHATSAPP_TEMPLATE_PAYMENT_ISSUE,
    },
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM,
  },
};

if (config.env === 'production' && config.jwtSecret === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
