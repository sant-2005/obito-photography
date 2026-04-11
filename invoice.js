/* OBITO PHOTOGRAPHY — INVOICE MANAGER v4 (invoice.js)
   ✅ Complete code review & fixes applied
   ✅ A4-sized invoices with flexible pagination
   ✅ WhatsApp share & print optimization
   ✅ Professional invoice builder
   ============================================================= */

'use strict';

const Invoices = (() => {

  /* ── State Management ── */
  let _all       = [];        // All invoices from database
  let _current   = null;      // Currently viewed invoice
  let _search    = '';        // Search query
  let _status    = 'All';     // Status filter
  let _chip      = '';        // Quick filter chip
  let _sortField = 'eventDate'; // Sort column
  let _sortDir   = 'desc';    // Sort direction
  let _selected  = new Set(); // Selected invoice IDs for bulk actions

  /* ════════════════════════════════════════════════════════════
     UTILITY FUNCTIONS
     ════════════════════════════════════════════════════════════ */

  /**
   * Escape HTML special characters to prevent XSS
   */
  function _esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Format number as Indian rupees
   */
  function _fmt(n) {
    return '₹' + (parseInt(n) || 0).toLocaleString('en-IN');
  }

  /**
   * Format date for display.
   * Handles ISO date-only strings (YYYY-MM-DD) by appending T00:00:00
   * so the local timezone is used instead of UTC, avoiding off-by-one-day errors.
   */
  function _fmtDate(d, opts) {
    if (!d) return '—';
    // If it's a plain date string like "2026-04-15", treat it as local time
    const normalized = (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      ? d + 'T00:00:00'
      : d;
    return new Date(normalized).toLocaleDateString('en-IN', opts || {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  /**
   * Determine payment status (Paid, Unpaid, Overdue, etc.)
   */
  function _payStatus(budget, advance, eventDate) {
    const pct = budget > 0 ? advance / budget : 0;
    let past = false;
    if (eventDate) {
      // Parse YYYY-MM-DD as local date to avoid UTC timezone shift
      const normalized = /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
        ? eventDate + 'T00:00:00'
        : eventDate;
      past = new Date(normalized) < new Date();
    }
    if (pct >= 1) return 'Paid';
    if (past && pct < 1) return 'Overdue';
    if (pct > 0) return 'Partially Paid';
    return 'Unpaid';
  }

  /**
   * Create styled status badge HTML
   */
  function _statusBadge(label) {
    const MAP = {
      'Paid':           { bg: 'rgba(16,185,129,0.12)', color: '#065f46', icon: '✅' },
      'Partially Paid': { bg: 'rgba(245,158,11,0.12)', color: '#92400e', icon: '⏳' },
      'Unpaid':         { bg: 'rgba(239,68,68,0.12)', color: '#991b1b', icon: '🔴' },
      'Overdue':        { bg: 'rgba(236,72,153,0.12)', color: '#9d174d', icon: '⚠️' },
      'Confirmed':      { bg: 'rgba(16,185,129,0.12)', color: '#065f46', icon: '✓' },
      'Pending':        { bg: 'rgba(245,158,11,0.12)', color: '#92400e', icon: '○' },
      'In Progress':    { bg: 'rgba(59,130,246,0.12)', color: '#1e40af', icon: '▶' },
    };
    
    const m = MAP[label] || { bg: 'rgba(107,114,128,0.12)', color: '#374151', icon: '●' };
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;background:${m.bg};color:${m.color};">${m.icon} ${_esc(label)}</span>`;
  }

  /* ════════════════════════════════════════════════════════════
     DATA LOADING
     ════════════════════════════════════════════════════════════ */

  /**
   * Load all invoices from database
   */
  async function _load() {
    try {
      _all = await DB.bookings.getAll();
    } catch (e) {
      console.error('[Invoices] Load failed:', e);
      if (typeof showToast === 'function') {
        showToast('❌ Failed to load invoices.', 'error');
      }
    }
  }

  /* ════════════════════════════════════════════════════════════
     STATISTICS & ANIMATION
     ════════════════════════════════════════════════════════════ */

  /**
   * Calculate statistics from invoice array
   */
  function _stats(arr) {
    return {
      total:     arr.length,
      value:     arr.reduce((s, b) => s + (parseInt(b.budget) || 0), 0),
      collected: arr.reduce((s, b) => s + (parseInt(b.advance) || 0), 0),
      pending:   arr.reduce((s, b) => s + Math.max(0, (parseInt(b.budget) || 0) - (parseInt(b.advance) || 0)), 0),
    };
  }

  /**
   * Animate number from 0 to end value
   */
  function _animNum(id, end, fmt) {
    const el = document.getElementById(id);
    if (!el) return;
    
    const DUR = 900;
    const t0 = performance.now();
    
    const tick = (now) => {
      const p = Math.min((now - t0) / DUR, 1);
      const e = 1 - Math.pow(1 - p, 3); // Ease out cubic
      el.textContent = fmt(Math.round(end * e));
      if (p < 1) requestAnimationFrame(tick);
    };
    
    requestAnimationFrame(tick);
  }

  /**
   * Update all stat cards with animation
   */
  function _updateStats(s) {
    _animNum('is-total', s.total, String);
    _animNum('is-value', s.value, _fmt);
    _animNum('is-collected', s.collected, _fmt);
    _animNum('is-pending', s.pending, _fmt);
  }

  /* ════════════════════════════════════════════════════════════
     FILTERING & SORTING
     ════════════════════════════════════════════════════════════ */

  /**
   * Filter invoices based on search, status, and date chips
   */
  function _filter() {
    const q = _search.toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const mStart = new Date(today.getFullYear(), today.getMonth(), 1);

    return _all.filter(b => {
      // Status filter
      if (_status !== 'All' && b.status !== _status) return false;
      
      // Date/Payment chips
      if (_chip) {
        const ed = b.eventDate ? new Date(b.eventDate) : null;
        const ps = _payStatus(
          parseInt(b.budget) || 0,
          parseInt(b.advance) || 0,
          b.eventDate
        );
        
        if (_chip === 'today') {
          if (!ed) return false;
          const normalized = /^\d{4}-\d{2}-\d{2}$/.test(ed) ? ed + 'T00:00:00' : ed;
          const d = new Date(normalized);
          d.setHours(0, 0, 0, 0);
          if (d.getTime() !== today.getTime()) return false;
        } else if (_chip === 'month') {
          if (!ed) return false;
          const normalized = /^\d{4}-\d{2}-\d{2}$/.test(ed) ? ed + 'T00:00:00' : ed;
          if (new Date(normalized) < mStart) return false;
        } else if (_chip === 'overdue') {
          if (ps !== 'Overdue') return false;
        }
      }
      
      // Search query
      if (q) {
        const hay = [b.id, b.customerName, b.eventType, b.phone, b.email]
          .map(x => (x || '').toLowerCase())
          .join(' ');
        if (!hay.includes(q)) return false;
      }
      
      return true;
    });
  }

  /**
   * Sort invoices by selected field and direction
   */
  function _sort(arr) {
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
      
      if (va < vb) return _sortDir === 'asc' ? -1 : 1;
      if (va > vb) return _sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /* ════════════════════════════════════════════════════════════
     TABLE RENDERING
     ════════════════════════════════════════════════════════════ */

  /**
   * Show loading skeleton in table
   */
  function _skeleton() {
    const tb = document.getElementById('invTableBody');
    if (!tb) return;
    
    tb.innerHTML = Array.from({ length: 5 })
      .map(() => `<tr><td><span class="skeleton sk-line sk-w40"></span></td><td><span class="skeleton sk-line sk-w60"></span><span class="skeleton sk-line sk-w30" style="height:9px;margin-top:6px"></span></td><td><span class="skeleton sk-line sk-w80"></span></td><td><span class="skeleton sk-line sk-w40"></span></td><td><span class="skeleton sk-line sk-w40"></span></td><td><span class="skeleton sk-line sk-w40"></span></td><td><span class="skeleton sk-line sk-w40"></span></td><td><span class="skeleton sk-line sk-w60"></span></td><td><span class="skeleton sk-line sk-w30"></span></td></tr>`)
      .join('');
  }

  /**
   * Main render function - display invoice table
   */
  function render() {
    // Get current filter values
    _search = (document.getElementById('searchInput')?.value || '').trim();
    _status = document.getElementById('statusFilter')?.value || 'All';

    // Apply filters and sort
    const filtered = _filter();
    const sorted = _sort(filtered);
    const s = _stats(sorted);
    const tbody = document.getElementById('invTableBody');
    const countEl = document.getElementById('invCount');

    // Update stats
    _updateStats(s);
    if (countEl) countEl.textContent = sorted.length;
    if (!tbody) return;

    // Empty state
    if (!sorted.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="inv-empty"><div class="empty-icon">📭</div><div class="empty-title">No invoices found</div><div class="empty-desc">Try adjusting your filters or create a new booking.</div></td></tr>`;
      return;
    }

    // Render table rows
    tbody.innerHTML = sorted.map(b => {
      const budget = parseInt(b.budget) || 0;
      const advance = parseInt(b.advance) || 0;
      const due = budget - advance;
      const pct = budget > 0 ? Math.round((advance / budget) * 100) : 0;
      const payS = _payStatus(budget, advance, b.eventDate);
      const fillCls = pct >= 100 ? 'full' : pct < 30 ? 'danger' : '';
      const evtDate = _fmtDate(b.eventDate, { year: '2-digit', month: 'short', day: 'numeric' });
      const isSel = _selected.has(b.id);

      return `<tr data-id="${_esc(b.id)}" class="${isSel ? 'row-selected' : ''}"><td class="inv-check-col" onclick="event.stopPropagation()"><input type="checkbox" class="inv-checkbox" data-id="${_esc(b.id)}" ${isSel ? 'checked' : ''}></td><td><div class="inv-id">${_esc(b.id || 'N/A')}</div><div class="inv-date">${evtDate}</div></td><td><div class="inv-customer">${_esc(b.customerName || '—')}</div><div class="inv-event">${_esc(b.eventType || '—')}</div></td><td>${_statusBadge(b.status || 'Pending')}</td><td><span class="amount-total">${_fmt(budget)}</span></td><td><span class="amount-paid">${_fmt(advance)}</span></td><td><span class="amount-due">${_fmt(due)}</span></td><td><div class="pct-bar"><div class="pct-track"><div class="pct-fill ${fillCls}" style="width:${pct}%"></div></div><div class="pct-label">${pct}%</div></div></td><td onclick="event.stopPropagation()"><div class="act-dropdown" id="dd-${_esc(b.id)}"><button class="act-menu-btn" data-dd="${_esc(b.id)}">Actions ▾</button><div class="act-menu-list"><button class="act-menu-item" data-action="view" data-id="${_esc(b.id)}">👁 View Invoice</button><button class="act-menu-item" data-action="print" data-id="${_esc(b.id)}">🖨️ Print / PDF</button><button class="act-menu-item" data-action="whatsapp" data-id="${_esc(b.id)}">💬 WhatsApp</button><div class="act-menu-divider"></div>${!b.delivered ? `<button class="act-menu-item" data-action="deliver" data-id="${_esc(b.id)}">✓ Mark Delivered</button>` : `<button class="act-menu-item" style="opacity:0.45;cursor:default;">✅ Delivered</button>`}</div></div></td></tr>`;
    }).join('');

    // Bind event listeners
    _bindTable();
    _bulkBar();
  }

  /* ════════════════════════════════════════════════════════════
     TABLE EVENT BINDING
     ════════════════════════════════════════════════════════════ */

  /**
   * Bind click handlers to table elements
   */
  function _bindTable() {
    const tbody = document.getElementById('invTableBody');
    if (!tbody) return;

    // Row click - view invoice
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => view(tr.dataset.id));
    });

    // Action button dropdown toggle
    tbody.querySelectorAll('[data-dd]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = 'dd-' + btn.dataset.dd;
        document.querySelectorAll('.act-dropdown.open').forEach(d => {
          if (d.id !== id) d.classList.remove('open');
        });
        document.getElementById(id)?.classList.toggle('open');
      });
    });

    // Action menu items
    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const { action, id } = btn.dataset;
        
        if (action === 'view') view(id);
        else if (action === 'print') print(id);
        else if (action === 'deliver') markDelivered(id);
        else if (action === 'whatsapp') _waById(id);
        
        document.querySelectorAll('.act-dropdown.open').forEach(d => d.classList.remove('open'));
      });
    });

    // Checkboxes
    tbody.querySelectorAll('.inv-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? _selected.add(cb.dataset.id) : _selected.delete(cb.dataset.id);
        _bulkBar();
      });
    });
  }

  /* ════════════════════════════════════════════════════════════
     BULK ACTIONS
     ════════════════════════════════════════════════════════════ */

  /**
   * Update bulk action bar visibility and count
   */
  function _bulkBar() {
    const bar = document.getElementById('bulkBar');
    const cnt = document.getElementById('bulkCount');
    if (!bar) return;
    bar.classList.toggle('visible', _selected.size > 0);
    if (cnt) cnt.textContent = `${_selected.size} selected`;
  }

  /**
   * Toggle select all checkboxes
   */
  function _selectAll(checked) {
    _sort(_filter()).forEach(b => {
      checked ? _selected.add(b.id) : _selected.delete(b.id);
    });
    render();
  }

  /**
   * Mark multiple invoices as delivered
   */
  async function bulkDeliver() {
    const ids = [..._selected];
    for (const id of ids) {
      const b = _all.find(x => x.id === id);
      if (b && !b.delivered) {
        b.delivered = true;
        await DB.bookings.save(b).catch(() => {});
      }
    }
    _selected.clear();
    await _load();
    render();
    if (typeof showToast === 'function') {
      showToast(`✅ ${ids.length} marked delivered!`, 'success');
    }
  }

  /**
   * Export selected invoices (placeholder)
   */
  function bulkExport() {
    if (typeof showToast === 'function') {
      showToast('📦 Export coming soon!', 'info');
    }
  }

  /* ════════════════════════════════════════════════════════════
     FILTERING CONTROLS
     ════════════════════════════════════════════════════════════ */

  /**
   * Set sort field and direction
   */
  function _setSort(field) {
    _sortDir = _sortField === field ? (_sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    _sortField = field;
    
    // Update sort icons
    document.querySelectorAll('.inv-table th').forEach(th => {
      th.classList.remove('sorted');
      const ic = th.querySelector('.sort-icon');
      if (ic) ic.textContent = '↕';
    });
    
    const th = document.querySelector(`[data-sort="${field}"]`);
    if (th) {
      th.classList.add('sorted');
      const ic = th.querySelector('.sort-icon');
      if (ic) ic.textContent = _sortDir === 'asc' ? '↑' : '↓';
    }
    
    render();
  }

  /**
   * Toggle date/status chips
   */
  function _setChip(chip) {
    _chip = _chip === chip ? '' : chip;
    document.querySelectorAll('.inv-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.chip === _chip);
    });
    render();
  }

  /* ════════════════════════════════════════════════════════════
     MODAL & PREVIEW
     ════════════════════════════════════════════════════════════ */

  /**
   * View invoice in modal
   */
  function view(id) {
    const b = _all.find(x => x.id === id);
    if (!b) return;
    _current = b;
    const content = document.getElementById('invModalContent');
    const modal = document.getElementById('invModal');
    if (!content || !modal) return;
    content.innerHTML = _buildA4(b);
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close modal
   */
  function closeModal() {
    document.getElementById('invModal')?.classList.remove('open');
    document.body.style.overflow = '';
    _current = null;
  }

  /* ════════════════════════════════════════════════════════════
     PRINT & PDF
     ════════════════════════════════════════════════════════════ */

  /**
   * Open invoice in new window for printing
   */
  function print(id) {
    const b = _all.find(x => x.id === id) || _current;
    if (!b) return;

    const invoiceHTML = _buildA4(b);
    const pw = window.open('', '_blank', 'width=900,height=750');
    if (!pw) return; // Popup blocked
    
    pw.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Invoice ${_esc(b.id)}</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}body{background:#e8edf2;font-family:'Plus Jakarta Sans',sans-serif;display:flex;justify-content:center;padding:32px 16px;}@page{size:A4 portrait;margin:0;}@media print{body{background:white!important;padding:0;margin:0;}.invoice-a4{box-shadow:none!important;width:210mm!important;height:auto!important;min-height:auto!important;page-break-after:always;page-break-inside:avoid;margin:0!important;padding:0!important;}.invoice-a4:last-child{page-break-after:auto;}.inv-header{page-break-inside:avoid;}.inv-body{page-break-inside:auto;}.inv-footer{page-break-inside:avoid;}.inv-tbl thead{display:table-header-group;}.inv-tbl tbody tr{page-break-inside:avoid;}.inv-header,.inv-tbl thead tr,.inv-sum-row.total-row,.inv-footer::before,.inv-footer-inner,.inv-pay-box,.inv-pay-bar-fill{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}.invoice-a4{width:794px;height:auto;min-height:1123px;background:#fff;color:#2c3e50;font-family:'Plus Jakarta Sans',sans-serif;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.22);page-break-after:always;margin-bottom:20px;}.invoice-a4:last-child{page-break-after:auto;margin-bottom:0;}.inv-header{background:linear-gradient(135deg,#1a4a8a 0%,#1e5ba8 50%,#2563eb 100%);padding:32px 44px 64px;position:relative;overflow:hidden;flex-shrink:0;}.inv-header::before{content:'';position:absolute;top:-60px;right:-60px;width:220px;height:220px;background:rgba(255,255,255,0.07);border-radius:50%;}.inv-header::after{content:'';position:absolute;bottom:-2px;left:-5%;width:110%;height:60px;background:#fff;border-radius:50% 50% 0 0/100% 100% 0 0;}.inv-header-inner{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:flex-start;}.inv-logo-row{display:flex;align-items:center;gap:14px;}.inv-logo-circle{width:56px;height:56px;border-radius:14px;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.38);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;color:white;flex-shrink:0;letter-spacing:-1px;}.inv-brand-name{font-weight:800;font-size:21px;color:white;line-height:1.15;}.inv-brand-sub{font-size:11px;color:rgba(255,255,255,0.62);margin-top:4px;font-weight:500;}.inv-title-block{text-align:right;}.inv-title-word{font-size:38px;font-weight:800;color:white;letter-spacing:5px;text-transform:uppercase;line-height:1;}.inv-title-meta{margin-top:12px;font-size:12px;color:rgba(255,255,255,0.7);line-height:2;}.inv-title-meta strong{color:white;font-weight:600;}.inv-body{padding:0 44px 36px;flex:1;}.inv-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:24px 0 20px;border-bottom:1px solid #ecf0f1;}.inv-info-label{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#9eaab8;font-weight:700;margin-bottom:9px;}.inv-info-name{font-weight:700;font-size:15px;color:#1a2332;margin-bottom:6px;}.inv-info-sub{font-size:12px;color:#7f8c8d;line-height:1.75;margin-top:2px;}.inv-pay-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;margin-top:11px;}.inv-pay-badge.paid{background:#d1fae5;color:#065f46;}.inv-pay-badge.partial{background:#fef3c7;color:#92400e;}.inv-pay-badge.unpaid{background:#fee2e2;color:#991b1b;}.inv-pay-badge.overdue{background:#fce7f3;color:#9d174d;}.inv-items{padding:20px 0 0;}.inv-tbl{width:100%;border-collapse:collapse;}.inv-tbl thead tr{background:linear-gradient(90deg,#1a4a8a,#2563eb);-webkit-print-color-adjust:exact;print-color-adjust:exact;}.inv-tbl th{padding:11px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:white;}.inv-tbl th:first-child{border-radius:6px 0 0 6px;}.inv-tbl th:last-child{border-radius:0 6px 6px 0;text-align:right;}.inv-tbl th.tar{text-align:right;}.inv-tbl tbody tr:nth-child(even){background:#f8fafc;}.inv-tbl td{padding:13px 14px;font-size:13px;color:#2c3e50;border-bottom:1px solid #ecf0f1;}.inv-tbl td.tar{text-align:right;font-weight:600;color:#1a2332;}.inv-summary{display:flex;justify-content:flex-end;padding:14px 0 20px;border-bottom:1px solid #ecf0f1;}.inv-sum-table{min-width:270px;}.inv-sum-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;font-size:13px;color:#5a6474;border-bottom:1px solid #f0f2f5;}.inv-sum-row:last-child{border-bottom:none;}.inv-sum-row.total-row{background:linear-gradient(90deg,#1a4a8a,#2563eb);color:white;border-radius:8px;padding:11px 15px;margin-top:7px;font-weight:800;font-size:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.inv-sum-row.total-row span:last-child{font-size:17px;}.inv-payment-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:18px 0;border-bottom:1px solid #ecf0f1;}.inv-pay-info-label{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#9eaab8;font-weight:700;margin-bottom:10px;}.inv-pay-info-row{font-size:12px;color:#7f8c8d;line-height:2;}.inv-pay-info-row strong{color:#1a2332;}.inv-pay-boxes{display:grid;grid-template-columns:1fr 1fr;gap:12px;}.inv-pay-box{border-radius:10px;padding:14px;border-left:3px solid transparent;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.inv-pay-box.green{background:#f0fdf4;border-left-color:#10b981;}.inv-pay-box.red{background:#fff5f5;border-left-color:#ef4444;}.inv-pay-box-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9eaab8;font-weight:700;margin-bottom:6px;}.inv-pay-box-amt{font-size:18px;font-weight:800;line-height:1;}.inv-pay-box-amt.green{color:#10b981;}.inv-pay-box-amt.red{color:#ef4444;}.inv-pay-bar-wrap{margin-top:8px;border-radius:3px;height:4px;overflow:hidden;}.inv-pay-bar-wrap.green{background:#d1fae5;}.inv-pay-bar-wrap.red{background:#fee2e2;}.inv-pay-bar-fill{height:100%;border-radius:3px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.inv-pay-bar-fill.green{background:#10b981;}.inv-pay-bar-fill.red{background:#ef4444;}.inv-pay-box-pct{font-size:10px;margin-top:4px;}.inv-pay-box-pct.green{color:#6ee7b7;}.inv-pay-box-pct.red{color:#fca5a5;}.inv-terms-row{display:flex;justify-content:space-between;align-items:flex-end;padding:18px 0;}.inv-terms-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9eaab8;font-weight:700;margin-bottom:7px;}.inv-terms-text{font-size:11px;color:#7f8c8d;line-height:1.8;max-width:290px;}.inv-sign-area{text-align:right;}.inv-sign-line{width:150px;border-top:1.5px solid #bdc3c7;margin-bottom:7px;margin-left:auto;}.inv-sign-label{font-size:11px;color:#7f8c8d;font-weight:600;}.inv-footer{position:relative;margin-top:auto;flex-shrink:0;}.inv-footer::before{content:'';display:block;height:50px;background:linear-gradient(90deg,#1a4a8a,#2563eb);border-radius:50% 50% 0 0/100% 100% 0 0;margin:0 -5% 0;width:110%;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.inv-footer-inner{background:linear-gradient(90deg,#1a4a8a,#2563eb);color:rgba(255,255,255,0.8);text-align:center;padding:10px 44px 28px;font-size:12px;line-height:1.9;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.inv-footer-inner strong{color:white;display:block;font-size:13.5px;font-weight:700;margin-bottom:3px;}</style></head><body>${invoiceHTML}<script>window.onload=function(){setTimeout(function(){window.print();},600);}<\/script></body></html>`);
    pw.document.close();
  }

  /* ════════════════════════════════════════════════════════════
     WHATSAPP SHARE
     ════════════════════════════════════════════════════════════ */

  /**
   * Find invoice by ID and share on WhatsApp
   */
  function _waById(id) {
    const b = _all.find(x => x.id === id);
    if (b) {
      _current = b;
      shareWhatsApp();
    }
  }

  /**
   * Share invoice details on WhatsApp
   */
  function shareWhatsApp() {
    if (!_current) return;
    
    const b = _current;
    const budget = parseInt(b.budget) || 0;
    const advance = parseInt(b.advance) || 0;
    const due = budget - advance;
    const ps = _payStatus(budget, advance, b.eventDate);
    const evtDate = _fmtDate(b.eventDate);
    
    const msg = encodeURIComponent(
      `📸 *Obito Photography — Invoice*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `*Booking ID:* ${b.id}\n` +
      `*Customer:* ${b.customerName}\n` +
      `*Event:* ${b.eventType} — ${evtDate}\n` +
      (b.venue ? `*Venue:* ${b.venue}${b.city ? ', ' + b.city : ''}\n` : '') +
      `━━━━━━━━━━━━━━━━━━\n` +
      `*Total Amount:* ₹${budget.toLocaleString('en-IN')}\n` +
      `*Advance Paid:* ₹${advance.toLocaleString('en-IN')}\n` +
      `*Balance Due:* ₹${due.toLocaleString('en-IN')}\n` +
      `*Payment Status:* ${ps}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Thank you for choosing Obito Photography! 🙏\n` +
      `Contact: obito@photography.com | +91 98765 00000`
    );
    
    window.open('https://wa.me/?text=' + msg, '_blank');
  }

  /**
   * Mark invoice as delivered
   */
  async function markDelivered(id) {
    const b = _all.find(x => x.id === id);
    if (!b) return;
    
    try {
      b.delivered = true;
      await DB.bookings.save(b);
      await _load();
      render();
      if (typeof showToast === 'function') {
        showToast('✅ Marked as delivered!', 'success');
      }
    } catch (e) {
      console.error('[Invoices] markDelivered failed:', e);
      if (typeof showToast === 'function') {
        showToast('❌ Failed to update.', 'error');
      }
    }
  }

  /* ════════════════════════════════════════════════════════════
     A4 INVOICE BUILDER
     ════════════════════════════════════════════════════════════ */

  /**
   * Build A4 invoice HTML
   */
  function _buildA4(b) {
    const budget = parseInt(b.budget) || 0;
    const advance = parseInt(b.advance) || 0;
    const due = budget - advance;
    const pct = budget > 0 ? Math.round((advance / budget) * 100) : 0;
    const ps = _payStatus(budget, advance, b.eventDate);
    const today = _fmtDate(new Date().toLocaleDateString('en-CA')); // en-CA gives YYYY-MM-DD local
    const evtDate = _fmtDate(b.eventDate);

    const badgeCls = { 'Paid': 'paid', 'Partially Paid': 'partial', 'Unpaid': 'unpaid', 'Overdue': 'overdue' }[ps] || 'unpaid';
    const badgeIco = { 'Paid': '✅', 'Partially Paid': '⏳', 'Unpaid': '🔴', 'Overdue': '⚠️' }[ps] || '●';
    const cName = _esc(b.customerName || 'Customer');
    const evtType = _esc(b.eventType || 'Event');
    const service = _esc(b.service || `${evtType} Photography Package`);

    return `<div class="invoice-a4"><div class="inv-header"><div class="inv-header-inner"><div class="inv-logo-row"><div class="inv-logo-circle">OP</div><div><div class="inv-brand-name">Obito Photography</div><div class="inv-brand-sub">Professional Event Photography</div></div></div><div class="inv-title-block"><div class="inv-title-word">INVOICE</div><div class="inv-title-meta"><strong>Invoice ID:</strong> ${_esc(b.id)}<br><strong>Issued:</strong> ${today}</div></div></div></div><div class="inv-body"><div class="inv-info-grid"><div><div class="inv-info-label">Invoice To</div><div class="inv-info-name">${cName}</div>${b.phone ? `<div class="inv-info-sub">📞 ${_esc(b.phone)}</div>` : ''}${b.email ? `<div class="inv-info-sub">✉️ ${_esc(b.email)}</div>` : ''}${b.address ? `<div class="inv-info-sub">🏠 ${_esc(b.address)}</div>` : ''}<div class="inv-pay-badge ${badgeCls}">${badgeIco} ${_esc(ps)}</div></div><div><div class="inv-info-label">Event Details</div><div class="inv-info-name">${evtType}</div>${b.venue ? `<div class="inv-info-sub">📍 ${_esc(b.venue)}${b.city ? ', ' + _esc(b.city) : ''}</div>` : ''}${b.service ? `<div class="inv-info-sub">📸 ${_esc(b.service)}</div>` : ''}${b.eventTime ? `<div class="inv-info-sub">⏰ ${_esc(b.eventTime)}</div>` : ''}<div class="inv-info-sub">📅 ${evtDate}</div>${b.photographers ? `<div class="inv-info-sub">👥 ${_esc(b.photographers)} Photographer(s)</div>` : ''}${b.eventDuration ? `<div class="inv-info-sub">⏱ ${_esc(b.eventDuration)} Hours</div>` : ''}</div></div><div class="inv-items"><table class="inv-tbl"><thead><tr><th style="width:40px;">SL.</th><th>Item Description</th><th class="tar">Price</th><th class="tar">Qty</th><th class="tar">Total</th></tr></thead><tbody><tr><td style="font-size:12px;font-weight:700;color:#1a4a8a;">01</td><td><div style="font-weight:600;color:#1a2332;">${service}</div>${b.eventType ? `<div style="font-size:11px;color:#7f8c8d;margin-top:3px;">${evtType} Coverage Package</div>` : ''}</td><td class="tar">₹${budget.toLocaleString('en-IN')}</td><td class="tar">1</td><td class="tar">₹${budget.toLocaleString('en-IN')}</td></tr>${b.description ? `<tr><td style="font-size:12px;font-weight:700;color:#1a4a8a;">02</td><td><div style="font-weight:600;color:#1a2332;">Notes</div><div style="font-size:11px;color:#7f8c8d;margin-top:3px;">${_esc(b.description)}</div></td><td class="tar">—</td><td class="tar">—</td><td class="tar">—</td></tr>` : ''}</tbody></table></div><div class="inv-summary"><div class="inv-sum-table"><div class="inv-sum-row"><span>Sub Total:</span><span>₹${budget.toLocaleString('en-IN')}</span></div><div class="inv-sum-row"><span>Tax (0%):</span><span>₹0</span></div><div class="inv-sum-row"><span>Advance Paid:</span><span style="color:#10b981;">− ₹${advance.toLocaleString('en-IN')}</span></div><div class="inv-sum-row total-row"><span>Balance Due:</span><span>₹${due.toLocaleString('en-IN')}</span></div></div></div><div class="inv-payment-grid"><div><div class="inv-pay-info-label">Payment Info</div><div class="inv-pay-info-row">Bank: <strong>Obito Photography</strong><br>UPI: <strong>obito@upi</strong><br>Phone: <strong>+91 98765 00000</strong><br>Email: <strong>obito@photography.com</strong></div></div><div><div class="inv-pay-boxes"><div class="inv-pay-box green"><div class="inv-pay-box-label">Advance Paid</div><div class="inv-pay-box-amt green">₹${advance.toLocaleString('en-IN')}</div><div class="inv-pay-bar-wrap green"><div class="inv-pay-bar-fill green" style="width:${pct}%;"></div></div><div class="inv-pay-box-pct green">${pct}% paid</div></div><div class="inv-pay-box red"><div class="inv-pay-box-label">Balance Due</div><div class="inv-pay-box-amt red">₹${due.toLocaleString('en-IN')}</div><div class="inv-pay-bar-wrap red"><div class="inv-pay-bar-fill red" style="width:${100 - pct}%;"></div></div><div class="inv-pay-box-pct red">${100 - pct}% pending</div></div></div></div></div><div class="inv-terms-row"><div><div class="inv-terms-label">Terms &amp; Conditions</div><div class="inv-terms-text">Payment due within 7 days of event completion.<br>50% advance required to confirm booking.<br>Cancellation policy applies as per agreement.<br>All deliverables subject to final payment clearance.</div></div><div class="inv-sign-area"><div class="inv-sign-line"></div><div class="inv-sign-label">Authorised Signature</div></div></div></div><div class="inv-footer"><div class="inv-footer-inner"><strong>Thank you for choosing Obito Photography! 📸</strong><br>obito@photography.com &nbsp;|&nbsp; +91 98765 00000 &nbsp;|&nbsp; www.obitophoto.com</div></div></div>`;
  }

  /* ════════════════════════════════════════════════════════════
     INITIALIZATION
     ════════════════════════════════════════════════════════════ */

  /**
   * Initialize invoice manager
   */
  async function init() {
    if (!document.getElementById('invTableBody')) return;
    _skeleton();

    try {
      await _load();
      render();

      // Modal close on backdrop click
      document.getElementById('invModal')?.addEventListener('click', e => {
        if (e.target.id === 'invModal') closeModal();
      });

      // Close dropdowns globally
      document.addEventListener('click', () => {
        document.querySelectorAll('.act-dropdown.open').forEach(d => d.classList.remove('open'));
      });

      // Sort headers
      document.querySelectorAll('[data-sort]').forEach(th => {
        th.addEventListener('click', () => _setSort(th.dataset.sort));
      });

      // Chips
      document.querySelectorAll('[data-chip]').forEach(chip => {
        chip.addEventListener('click', () => _setChip(chip.dataset.chip));
      });

      // Select-all
      document.getElementById('selectAll')?.addEventListener('change', e => _selectAll(e.target.checked));

      // Bulk buttons
      document.getElementById('bulkDeliverBtn')?.addEventListener('click', bulkDeliver);
      document.getElementById('bulkExportBtn')?.addEventListener('click', bulkExport);
      document.getElementById('bulkClearBtn')?.addEventListener('click', () => {
        _selected.clear();
        const sa = document.getElementById('selectAll');
        if (sa) sa.checked = false;
        render();
      });

      // URL ?status= param
      const sp = new URLSearchParams(window.location.search).get('status');
      if (sp) {
        const sel = document.getElementById('statusFilter');
        if (sel) {
          sel.value = sp;
          _status = sp;
          render();
        }
      }

      // Re-render on real-time cloud change
      window.addEventListener('supabase:change', async () => {
        await _load();
        render();
      });

    } catch (err) {
      console.error('[Invoices] init failed:', err);
      if (typeof showToast === 'function') {
        showToast('❌ Failed to initialize.', 'error');
      }
    }
  }

  /* ── Public API ── */
  return {
    init,
    render,
    view,
    print,
    markDelivered,
    shareWhatsApp,
    closeModal,
    bulkDeliver,
    bulkExport
  };

})();

/* ── Auto-init on page load ── */
window.addEventListener('load', async () => {
  if (typeof sharedInit === 'function') sharedInit();
  if (typeof DB === 'undefined') {
    console.error('[Invoices] DB not found');
    return;
  }
  try {
    await DB.init();
  } catch (e) {
    console.error('[Invoices] DB.init failed:', e);
    return;
  }
  await Invoices.init();
});
