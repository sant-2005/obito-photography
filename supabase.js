/* OBITO PHOTOGRAPHY — SUPABASE CONFIG v6 (supabase.js)
   Cloud-first: Supabase is the primary database.
   IndexedDB acts as offline cache only.
   Real-time subscriptions push changes to all open tabs/devices.
   ============================================================= */

'use strict';

const SUPABASE_CONFIG = {
  url:     'https://metqwrjyhywsiherxctv.supabase.co',
  anonKey: 'sb_publishable_5QKlwKAvyPLs_KvzLA41DA_iNZAt_yL',
};

/* ── Validate config is real (not placeholder) ─────────────────── */
const _CONFIGURED =
  SUPABASE_CONFIG.url.includes('supabase.co') &&
  SUPABASE_CONFIG.anonKey.length > 20 &&
  !SUPABASE_CONFIG.url.includes('your-project');

const Supabase = (() => {
  let _client   = null;
  let _isOnline = navigator.onLine;
  let _queue    = [];   // offline write queue
  let _subs     = [];   // realtime subscriptions
  let _ready    = false;

  /* ── Init: load SDK then connect ──────────────────────────────── */
  async function init() {
    if (!_CONFIGURED) {
      console.warn('[Supabase] Credentials not configured — running offline (IndexedDB only).');
      return null;
    }

    /* Load the Supabase JS v2 SDK from CDN if not already present */
    if (!window.supabase?.createClient) {
      await _loadSDK('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
    }

    if (!window.supabase?.createClient) {
      console.error('[Supabase] SDK failed to load — falling back to offline mode.');
      return null;
    }

    try {
      _client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
        auth:     { persistSession: false },
        realtime: { params: { eventsPerSecond: 10 } },
      });

      /* Test connection */
      const { error } = await _client.from('bookings').select('id').limit(1);
      if (error) throw error;

      _ready = true;
      console.info('[Supabase] ✅ Connected to', SUPABASE_CONFIG.url);

      /* Online/offline listeners */
      window.addEventListener('online',  () => { _isOnline = true;  _processQueue(); console.info('[Supabase] Back online — flushing queue…'); });
      window.addEventListener('offline', () => { _isOnline = false; console.warn('[Supabase] Offline — writes will be queued.'); });

      /* Real-time subscriptions */
      _subscribe();

      /* Flush any queued operations */
      await _processQueue();

      return _client;
    } catch (err) {
      console.error('[Supabase] Connection failed:', err.message);
      _client = null;
      _ready  = false;
      return null;
    }
  }

  /* ── Load SDK via script tag ───────────────────────────────────── */
  function _loadSDK(src) {
    return new Promise((resolve) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload  = resolve;
      s.onerror = () => { console.error('[Supabase] Failed to load SDK from', src); resolve(); };
      document.head.appendChild(s);
    });
  }

  /* ── Real-time subscriptions (push cloud changes → IndexedDB) ─── */
  function _subscribe() {
    if (!_client) return;
    try {
      const bookingSub = _client
        .channel('realtime:bookings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, async payload => {
          console.info('[Supabase RT] bookings', payload.eventType);
          try {
            if (payload.eventType === 'DELETE') {
              await _idbDelete('bookings', payload.old.id);
            } else {
              await _idbPut('bookings', payload.new);
            }
            /* Notify the page a cloud change arrived */
            window.dispatchEvent(new CustomEvent('supabase:change', { detail: { table: 'bookings', payload } }));
          } catch (e) { console.warn('[Supabase RT] IDB sync error:', e); }
        })
        .subscribe();

      const customerSub = _client
        .channel('realtime:customers')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, async payload => {
          console.info('[Supabase RT] customers', payload.eventType);
          try {
            if (payload.eventType === 'DELETE') {
              await _idbDelete('customers', payload.old.id);
            } else {
              await _idbPut('customers', payload.new);
            }
            window.dispatchEvent(new CustomEvent('supabase:change', { detail: { table: 'customers', payload } }));
          } catch (e) { console.warn('[Supabase RT] IDB sync error:', e); }
        })
        .subscribe();

      _subs.push(bookingSub, customerSub);
    } catch (err) { console.warn('[Supabase] Subscribe error:', err.message); }
  }

  /* ── Lightweight direct IndexedDB helpers (no DB dependency) ──── */
  function _idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ObitoPhotographyDB', 2);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }
  async function _idbPut(store, record) {
    const db  = await _idbOpen();
    const tx  = db.transaction(store, 'readwrite');
    return new Promise((res, rej) => {
      const req = tx.objectStore(store).put(record);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  }
  async function _idbDelete(store, id) {
    const db  = await _idbOpen();
    const tx  = db.transaction(store, 'readwrite');
    return new Promise((res, rej) => {
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  }

  /* ── Public API ────────────────────────────────────────────────── */

  /** Fetch ALL rows from a table (cloud) */
  async function fetchAll(table) {
    if (!_client || !_isOnline) return [];
    try {
      const { data, error } = await _client.from(table).select('*').order('createdAt', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.warn('[Supabase] fetchAll failed:', err.message);
      return [];
    }
  }

  /** Upsert a single record to Supabase */
  async function saveRecord(table, record) {
    if (!_client || !_isOnline) {
      _queue.push({ op: 'save', table, data: record });
      console.info('[Supabase] Queued save for', table, record.id);
      return false;
    }
    try {
      const { error } = await _client.from(table).upsert(record, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[Supabase] saveRecord failed — queued:', err.message);
      _queue.push({ op: 'save', table, data: record });
      return false;
    }
  }

  /** Delete a record from Supabase by id */
  async function deleteRecord(table, id) {
    if (!_client || !_isOnline) {
      _queue.push({ op: 'delete', table, id });
      console.info('[Supabase] Queued delete for', table, id);
      return false;
    }
    try {
      const { error } = await _client.from(table).delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[Supabase] deleteRecord failed — queued:', err.message);
      _queue.push({ op: 'delete', table, id });
      return false;
    }
  }

  /** Bulk upsert many records (used for seeding / import) */
  async function saveAll(table, records) {
    if (!_client || !_isOnline || !records.length) return false;
    try {
      const { error } = await _client.from(table).upsert(records, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[Supabase] saveAll failed:', err.message);
      return false;
    }
  }

  /** Flush offline write queue */
  async function _processQueue() {
    if (!_client || !_isOnline || !_queue.length) return;
    const todo = [..._queue];
    _queue = [];
    for (const op of todo) {
      try {
        if (op.op === 'save')   await saveRecord(op.table, op.data);
        if (op.op === 'delete') await deleteRecord(op.table, op.id);
      } catch {
        _queue.push(op); /* re-queue on failure */
      }
    }
    if (_queue.length) console.warn('[Supabase] Queue still has', _queue.length, 'pending ops');
    else console.info('[Supabase] Queue flushed ✓');
  }

  /** Sync all local IDB data up to Supabase (call after coming online) */
  async function syncLocalData(bookings, customers) {
    if (!isAvailable()) return 0;
    let n = 0;
    if (bookings.length)  { await saveAll('bookings',  bookings);  n += bookings.length; }
    if (customers.length) { await saveAll('customers', customers); n += customers.length; }
    return n;
  }

  function isAvailable() { return !!_client && _isOnline && _ready; }

  function cleanup() {
    _subs.forEach(s => { try { s?.unsubscribe?.(); } catch {} });
    _subs = [];
  }

  /* Expose client for advanced use */
  function getClient() { return _client; }

  return {
    init,
    fetchAll,
    saveRecord,
    deleteRecord,
    saveAll,
    syncLocalData,
    isAvailable,
    cleanup,
    getClient,
  };
})();

window.Supabase = Supabase;