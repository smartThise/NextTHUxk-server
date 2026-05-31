/* ═══════════════════════════════════════════════════════════════
   NextTHUxk Local — App: entry point, launch flow, event bindings
   (mirrors extension content.js, adapted for local server)
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Welcome Screen (askSem — replaces prompt) ────────────────

  function askSem() {
    return new Promise(function (resolve) {
      var el = document.getElementById('list');
      if (!el) { resolve({ sem: '', grade: 0 }); return; }
      var now = new Date();
      var y = now.getFullYear();
      var m = now.getMonth() + 1;
      var defSem = y + '-' + (y + 1) + '-' + (m >= 2 && m <= 7 ? '2' : '1');
      el.innerHTML = '<div class="nx-welcome">' +
        '<div class="nx-welcome-card">' +
          '<div class="nx-welcome-icon">📚</div>' +
          '<div class="nx-welcome-title">欢迎使用 NextTHUxk</div>' +
          '<div class="nx-welcome-sub">请设置当前学期与年级</div>' +
          '<div class="nx-welcome-field">' +
            '<label>📅 学期</label>' +
            '<input type="text" id="sem-input" value="' + defSem + '">' +
          '</div>' +
          '<div class="nx-welcome-field">' +
            '<label>🎓 年级（仅影响 AI 对体育课的推荐，不影响其他功能）</label>' +
            '<select id="grade-input">' +
              '<option value="1">大一</option>' +
              '<option value="2">大二</option>' +
              '<option value="3">大三</option>' +
              '<option value="4">大四</option>' +
              '<option value="5">大五</option>' +
              '<option value="0">研究生 / 其他</option>' +
            '</select>' +
          '</div>' +
          '<button id="sem-go" class="nx-welcome-btn">🚀 开始加载</button>' +
        '</div></div>';
      document.getElementById('sem-go').onclick = function () {
        var v = (document.getElementById('sem-input').value || '').trim();
        var g = parseInt(document.getElementById('grade-input').value) || 0;
        resolve({ sem: v || '', grade: g });
      };
      document.getElementById('sem-input').onkeydown = function (e) {
        if (e.key === 'Enter') document.getElementById('sem-go').click();
      };
      document.getElementById('sem-input').focus();
    });
  }

  // ─── Launch ───────────────────────────────────────────────────

  NX.launch = async function (forceRefresh) {
    var state = NX.state;

    // Resolve semester
    if (!state.SEM) { state.SEM = NX.store.get('sem') || ''; }
    if (!state.SEM) {
      var semInfo = await askSem();
      state.SEM = semInfo.sem;
      state.GRADE = semInfo.grade;
    }
    if (!state.SEM) { document.getElementById('list').innerHTML = '<div class="nx-empty">需要输入学期</div>'; return; }
    NX.store.set('sem', state.SEM);

    // Resolve grade
    if (!state.GRADE) { state.GRADE = NX.store.get('grade') || 0; }
    NX.store.set('grade', state.GRADE);

    var semBtn = document.getElementById('sem-btn');
    if (semBtn) semBtn.textContent = state.SEM;
    var gradeBtn = document.getElementById('grade-btn');
    if (gradeBtn) gradeBtn.textContent = state.GRADE ? ['', '大一', '大二', '大三', '大四', '大五'][state.GRADE] || '研' : '未设置';

    var listEl = document.getElementById('list');
    listEl.innerHTML = '<div class="nx-empty"><span class="nx-spin"></span>&ensp;正在获取数据…</div>';

    try {
      var t0 = Date.now();

      // 1. Check localStorage cache (extension-style staticData)
      var coursesCache = forceRefresh ? null : NX.store.get('coursesCache');
      var needFetch = !coursesCache || coursesCache.sem !== state.SEM || !coursesCache.courses || !coursesCache.courses.length;

      var plan, catalog, volData, selectedForZy;
      if (needFetch) {
        // Full fetch: get everything from server
        var d = await NX.fetchInitData(state.SEM, !!forceRefresh);
        plan = d.plan; catalog = d.catalog; volData = d.volunteer;
        state.queueDataMap = d.queueMap;
        state.isQueuePhase = d.queuePhase;
        state.candidateCourses = d.candidates;
        state.allCourses = NX.mergeStaticData(catalog, volData, plan);
        NX.store.set('coursesCache', { sem: state.SEM, courses: state.allCourses, plan: plan, ts: Date.now() });
        var selectedForZy = d.selected;
      } else {
        // Cache hit: use cached courses, fetch only per-user data
        console.log('[NextTHUxk] using cached', coursesCache.courses.length, 'courses');
        state.allCourses = coursesCache.courses;
        // Deduplicate in case cache was saved before dedup was added
        var dedup = {};
        state.allCourses = state.allCourses.filter(function (c) {
          var k = c.code + '_' + (c.seq || '0');
          if (dedup[k]) return false;
          dedup[k] = true;
          return true;
        });
        if (dedup) { /* just referenced */ }
        // Update cache if duplicates were removed
        if (state.allCourses.length !== coursesCache.courses.length) {
          NX.store.set('coursesCache', { sem: state.SEM, courses: state.allCourses, plan: coursesCache.plan, ts: coursesCache.ts });
        }
        plan = coursesCache.plan || [];
        var q = await NX.fetchQueue(state.SEM).catch(function () { return { map: {}, phase: false }; });
        state.queueDataMap = q.map;
        state.isQueuePhase = q.phase;
        state.candidateCourses = await NX.fetchCandidates(state.SEM).catch(function () { return []; });
        var selectedForZy = await NX.fetchSelected(state.SEM).catch(function () { return []; });
      }
      state.planData = plan;

      // 2. Mark candidate courses
      if (state.candidateCourses.length) {
        var candCodes = new Set(state.candidateCourses.map(function (c) { return c.code; }));
        state.allCourses.forEach(function (c) { if (candCodes.has(c.code)) c.isCandidate = true; });
      }

      // 3. Resolve ZY
      var selMap = {};
      selectedForZy.forEach(function (s) { selMap[s.code + '_' + (s.seq || '0')] = s; });
      var zyCache = NX.store.get('zyCache') || {};
      var cacheUpdated = await NX.resolveCourseZy(state.allCourses, selMap, zyCache);
      if (cacheUpdated) NX.store.set('zyCache', zyCache);

      // 5. Load stage & drafts from localStorage
      state.stageCart = NX.store.get('stageCart') || [];
      state.savedDrafts = NX.store.get('drafts') || [];

      // Migrate old data without baseFlag
      var migrated = false;
      state.stageCart.forEach(function (c) {
        if (!c.baseFlag) { var ac = state.allCourses.find(function (x) { return x.code === c.code; }); c.baseFlag = ac ? NX.baseFlag(ac) : 'rx'; migrated = true; }
      });
      state.savedDrafts.forEach(function (d) {
        d.courses.forEach(function (c) {
          if (!c.baseFlag) { var ac = state.allCourses.find(function (x) { return x.code === c.code; }); c.baseFlag = ac ? NX.baseFlag(ac) : 'rx'; migrated = true; }
        });
      });
      if (migrated) { NX.store.set('stageCart', state.stageCart); NX.store.set('drafts', state.savedDrafts); }

      // 6. Render all
      NX.renderCourses(state.allCourses);
      NX.renderPlan(plan);
      NX.renderPreviewTT(
        state.allCourses.filter(function (c) { return c.selected; }).concat(
          state.candidateCourses.filter(function (cc) { return !state.allCourses.some(function (ac) { return ac.selected && ac.code === cc.code && String(ac.seq || '0') === String(cc.seq || '0'); }); })
        ),
        '当前已选'
      );
      NX.renderStageCart();
      NX.renderDrafts();

      // 7. Cache info
      var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      var cacheEl = document.getElementById('cache-info');
      if (cacheEl) {
        cacheEl.textContent = elapsed + 's · ' + state.allCourses.length + '门';
      }

      // 8. Phase tag
      var phaseTag = document.getElementById('phase-tag');
      if (phaseTag) {
        if (state.isQueuePhase) { phaseTag.style.display = 'inline'; phaseTag.textContent = '📊 课余量模式'; }
        else { phaseTag.style.display = 'none'; }
      }
      var qRefreshBtn = document.getElementById('refresh-queue-btn');
      if (qRefreshBtn) qRefreshBtn.style.display = (state.isQueuePhase || state.candidateCourses.length) ? 'inline-block' : 'none';

      // 9. Load AI config
      var cfg = NX.store.get('config');
      if (cfg) {
        if (cfg.api) document.getElementById('ai-api').value = cfg.api;
        if (cfg.model) document.getElementById('ai-model').value = cfg.model;
        if (cfg.token) document.getElementById('ai-token').value = cfg.token;
        if (cfg.pref) document.getElementById('ai-pref').value = cfg.pref;
      }

      console.log('[NextTHUxk] loaded', state.allCourses.length, 'courses,', selectedForZy.length, 'selected');
    } catch (e) {
      if (e.message && e.message.includes('请先登录')) { location.href = '/'; return; }
      listEl.innerHTML = '<div class="nx-empty nx-st err">❌ ' + NX.esc(e.message) + '</div>';
    }
  };

  // ─── Event Bindings ───────────────────────────────────────────

  // Filter chips
  document.querySelectorAll('.nx-chip').forEach(function (chip) {
    chip.onclick = function () {
      document.querySelectorAll('.nx-chip').forEach(function (c) { c.classList.remove('on'); });
      chip.classList.add('on');
      NX.filterCourses();
    };
  });

  // Search
  document.getElementById('search').oninput = function () {
    NX.updateSearchClear();
    NX.filterCourses();
  };
  document.getElementById('search-clear').onclick = function () {
    document.getElementById('search').value = '';
    NX.filterCourses();
    document.getElementById('search').focus();
  };

  // Filter selects
  ['f-conflict', 'f-credits', 'f-day', 'f-period', 'f-tongshi', 'f-feature', 'f-grade', 'f-bksrem', 'f-yjsrem'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.onchange = NX.filterCourses;
  });
  var xkNoteEl = document.getElementById('f-xknote');
  if (xkNoteEl) xkNoteEl.oninput = NX.filterCourses;

  // Buttons
  document.getElementById('refresh-btn').onclick = function () { NX.launch(true); };
  document.getElementById('refresh-queue-btn').onclick = async function () {
    var btn = document.getElementById('refresh-queue-btn');
    if (btn) { btn.textContent = '⏳ 刷新中...'; btn.disabled = true; }
    var qResult = await NX.fetchQueue(NX.state.SEM);
    NX.state.queueDataMap = qResult.map;
    NX.state.isQueuePhase = qResult.phase;
    NX.state.candidateCourses = await NX.fetchCandidates(NX.state.SEM);
    var candKeys = new Set(NX.state.candidateCourses.map(function (c) { return c.code + '_' + (c.seq || '0'); }));
    NX.state.allCourses.forEach(function (c) { c.isCandidate = candKeys.has(c.code + '_' + (c.seq || '0')); });
    NX.filterCourses();
    NX.renderPreviewTT(
      NX.state.allCourses.filter(function (c) { return c.selected; }).concat(
        NX.state.candidateCourses.filter(function (cc) { return !NX.state.allCourses.some(function (ac) { return ac.selected && ac.code === cc.code && String(ac.seq || '0') === String(cc.seq || '0'); }); })
      ),
      '当前已选'
    );
    if (btn) { btn.textContent = '📊 刷新队列'; btn.disabled = false; }
    NX.showXkResult({ ok: true, msg: '队列数据已刷新 · ' + Object.keys(NX.state.queueDataMap).length + '门课余量 · ' + NX.state.candidateCourses.length + '门我的队列' });
  };

  document.getElementById('sem-btn').onclick = async function () {
    var si = await askSem();
    if (si.sem) {
      NX.state.SEM = si.sem;
      NX.state.GRADE = si.grade;
      NX.store.set('sem', NX.state.SEM);
      NX.store.set('grade', NX.state.GRADE);
      document.getElementById('sem-btn').textContent = NX.state.SEM;
      var gradeBtn = document.getElementById('grade-btn');
      if (gradeBtn) gradeBtn.textContent = NX.state.GRADE ? ['', '大一', '大二', '大三', '大四', '大五'][NX.state.GRADE] || '研' : '未设置';
      NX.launch(true);
    }
  };

  // Grade button
  document.getElementById('grade-btn').onclick = function () {
    var g = prompt('修改年级（仅影响 AI 对体育课的推荐，不影响其他功能）\n\n1=大一 2=大二 3=大三 4=大四 5=大五 0=研究生：', String(NX.state.GRADE));
    if (g) {
      NX.state.GRADE = Math.max(0, Math.min(5, parseInt(g) || 0));
      NX.store.set('grade', NX.state.GRADE);
      document.getElementById('grade-btn').textContent = NX.state.GRADE ? ['', '大一', '大二', '大三', '大四', '大五'][NX.state.GRADE] || '研' : '未设置';
    }
  };

  // AI
  document.getElementById('ai-search-btn').onclick = NX.aiSearch;
  document.getElementById('ai-btn').onclick = NX.callAI;

  // Draft actions
  document.getElementById('save-draft').onclick = NX.saveDraft;
  document.getElementById('save-selected').onclick = NX.saveSelectedAsDraft;
  document.getElementById('export-btn').onclick = NX.exportStageCart;

  document.getElementById('preview-stage-btn').onclick = function () {
    if (!NX.state.stageCart.length) { NX.showXkResult({ ok: false, msg: '暂存区没有课程' }); return; }
    NX.state.previewMode = 'stage';
    NX.renderPreviewTT(NX.state.stageCart, '暂存区预览');
  };

  document.getElementById('import-btn').onclick = function () {
    var area = document.getElementById('import-area');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
  };
  document.getElementById('import-ok').onclick = function () {
    var data = document.getElementById('import-data').value;
    if (!data) return;
    NX.importToStage(data);
    document.getElementById('import-area').style.display = 'none';
    document.getElementById('import-data').value = '';
  };
  document.getElementById('import-cancel').onclick = function () {
    document.getElementById('import-area').style.display = 'none';
  };

  document.getElementById('preview-reset').onclick = function () {
    NX.renderPreviewTT(
      NX.state.allCourses.filter(function (c) { return c.selected; }).concat(
        NX.state.candidateCourses.filter(function (cc) { return !NX.state.allCourses.some(function (ac) { return ac.selected && ac.code === cc.code && String(ac.seq || '0') === String(cc.seq || '0'); }); })
      ),
      '当前已选'
    );
  };

  // Modal
  document.getElementById('modal-close').onclick = function () { document.getElementById('modal').classList.remove('show'); };
  document.getElementById('modal').onclick = function (e) { if (e.target === document.getElementById('modal')) document.getElementById('modal').classList.remove('show'); };

  // ZY Modal
  document.getElementById('zy-modal').onclick = function (e) { if (e.target === document.getElementById('zy-modal')) document.getElementById('zy-modal').classList.remove('show'); };

  // ─── Start ────────────────────────────────────────────────────
  NX.launch();

  console.log('[NextTHUxk] ready');
})();
