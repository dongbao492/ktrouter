// Circuit Breaker per provider
// States: closed (normal) | open (skip) | half-open (probe)

const STATE = { CLOSED: "closed", OPEN: "open", HALF_OPEN: "half-open" };

const DEFAULTS = {
  failureThreshold: 5,
  openDurationMs: 30_000,
  halfOpenMaxAttempts: 1,
  successesToClose: 1,
};

const breakers = new Map();

function get(provider) {
  let b = breakers.get(provider);
  if (!b) {
    b = { state: STATE.CLOSED, failures: 0, successes: 0, openedAt: 0, halfOpenInflight: 0 };
    breakers.set(provider, b);
  }
  return b;
}

export function canExecute(provider) {
  const b = get(provider);
  const now = Date.now();
  if (b.state === STATE.OPEN) {
    if (now - b.openedAt >= DEFAULTS.openDurationMs) {
      b.state = STATE.HALF_OPEN;
      b.halfOpenInflight = 0;
      b.successes = 0;
    } else {
      return { allow: false, reason: "circuit-open", retryAt: b.openedAt + DEFAULTS.openDurationMs };
    }
  }
  if (b.state === STATE.HALF_OPEN) {
    if (b.halfOpenInflight >= DEFAULTS.halfOpenMaxAttempts) {
      return { allow: false, reason: "circuit-half-open-full", retryAt: now + 1_000 };
    }
    b.halfOpenInflight++;
  }
  return { allow: true };
}

export function reportSuccess(provider) {
  const b = get(provider);
  if (b.state === STATE.HALF_OPEN) {
    b.successes++;
    b.halfOpenInflight = Math.max(0, b.halfOpenInflight - 1);
    if (b.successes >= DEFAULTS.successesToClose) {
      b.state = STATE.CLOSED;
      b.failures = 0;
      b.successes = 0;
    }
  } else {
    b.failures = 0;
  }
}

export function reportFailure(provider, status) {
  const isInfra = !status || status === 408 || status === 429 || status >= 500;
  if (!isInfra) return;
  const b = get(provider);
  if (b.state === STATE.HALF_OPEN) {
    b.state = STATE.OPEN;
    b.openedAt = Date.now();
    b.halfOpenInflight = 0;
    return;
  }
  b.failures++;
  if (b.failures >= DEFAULTS.failureThreshold) {
    b.state = STATE.OPEN;
    b.openedAt = Date.now();
  }
}

export function snapshot() {
  const out = {};
  for (const [k, v] of breakers.entries()) out[k] = { ...v };
  return out;
}