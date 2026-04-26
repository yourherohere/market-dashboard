// server/cache.js — TTL cache with LRU eviction + size cap
const _store  = new Map();
const MAX_SZ  = 500;   // max cached entries; oldest evicted first

export const cache = {
  get(key, ttl = 60_000) {
    const e = _store.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > ttl) { _store.delete(key); return null; }
    // LRU: re-insert to mark as recently used
    _store.delete(key);
    _store.set(key, e);
    return e.val;
  },
  set(key, val) {
    if (_store.size >= MAX_SZ) {
      // Evict oldest entry (first key in insertion order)
      _store.delete(_store.keys().next().value);
    }
    _store.set(key, { val, ts: Date.now() });
  },
  del(key)   { _store.delete(key); },
  clear(pfx) {
    if (!pfx) { _store.clear(); return; }
    for (const k of _store.keys()) if (k.startsWith(pfx)) _store.delete(k);
  },
  keys(pfx)  {
    const all = [..._store.keys()];
    return pfx ? all.filter(k => k.startsWith(pfx)) : all;
  },
  size()     { return _store.size; },
};
