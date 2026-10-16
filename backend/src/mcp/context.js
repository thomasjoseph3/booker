/**
 * What the MCP server fills in for a live call, from the signed token, before a tool runs. The model never gets to
 * choose these: the caller's own number is the default for every lookup, and the booking and any callback request are
 * always tied to this call.
 */
export function applyCallContext(spec, args, claims) {
  const input = { ...args };
  if (input.phone === undefined && claims.phone && 'phone' in spec.schema.shape) input.phone = claims.phone;
  if (spec.name === 'create_booking') {
    input.callId = claims.callId;
    input.guest = {
      ...(claims.phone ? { phone: claims.phone } : {}),
      ...(claims.email ? { email: claims.email } : {}),
      ...input.guest,
    };
  }
  if (spec.name === 'request_human_callback') input.callId = claims.callId;
  return input;
}
