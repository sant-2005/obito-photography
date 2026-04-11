/* OBITO PHOTOGRAPHY — DATABASE MANAGER v6 (db.js)
   Cloud-first architecture:
     • READ  → Supabase first, fall back to IndexedDB if offline
     • WRITE → IndexedDB immediately + Supabase in background
     • SEED  → only if BOTH cloud and local are empty
     • SYNC  → on init, pull latest from Supabase → cache in IndexedDB
   ============================================================= */

const DB = (() => {
  const IDB_NAME    = 'ObitoPhotographyDB';
  const IDB_VERSION = 2;
  let _db = null;

  /* ── IndexedDB open ─────────────────────────────────────────── */
  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('bookings')) {
          const bs = db.createObjectStore('bookings', { keyPath: 'id' });
          bs.createIndex('customerName', 'customerName', { unique: false });
          bs.createIndex('eventDate',    'eventDate',    { unique: false });
          bs.createIndex('status',       'status',       { unique: false });
        }
        if (!db.objectStoreNames.contains('customers')) {
          const cs = db.createObjectStore('customers', { keyPath: 'id' });
          cs.createIndex('phone', 'phone', { unique: false });
          cs.createIndex('email', 'email', { unique: false });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  function idbReq(r) {
    return new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  function _genId() {
    return 'ID' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  /* ── IndexedDB store factory ────────────────────────────────── */
  function makeIDBStore(name) {
    async function tx(mode) {
      const db = await open();
      return db.transaction(name, mode).objectStore(name);
    }
    return {
      async getAll()   { return idbReq((await tx('readonly')).getAll()).then(r => r || []); },
      async get(id)    { return idbReq((await tx('readonly')).get(id)); },
      async count()    { return idbReq((await tx('readonly')).count()); },
      async clear()    { return idbReq((await tx('readwrite')).clear()); },
      async put(rec)   { return idbReq((await tx('readwrite')).put(rec)); },
      async del(id)    { return idbReq((await tx('readwrite')).delete(id)); },
      async putAll(records) {
        const store = await tx('readwrite');
        for (const r of records) await idbReq(store.put(r));
      },
    };
  }

  const _idb = {
    bookings:  makeIDBStore('bookings'),
    customers: makeIDBStore('customers'),
  };

  /* ── Public store API (cloud-first) ─────────────────────────── */
  function makeStore(name) {
    const idb = _idb[name];

    return {
      /* ── getAll: prefer Supabase, fall back to IDB ─────────── */
      async getAll() {
        if (typeof Supabase !== 'undefined' && Supabase.isAvailable()) {
          try {
            const rows = await Supabase.fetchAll(name);
            if (rows.length > 0) {
              /* Refresh local cache silently */
              await idb.putAll(rows);
              return rows;
            }
          } catch (e) { console.warn('[DB] Cloud fetch failed, using IDB:', e.message); }
        }
        return idb.getAll();
      },

      /* ── get single record ──────────────────────────────────── */
      async get(id) {
        /* IDB is fast for single lookups */
        return idb.get(id);
      },

      /* ── count (local) ──────────────────────────────────────── */
      async count() {
        return idb.count();
      },

      /* ── save: write to IDB immediately, then push to cloud ─── */
      async save(record) {
        if (!record.id) record.id = _genId();
        record.updatedAt = new Date().toISOString();
        /* 1. Write locally first (instant) */
        await idb.put(record);
        /* 2. Push to Supabase (background) */
        if (typeof Supabase !== 'undefined') {
          Supabase.saveRecord(name, record).catch(e =>
            console.warn('[DB] Cloud save failed (queued):', e.message)
          );
        }
        return record;
      },

      /* ── saveAll: batch write ───────────────────────────────── */
      async saveAll(records) {
        const stamped = records.map(r => ({
          ...r,
          id:        r.id || _genId(),
          updatedAt: r.updatedAt || new Date().toISOString(),
        }));
        await idb.putAll(stamped);
        if (typeof Supabase !== 'undefined') {
          Supabase.saveAll(name, stamped).catch(e =>
            console.warn('[DB] Cloud saveAll failed:', e.message)
          );
        }
        return stamped;
      },

      /* ── delete: remove locally + from cloud ────────────────── */
      async delete(id) {
        await idb.del(id);
        if (typeof Supabase !== 'undefined') {
          Supabase.deleteRecord(name, id).catch(e =>
            console.warn('[DB] Cloud delete failed (queued):', e.message)
          );
        }
        return true;
      },

      /* ── clear local cache ──────────────────────────────────── */
      async clear() {
        return idb.clear();
      },
    };
  }

  /* ── Migrate old localStorage data ─────────────────────────── */
  async function _migrateLS() {
    try {
      for (const [key, storeName] of [['obito_bookings', 'bookings'], ['obito_customers', 'customers']]) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr) || !arr.length) continue;
        if (await _idb[storeName].count() === 0) {
          const mapped = arr.map(r => ({
            ...r,
            id:      r.id || _genId(),
            advance: parseInt(r.advance) || parseInt(r.advanceAmount) || 0,
            budget:  parseInt(r.budget) || 0,
          }));
          await DB[storeName].saveAll(mapped);
          console.info('[DB] Migrated', mapped.length, storeName, 'from localStorage → IDB + Supabase');
        }
        localStorage.removeItem(key);
      }
    } catch (e) { console.warn('[DB] Migration error:', e); }
  }

  /* ── Pull cloud data into local IDB cache ───────────────────── */
  async function _syncFromCloud() {
    if (typeof Supabase === 'undefined' || !Supabase.isAvailable()) return;
    try {
      const [bookings, customers] = await Promise.all([
        Supabase.fetchAll('bookings'),
        Supabase.fetchAll('customers'),
      ]);
      if (bookings.length)  await _idb.bookings.putAll(bookings);
      if (customers.length) await _idb.customers.putAll(customers);
      console.info(`[DB] Synced from cloud — ${bookings.length} bookings, ${customers.length} customers ✓`);
    } catch (e) { console.warn('[DB] Cloud sync failed:', e.message); }
  }

  /* ── Seed demo data (only when truly empty everywhere) ──────── */
  async function _seed() {
    /* Check cloud first */
    if (typeof Supabase !== 'undefined' && Supabase.isAvailable()) {
      try {
        const { data } = await Supabase.getClient().from('bookings').select('id').limit(1);
        if (data && data.length > 0) {
          console.info('[DB] Cloud already has data — skipping seed.');
          return;
        }
      } catch {}
    }

    /* Check local */
    if (await _idb.bookings.count() > 0) {
      console.info('[DB] Local already has data — skipping seed.');
      return;
    }

    const seedBookings = [
      { id:'BK000001', customerName:'Rahul Sharma',  phone:'+91 98000 11111', email:'rahul@example.com',  eventType:'Wedding',     eventDate:'2026-04-15', venue:'Grand Palace',      city:'Kolkata', state:'West Bengal', service:'Photography + Videography', photographers:3, budget:250000, advance:100000, status:'Confirmed',   delivered:false, createdAt:'2026-03-01T10:00:00.000Z', createdBy:'admin' },
      { id:'BK000002', customerName:'Priya Mehta',   phone:'+91 98000 22222', email:'priya@example.com',  eventType:'Pre-Wedding',  eventDate:'2026-04-22', venue:'Victoria Memorial', city:'Kolkata', state:'West Bengal', service:'Photography Only',          photographers:2, budget:80000,  advance:30000,  status:'Pending',     delivered:false, createdAt:'2026-03-05T11:00:00.000Z', createdBy:'admin' },
      { id:'BK000003', customerName:'Amit Das',      phone:'+91 98000 33333', email:'amit@example.com',   eventType:'Birthday',    eventDate:'2026-05-10', venue:'Home',              city:'Howrah',  state:'West Bengal', service:'Photography Only',          photographers:1, budget:40000,  advance:20000,  status:'Confirmed',   delivered:false, createdAt:'2026-03-10T09:00:00.000Z', createdBy:'admin' },
      { id:'BK000004', customerName:'Sneha Roy',     phone:'+91 98000 44444', email:'sneha@example.com',  eventType:'Corporate',   eventDate:'2026-03-20', venue:'ITC Sonar',         city:'Kolkata', state:'West Bengal', service:'Photography + Videography', photographers:2, budget:150000, advance:75000,  status:'In Progress', delivered:false, createdAt:'2026-02-15T08:00:00.000Z', createdBy:'admin' },
      { id:'BK000005', customerName:'Rahul Sharma',  phone:'+91 98000 11111', email:'rahul@example.com',  eventType:'Anniversary', eventDate:'2026-06-01', venue:'Taj Bengal',        city:'Kolkata', state:'West Bengal', service:'Premium Package',           photographers:3, budget:300000, advance:150000, status:'Confirmed',   delivered:false, createdAt:'2026-03-12T10:00:00.000Z', createdBy:'admin' },
      { id:'BK000006', customerName:'Kavya Nair',    phone:'+91 98000 55555', email:'kavya@example.com',  eventType:'Portrait',    eventDate:'2026-03-28', venue:'Studio',            city:'Kolkata', state:'West Bengal', service:'Photography Only',          photographers:1, budget:25000,  advance:12500,  status:'In Progress', delivered:false, createdAt:'2026-03-20T14:00:00.000Z', createdBy:'admin' },
      { id:'BK000007', customerName:'Deepak Singh',  phone:'+91 98000 66666', email:'deepak@example.com', eventType:'Wedding',     eventDate:'2026-07-14', venue:'Swissotel',         city:'Kolkata', state:'West Bengal', service:'Album & Photography',       photographers:2, budget:200000, advance:80000,  status:'Pending',     delivered:false, createdAt:'2026-03-25T13:00:00.000Z', createdBy:'admin' },
    ];
    const seedCustomers = [
      { id:'CU000001', firstName:'Rahul',  lastName:'Sharma', phone:'+91 98000 11111', email:'rahul@example.com',  city:'Kolkata', category:'VIP',     createdAt:'2026-03-01T10:00:00.000Z', totalBookings:2, totalRevenue:550000, notes:'Repeat client' },
      { id:'CU000002', firstName:'Priya',  lastName:'Mehta',  phone:'+91 98000 22222', email:'priya@example.com',  city:'Kolkata', category:'Regular', createdAt:'2026-03-05T11:00:00.000Z', totalBookings:1, totalRevenue:80000,  notes:'' },
      { id:'CU000003', firstName:'Amit',   lastName:'Das',    phone:'+91 98000 33333', email:'amit@example.com',   city:'Howrah',  category:'New',     createdAt:'2026-03-10T09:00:00.000Z', totalBookings:1, totalRevenue:40000,  notes:'' },
      { id:'CU000004', firstName:'Sneha',  lastName:'Roy',    phone:'+91 98000 44444', email:'sneha@example.com',  city:'Kolkata', category:'Regular', createdAt:'2026-02-15T08:00:00.000Z', totalBookings:1, totalRevenue:150000, notes:'Corporate account' },
      { id:'CU000005', firstName:'Kavya',  lastName:'Nair',   phone:'+91 98000 55555', email:'kavya@example.com',  city:'Kolkata', category:'New',     createdAt:'2026-03-20T14:00:00.000Z', totalBookings:1, totalRevenue:25000,  notes:'' },
      { id:'CU000006', firstName:'Deepak', lastName:'Singh',  phone:'+91 98000 66666', email:'deepak@example.com', city:'Kolkata', category:'Regular', createdAt:'2026-03-25T13:00:00.000Z', totalBookings:1, totalRevenue:200000, notes:'' },
    ];

    await DB.bookings.saveAll(seedBookings);
    await DB.customers.saveAll(seedCustomers);
    console.info('[DB] Demo data seeded to IDB + Supabase ✓');
  }

  /* ── Main DB object ─────────────────────────────────────────── */
  const DB = {
    bookings:  makeStore('bookings'),
    customers: makeStore('customers'),

    async init() {
      await open();
      await _migrateLS();

      /* 1. Connect Supabase */
      if (typeof Supabase !== 'undefined') {
        await Supabase.init();
      }

      /* 2. Pull latest cloud data into local cache */
      await _syncFromCloud();

      /* 3. Seed only if nothing exists anywhere */
      await _seed();

      /* 4. Re-sync cache on cloud changes (real-time) */
      window.addEventListener('supabase:change', () => _syncFromCloud());

      console.info('[DB] Ready ✓ (cloud-first mode)');
    },

    /** Force a full re-sync from Supabase */
    async forceSync() {
      await _syncFromCloud();
      console.info('[DB] Force sync complete ✓');
    },

    /** Export all data as JSON download */
    async exportJSON() {
      const b = await DB.bookings.getAll();
      const c = await DB.customers.getAll();
      const blob = new Blob(
        [JSON.stringify({ bookings: b, customers: c, exportedAt: new Date().toISOString() }, null, 2)],
        { type: 'application/json' }
      );
      const a = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = 'obito-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    },

    /** Import JSON backup — writes to both IDB and Supabase */
    async importJSON(file) {
      const data = JSON.parse(await file.text());
      if (data.bookings)  await DB.bookings.saveAll(data.bookings);
      if (data.customers) await DB.customers.saveAll(data.customers);
      return {
        bookings:  (data.bookings  || []).length,
        customers: (data.customers || []).length,
      };
    },

    generateId: _genId,
  };

  return DB;
})();

window.DB = DB;