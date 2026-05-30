/* ═══════════════════════════════════════════════════════════════
   NextTHUxk Local — Config: constants, state, storage, helpers
   ═══════════════════════════════════════════════════════════════ */

var NX = window.NX = {};

// ─── Constants ──────────────────────────────────────────────────
NX.TAG = '[NextTHUxk]';
NX.SP = 'nx_';
NX.ZY_LIMITS = {
  bx: [[1,1],[2,2],[3,Infinity]],
  xx: [[1,1],[2,2],[3,Infinity]],
  rx: [[1,1],[2,2],[3,Infinity]],
  ty: [[1,1],[2,1],[3,Infinity]],
};

// ─── State ──────────────────────────────────────────────────────
NX.state = {
  SEM: '',
  GRADE: 0,
  BASE: '',
  allCourses: [],
  planData: [],
  activeGroup: null,
  stageCart: [],
  savedDrafts: [],
  queueDataMap: {},
  isQueuePhase: false,
  candidateCourses: [],
  previewMode: 'selected',  // 'selected' | 'stage' | 'draft'
  previewDraftIdx: -1,
  expandedDraft: -1,
};

// ─── Helpers ────────────────────────────────────────────────────
NX.esc = function (s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

// ─── Storage (localStorage wrapper) ─────────────────────────────
NX.store = {
  get: function (k) {
    try {
      var v = localStorage.getItem(NX.SP + k);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  },
  set: function (k, v) {
    localStorage.setItem(NX.SP + k, JSON.stringify(v));
  },
};

// ─── Toast ──────────────────────────────────────────────────────
NX.showXkResult = function (res) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.className = res.ok ? 'nx-toast nx-toast-ok' : 'nx-toast nx-toast-err';
  toast.textContent = (res.ok ? '✅ ' : '❌ ') + (res.msg || (res.ok ? '操作成功' : '操作失败'));
  toast.style.display = 'block';
  toast.style.opacity = '1';
  setTimeout(function () {
    toast.style.opacity = '0';
    setTimeout(function () { toast.style.display = 'none'; }, 300);
  }, 2500);
};

NX.showToast = function (msg, type) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.className = 'nx-toast nx-toast-' + (type || 'loading');
  toast.textContent = msg;
  toast.style.display = 'block';
  toast.style.opacity = '1';
};

NX.hideToast = function () {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.style.opacity = '0';
  setTimeout(function () { toast.style.display = 'none'; }, 300);
};
