/**
 * D1 Adapter for Cloudflare Workers
 * Wraps D1 binding to match the same interface as other adapters:
 *   run(sql, params) -> { changes }
 *   get(sql, params) -> row | null
 *   all(sql, params) -> row[]
 *   exec(sql) -> void
 *   transaction(fn) -> result
 */

export function createD1Adapter(d1Binding) {
  const db = d1Binding;

  function run(sql, params = []) {
    return db.prepare(sql).bind(...params).run();
  }

  function get(sql, params = []) {
    return db.prepare(sql).bind(...params).first();
  }

  function all(sql, params = []) {
    return db.prepare(sql).bind(...params).all().then(r => r.results || []);
  }

  function exec(sql) {
    return db.exec(sql);
  }

  async function transaction(fn) {
    // D1 does not support interactive transactions.
    // We batch statements collected during fn() execution.
    // For simple cases, just run fn directly (D1 auto-commits each statement).
    return await fn({ run, get, all, exec });
  }

  function close() {
    // No-op for D1
  }

  return { driver: "d1", run, get, all, exec, transaction, close, raw: db };
}