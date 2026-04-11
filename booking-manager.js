/* =============================================================
   OBITO PHOTOGRAPHY — BOOKING MANAGER  (booking-manager.js)
   Drop this file into your project root.

   Handles TWO pages — include only what each page needs:

   add-booking.html  →  <script src="booking-manager.js"></script>
   bookings-list.html →  <script src="booking-manager.js"></script>

   The module auto-detects which page it is running on and
   initialises only the relevant functionality.

   Load order for BOTH pages:
     <script src="shared.js"></script>
     <script src="db.js"></script>
     <script src="booking-manager.js"></script>
   ============================================================= */

'use strict';

/* ─────────────────────────────────────────────────────────────
   §1  SHARED UTILITIES
   ─────────────────────────────────────────────────────────── */

/**
 * Escape a value for safe insertion into innerHTML.
 * Prevents XSS from stored booking data.
 */
function _esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely set a form-element value, resolving <select> by value
 * or by visible text so partial matches still work.
 */
function _setField(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tagName === 'SELECT') {
    const match = Array.from(el.options).find(
      o => o.value === String(val) || o.text === String(val)
    );
    el.value = match ? match.value : (el.options[0]?.value ?? '');
  } else {
    el.value = val ?? '';
  }
}

/** Read text value from an element, trimmed. */
function _val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

/** Set textContent of an element safely. */
function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Format rupee amounts compactly. */
function _fmt(n) {
  n = parseInt(n) || 0;
  if (n >= 10_000_000) return '₹' + (n / 10_000_000).toFixed(2) + ' Cr';
  if (n >= 100_000)    return '₹' + (n / 100_000).toFixed(2) + ' L';
  if (n >= 1_000)      return '₹' + (n / 1_000).toFixed(1) + 'K';
  return '₹' + n.toLocaleString('en-IN');
}

/** Animated counter — counts from 0 to `end` over ~900 ms. */
function _animateCount(id, end, format = String) {
  const el = document.getElementById(id);
  if (!el) return;
  const DURATION = 900;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / DURATION, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);   // ease-out-cubic
    el.textContent = format(Math.round(end * eased));
    if (progress < 1) requestAnimationFrame(tick);
    else              el.textContent = format(end);
  }
  requestAnimationFrame(tick);
}

