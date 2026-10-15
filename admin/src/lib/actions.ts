"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { api } from "./api";
import type { AvailabilityOption, Booking, Payment } from "./types";

export type ActionResult<T = unknown> = { ok: true; data: T; message?: string } | { ok: false; message: string };

async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    refresh();
    return { ok: true, data, message };
  } catch (e) {
    unstable_rethrow(e); // let redirects (e.g. expired session) through
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}

const B = (hotelId: string, code: string) => `/hotels/${hotelId}/bookings/${encodeURIComponent(code)}`;

// ---- bookings ----
export async function checkIn(hotelId: string, code: string, roomIds?: string[]) {
  return run(() => api(`${B(hotelId, code)}/check-in`, { method: "POST", body: roomIds?.length ? { roomIds } : {} }), "Guest checked in");
}
export async function checkOut(hotelId: string, code: string, force = false) {
  return run(() => api(`${B(hotelId, code)}/check-out`, { method: "POST", body: { force } }), "Guest checked out");
}
export async function markNoShow(hotelId: string, code: string) {
  return run(() => api(`${B(hotelId, code)}/no-show`, { method: "POST" }), "Marked as no-show");
}
export async function recordPayment(hotelId: string, code: string, body: { amount: number; method: string; note?: string }) {
  return run(() => api(`${B(hotelId, code)}/payments`, { method: "POST", body }), "Payment recorded");
}
export async function sendPaymentLink(hotelId: string, code: string) {
  return run(() => api<Payment>(`${B(hotelId, code)}/payment-link`, { method: "POST" }), "Payment link sent to the guest on WhatsApp");
}
export async function cancelBooking(hotelId: string, code: string, body: { reason?: string; waiveFee: boolean }) {
  return run(() => api(`${B(hotelId, code)}/cancel`, { method: "POST", body }), "Booking cancelled");
}
export async function modifyBooking(hotelId: string, code: string, body: Record<string, unknown>) {
  return run(() => api(B(hotelId, code), { method: "PATCH", body }), "Booking updated");
}
export async function addBookingNote(hotelId: string, code: string, note: string) {
  return run(() => api(`${B(hotelId, code)}/notes`, { method: "POST", body: { note } }), "Note added");
}
export async function searchAvailability(hotelId: string, body: { checkIn: string; checkOut: string; adults: number; children: number; roomsCount: number }) {
  return run(() => api<{ options: AvailabilityOption[]; nights: number }>(`/hotels/${hotelId}/availability`, { method: "POST", body }));
}
export async function createBooking(hotelId: string, body: Record<string, unknown>) {
  return run(async () => {
    const r = await api<{ booking: Booking; paymentError?: string }>(`/hotels/${hotelId}/bookings`, { method: "POST", body });
    return { code: r.booking.code, status: r.booking.status, paymentError: r.paymentError };
  }, "Booking created");
}

// ---- operations ----
export async function updateRoomStatus(hotelId: string, roomId: string, status: string) {
  return run(() => api(`/hotels/${hotelId}/rooms/${roomId}`, { method: "PATCH", body: { status } }), "Room updated");
}
export async function updateCallback(hotelId: string, id: string, body: { status?: string; notes?: string; assignedTo?: string }) {
  return run(() => api(`/hotels/${hotelId}/callbacks/${id}`, { method: "PATCH", body }), "Callback updated");
}
export async function setStopSell(hotelId: string, body: { roomTypeId: string; from: string; to: string; closed: boolean }) {
  return run(() => api(`/hotels/${hotelId}/inventory/stop-sell`, { method: "PUT", body }));
}
export async function markRefunded(hotelId: string, paymentId: string) {
  return run(() => api(`/hotels/${hotelId}/payments/${paymentId}/mark-refunded`, { method: "POST" }), "Refund marked as completed");
}
export async function updateGuest(hotelId: string, guestId: string, body: { notes?: string; vip?: boolean; email?: string; name?: string }) {
  return run(() => api(`/hotels/${hotelId}/guests/${guestId}`, { method: "PATCH", body }), "Guest saved");
}

// ---- configuration ----
export async function saveRoomType(hotelId: string, id: string | null, body: Record<string, unknown>) {
  return run(
    () => (id ? api(`/hotels/${hotelId}/room-types/${id}`, { method: "PATCH", body }) : api(`/hotels/${hotelId}/room-types`, { method: "POST", body })),
    "Room type saved",
  );
}
export async function deactivateRoomType(hotelId: string, id: string) {
  return run(() => api(`/hotels/${hotelId}/room-types/${id}`, { method: "DELETE" }), "Room type deactivated");
}
export async function addRoom(hotelId: string, body: { roomTypeId: string; number: string; floor?: string }) {
  return run(() => api(`/hotels/${hotelId}/rooms`, { method: "POST", body }), "Room added");
}
export async function saveHotel(hotelId: string, body: Record<string, unknown>) {
  return run(() => api(`/hotels/${hotelId}`, { method: "PATCH", body }), "Settings saved");
}
export async function rotateAgentKey(hotelId: string) {
  return run(() => api<{ apiKey: string }>(`/hotels/${hotelId}/agent-key`, { method: "POST" }), "New key generated");
}

// ---- browser test call (voice agent) ----
export type VoiceTurn = { reply: string; tools: { name: string; ok: boolean }[] };
export type VoiceEnd = { callId: string; outcome?: string; summary?: string; durationSec?: number };

export async function startVoiceCall(hotelId: string, callerPhone: string, callerEmail: string) {
  return run(() => api<{ callId: string; greeting: string }>(`/hotels/${hotelId}/voice/start`, { method: "POST", body: { callerPhone, callerEmail } }));
}
export async function voiceTurn(hotelId: string, callId: string, text: string) {
  return run(() => api<VoiceTurn>(`/hotels/${hotelId}/voice/turn`, { method: "POST", body: { callId, text } }));
}
export async function endVoiceCall(hotelId: string, callId: string) {
  return run(() => api<VoiceEnd>(`/hotels/${hotelId}/voice/end`, { method: "POST", body: { callId } }));
}
