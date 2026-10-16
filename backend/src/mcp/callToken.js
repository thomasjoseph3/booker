import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * The pass a live call carries to the MCP server. It names the hotel, the call and the caller, and it is signed, so the
 * model cannot change who the caller is or which hotel it works for: the MCP server takes those from the token and
 * ignores anything the model says about them. It expires shortly after the longest call allowed.
 */
const AUDIENCE = 'mcp-call';

export function mintCallToken({ hotelId, callId, phone, email }, ttlSeconds) {
  return jwt.sign({ hotel: String(hotelId), callId, phone: phone || undefined, email: email || undefined }, config.mcp.secret, {
    audience: AUDIENCE,
    algorithm: 'HS256',
    expiresIn: ttlSeconds,
  });
}

/** Returns the claims, or throws when the token is forged, expired or meant for something else. */
export const verifyCallToken = (token) => jwt.verify(token, config.mcp.secret, { audience: AUDIENCE, algorithms: ['HS256'] });