/** Show or hide an element by toggling a class or display. */
function _show(id)   { const el = document.getElementById(id); if (el) el.style.display = ''; }
function _hide(id)   { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function _addClass(id, cls)    { document.getElementById(id)?.classList.add(cls); }
function _removeClass(id, cls) { document.getElementById(id)?.classList.remove(cls); }

/** Mark a form field as invalid with a visual cue. */
function _markInvalid(el, msg) {
  el.style.borderColor = 'var(--danger, #ef4444)';
  el.style.boxShadow   = '0 0 0 3px rgba(239,68,68,.15)';
  el.setAttribute('aria-invalid', 'true');
  el.focus();
  if (typeof showToast === 'function') showToast('⚠️ ' + msg, 'error');
}

/** Clear all validation states on a form. */
function _clearValidation(form) {
  form.querySelectorAll('input, select, textarea').forEach(el => {
    el.style.borderColor = '';
    el.style.boxShadow   = '';
    el.removeAttribute('aria-invalid');
  });
}

/** Disable / re-enable a submit button with a loading label. */
function _setBusy(btnId, busy, labelIdle = '✅ Create Booking') {
  const btn = document.getElementById(btnId) || document.querySelector('[type="submit"]');
  if (!btn) return;
  btn.disabled    = busy;
  btn.textContent = busy ? 'Saving…' : labelIdle;
  btn.style.opacity = busy ? '0.7' : '';
}

/* ─────────────────────────────────────────────────────────────
   §2  CUSTOMER SYNC
   ─────────────────────────────────────────────────────────── */

/**
 * Upsert a customer record based on phone number (primary key).
 * If a matching customer is found:
 *   – Update totalBookings and totalRevenue.
 *   – Refresh name / email / city if they changed.
 * If not found:
 *   – Create a fresh customer record.
 *
 * @param {Object} booking  A fully-formed booking record.
 * @returns {Promise<Object>}  The saved customer record.
 */
async function syncCustomer(booking) {
  // ── 1. Load all customers and find by phone (most reliable match) ──
  const all = await DB.customers.getAll();

  const phone = (booking.phone || '').replace(/\s+/g, '').toLowerCase();
  let existing = phone
    ? all.find(c => (c.phone || '').replace(/\s+/g, '').toLowerCase() === phone)
    : null;

  // Fallback: match by email if phone lookup failed
  if (!existing && booking.email) {
    const email = booking.email.toLowerCase();
    existing = all.find(c => (c.email || '').toLowerCase() === email);
  }

  if (existing) {
    // ── 2a. Update existing customer ──
    const allBookings = await DB.bookings.getAll();

    // Count bookings belonging to this customer by phone
    const customerBookings = allBookings.filter(b =>
      (b.phone || '').replace(/\s+/g, '') ===
      (existing.phone || '').replace(/\s+/g, '')
    );

    const totalRevenue   = customerBookings.reduce((s, b) => s + (parseInt(b.budget) || 0), 0);
    const totalBookings  = customerBookings.length;

    // Promote to VIP if they have ≥3 bookings
    let category = existing.category || 'Regular';
    if (totalBookings >= 3) category = 'VIP';

    const updated = {
      ...existing,
      // Refresh contact fields in case they changed
      firstName:     booking.customerName.split(' ')[0] || existing.firstName,
      lastName:      booking.customerName.split(' ').slice(1).join(' ') || existing.lastName,
      phone:         booking.phone  || existing.phone,
      email:         booking.email  || existing.email,
      city:          booking.city   || existing.city,
      category,
      totalBookings,
      totalRevenue,
      lastBookingId:   booking.id,
      lastBookingDate: booking.eventDate,
    };

    return DB.customers.save(updated);

  } else {
    // ── 2b. Create new customer ──
    const nameParts = (booking.customerName || '').trim().split(/\s+/);
    const firstName = nameParts[0]  || '';
    const lastName  = nameParts.slice(1).join(' ') || '';

    const fresh = {
      // id auto-generated by DB.customers.save()
      firstName,
      lastName,
      phone:           booking.phone  || '',
      email:           booking.email  || '',
      city:            booking.city   || '',
      address:         booking.address || '',
      category:        'New',
      totalBookings:   1,
      totalRevenue:    parseInt(booking.budget) || 0,
      lastBookingId:   booking.id,
      lastBookingDate: booking.eventDate,
      createdAt:       new Date().toISOString().split('T')[0],
      notes:           '',
    };

    return DB.customers.save(fresh);
  }
}

/* ─────────────────────────────────────────────────────────────
   §3  ADD-BOOKING PAGE
   ─────────────────────────────────────────────────────────── */

const AddBooking = (() => {

  /* ── §3.1  Validation rules ── */
  const REQUIRED_FIELDS = [
    { id: 'input[name="customerName"]', label: 'Customer Name'  },
    { id: 'input[name="phone"]',        label: 'Phone Number'   },
    { id: 'input[name="eventDate"]',    label: 'Event Date'     },
    { id: 'select[name="eventType"]',   label: 'Event Type'     },
    { id: 'input[name="venue"]',        label: 'Venue Name'     },
    { id: 'input[name="city"]',         label: 'City'           },
    { id: 'select[name="service"]',     label: 'Service Type'   },
    { id: 'input[name="budget"]',       label: 'Total Budget'   },
    { id: 'select[name="status"]',      label: 'Booking Status' },
  ];

  /**
   * Validate the booking form.
   * Returns { valid: true } or { valid: false, el, message }.
   */
  function _validate(form) {
    _clearValidation(form);

    for (const rule of REQUIRED_FIELDS) {
      const el = form.querySelector(rule.id);
      if (!el) continue;
      const val = el.value.trim();
      if (!val || val === '') {
        return { valid: false, el, message: rule.label + ' is required.' };
      }
    }

    // Budget must be a positive number
    const budgetEl  = form.querySelector('[name="budget"]');
    const budget    = parseInt(budgetEl?.value || 0);
    if (budget <= 0) {
      return { valid: false, el: budgetEl, message: 'Budget must be greater than ₹0.' };
    }

    // Advance must not exceed budget
    const advanceEl = form.querySelector('[name="advanceAmount"]');
    const advance   = parseInt(advanceEl?.value || 0);
    if (advance > budget) {
      return { valid: false, el: advanceEl, message: 'Advance payment cannot exceed total budget.' };
    }

    // Event date must not be in the past (soft warning only — don't block)
    const dateEl  = form.querySelector('[name="eventDate"]');
    const dateVal = dateEl?.value;
    if (dateVal) {
      const chosen  = new Date(dateVal);
      const today   = new Date();
      today.setHours(0, 0, 0, 0);
      if (chosen < today && typeof showToast === 'function') {
        showToast('⚠️ Event date is in the past. Continue?', 'info', 4000);
      }
    }

    return { valid: true };
  }

  /* ── §3.2  Build the booking record ── */
  function _buildRecord(form) {
    const fd   = new FormData(form);
    const data = Object.fromEntries(fd.entries());

    return {
      // Stable ID — prefix BK + compact timestamp
      id:            'BK' + Date.now().toString(36).toUpperCase(),

      // Customer
      customerName:  (data.customerName  || '').trim(),
      phone:         (data.phone         || '').trim(),
      email:         (data.email         || '').trim(),
      address:       (data.address       || '').trim(),

      // Event
      eventType:     data.eventType      || '',
      eventDate:     data.eventDate      || '',
      eventTime:     data.eventTime      || '',
      eventDuration: data.eventDuration  || '',

      // Location
      venue:         (data.venue         || '').trim(),
      city:          (data.city          || '').trim(),
      state:         (data.state         || '').trim(),
      zipCode:       (data.zipCode       || '').trim(),

      // Service
      service:       data.service        || '',
      photographers: parseInt(data.photographers) || 1,

      // Financials — always coerce to integers
      budget:        parseInt(data.budget)        || 0,
      advance:       parseInt(data.advanceAmount)  || 0,

      // Status & delivery
      status:        data.status         || 'Pending',
      delivered:     false,

      // Description / notes
      description:   (data.description   || '').trim(),

      // Metadata
      createdAt:     new Date().toISOString().split('T')[0],
      createdBy:     sessionStorage.getItem('username') || 'admin',
    };
  }

  /* ── §3.3  Show success state ── */
  function _showSuccess(bookingId) {
    const bar = document.getElementById('successBar');
    if (bar) {
      bar.textContent = '✅ Booking ' + bookingId + ' saved! Redirecting…';
      bar.classList.add('show');
    }
    if (typeof showToast === 'function') {
      showToast('✅ Booking ' + bookingId + ' created!', 'success', 3000);
    }
  }

  /* ── §3.4  Submit handler ── */
  async function _onSubmit(e) {
    e.preventDefault();
    const form  = e.currentTarget;
    const btn   = form.querySelector('[type="submit"]');
    const label = btn?.textContent || '✅ Create Booking';

    // ── Validate ──
    const check = _validate(form);
    if (!check.valid) {
      _markInvalid(check.el, check.message);
      return;
    }

    // ── Lock UI ──
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; btn.style.opacity = '0.7'; }

    try {
      // ── Build record ──
      const booking = _buildRecord(form);

      // ── Persist booking ──
      await DB.bookings.save(booking);

      // ── Upsert customer ──
      await syncCustomer(booking);

      // ── Feedback ──
      _showSuccess(booking.id);

      // ── Redirect after a short pause so user sees the toast ──
      setTimeout(() => {
        if (typeof navigateTo === 'function') {
          navigateTo('bookings-list.html');
        } else {
          window.location.href = 'bookings-list.html';
        }
      }, 1600);

    } catch (err) {
      console.error('[AddBooking] Save failed:', err);
      if (typeof showToast === 'function') {
        showToast('❌ Could not save booking. Please try again.', 'error', 5000);
      }
      // Re-enable form
      if (btn) { btn.disabled = false; btn.textContent = label; btn.style.opacity = ''; }
    }
  }

  /* ── §3.5  Bootstrap ── */
  function init() {
    const form = document.getElementById('bookingForm');
    if (!form) return;   // Not on the add-booking page

    // Replace any existing inline submit handler with this one
    form.removeEventListener('submit', form._bmHandler);
    form._bmHandler = _onSubmit;
    form.addEventListener('submit', _onSubmit);

    // Pre-fill today's date as a convenience default
    const dateInput = form.querySelector('[name="eventDate"]');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }

    // Live advance ≤ budget check — warn inline, don't block
    const budgetInput  = form.querySelector('[name="budget"]');
    const advanceInput = form.querySelector('[name="advanceAmount"]');

    function _checkAdvance() {
      if (!budgetInput || !advanceInput) return;
      const b = parseInt(budgetInput.value)  || 0;
      const a = parseInt(advanceInput.value) || 0;
      if (a > b && b > 0) {
        advanceInput.style.borderColor = 'var(--warning, #f59e0b)';
        advanceInput.title = 'Advance exceeds budget';
      } else {
        advanceInput.style.borderColor = '';
        advanceInput.title = '';
      }
    }

    budgetInput?.addEventListener('input',  _checkAdvance);
    advanceInput?.addEventListener('input', _checkAdvance);

    console.info('[BookingManager] AddBooking ready ✓');
  }

  return { init };
})();

