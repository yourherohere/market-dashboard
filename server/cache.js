// server/cache.js — In-memory TTL cache with stats
const _store = new Map();

export const cache = {
  get(key, ttl) {
    const e = _store.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > ttl) { _store.delete(key); return null; }
    return e.data;
  },
  set(key, data) {
    _store.set(key, { data, ts: Date.now() });
    return data;
  },
  del(key)   { _store.delete(key); },
  clear(pfx) {
    if (!pfx) { _store.clear(); return; }
    for (const k of _store.keys()) if (k.startsWith(pfx)) _store.delete(k);
  },
  size()     { return _store.size; },
  keys(pfx)  {
    const all = [..._store.keys()];
    return pfx ? all.filter(k => k.startsWith(pfx)) : all;
  },
};
