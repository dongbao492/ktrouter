// Cooldown scheduler per credential (connectionId or apiKey hash)

const cooldowns = new Map();

function defaultDelay(status) {
  if (status === 429) return 60_000;
  if (status === 403) return 5 * 60_000;
  if (status === 401) return 30_000;
  if (status >= 500) return 30_000;
  return 30_000;
}

export function isCooling(key, now = Date.now()) {
  if (!key) return false;
  const e = cooldowns.get(key);
  if (!e) return false;
  if (e.until <= now) {
    cooldowns.delete(key);
    return false;
  }
  return true;
}

export function getCooldownInfo(key) {
  const e = cooldowns.get(key);
  if (!e) return null;
  if (e.until <= Date.now()) {
    cooldowns.delete(key);
    return null;
  }
  return { until: e.until, msLeft: e.until - Date.now(), reason: e.reason };
}

export function setCooldown(key, status, customMs, reason) {
  if (!key) return;
  const ms = Number.isFinite(customMs) && customMs > 0 ? customMs : defaultDelay(status);
  cooldowns.set(key, { until: Date.now() + ms, reason: reason || `status-${status}` });
}

export function clearCooldown(key) {
  if (!key) return;
  cooldowns.delete(key);
}

export function snapshot() {
  const out = {};
  const now = Date.now();
  for (const [k, v] of cooldowns.entries()) {
    if (v.until > now) out[k] = { ...v, msLeft: v.until - now };
    else cooldowns.delete(k);
  }
  return out;
}