/* ─────────────────────────────────────────────────────────────
   §4  BOOKINGS-LIST PAGE
   ─────────────────────────────────────────────────────────── */

const BookingsList = (() => {

  /* ─── State ─── */
  let _all       = [];   // master list — never mutate directly
  let _editingId = null; // id of the record open in the edit modal

  /* ─────────────────────────────────────────────────────────
     §4.1  Load & Stats
     ───────────────────────────────────────────────────────── */

  /** Fetch all bookings from DB, sort newest first, refresh UI. */
  async function _loadAll() {
    try {
      _all = await DB.bookings.getAll();
      _all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } catch (err) {
      console.error('[BookingsList] getAll failed:', err);
      _all = [];
      if (typeof showToast === 'function') {
        showToast('⚠️ Could not load bookings from database.', 'error');
      }
    }
    _updateStats(_all);
    applyFilters();
  }

  /** Compute and animate the four summary stat cards. */
  function _updateStats(bookings) {
    const total   = bookings.length;
    const revenue = bookings.reduce((s, b) => s + (parseInt(b.budget)  || 0), 0);
    const advance = bookings.reduce((s, b) => s + (parseInt(b.advance) || 0), 0);
    const pending = Math.max(0, revenue - advance);

    // Stat cards — only update if the elements exist on this page
    _animateCount('stat-total',   total,   String);
    _animateCount('stat-revenue', revenue, _fmt);
    _animateCount('stat-advance', advance, _fmt);
    _animateCount('stat-pending', pending, _fmt);

    // Also update the record-count badge in the table header
    _setText('recordCount', total + ' booking' + (total !== 1 ? 's' : ''));
  }

  /* ─────────────────────────────────────────────────────────
     §4.2  Filtering
     ───────────────────────────────────────────────────────── */

  /** Read filters and render the filtered slice. Exposed globally. */
  function applyFilters() {
    const q        = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const status   = document.getElementById('statusFilter')?.value  || 'all';
    const delivery = document.getElementById('deliveryFilter')?.value || 'all';

    const filtered = _all.filter(b => {
      const matchText = !q
        || (b.customerName || '').toLowerCase().includes(q)
        || (b.eventType    || '').toLowerCase().includes(q)
        || (b.id           || '').toLowerCase().includes(q)
        || (b.city         || '').toLowerCase().includes(q)
        || (b.venue        || '').toLowerCase().includes(q);

      const matchStatus   = status   === 'all' || b.status === status;
      const matchDelivery = delivery === 'all'
        || (delivery === 'delivered' && b.delivered)
        || (delivery === 'pending'   && !b.delivered);

      return matchText && matchStatus && matchDelivery;
    });

    _renderTable(filtered);
    _refreshFilterBadges(filtered.length, q, status, delivery);
  }

  /** Update the "3 results" / Clear-filters badges. */
  function _refreshFilterBadges(count, q, status, delivery) {
    const hasFilter = q || status !== 'all' || delivery !== 'all';
    const badgeEl   = document.getElementById('activeFilterBadge');
    const clearEl   = document.getElementById('clearFilterBtn');

    if (badgeEl) {
      badgeEl.style.display = hasFilter ? 'inline-flex' : 'none';
      badgeEl.textContent   = count + ' result' + (count !== 1 ? 's' : '');
    }
    if (clearEl) {
      clearEl.style.display = hasFilter ? 'inline-flex' : 'none';
    }
  }

  function clearFilters() {
    const si = document.getElementById('searchInput');
    const sf = document.getElementById('statusFilter');
    const df = document.getElementById('deliveryFilter');
    if (si) si.value = '';
    if (sf) sf.value = 'all';
    if (df) df.value = 'all';
    applyFilters();
  }

  /* ─────────────────────────────────────────────────────────
     §4.3  Table Rendering
     ───────────────────────────────────────────────────────── */

  /** Map status string → badge CSS class. */
  function _statusBadge(s) {
    const map = {
      'pending':     'badge-warning',
      'confirmed':   'badge-success',
      'in progress': 'badge-primary',
      'completed':   'badge-muted',
      'cancelled':   'badge-danger',
    };
    const cls = map[(s || '').toLowerCase()] || 'badge-warning';
    return `<span class="badge ${cls}">${_esc(s) || 'Pending'}</span>`;
  }

  /** Format a date string for display. */
  function _fmtDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return _esc(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /**
   * Build one <tr> for a booking.
   * All data is escaped.  Action buttons use data-id so there is
   * no inline JS and no injection surface.
   */
  function _buildRow(b) {
    const budget  = parseInt(b.budget)  || 0;
    const advance = parseInt(b.advance) || 0;
    const pending = budget - advance;

    const deliveryBadge = b.delivered
      ? '<span class="badge badge-success">✅ Delivered</span>'
      : '<span class="badge badge-warning">⏳ Pending</span>';

    return `
      <tr>
        <td class="tbl-id">${_esc(b.id) || '—'}</td>
        <td class="tbl-name">${_esc(b.customerName) || '—'}</td>
        <td class="tbl-muted">${_esc(b.eventType) || '—'}</td>
        <td>${_fmtDate(b.eventDate)}</td>
        <td>₹${budget.toLocaleString('en-IN')}</td>
        <td class="amount-paid">₹${advance.toLocaleString('en-IN')}</td>
        <td class="amount-pending">₹${pending.toLocaleString('en-IN')}</td>
        <td>${_statusBadge(b.status)}</td>
        <td>${deliveryBadge}</td>
        <td>
          <div style="display:flex;gap:5px;">
            <button class="action-btn action-view"
                    data-id="${_esc(b.id)}"
                    data-action="view"
                    title="View details"
                    aria-label="View booking ${_esc(b.id)}">👁️</button>
            <button class="action-btn action-edit"
                    data-id="${_esc(b.id)}"
                    data-action="edit"
                    title="Edit booking"
                    aria-label="Edit booking ${_esc(b.id)}">✏️</button>
            <button class="action-btn action-delete"
                    data-id="${_esc(b.id)}"
                    data-action="delete"
                    title="Delete booking"
                    aria-label="Delete booking ${_esc(b.id)}">🗑️</button>
          </div>
        </td>
      </tr>`;
  }

  /** Render all rows or the empty-state. */
  function _renderTable(data) {
    const tbody = document.getElementById('bookingsTableBody');
    if (!tbody) return;

    _setText('recordCount', data.length + ' booking' + (data.length !== 1 ? 's' : ''));

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10">
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <p class="empty-text">No bookings match your filters.</p>
              <button class="btn btn-primary"
                      onclick="typeof navigateTo==='function'?navigateTo('add-booking.html'):(window.location.href='add-booking.html')">
                ➕ Create Booking
              </button>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = data.map(_buildRow).join('');
  }

  /* ─────────────────────────────────────────────────────────
     §4.4  Event delegation for table action buttons
     ───────────────────────────────────────────────────────── */

  function _onTableClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id     = btn.dataset.id;
    const action = btn.dataset.action;
    if (!id) return;

    switch (action) {
      case 'view':   viewBooking(id);   break;
      case 'edit':   editBooking(id);   break;
      case 'delete': deleteBooking(id); break;
    }
  }

  /* ─────────────────────────────────────────────────────────
     §4.5  View Modal
     ───────────────────────────────────────────────────────── */

  function _detailRow(label, value) {
    return `
      <div class="detail-row">
        <span class="detail-label">${_esc(label)}</span>
        <span class="detail-val">${_esc(String(value ?? '—'))}</span>
      </div>`;
  }

  function viewBooking(id) {
    const b = _all.find(x => x.id === id);
    if (!b) { console.warn('[BookingsList] viewBooking: id not found:', id); return; }

    _editingId = id;   // remember in case user clicks "Edit" from the view modal

    const budget  = parseInt(b.budget)  || 0;
    const advance = parseInt(b.advance) || 0;

    _setText('viewModalTitle', 'Booking ' + b.id);

    document.getElementById('viewModalBody').innerHTML = [
      ['Customer',    b.customerName],
      ['Phone',       b.phone  || '—'],
      ['Email',       b.email  || '—'],
      ['Event Type',  b.eventType],
      ['Event Date',  _fmtDate(b.eventDate)],
      ['Venue',       [b.venue, b.city].filter(Boolean).join(', ')],
      ['Service',     b.service],
      ['Photographers', b.photographers || '—'],
      ['Budget',      '₹' + budget.toLocaleString('en-IN')],
      ['Advance',     '₹' + advance.toLocaleString('en-IN')],
      ['Balance Due', '₹' + (budget - advance).toLocaleString('en-IN')],
      ['Status',      b.status],
      ['Delivery',    b.delivered ? '✅ Delivered' : '⏳ Pending'],
      ...(b.description ? [['Notes', b.description]] : []),
      ['Created',     _fmtDate(b.createdAt)],
      ...(b.updatedAt ? [['Last Updated', _fmtDate(b.updatedAt)]] : []),
    ].map(([label, val]) => _detailRow(label, val)).join('');

    _openModal('viewModal');
  }

  function switchToEdit() {
    _closeModal('viewModal');
    if (_editingId) editBooking(_editingId);
  }

  /* ─────────────────────────────────────────────────────────
     §4.6  Edit Modal
     ───────────────────────────────────────────────────────── */

  function editBooking(id) {
    const b = _all.find(x => x.id === id);
    if (!b) { console.warn('[BookingsList] editBooking: id not found:', id); return; }

    _editingId = id;
    _setText('editModalTitle', 'Edit Booking — ' + b.id);

    // Populate every edit field
    const fields = {
      e_customerName:  b.customerName,
      e_phone:         b.phone,
      e_email:         b.email,
      e_address:       b.address,
      e_eventType:     b.eventType,
      e_eventDate:     b.eventDate,
      e_eventTime:     b.eventTime,
      e_eventDuration: b.eventDuration,
      e_venue:         b.venue,
      e_city:          b.city,
      e_state:         b.state,
      e_service:       b.service,
      e_photographers: b.photographers,
      e_budget:        b.budget,
      e_advance:       b.advance,
      e_status:        b.status || 'Pending',
      e_description:   b.description,
    };

    for (const [fieldId, value] of Object.entries(fields)) {
      _setField(fieldId, value);
    }

    const deliveredEl = document.getElementById('e_delivered');
    if (deliveredEl) deliveredEl.checked = !!b.delivered;

    _openModal('editModal');
  }

  /** Collect edit-modal values, validate, persist, refresh. */
  async function saveEdit() {
    if (!_editingId) return;

    const existing = _all.find(x => x.id === _editingId);
    if (!existing) return;

    // ── Read values ──
    const name   = _val('e_customerName');
    const date   = _val('e_eventDate');
    const budget = parseInt(document.getElementById('e_budget')?.value)  || 0;
    const adv    = parseInt(document.getElementById('e_advance')?.value) || 0;

    // ── Validate ──
    if (!name) {
      _markInvalid(document.getElementById('e_customerName'), 'Customer name is required.');
      return;
    }
    if (!date) {
      _markInvalid(document.getElementById('e_eventDate'), 'Event date is required.');
      return;
    }
    if (adv > budget) {
      _markInvalid(document.getElementById('e_advance'), 'Advance cannot exceed total budget.');
      return;
    }

    // ── Build updated record (spread existing to preserve unknown fields) ──
    const updated = {
      ...existing,
      customerName:  name,
      phone:         _val('e_phone'),
      email:         _val('e_email'),
      address:       _val('e_address'),
      eventType:     document.getElementById('e_eventType')?.value      || '',
      eventDate:     date,
      eventTime:     document.getElementById('e_eventTime')?.value      || '',
      eventDuration: document.getElementById('e_eventDuration')?.value  || '',
      venue:         _val('e_venue'),
      city:          _val('e_city'),
      state:         _val('e_state'),
      service:       document.getElementById('e_service')?.value        || '',
      photographers: parseInt(document.getElementById('e_photographers')?.value) || 1,
      budget,
      advance:       adv,
      status:        document.getElementById('e_status')?.value         || 'Pending',
      delivered:     document.getElementById('e_delivered')?.checked    ?? existing.delivered,
      description:   _val('e_description'),
      updatedBy:     sessionStorage.getItem('username') || 'admin',
    };

    try {
      await DB.bookings.save(updated);

      // Sync customer stats after edit
      await syncCustomer(updated);

      _closeModal('editModal');
      await _loadAll();

      if (typeof showToast === 'function') {
        showToast('✅ Booking ' + existing.id + ' updated!', 'success');
      }
      _editingId = null;

    } catch (err) {
      console.error('[BookingsList] saveEdit failed:', err);
      if (typeof showToast === 'function') {
        showToast('❌ Could not save changes. Please try again.', 'error');
      }
    }
  }

  /* ─────────────────────────────────────────────────────────
     §4.7  Delete
     ───────────────────────────────────────────────────────── */

  async function deleteBooking(id) {
    const b = _all.find(x => x.id === id);
    if (!b) return;

    const confirmed = window.confirm(
      'Delete booking ' + b.id + ' for ' + b.customerName + '?\n\nThis cannot be undone.'
    );
    if (!confirmed) return;

    try {
      await DB.bookings.delete(id);
      await _loadAll();
      if (typeof showToast === 'function') {
        showToast('🗑️ Booking ' + b.id + ' deleted.', 'info');
      }
    } catch (err) {
      console.error('[BookingsList] deleteBooking failed:', err);
      if (typeof showToast === 'function') {
        showToast('❌ Could not delete booking. Please try again.', 'error');
      }
    }
  }

  /* ─────────────────────────────────────────────────────────
     §4.8  Modal helpers
     ───────────────────────────────────────────────────────── */

  function _openModal(id) {
    document.getElementById(id)?.classList.add('show');
  }

  function _closeModal(id) {
    document.getElementById(id)?.classList.remove('show');
  }

  function closeModal(id) { _closeModal(id); }

  /* ─────────────────────────────────────────────────────────
     §4.9  Bootstrap
     ───────────────────────────────────────────────────────── */

  async function init() {
    const tbody = document.getElementById('bookingsTableBody');
    if (!tbody) return;   // Not on the bookings-list page

    // ── Attach delegated click handler to the table ──
    tbody.addEventListener('click', _onTableClick);

    // ── Backdrop-click to close modals ──
    ['viewModal', 'editModal'].forEach(modalId => {
      document.getElementById(modalId)?.addEventListener('click', e => {
        if (e.target.id === modalId) _closeModal(modalId);
      });
    });

    // ── Load data ──
    try {
      await _loadAll();
    } catch (err) {
      console.error('[BookingsList] init failed:', err);
    }

    // ── Handle ?delivery=pending query-string ──
    const params = new URLSearchParams(window.location.search);
    const dParam = params.get('delivery');
    if (dParam) {
      const df = document.getElementById('deliveryFilter');
      if (df) { df.value = dParam; applyFilters(); }
    }

    console.info('[BookingManager] BookingsList ready ✓');
  }

  /* ── Public surface ── */
  return {
    init,
    applyFilters,
    clearFilters,
    viewBooking,
    editBooking,
    saveEdit,
    deleteBooking,
    switchToEdit,
    closeModal,
  };
})();

