/* OBITO PHOTOGRAPHY — INVOICE MANAGER v2.0 (invoice.js)
   Premium refactor: wave invoice template, quick actions dropdown,
   bulk select, smart chips, sorting, skeleton loading.
   ============================================================= */

'use strict';

const Invoices = (() => {

  /* ── Private State ── */
  let all = [];
  let _current = null;
  let _searchTerm = '';
  let _statusFilter = 'All';
  let _chipFilter = '';
  let _sortField = 'eventDate';
  let _sortDir = 'desc';
  let _selected = new Set();

  /* ── Helpers ── */
  function _esc(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _fmt(n) {
    return '₹' + (parseInt(n) || 0).toLocaleString('en-IN');
  }

  function _calcPayStatus(budget, advance, eventDate) {
    const pct = budget > 0 ? advance / budget : 0;
    const past = eventDate && new Date(eventDate) < new Date();
    if (pct >= 1) return 'Paid';
    if (past && pct < 1) return 'Overdue';
    if (pct > 0) return 'Partially Paid';
    return 'Unpaid';
  }

  const STATUS_META = {
    'Paid':           { icon: '✅', cls: 'paid',    bg: 'rgba(16,185,129,0.12)', color: '#065f46' },
    'Partially Paid': { icon: '⏳', cls: 'partial', bg: 'rgba(245,158,11,0.12)', color: '#92400e' },
    'Unpaid':         { icon: '🔴', cls: 'unpaid',  bg: 'rgba(239,68,68,0.12)', color: '#991b1b' },
    'Overdue':        { icon: '⚠️', cls: 'overdue', bg: 'rgba(236,72,153,0.12)', color: '#9d174d' },
    'Confirmed':      { icon: '✓',  cls: 'success', bg: 'rgba(16,185,129,0.12)', color: '#065f46' },
    'Pending':        { icon: '○',  cls: 'warning', bg: 'rgba(245,158,11,0.12)', color: '#92400e' },
    'In Progress':    { icon: '▶',  cls: 'primary', bg: 'rgba(59,130,246,0.12)', color: '#1e40af' },
  };

  function _statusBadge(label) {
    const m = STATUS_META[label] || { icon: '●', bg: 'rgba(107,114,128,0.12)', color: '#374151' };
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;
      border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;
      background:${m.bg};color:${m.color};">${m.icon} ${_esc(label)}</span>`;
  }

  /* ── Data Loading ── */
  async function _load() {
    try {
      all = await DB.bookings.getAll();
      return all;
    } catch (err) {
      console.error('[Invoices] Load failed:', err);
      if (typeof showToast === 'function') showToast('❌ Failed to load invoices.', 'error');
      return [];
    }
  }

  /* ── Stats ── */
  function _calcStats(filtered) {
    return {
      total:     filtered.length,
      value:     filtered.reduce((s, b) => s + (parseInt(b.budget) || 0), 0),
      collected: filtered.reduce((s, b) => s + (parseInt(b.advance) || 0), 0),
      pending:   filtered.reduce((s, b) => s + Math.max(0, (parseInt(b.budget) || 0) - (parseInt(b.advance) || 0)), 0),
    };
  }

  function _animateCount(id, end, format) {
    const el = document.getElementById(id);
    if (!el) return;
    const DURATION = 900;
    const start = performance.now();
    (function tick(now) {
      const p = Math.min((now - start) / DURATION, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = format(Math.round(end * e));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = format(end);
    })(start);
  }

  function _updateStats(stats) {
    _animateCount('is-total',     stats.total,     String);
    _animateCount('is-value',     stats.value,     _fmt);
    _animateCount('is-collected', stats.collected, _fmt);
    _animateCount('is-pending',   stats.pending,   _fmt);
  }

  /* ── Filters ── */
  function _applyFilters() {
    const search = _searchTerm.toLowerCase();
    const today  = new Date(); today.setHours(0,0,0,0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    return all.filter(b => {
      // Booking status filter
      if (_statusFilter !== 'All' && b.status !== _statusFilter) return false;

      // Quick chip filter
      if (_chipFilter) {
        const eDate = b.eventDate ? new Date(b.eventDate) : null;
        const budget  = parseInt(b.budget)  || 0;
        const advance = parseInt(b.advance) || 0;
        const payStatus = _calcPayStatus(budget, advance, b.eventDate);

        if (_chipFilter === 'today') {
          if (!eDate) return false;
          const d = new Date(eDate); d.setHours(0,0,0,0);
          if (d.getTime() !== today.getTime()) return false;
        } else if (_chipFilter === 'month') {
          if (!eDate || eDate < monthStart) return false;
        } else if (_chipFilter === 'overdue') {
          if (payStatus !== 'Overdue') return false;
        }
      }

      // Search filter
      if (search) {
        const haystack = [b.id, b.customerName, b.eventType, b.phone, b.email]
          .map(x => (x || '').toLowerCase()).join(' ');
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }

  function _applySort(arr) {
    return [...arr].sort((a, b) => {
      let va, vb;
      if (_sortField === 'budget') {
        va = parseInt(a.budget) || 0;
        vb = parseInt(b.budget) || 0;
      } else if (_sortField === 'advance') {
        va = parseInt(a.advance) || 0;
        vb = parseInt(b.advance) || 0;
      } else {
        va = a.eventDate || '';
        vb = b.eventDate || '';
      }
      if (va < vb) return _sortDir === 'asc' ? -1 :  1;
      if (va > vb) return _sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  /* ── Skeleton Loader ── */
  function _showSkeleton() {
    const tbody = document.getElementById('invTableBody');
    if (!tbody) return;
    tbody.innerHTML = Array.from({ length: 5 }, (_, i) => `
      <tr>
        <td><span class="skeleton sk-line sk-w40"></span></td>
        <td><span class="skeleton sk-line sk-w60"></span><span class="skeleton sk-line sk-w30" style="height:9px;margin-top:6px"></span></td>
        <td><span class="skeleton sk-line sk-w30"></span></td>
        <td><span class="skeleton sk-line sk-w40"></span></td>
        <td><span class="skeleton sk-line sk-w40"></span></td>
        <td><span class="skeleton sk-line sk-w40"></span></td>
        <td><span class="skeleton sk-line sk-w80"></span></td>
        <td><span class="skeleton sk-line sk-w60"></span></td>
      </tr>`).join('');
  }

  /* ── Main Render ── */
  function render() {
    _searchTerm  = (document.getElementById('searchInput')?.value || '').trim();
    _statusFilter = document.getElementById('statusFilter')?.value || 'All';

    const filtered = _applyFilters();
    const sorted   = _applySort(filtered);
    const stats    = _calcStats(sorted);
    const tbody    = document.getElementById('invTableBody');
    const countEl  = document.getElementById('invCount');

    _updateStats(stats);
    if (countEl) countEl.textContent = sorted.length;

    if (!tbody) return;

    if (sorted.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="9" class="inv-empty">
          <div class="empty-icon">📭</div>
          <div class="empty-title">No invoices found</div>
          <div class="empty-desc">Try adjusting your filters or create a new booking.</div>
        </td></tr>`;
      return;
    }

    tbody.innerHTML = sorted.map(b => {
      const budget    = parseInt(b.budget)  || 0;
      const advance   = parseInt(b.advance) || 0;
      const due       = budget - advance;
      const pct       = budget > 0 ? Math.round((advance / budget) * 100) : 0;
      const payStatus = _calcPayStatus(budget, advance, b.eventDate);
      const fillCls   = pct >= 100 ? 'full' : pct < 30 ? 'danger' : '';

      const eventDate = b.eventDate
        ? new Date(b.eventDate).toLocaleDateString('en-IN', { year:'2-digit', month:'short', day:'numeric' })
        : '—';

      const isSelected = _selected.has(b.id);

      return `
        <tr data-id="${_esc(b.id)}" class="${isSelected ? 'row-selected' : ''}">
          <td class="inv-check-col" onclick="event.stopPropagation()">
            <input type="checkbox" class="inv-checkbox" data-id="${_esc(b.id)}"
              ${isSelected ? 'checked' : ''}>
          </td>
          <td>
            <div class="inv-id">${_esc(b.id || 'N/A')}</div>
            <div class="inv-date">${eventDate}</div>
          </td>
          <td>
            <div class="inv-customer">${_esc(b.customerName || '—')}</div>
            <div class="inv-event">${_esc(b.eventType || '—')}</div>
          </td>
          <td>${_statusBadge(b.status || 'Pending')}</td>
          <td><div class="amount-total">${_fmt(budget)}</div></td>
          <td><div class="amount-paid">${_fmt(advance)}</div></td>
          <td><div class="amount-due">${_fmt(due)}</div></td>
          <td>
            <div class="pct-bar">
              <div class="pct-track">
                <div class="pct-fill ${fillCls}" style="width:${pct}%"></div>
              </div>
              <div class="pct-label">${pct}%</div>
            </div>
          </td>
          <td onclick="event.stopPropagation()">
            <div class="act-dropdown" id="dd-${_esc(b.id)}">
              <button class="act-menu-btn" data-dd="${_esc(b.id)}">
                Actions ▾
              </button>
              <div class="act-menu-list">
                <button class="act-menu-item" data-action="view" data-id="${_esc(b.id)}">👁 View Invoice</button>
                <button class="act-menu-item" data-action="print" data-id="${_esc(b.id)}">🖨️ Print</button>
                <button class="act-menu-item" data-action="whatsapp" data-id="${_esc(b.id)}">💬 WhatsApp</button>
                <div class="act-menu-divider"></div>
                ${!b.delivered
                  ? `<button class="act-menu-item" data-action="deliver" data-id="${_esc(b.id)}">✓ Mark Delivered</button>`
                  : `<button class="act-menu-item" style="opacity:0.5;cursor:default">✅ Delivered</button>`
                }
              </div>
            </div>
          </td>
        </tr>`;
    }).join('');

    _attachTableListeners();
    _updateBulkBar();
  }

  /* ── Event Delegation ── */
  function _attachTableListeners() {
    const tbody = document.getElementById('invTableBody');
    if (!tbody) return;

    // Row click → view (except action column)
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.dataset.id;
        if (id) view(id);
      });
    });

    // Dropdown toggle
    tbody.querySelectorAll('[data-dd]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const ddId = 'dd-' + btn.dataset.dd;
        document.querySelectorAll('.act-dropdown.open').forEach(d => {
          if (d.id !== ddId) d.classList.remove('open');
        });
        document.getElementById(ddId)?.classList.toggle('open');
      });
    });

    // Action items
    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const { action, id } = btn.dataset;
        if (action === 'view')      view(id);
        if (action === 'print')     print(id);
        if (action === 'deliver')   markDelivered(id);
        if (action === 'whatsapp')  _shareWhatsAppById(id);
        document.querySelectorAll('.act-dropdown.open').forEach(d => d.classList.remove('open'));
      });
    });

    // Checkboxes
    tbody.querySelectorAll('.inv-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) _selected.add(cb.dataset.id);
        else            _selected.delete(cb.dataset.id);
        _updateBulkBar();
      });
    });
  }

  /* ── Select All ── */
  function _toggleSelectAll(checked) {
    const filtered = _applySort(_applyFilters());
    filtered.forEach(b => {
      if (checked) _selected.add(b.id);
      else         _selected.delete(b.id);
    });
    render();
  }

  /* ── Bulk Actions Bar ── */
  function _updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    const cnt = document.getElementById('bulkCount');
    if (!bar) return;
    if (_selected.size > 0) {
      bar.classList.add('visible');
      if (cnt) cnt.textContent = `${_selected.size} selected`;
    } else {
      bar.classList.remove('visible');
    }
  }

  async function bulkDeliver() {
    if (_selected.size === 0) return;
    const ids = [..._selected];
    for (const id of ids) {
      const b = all.find(x => x.id === id);
      if (b && !b.delivered) {
        b.delivered = true;
        await DB.bookings.save(b).catch(() => {});
      }
    }
    _selected.clear();
    await _load();
    render();
    if (typeof showToast === 'function') showToast(`✅ ${ids.length} invoices marked delivered!`, 'success');
  }

  function bulkExport() {
    if (typeof showToast === 'function') showToast('📦 Export feature coming soon!', 'info');
  }

  /* ── Sorting ── */
  function _setSort(field) {
    if (_sortField === field) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    else { _sortField = field; _sortDir = 'desc'; }

    document.querySelectorAll('.inv-table th').forEach(th => {
      th.classList.remove('sorted');
      th.querySelector('.sort-icon') && (th.querySelector('.sort-icon').textContent = '↕');
    });
    const th = document.querySelector(`[data-sort="${field}"]`);
    if (th) {
      th.classList.add('sorted');
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = _sortDir === 'asc' ? '↑' : '↓';
    }
    render();
  }

  /* ── Chip Filter ── */
  function _setChip(chip) {
    _chipFilter = _chipFilter === chip ? '' : chip;
    document.querySelectorAll('.inv-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.chip === _chipFilter);
    });
    render();
  }

  /* ── View Modal ── */
  function view(id) {
    const b = all.find(x => x.id === id);
    if (!b) return;

    _current = b;
    const budget  = parseInt(b.budget)  || 0;
    const advance = parseInt(b.advance) || 0;
    const content = document.getElementById('invModalContent');
    const modal   = document.getElementById('invModal');

    if (content && modal) {
      content.innerHTML = _invoiceHTML(b, budget, advance);
      modal.classList.add('open');
    }
  }

  /* ── Print ── */
  function print(id) {
    const b = all.find(x => x.id === id) || _current;
    if (!b) return;

    const budget  = parseInt(b.budget)  || 0;
    const advance = parseInt(b.advance) || 0;
    const html    = _invoiceHTML(b, budget, advance);
    const pw      = window.open('', '', 'width=920,height=700');

    pw.document.write(`<!DOCTYPE html><html lang="en"><head>
      <meta charset="UTF-8">
      <title>Invoice ${b.id} — Obito Photography</title>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: white; }
        .inv-wave-header, .inv-tbl thead tr, .inv-sum-row.total-row,
        .inv-wave-footer::before, .inv-footer-content {
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        @media print { body { margin: 0; padding: 0; } }
      </style>
    </head><body>${html}</body></html>`);
    pw.document.close();
    pw.focus();
    setTimeout(() => pw.print(), 450);
  }

  /* ── Mark Delivered ── */
  async function markDelivered(id) {
    const b = all.find(x => x.id === id);
    if (!b) return;
    try {
      b.delivered = true;
      await DB.bookings.save(b);
      await _load();
      render();
      if (typeof showToast === 'function') showToast('✅ Marked as delivered!', 'success');
    } catch (err) {
      console.error('[Invoices] markDelivered failed:', err);
      if (typeof showToast === 'function') showToast('❌ Failed to update.', 'error');
    }
  }

  /* ── WhatsApp ── */
  function _shareWhatsAppById(id) {
    const b = all.find(x => x.id === id);
    if (b) { _current = b; shareWhatsApp(); }
  }

  function shareWhatsApp() {
    if (!_current) return;
    const b = _current;
    const budget  = parseInt(b.budget)  || 0;
    const advance = parseInt(b.advance) || 0;
    const due     = budget - advance;
    const payStatus = _calcPayStatus(budget, advance, b.eventDate);
    const eventDate = b.eventDate
      ? new Date(b.eventDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })
      : '—';

    const msg = encodeURIComponent(
      `📸 *Obito Photography — Invoice*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `*Booking ID:* ${b.id}\n` +
      `*Customer:* ${b.customerName}\n` +
      `*Event:* ${b.eventType} — ${eventDate}\n` +
      (b.venue ? `*Venue:* ${b.venue}${b.city ? ', ' + b.city : ''}\n` : '') +
      `━━━━━━━━━━━━━━━━━━\n` +
      `*Total Amount:* ₹${budget.toLocaleString('en-IN')}\n` +
      `*Advance Paid:* ₹${advance.toLocaleString('en-IN')}\n` +
      `*Balance Due:* ₹${due.toLocaleString('en-IN')}\n` +
      `*Payment Status:* ${payStatus}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Thank you for choosing Obito Photography! 🙏\n` +
      `For queries: obito@photography.com | +91 98765 00000`
    );
    window.open('https://wa.me/?text=' + msg, '_blank');
  }

  /* ── Close Modal ── */
  function closeModal() {
    document.getElementById('invModal')?.classList.remove('open');
    _current = null;
  }

  /* ────────────────────────────────────────────────────────────
     INVOICE HTML — Wave Design matching reference template
     ──────────────────────────────────────────────────────────── */
  function _invoiceHTML(b, budget, advance) {
    const due       = budget - advance;
    const pct       = budget > 0 ? Math.round((advance / budget) * 100) : 0;
    const payStatus = _calcPayStatus(budget, advance, b.eventDate);
    const today     = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
    const eventDate = b.eventDate
      ? new Date(b.eventDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })
      : '—';

    const statusMeta = {
      'Paid':           { cls:'paid',    icon:'✅' },
      'Partially Paid': { cls:'partial', icon:'⏳' },
      'Unpaid':         { cls:'unpaid',  icon:'🔴' },
      'Overdue':        { cls:'overdue', icon:'⚠️' },
    };
    const sm = statusMeta[payStatus] || { cls:'unpaid', icon:'●' };

    const invNum  = _esc(b.id || 'INV-001');
    const custName = _esc(b.customerName || '—');
    const evtType  = _esc(b.eventType || 'Photography Service');
    const service  = _esc(b.service || 'Photography Service');

    return `
<div class="invoice-print" id="printableInvoice" style="background:#fff;color:#2c3e50;font-family:'Plus Jakarta Sans',sans-serif;max-width:720px;margin:0 auto;overflow:hidden;">

  <!-- WAVE HEADER -->
  <div class="inv-wave-header" style="position:relative;background:linear-gradient(135deg,#1a4a8a 0%,#2563eb 100%);padding:28px 36px 72px;overflow:hidden;">
    <!-- Decorative circles -->
    <div style="position:absolute;top:-50px;right:-50px;width:200px;height:200px;background:rgba(255,255,255,0.06);border-radius:50%;"></div>
    <div style="position:absolute;bottom:30px;left:-30px;width:120px;height:120px;background:rgba(255,255,255,0.04);border-radius:50%;"></div>

    <!-- Wave curve at bottom -->
    <div style="position:absolute;bottom:-2px;left:-5%;width:110%;height:55px;background:#fff;border-radius:50% 50% 0 0 / 100% 100% 0 0;"></div>

    <!-- Header content -->
    <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
      <!-- Logo & Brand -->
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="width:54px;height:54px;border-radius:50%;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:white;flex-shrink:0;letter-spacing:-0.5px;">OP</div>
        <div>
          <div style="font-weight:800;font-size:20px;color:white;line-height:1.1;">Obito Photography</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:3px;font-weight:500;letter-spacing:0.3px;">Professional Photography Services</div>
        </div>
      </div>

      <!-- Invoice title & meta -->
      <div style="text-align:right;">
        <div style="font-size:36px;font-weight:800;color:white;letter-spacing:5px;text-transform:uppercase;line-height:1;">INVOICE</div>
        <div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.7);line-height:2;">
          <span style="color:rgba(255,255,255,0.5);">Invoice #</span> <strong style="color:white;">${invNum}</strong><br>
          <span style="color:rgba(255,255,255,0.5);">Date</span> <strong style="color:white;">${today}</strong><br>
          <span style="color:rgba(255,255,255,0.5);">Event Date</span> <strong style="color:white;">${eventDate}</strong>
        </div>
      </div>
    </div>
  </div>

  <!-- BODY -->
  <div style="padding:0 36px 28px;">

    <!-- Bill To / Event Details -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:22px 0 20px;border-bottom:1px solid #ecf0f1;">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#9eaab8;font-weight:700;margin-bottom:8px;">Invoice To</div>
        <div style="font-weight:700;font-size:15px;color:#1a2332;margin-bottom:6px;">${custName}</div>
        ${b.phone ? `<div style="font-size:12px;color:#7f8c8d;line-height:1.7;">📞 ${_esc(b.phone)}</div>` : ''}
        ${b.email ? `<div style="font-size:12px;color:#7f8c8d;line-height:1.7;">✉️ ${_esc(b.email)}</div>` : ''}
        <!-- Payment status badge -->
        <div style="margin-top:12px;">
          <span class="inv-status-badge ${sm.cls}" style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${sm.icon} ${payStatus}</span>
        </div>
      </div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#9eaab8;font-weight:700;margin-bottom:8px;">Event Details</div>
        <div style="font-weight:700;font-size:15px;color:#1a2332;margin-bottom:6px;">${evtType}</div>
        ${b.venue ? `<div style="font-size:12px;color:#7f8c8d;line-height:1.7;">📍 ${_esc(b.venue)}${b.city ? ', ' + _esc(b.city) : ''}</div>` : ''}
        ${b.service ? `<div style="font-size:12px;color:#7f8c8d;line-height:1.7;">📸 ${_esc(b.service)}</div>` : ''}
        <div style="font-size:12px;color:#7f8c8d;line-height:1.7;">📅 ${eventDate}</div>
      </div>
    </div>

    <!-- Items Table -->
    <div style="padding:20px 0 0;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:linear-gradient(90deg,#1a4a8a,#2563eb);">
            <th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:white;border-radius:6px 0 0 6px;">SL.</th>
            <th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:white;">Item Description</th>
            <th style="padding:11px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:white;">Price</th>
            <th style="padding:11px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:white;">Qty</th>
            <th style="padding:11px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:white;border-radius:0 6px 6px 0;">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:13px 14px;font-size:13px;color:#1a4a8a;font-weight:700;border-bottom:1px solid #ecf0f1;">1</td>
            <td style="padding:13px 14px;font-size:13px;color:#1a2332;font-weight:600;border-bottom:1px solid #ecf0f1;">
              ${service}
              ${b.eventType ? `<div style="font-size:11px;color:#7f8c8d;margin-top:2px;">${evtType} Coverage</div>` : ''}
            </td>
            <td style="padding:13px 14px;font-size:13px;text-align:right;font-weight:600;color:#1a2332;border-bottom:1px solid #ecf0f1;">₹${budget.toLocaleString('en-IN')}</td>
            <td style="padding:13px 14px;font-size:13px;text-align:right;font-weight:600;color:#1a2332;border-bottom:1px solid #ecf0f1;">01</td>
            <td style="padding:13px 14px;font-size:13px;text-align:right;font-weight:700;color:#1a2332;border-bottom:1px solid #ecf0f1;">₹${budget.toLocaleString('en-IN')}</td>
          </tr>
          <!-- Spacer row -->
          <tr><td colspan="5" style="padding:8px 0;border-bottom:1px solid #ecf0f1;"></td></tr>
        </tbody>
      </table>
    </div>

    <!-- Summary (right-aligned) -->
    <div style="display:flex;justify-content:flex-end;padding:12px 0 20px;border-bottom:1px solid #ecf0f1;">
      <div style="min-width:270px;">
        <div style="display:flex;justify-content:space-between;padding:7px 0;font-size:13px;color:#5a6474;border-bottom:1px solid #f0f2f5;">
          <span>Sub Total:</span><span>₹${budget.toLocaleString('en-IN')}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:7px 0;font-size:13px;color:#5a6474;border-bottom:1px solid #f0f2f5;">
          <span>Tax (0.00%):</span><span>₹0</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;background:linear-gradient(90deg,#1a4a8a,#2563eb);color:white;border-radius:8px;padding:11px 14px;margin-top:8px;font-weight:800;font-size:14px;">
          <span>Total:</span><span style="font-size:18px;">₹${budget.toLocaleString('en-IN')}</span>
        </div>
      </div>
    </div>

    <!-- Payment Info -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:18px 0;border-bottom:1px solid #ecf0f1;">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#9eaab8;font-weight:700;margin-bottom:10px;">Payment Info</div>
        <div style="font-size:12px;color:#7f8c8d;line-height:2;">
          <div>Bank: <strong style="color:#1a2332;">Obito Photography</strong></div>
          <div>UPI: <strong style="color:#1a2332;">obito@upi</strong></div>
          <div>Contact: <strong style="color:#1a2332;">+91 98765 00000</strong></div>
        </div>
      </div>
      <div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="background:#f0fdf4;border-radius:10px;padding:14px;border-left:3px solid #10b981;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9eaab8;font-weight:700;margin-bottom:6px;">Advance Paid</div>
            <div style="font-size:18px;font-weight:800;color:#10b981;line-height:1;">₹${advance.toLocaleString('en-IN')}</div>
            <div style="margin-top:8px;background:#d1fae5;border-radius:3px;height:4px;overflow:hidden;">
              <div style="width:${pct}%;height:100%;background:#10b981;border-radius:3px;"></div>
            </div>
            <div style="font-size:10px;color:#6ee7b7;margin-top:4px;">${pct}% paid</div>
          </div>
          <div style="background:#fff5f5;border-radius:10px;padding:14px;border-left:3px solid #ef4444;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9eaab8;font-weight:700;margin-bottom:6px;">Balance Due</div>
            <div style="font-size:18px;font-weight:800;color:#ef4444;line-height:1;">₹${due.toLocaleString('en-IN')}</div>
            <div style="margin-top:8px;background:#fee2e2;border-radius:3px;height:4px;overflow:hidden;">
              <div style="width:${100 - pct}%;height:100%;background:#ef4444;border-radius:3px;"></div>
            </div>
            <div style="font-size:10px;color:#fca5a5;margin-top:4px;">${100 - pct}% pending</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Terms & Signature -->
    <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:18px 0;">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9eaab8;font-weight:700;margin-bottom:8px;">Terms &amp; Conditions</div>
        <div style="font-size:11px;color:#7f8c8d;line-height:1.8;max-width:280px;">
          Payment due within 7 days of event date.<br>
          50% advance required to confirm booking.<br>
          Cancellation policy applies as per agreement.
        </div>
      </div>
      <div style="text-align:right;">
        <div style="width:140px;border-top:1.5px solid #bdc3c7;margin-bottom:8px;margin-left:auto;"></div>
        <div style="font-size:11px;color:#7f8c8d;font-weight:600;">Authorised Signature</div>
      </div>
    </div>
  </div>

  <!-- WAVE FOOTER -->
  <div style="position:relative;padding-top:30px;overflow:hidden;">
    <div style="position:absolute;top:0;left:-5%;width:110%;height:55px;background:linear-gradient(90deg,#1a4a8a,#2563eb);border-radius:0 0 50% 50% / 0 0 100% 100%;transform:rotate(180deg);"></div>
    <div style="background:linear-gradient(90deg,#1a4a8a,#2563eb);color:rgba(255,255,255,0.8);text-align:center;padding:14px 36px 24px;font-size:12px;line-height:1.9;position:relative;z-index:1;">
      <strong style="color:white;font-size:13px;display:block;margin-bottom:2px;">Thank you for choosing Obito Photography!</strong>
      obito@photography.com | +91 98765 00000 | www.obitophoto.com
    </div>
  </div>

</div>`;
  }

  /* ── Init ── */
  async function init() {
    const tbody = document.getElementById('invTableBody');
    if (!tbody) return;

    _showSkeleton();

    try {
      await _load();
      render();

      // Modal backdrop close
      document.getElementById('invModal')?.addEventListener('click', e => {
        if (e.target.id === 'invModal') closeModal();
      });

      // Close dropdowns on outside click
      document.addEventListener('click', () => {
        document.querySelectorAll('.act-dropdown.open').forEach(d => d.classList.remove('open'));
      });

      // Sorting headers
      document.querySelectorAll('[data-sort]').forEach(th => {
        th.addEventListener('click', () => _setSort(th.dataset.sort));
      });

      // Chip filters
      document.querySelectorAll('[data-chip]').forEach(chip => {
        chip.addEventListener('click', () => _setChip(chip.dataset.chip));
      });

      // Select-all checkbox
      const selectAll = document.getElementById('selectAll');
      if (selectAll) {
        selectAll.addEventListener('change', () => _toggleSelectAll(selectAll.checked));
      }

      // Bulk buttons
      document.getElementById('bulkDeliverBtn')?.addEventListener('click', bulkDeliver);
      document.getElementById('bulkExportBtn')?.addEventListener('click', bulkExport);
      document.getElementById('bulkClearBtn')?.addEventListener('click', () => {
        _selected.clear();
        const selectAll = document.getElementById('selectAll');
        if (selectAll) selectAll.checked = false;
        render();
      });

      // Restore URL filter param
      const params = new URLSearchParams(window.location.search);
      const sp = params.get('status');
      if (sp) {
        const sel = document.getElementById('statusFilter');
        if (sel) { sel.value = sp; _statusFilter = sp; render(); }
      }

    } catch (err) {
      console.error('[Invoices] init failed:', err);
      if (typeof showToast === 'function') showToast('❌ Failed to initialize invoices.', 'error');
    }
  }

  /* ── Public API ── */
  return {
    init,
    render() {
      _searchTerm   = (document.getElementById('searchInput')?.value || '').trim();
      _statusFilter = document.getElementById('statusFilter')?.value || 'All';
      render();
    },
    view,
    print,
    markDelivered,
    shareWhatsApp,
    closeModal,
    bulkDeliver,
    bulkExport,
  };
})();

/* ── Auto-init ── */
window.addEventListener('load', async () => {
  if (typeof sharedInit === 'function') sharedInit();
  if (typeof DB === 'undefined') {
    console.error('[Invoices] DB not defined — ensure db.js loads first');
    return;
  }
  try { await DB.init(); } catch (err) { console.error('[Invoices] DB.init failed:', err); return; }
  await Invoices.init();
});