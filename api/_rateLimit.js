/**
 * In-memory rate limiter pro Vercel serverless funkce.
 * Pozor: každá instance funkce má vlastní paměť — při vysokém provozu
 * použij Upstash Redis nebo Vercel KV pro sdílený stav napříč instancemi.
 * Pro malý provoz (desítky uživatelů) je in-memory řešení dostačující.
 */

const store = new Map();

function cleanExpired() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}

/**
 * @param {string} key        - Identifikátor (IP, klic, ...)
 * @param {number} limit      - Max počet pokusů
 * @param {number} windowMs   - Časové okno v ms
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
function checkRateLimit(key, limit, windowMs) {
  cleanExpired();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Vrátí IP adresu z requestu (Vercel přidává x-forwarded-for).
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = { checkRateLimit, getClientIp };