/* ─────────────────────────────────────────────────────────────
   §5  AUTO-INIT
   Detects which page we're on and calls the right initialiser.
   Both pages share a common startup flow:
     1. sharedInit()  — theme, auth, date, dropdown
     2. DB.init()     — open IndexedDB, migrate, seed
     3. Page-specific init
   ─────────────────────────────────────────────────────────── */

window.addEventListener('load', async () => {
  // shared.js must have already run
  if (typeof sharedInit === 'function') sharedInit();

  // db.js must have already run
  if (typeof DB === 'undefined') {
    console.error('[BookingManager] DB is not defined — ensure db.js loads before booking-manager.js');
    return;
  }

  try {
    await DB.init();
  } catch (err) {
    console.error('[BookingManager] DB.init failed:', err);
    if (typeof showToast === 'function') {
      showToast('⚠️ Database error — data may not load correctly.', 'error', 5000);
    }
    return;
  }

  // ── Detect page by looking for landmark elements ──
  if (document.getElementById('bookingForm'))      { AddBooking.init(); }
  if (document.getElementById('bookingsTableBody')){ await BookingsList.init(); }
});

/* ─────────────────────────────────────────────────────────────
   §6  GLOBAL EXPORTS
   These must be global so that HTML onclick= attributes that
   already exist in the pages can still reach them.
   ─────────────────────────────────────────────────────────── */

window.applyFilters  = () => BookingsList.applyFilters();
window.clearFilters  = () => BookingsList.clearFilters();
window.viewBooking   = (id) => BookingsList.viewBooking(id);
window.editBooking   = (id) => BookingsList.editBooking(id);
window.deleteBooking = (id) => BookingsList.deleteBooking(id);
window.switchToEdit  = ()   => BookingsList.switchToEdit();
window.saveEdit      = ()   => BookingsList.saveEdit();
window.closeModal    = (id) => BookingsList.closeModal(id);
window.syncCustomer  = syncCustomer;   // export for use from other pages if needed