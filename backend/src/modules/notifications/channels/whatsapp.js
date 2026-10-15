import { config } from '../../../config.js';

/**
 * WhatsApp delivery.
 *
 * WHATSAPP_PROVIDER=log    -> store + print only (default, for development)
 * WHATSAPP_PROVIDER=meta   -> WhatsApp Cloud API (graph.facebook.com)
 * WHATSAPP_PROVIDER=twilio -> Twilio WhatsApp
 *
 * WhatsApp only allows free-form text inside a 24h window after the guest messages you.
 * A guest who *phoned* has not messaged you, so production sends must use pre-approved
 * templates. Map each message type to an approved template name via env
 * (WHATSAPP_TEMPLATE_PAYMENT_LINK, ..._CONFIRMED, ...); the template's {{1}}, {{2}}...
 * body variables receive `params` in order (see notify.js).
 */

async function sendMeta(to, { text, template, params }) {
  const { token, phoneNumberId, templateLanguage } = config.whatsapp;
  if (!token || !phoneNumberId) throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured');
  const templateName = config.whatsapp.templates[template];
  const payload = templateName
    ? {
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }],
        },
      }
    : { messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body: text, preview_url: true } };
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp API error ${res.status}`);
  return { status: 'sent', providerMessageId: data.messages?.[0]?.id };
}

async function sendTwilio(to, { text }) {
  const { accountSid, authToken, whatsappFrom } = config.twilio;
  if (!accountSid || !authToken || !whatsappFrom) throw new Error('Twilio WhatsApp is not configured');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: `whatsapp:${whatsappFrom}`, To: `whatsapp:${to}`, Body: text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Twilio error ${res.status}`);
  return { status: 'sent', providerMessageId: data.sid };
}

export async function sendWhatsApp(to, message) {
  switch (config.whatsapp.provider) {
    case 'meta':
      return sendMeta(to, message);
    case 'twilio':
      return sendTwilio(to, message);
    default:
      return { status: 'logged' };
  }
}
