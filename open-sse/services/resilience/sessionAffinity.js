// Session Affinity: bind a session ID to a credential for stable routing.
// Improves prompt caching (Anthropic/OpenAI) and conversation context consistency.

import crypto from "node:crypto";

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

const bindings = new Map(); // sessionKey -> { connectionId, lastUsed }
let lastCleanup = Date.now();

function cleanup(now = Date.now()) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [k, v] of bindings.entries()) {
    if (now - v.lastUsed > DEFAULT_TTL_MS) bindings.delete(k);
  }
}

function hash(str) {
  return crypto.createHash("sha256").update(String(str)).digest("hex").slice(0, 16);
}

/**
 * Extract a session key from request body and headers.
 * Tries multiple sources, falls back to first 2 messages content hash.
 */
export function extractSessionKey(body, headers = {}) {
  // Header-based session IDs
  const headerKeys = [
    "x-session-id",
    "session-id",
    "x-amp-thread-id",
    "x-client-request-id",
    "session_id",
  ];
  for (const k of headerKeys) {
    const v = headers[k] || headers[k.toLowerCase()];
    if (v) return `h:${v}`;
  }

  // Claude Code metadata.user_id
  if (body?.metadata?.user_id) return `m:${body.metadata.user_id}`;

  // OpenAI conversation_id
  if (body?.conversation_id) return `c:${body.conversation_id}`;

  // Hash first 2 messages (conversation fingerprint)
  const msgs = body?.messages || body?.input || body?.contents || [];
  if (Array.isArray(msgs) && msgs.length > 0) {
    const sample = msgs.slice(0, 2).map(m => {
      const c = m?.content;
      if (typeof c === "string") return c.slice(0, 200);
      if (Array.isArray(c)) return c.map(x => x?.text || "").join("").slice(0, 200);
      return "";
    }).join("|");
    if (sample) return `f:${hash(sample)}`;
  }

  return null;
}

/**
 * Bind a session to a connection (called after successful request).
 */
export function bindSession(sessionKey, connectionId) {
  if (!sessionKey || !connectionId) return;
  bindings.set(sessionKey, { connectionId, lastUsed: Date.now() });
  cleanup();
}

/**
 * Resolve a session to its bound connection (called before picking credential).
 * Returns null if no binding or expired.
 */
export function resolveSession(sessionKey) {
  if (!sessionKey) return null;
  const e = bindings.get(sessionKey);
  if (!e) return null;
  if (Date.now() - e.lastUsed > DEFAULT_TTL_MS) {
    bindings.delete(sessionKey);
    return null;
  }
  e.lastUsed = Date.now();
  return e.connectionId;
}

/**
 * Clear all bindings (useful for testing or after credential rotation).
 */
export function clearAllBindings() {
  bindings.clear();
}

export function snapshot() {
  cleanup();
  const out = {};
  for (const [k, v] of bindings.entries()) {
    out[k] = { ...v, msIdle: Date.now() - v.lastUsed };
  }
  return out;
}