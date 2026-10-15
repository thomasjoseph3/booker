// Loaded before every unit test (node --import). Makes tests independent of a developer's real .env:
// no real emails, no API keys, a fixed default country code.
process.env.NODE_ENV = 'test';
process.env.GUEST_CHANNELS = 'whatsapp';
process.env.WHATSAPP_PROVIDER = 'log';
process.env.DEFAULT_COUNTRY_CODE = '91';
process.env.GEMINI_API_KEY = '';
process.env.SMTP_HOST = '';
process.env.EMAIL_OVERRIDE_TO = '';
