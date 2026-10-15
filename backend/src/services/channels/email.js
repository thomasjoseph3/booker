import nodemailer from 'nodemailer';
import { config } from '../../config.js';

/**
 * Email delivery (SMTP). Works with Gmail (use an App Password), Brevo, SES, Mailtrap, etc.
 * The WhatsApp-style text (*bold*, newlines, links) is rendered as simple HTML.
 */

const SUBJECTS = {
  payment_link: (h, b) => `${h.name}: room on hold, pay advance to confirm (${b.code})`,
  confirmed: (h, b) => `${h.name}: booking confirmed (${b.code})`,
  modified: (h, b) => `${h.name}: booking updated (${b.code})`,
  cancelled: (h, b) => `${h.name}: booking cancelled (${b.code})`,
  expired: (h, b) => `${h.name}: hold released (${b.code})`,
  payment_issue: (h, b) => `${h.name}: action needed on ${b.code}`,
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (text) =>
  esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');

let transporter;
const getTransporter = () => {
  const { host, port, user, pass } = config.email;
  if (!host) throw new Error('SMTP_HOST not configured');
  transporter ||= nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined });
  return transporter;
};

export const emailEnabled = () => config.guestChannels.includes('email');

export function emailRecipient(booking) {
  return config.email.overrideTo || booking.guestEmail || null;
}

export async function sendEmail(to, { text, template, hotel, booking }) {
  const subject = (SUBJECTS[template] || ((h) => h.name))(hotel, booking);
  const info = await getTransporter().sendMail({
    from: config.email.from || config.email.user,
    to,
    replyTo: hotel.contact?.email || undefined,
    subject,
    text: text.replace(/\*/g, ''),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;max-width:560px">${toHtml(text)}</div>`,
  });
  return { status: 'sent', providerMessageId: info.messageId };
}
