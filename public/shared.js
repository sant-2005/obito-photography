/* OBITO PHOTOGRAPHY — SHARED JS v3 */

function checkAuth() {
  const ok = sessionStorage.getItem('loggedIn');
  if (!ok) { window.location.replace('admin.html'); return null; }
  return sessionStorage.getItem('username') || 'Admin';
}

function applyUsername(u) {
  u = u || sessionStorage.getItem('username') || 'Admin';
  const cap = u.charAt(0).toUpperCase() + u.slice(1);
  const ini = u.charAt(0).toUpperCase();
  ['userNameDisplay','userName','headerUserName'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = cap;
  });
  ['userAvatarInitials','userInitials'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = ini;
  });
  const da = document.getElementById('dropdownAvatar');
  const dn = document.getElementById('dropdownName');
  if (da) da.textContent = ini;
  if (dn) dn.textContent = cap;
}

function logout() {
  if (confirm('Are you sure you want to logout?')) {
    sessionStorage.removeItem('loggedIn');
    sessionStorage.removeItem('username');
    window.location.href = 'admin.html';
  }
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  if (saved === 'dark') _applyDark(); else _applyLight();
}
function _applyDark()  { document.body.classList.add('dark-mode');    const b=document.getElementById('themeBtn'); if(b) b.textContent='☀️'; }
function _applyLight() { document.body.classList.remove('dark-mode'); const b=document.getElementById('themeBtn'); if(b) b.textContent='🌙'; }
function toggleTheme() {
  const dark = document.body.classList.contains('dark-mode');
  if (dark) { _applyLight(); localStorage.setItem('theme','light'); }
  else      { _applyDark();  localStorage.setItem('theme','dark'); }
  const b = document.getElementById('themeBtn');
  if (b) { b.style.animation='none'; setTimeout(()=>{b.style.animation='rotateIn .5s ease-out';},10); }
}

function updateDateTime() {
  const el = document.getElementById('currentDate');
  if (el) el.textContent = new Date().toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'});
}

function navigateTo(page) {
  const m = document.querySelector('.main-content');
  if (m) { m.style.opacity='0.5'; m.style.transform='scale(0.99)'; }
  setTimeout(() => { window.location.href = page; }, 200);
}

let _tTimer;
function showToast(msg, type='info', ms=3400) {
  let t = document.getElementById('globalToast');
  if (!t) { t=document.createElement('div'); t.id='globalToast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(_tTimer);
  _tTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function formatINR(n) {
  n = parseInt(n) || 0;
  if (n >= 10000000) return '₹' + (n/10000000).toFixed(2) + ' Cr';
  if (n >= 100000)   return '₹' + (n/100000).toFixed(2) + ' L';
  if (n >= 1000)     return '₹' + (n/1000).toFixed(1) + 'K';
  return '₹' + n.toLocaleString('en-IN');
}

function initUserDropdown() {
  const btn = document.getElementById('userBtn');
  const dd  = document.getElementById('userDropdown');
  if (!btn || !dd) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    dd.classList.toggle('open');
    btn.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!btn.contains(e.target)) {
      dd.classList.remove('open');
      btn.classList.remove('open');
    }
  });
}

function markSidebar() {
  const page = window.location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.sidebar-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

function sharedInit() {
  initTheme();
  updateDateTime();
  setInterval(updateDateTime, 30000);
  const u = checkAuth();
  if (u) applyUsername(u);
  initUserDropdown();
  markSidebar();
  const tb = document.getElementById('themeBtn');
  if (tb) tb.addEventListener('click', toggleTheme);
  document.querySelectorAll('[data-action="logout"]').forEach(el => el.addEventListener('click', logout));
}

window.sharedInit    = sharedInit;
window.navigateTo    = navigateTo;
window.logout        = logout;
window.showToast     = showToast;
window.formatINR     = formatINR;
window.applyUsername = applyUsername;
window.checkAuth     = checkAuth;
