/* ═══════════════════════════════════════════════════════════════
   NextTHUxk Local — Render: all rendering functions
   (mirrors extension render.js, adapted for local server DOM IDs)
   ═══════════════════════════════════════════════════════════════ */

var NX = NX || {};

// ─── Course Card Rendering ──────────────────────────────────────

NX.renderCourses = function (list) {
  var state = NX.state;
  var el = document.getElementById('list');
  if (!list.length) { el.innerHTML = '<div class="nx-empty">暂无匹配课程</div>'; return; }

  el.innerHTML = list.map(function (c) {
    // Tags
    var tags = [];
    if (c.available) tags.push('<span class="nx-tag nx-tag-ok">可选</span>');
    else tags.push('<span class="nx-tag nx-tag-no">已满</span>');
    if (c.selected) tags.push('<span class="nx-tag nx-tag-sel">已选</span>');
    if (c.attr === '必修') tags.push('<span class="nx-tag nx-tag-req">必修</span>');
    else if (c.attr === '限选') tags.push('<span class="nx-tag nx-tag-ele">限选</span>');
    else if (c.attr === '任选') tags.push('<span class="nx-tag nx-tag-opt">任选</span>');
    if (c.teacher) tags.push('<span class="nx-tag">' + NX.esc(c.teacher) + '</span>');
    if (c.time) tags.push('<span class="nx-tag">' + NX.esc(c.time) + '</span>');
    if (c.department) tags.push('<span class="nx-tag">' + NX.esc(c.department) + '</span>');

    // Volunteer display
    var vc = NX.volColor(c);
    var volParts = [];
    var isTy = NX.isSportsCourse(c);
    if (isTy && c.volSports && c.volSports !== '0,0,0') {
      var s = NX.fmtVol(c.volSports); if (s) volParts.push('<span>体 ' + s + '</span>');
    } else {
      if (c.volRequired && c.volRequired !== '0,0,0') { var s = NX.fmtVol(c.volRequired); if (s) volParts.push('<span>必 ' + s + '</span>'); }
      if (c.volElective && c.volElective !== '0,0,0') { var s = NX.fmtVol(c.volElective); if (s) volParts.push('<span>限 ' + s + '</span>'); }
      if (c.volOptional && c.volOptional !== '0,0,0') { var s = NX.fmtVol(c.volOptional); if (s) volParts.push('<span>任 ' + s + '</span>'); }
    }
    var volHtml = volParts.length ? '<div class="nx-vol">' + volParts.join('') + '</div>' : '';

    // Competition bar
    var defFlag = NX.baseFlag(c);
    var volApplied = c.volApplied || 0;
    var volCap = c.volCapacity || c.capacity || 0;
    var compLabel = vc.level === 'easy' ? '竞争宽松' : vc.level === 'medium' ? '竞争适中' : vc.level === 'hard' ? '竞争激烈' : '';
    var compHtml = volCap > 0 ? '<div class="nx-comp"><div class="nx-comp-bar" style="width:' + vc.pct + '%;background:' + vc.color + '"></div><span class="nx-comp-txt" style="color:' + vc.color + '">' + volApplied + '/' + volCap + ' · ' + compLabel + '</span></div>' : '';

    // Probability
    var currentFlag = c.selected ? NX.typeCodeToFlag(c.typeCode) : defFlag;
    var currentZy = c.selected ? (c.zy || 3) : 3;
    var currentProbHtml = NX.currentProbLine(c, currentFlag, currentZy);
    var probHtml = NX.fullProbGrid(c, defFlag);

    // Queue info
    var qKey = c.code + '_' + (c.seq || '0');
    var qd = state.queueDataMap[qKey];
    var cand = state.candidateCourses.find(function (cc) { return cc.code === c.code && String(cc.seq) === String(c.seq || '0'); });
    var queueInfoHtml = '';
    if (state.isQueuePhase && (qd || cand)) {
      if (cand) {
        queueInfoHtml = '<div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          '<span style="background:rgba(255,149,0,.12);color:#ff9500;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">排队第' + cand.myPos + '名</span>' +
          '<span style="background:rgba(142,142,147,.1);color:#86868b;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">共' + cand.queueTotal + '人排队</span>' +
          (qd ? '<span style="background:rgba(' + (qd.qRemaining > 0 ? '52,199,89' : '255,59,48') + ',.12);color:' + (qd.qRemaining > 0 ? '#34c759' : '#ff3b30') + ';padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">余' + qd.qRemaining + '/' + qd.qCapacity + '</span>' : '') +
          '<span style="font-size:10px;font-weight:700;color:#ff9500">' + cand.typeLabel + ' · 第' + cand.zy + '志愿</span></div>';
      } else if (qd) {
        var rc = qd.qRemaining > 0 ? '#34c759' : '#ff3b30';
        var rl = qd.qRemaining > 0 ? '余' + qd.qRemaining + '/' + qd.qCapacity : '已满(容量' + qd.qCapacity + ')';
        var hope = qd.qRemaining > 0 ? '排入希望：高' : qd.qQueue > 0 ? '排入希望：低(队' + qd.qQueue + '人)' : '暂无排队';
        var hc = qd.qRemaining > 0 ? '#34c759' : qd.qQueue > 0 ? '#ff9500' : '#86868b';
        queueInfoHtml = '<div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          '<span style="background:rgba(' + (qd.qRemaining > 0 ? '52,199,89' : '255,59,48') + ',.12);color:' + rc + ';padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">' + rl + '</span>' +
          (qd.qQueue > 0 ? '<span style="background:rgba(255,149,0,.12);color:#ff9500;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">排队 ' + qd.qQueue + '人</span>' : '') +
          '<span style="font-size:10px;font-weight:700;color:' + hc + '">' + hope + '</span></div>';
      }
    }

    // Conflicts
    var pConflicts = NX.findPreviewConflicts(c);
    var conflictHtml = pConflicts.length
      ? '<div style="font-size:10px;color:#ff3b30;margin-top:3px;display:flex;gap:4px;align-items:center;flex-wrap:wrap"><span>⚠ 冲突:</span>' +
        pConflicts.slice(0, 3).map(function (cf) { return '<span style="background:rgba(255,59,48,.1);padding:1px 6px;border-radius:4px">' + cf.day + cf.slot + ' ' + NX.esc(cf.name) + '</span>'; }).join('') +
        '</div>' : '';

    var detail = [c.capacity ? '容量' + c.capacity : '', c.remaining !== undefined ? '余' + c.remaining : ''].filter(Boolean).join(' · ');

    // Action buttons
    var selectBtn;
    if (c.selected) {
      var volLabel = c.zy ? '<span class="nx-vol-info">第' + c.zy + '志愿 · ' + NX.esc(c.typeLabel || '') + '</span>' : '';
      var p = NX.currentProbMeta(c, currentFlag, currentZy);
      var probInline = state.isQueuePhase && (qd || cand)
        ? '<span class="nx-inline-prob" style="color:' + (cand ? '#ff9500' : qd && qd.qRemaining > 0 ? '#34c759' : '#ff3b30') + '">' + (cand ? '排队第' + cand.myPos + '名' : qd && qd.qRemaining > 0 ? '余' + qd.qRemaining : '已满') + '</span>'
        : '<span class="nx-inline-prob nx-card-inline-prob" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '" style="color:' + p.color + '">' + (p.percentLabel || p.label) + '</span>';
      var canUp = c.zy && c.zy > 1 && NX.canAdjustZy(c.code, c.seq || '0', c.zy - 1);
      var canDown = c.zy && c.zy < 3 && NX.canAdjustZy(c.code, c.seq || '0', c.zy + 1);
      var upBtn = canUp ? '<button class="nx-vol-btn" data-dir="up" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '" data-zy="' + c.zy + '">▲</button>' : (c.zy > 1 ? '<button class="nx-vol-btn" disabled title="该志愿名额已满">▲</button>' : '');
      var downBtn = canDown ? '<button class="nx-vol-btn" data-dir="down" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '" data-zy="' + c.zy + '">▼</button>' : (c.zy < 3 ? '<button class="nx-vol-btn" disabled title="该志愿名额已满">▼</button>' : '');
      var sFlag = NX.typeCodeToFlag(c.typeCode);
      var inStage = state.stageCart.some(function (s) { return s.code === c.code && String(s.seq) === String(c.seq || '0'); });
      selectBtn = volLabel + probInline + upBtn + downBtn +
        '<button class="nx-stage-btn nx-add-stage-sel" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '" data-flag="' + sFlag + '" data-zy="' + (c.zy || 3) + '"' + (inStage ? ' disabled' : '') + '>' + (inStage ? '已暂存' : '暂存') + '</button>' +
        '<button class="nx-drop-btn" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '">退选</button>';
    } else if (c.available) {
      var inStage = state.stageCart.some(function (s) { return s.code === c.code && String(s.seq) === String(c.seq || '0'); });
      var aFlags = NX.allowedFlags(defFlag);
      var flagOpts = aFlags.map(function (f) { return '<option value="' + f + '"' + (defFlag === f ? ' selected' : '') + '>' + NX.flagName(f) + '</option>'; }).join('');
      var p = NX.currentProbMeta(c, currentFlag, currentZy);
      var probInline = state.isQueuePhase && (qd || cand)
        ? '<span class="nx-inline-prob" style="color:' + (cand ? '#ff9500' : qd && qd.qRemaining > 0 ? '#34c759' : '#ff3b30') + '">' + (cand ? '排队第' + cand.myPos + '名' : qd && qd.qRemaining > 0 ? '余' + qd.qRemaining : '已满') + '</span>'
        : '<span class="nx-inline-prob nx-card-inline-prob" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '" style="color:' + p.color + '">' + (p.percentLabel || p.label) + '</span>';
      selectBtn = '<select class="nx-type-select" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '">' + flagOpts + '</select>' +
        '<select class="nx-zy-select" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '"><option value="3">3志愿</option><option value="2">2志愿</option><option value="1">1志愿</option></select>' +
        probInline +
        '<button class="nx-select-btn" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '">选课</button>' +
        '<button class="nx-stage-btn nx-add-stage" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '"' + (inStage ? ' disabled' : '') + '>' + (inStage ? '已暂存' : '暂存') + '</button>';
    } else if (c.isCandidate && cand) {
      selectBtn = '<span style="font-size:11px;color:#ff9500;font-weight:600">排队第' + cand.myPos + '名 / 共' + cand.queueTotal + '人</span>' +
        '<button class="nx-drop-btn" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '">删除</button>';
    } else {
      var inStage = state.stageCart.some(function (s) { return s.code === c.code && String(s.seq) === String(c.seq || '0'); });
      var aFlags = NX.allowedFlags(defFlag);
      var flagOpts = aFlags.map(function (f) { return '<option value="' + f + '"' + (defFlag === f ? ' selected' : '') + '>' + NX.flagName(f) + '</option>'; }).join('');
      var p = NX.currentProbMeta(c, currentFlag, currentZy);
      var probInline = state.isQueuePhase && (qd || cand)
        ? '<span class="nx-inline-prob" style="color:' + (cand ? '#ff9500' : qd && qd.qRemaining > 0 ? '#34c759' : '#ff3b30') + '">' + (cand ? '排队第' + cand.myPos + '名' : qd && qd.qRemaining > 0 ? '余' + qd.qRemaining : '已满') + '</span>'
        : '<span class="nx-inline-prob nx-card-inline-prob" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '" style="color:' + p.color + '">' + (p.percentLabel || p.label) + '</span>';
      selectBtn = '<span style="font-size:10px;color:#ff3b30;font-weight:600;margin-right:2px">⚠ 已满</span>' +
        '<select class="nx-type-select" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '">' + flagOpts + '</select>' +
        '<select class="nx-zy-select" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '"><option value="3">3志愿</option><option value="2">2志愿</option><option value="1">1志愿</option></select>' +
        probInline +
        '<button class="nx-select-btn" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '" style="background:linear-gradient(135deg,#ff9500,#f59e0b)">排队选课</button>' +
        '<button class="nx-stage-btn nx-add-stage" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '"' + (inStage ? ' disabled' : '') + '>' + (inStage ? '已暂存' : '暂存') + '</button>';
    }

    return '<div class="nx-card' + (c.selected ? ' nx-selected' : '') + '" data-code="' + NX.esc(c.code) + '" data-tid="' + NX.esc(c.teacherId || '') + '">' +
      '<div class="nx-card-head"><span class="nx-card-name">' + NX.esc(c.name) + '</span><span class="nx-card-credit">' + c.credits + '学分</span></div>' +
      '<div style="font-size:11px;color:#86868b;margin-bottom:3px">' + NX.esc(c.code) + (c.seq ? ' · ' + NX.esc(c.seq) + '课序' : '') + '</div>' +
      '<div class="nx-tags">' + tags.join('') + '</div>' +
      (state.isQueuePhase && (qd || cand) ? queueInfoHtml : volHtml + compHtml + currentProbHtml + probHtml) +
      conflictHtml +
      '<div class="nx-card-detail"><div class="nx-card-detail-inner">' + detail + '</div></div>' +
      '<div class="nx-card-actions">' +
      '<button class="nx-detail-btn" data-code="' + NX.esc(c.code) + '" data-tid="' + NX.esc(c.teacherId || '') + '">📄 简介</button>' +
      selectBtn + '</div></div>';
  }).join('');

  // Bind events
  el.querySelectorAll('.nx-card').forEach(function (card) {
    card.onclick = function () { card.classList.toggle('open'); };
  });
  el.querySelectorAll('.nx-detail-btn').forEach(function (btn) {
    btn.onclick = function (e) { e.stopPropagation(); NX.showCourseModal(btn.dataset.code, btn.dataset.tid); };
  });

  // Sync probability on flag/zy change
  var syncCardProb = function (node) {
    var card = node.closest('.nx-card');
    if (!card) return;
    var code = card.dataset.code;
    var course = NX.state.allCourses.find(function (x) { return x.code === code && String(x.seq || '0') === String(node.dataset.seq || '0'); });
    if (!course || course.selected) return;
    var flag = card.querySelector('.nx-type-select') ? card.querySelector('.nx-type-select').value : NX.baseFlag(course);
    var zy = parseInt(card.querySelector('.nx-zy-select') ? card.querySelector('.nx-zy-select').value : 3) || 3;
    var meta = NX.currentProbMeta(course, flag, zy);
    var line = card.querySelector('.nx-current-prob');
    if (line) {
      line.dataset.flag = flag;
      line.dataset.zy = String(zy);
      var pill = line.querySelector('.nx-prob-pill');
      if (pill) {
        var detail = meta.ratioLabel && meta.ratioLabel !== '无数据' ? ' · ' + meta.ratioLabel : '';
        pill.textContent = meta.flagLabel + ' · ' + meta.zy + '志愿 · ' + (meta.percentLabel || meta.label) + detail;
        pill.style.background = meta.bg;
        pill.style.color = meta.color;
        if (meta.prob < 0) pill.classList.add('nx-prob-pill-muted');
        else pill.classList.remove('nx-prob-pill-muted');
      }
    }
    var inline = card.querySelector('.nx-card-inline-prob');
    if (inline) {
      inline.textContent = meta.percentLabel || meta.label;
      inline.style.color = meta.color;
    }
  };

  el.querySelectorAll('.nx-type-select,.nx-zy-select').forEach(function (sel) {
    sel.onchange = function (e) { e.stopPropagation(); syncCardProb(sel); };
  });

  el.querySelectorAll('.nx-select-btn').forEach(function (btn) {
    btn.onclick = async function (e) {
      e.stopPropagation();
      var actions = btn.parentElement;
      var flag = actions.querySelector('.nx-type-select') ? actions.querySelector('.nx-type-select').value : 'bx';
      var zy = actions.querySelector('.nx-zy-select') ? actions.querySelector('.nx-zy-select').value : '3';
      var orig = btn.textContent;
      btn.disabled = true; btn.textContent = '提交中…';
      try {
        var res = await NX.submitCourse(NX.state.SEM, btn.dataset.code, btn.dataset.seq, parseInt(zy), flag);
        NX.showXkResult(res);
        if (res.ok) await NX.refreshSelected();
      } catch (e) { NX.showXkResult({ ok: false, msg: e.message }); }
      finally { btn.disabled = false; btn.textContent = orig; }
    };
  });

  el.querySelectorAll('.nx-drop-btn').forEach(function (btn) {
    btn.onclick = async function (e) {
      e.stopPropagation();
      var orig = btn.textContent;
      btn.disabled = true; btn.textContent = orig.includes('删除') ? '退出中…' : '退选中…';
      try {
        var isQ = !!NX.state.candidateCourses.find(function (c) { return c.code === btn.dataset.code && String(c.seq) === btn.dataset.seq; });
        var res = await NX.dropCourse(NX.state.SEM, btn.dataset.code, btn.dataset.seq, isQ);
        NX.showXkResult(res);
        if (res.ok) await NX.refreshSelected();
      } catch (e) { NX.showXkResult({ ok: false, msg: e.message }); }
      finally { btn.disabled = false; btn.textContent = orig; }
    };
  });

  el.querySelectorAll('.nx-vol-btn').forEach(function (btn) {
    btn.onclick = async function (e) {
      e.stopPropagation();
      var curZy = parseInt(btn.dataset.zy) || 1;
      var dir = btn.dataset.dir;
      var targetZy = dir === 'up' ? curZy - 1 : curZy + 1;
      if (targetZy < 1) return;
      btn.disabled = true;
      try {
        var res = await NX.changeVolunteer(NX.state.SEM, btn.dataset.code, btn.dataset.seq, targetZy);
        NX.showXkResult(res);
        if (res.ok) await NX.refreshSelected();
      } catch (e) { NX.showXkResult({ ok: false, msg: e.message }); }
      finally { btn.disabled = false; }
    };
  });

  el.querySelectorAll('.nx-add-stage').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      var actions = btn.parentElement;
      var flag = actions.querySelector('.nx-type-select') ? actions.querySelector('.nx-type-select').value : 'bx';
      var zy = parseInt(actions.querySelector('.nx-zy-select') ? actions.querySelector('.nx-zy-select').value : 3) || 3;
      NX.addToStage(btn.dataset.code, btn.dataset.seq, flag, zy);
      btn.textContent = '已暂存'; btn.disabled = true;
    };
  });

  el.querySelectorAll('.nx-add-stage-sel').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      NX.addToStage(btn.dataset.code, btn.dataset.seq, btn.dataset.flag || 'bx', parseInt(btn.dataset.zy) || 3);
      btn.textContent = '已暂存'; btn.disabled = true;
    };
  });
};

// ─── Timetable Preview ──────────────────────────────────────────

NX.renderPreviewTT = function (courses, label) {
  var state = NX.state;
  var el = document.getElementById('preview-tt');
  var info = document.getElementById('preview-info');
  var resetBtn = document.getElementById('preview-reset');
  if (!el) return;
  if (info) info.textContent = label || '';
  if (resetBtn) resetBtn.style.display = (label && label !== '当前已选') ? 'inline-block' : 'none';
  state.previewMode = (label === '当前已选') ? 'selected' : 'stage';
  if (label && label.startsWith('草稿「')) state.previewMode = 'draft';
  if (!courses.length) { el.innerHTML = '<div class="nx-st">暂无课程</div>'; return; }

  // Final dedup: ensure no duplicate code+seq entries (defense in depth)
  var dedupSeen = {};
  courses = courses.filter(function (c) {
    var k = c.code + '_' + (c.seq || '0');
    if (dedupSeen[k]) return false;
    dedupSeen[k] = true;
    return true;
  });

  var tt = {};
  courses.forEach(function (c, ci) {
    var lbl = c.teacher ? c.name + '(' + c.teacher + ')' : c.name;
    var cellColor = '', probLabel = '', probBgColor = '';
    if (state.isQueuePhase) {
      var qKey = c.code + '_' + (c.seq || '0');
      var qd = state.queueDataMap[qKey];
      var cand = state.candidateCourses.find(function (cc) { return cc.code === c.code && String(cc.seq) === String(c.seq || '0'); });
      if (c.isCandidate && cand) {
        cellColor = '#ff9500'; probLabel = '排队第' + cand.myPos + '/' + cand.queueTotal + '人'; probBgColor = 'rgba(255,149,0,.14)';
      } else if (state.previewMode === 'selected') {
        probLabel = '已选'; cellColor = '#34c759'; probBgColor = 'rgba(52,199,89,.14)';
      } else if (qd) {
        if (qd.qRemaining > 0) { cellColor = '#34c759'; probLabel = '余' + qd.qRemaining; probBgColor = 'rgba(52,199,89,.14)'; }
        else if (qd.qQueue > 0) { cellColor = '#ff9500'; probLabel = '排队' + qd.qQueue + '人'; probBgColor = 'rgba(255,149,0,.14)'; }
        else { cellColor = '#ff3b30'; probLabel = '已满'; probBgColor = 'rgba(255,59,48,.14)'; }
      }
    } else if (state.previewMode === 'selected' && c.zy) {
      var sf = NX.typeCodeToFlag(c.typeCode);
      var p = NX.calcProb(c, sf, c.zy);
      if (p.prob >= 0) { cellColor = p.color; probLabel = p.percentLabel || p.label; probBgColor = NX.probBg(p.color); }
    } else if ((state.previewMode === 'stage' || state.previewMode === 'draft') && c.flag && c.zy) {
      var ac = state.allCourses.find(function (x) { return x.code === c.code && String(x.seq || '0') === String(c.seq || '0'); });
      if (ac) { var p = NX.calcProb(ac, c.flag, c.zy); if (p.prob >= 0) { cellColor = p.color; probLabel = p.percentLabel || p.label; probBgColor = NX.probBg(p.color); } }
    }
    NX.parseTimeSlots(c.time).forEach(function (s) {
      if (!tt[s.day]) tt[s.day] = {};
      var entry = { label: lbl, ci: ci, code: c.code, seq: c.seq || '0', color: cellColor, probLabel: probLabel, probBgColor: probBgColor };
      if (tt[s.day][s.slot]) {
        var old = tt[s.day][s.slot];
        var labels = (old.conflict ? old.items : [old]).concat(entry);
        tt[s.day][s.slot] = { label: labels.map(function (e) { return e.label; }).join(' / '), conflict: true, items: labels };
      } else tt[s.day][s.slot] = entry;
    });
  });

  var days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var sls = ['1-2节', '3-4节', '5-6节', '7-8节', '9-10节', '11-12节'];
  var h = '<table class="nx-tt"><thead><tr><th></th>';
  days.forEach(function (d) { h += '<th>' + d + '</th>'; });
  h += '</tr></thead><tbody>';
  sls.forEach(function (slot) {
    h += '<tr><th>' + slot + '</th>';
    days.forEach(function (day) {
      var val = tt[day] ? tt[day][slot] : null;
      if (val) {
        var isC = val.conflict;
        var items = isC ? val.items : [val];
        var btns = items.map(function (it) { return '<span class="nx-tt-rm" data-code="' + NX.esc(it.code) + '" data-seq="' + NX.esc(it.seq) + '" title="移除 ' + NX.esc(it.label) + '">✕</span>'; }).join('');
        var linesHtml = items.map(function (it) {
          var probHtml = it.probLabel ? '<span class="nx-tt-prob" style="background:' + it.probBgColor + ';color:' + it.color + '">' + it.probLabel + '</span>' : '';
          return '<div class="nx-tt-line"><span class="nx-tt-text">' + NX.esc(it.label) + '</span>' + probHtml + '</div>';
        }).join('');
        var cellClass = isC ? 'nx-c' : 'nx-s';
        var cellStyle = '';
        if (!isC && val.color) {
          cellStyle = 'background:' + val.color + '.1;color:' + val.color;
        }
        h += '<td class="' + cellClass + '" ' + (cellStyle ? 'style="' + cellStyle + '"' : '') + '><div class="nx-tt-cell">' + linesHtml + btns + '</div></td>';
      } else h += '<td></td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table>';
  var cr = courses.reduce(function (s, c) { return s + (c.credits || 0); }, 0);
  h += '<div class="nx-st ok" style="margin-top:6px">' + courses.length + '门课 · ' + cr + '学分</div>';
  el.innerHTML = h;
  el.querySelectorAll('.nx-tt-rm').forEach(function (btn) {
    btn.onclick = function () { NX.handlePreviewRemove(btn.dataset.code, btn.dataset.seq); };
  });
};

// ─── Stage Cart Rendering ───────────────────────────────────────

NX.stageProbHtml = function (c) {
  var state = NX.state;
  var ac = state.allCourses.find(function (x) { return x.code === c.code && String(x.seq || '0') === String(c.seq || '0'); });
  if (!ac) return '';
  if (state.isQueuePhase) {
    var qKey = c.code + '_' + (c.seq || '0');
    var qd = state.queueDataMap[qKey];
    if (qd) {
      var rc = qd.qRemaining > 0 ? '#34c759' : '#ff3b30';
      return '<div style="margin-top:2px;display:flex;gap:4px;align-items:center;flex-wrap:wrap"><span style="background:rgba(' + (qd.qRemaining > 0 ? '52,199,89' : '255,59,48') + ',.12);color:' + rc + ';padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600">余' + qd.qRemaining + '/' + qd.qCapacity + '</span>' + (qd.qQueue > 0 ? '<span style="background:rgba(255,149,0,.12);color:#ff9500;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600">排队' + qd.qQueue + '人</span>' : '') + '</div>';
    }
    return '';
  }
  return NX.fullProbGrid(ac, c.baseFlag || NX.baseFlag(ac)).replace(/margin-top:3px/, 'margin-top:2px');
};

NX.renderStageCart = function () {
  var state = NX.state;
  var el = document.getElementById('stage-list');
  var cf = document.getElementById('stage-conflict');
  if (!el) return;
  if (!state.stageCart.length) {
    el.innerHTML = '<div class="nx-st">暂无暂存课程，点击课程卡片上的「暂存」按钮添加</div>';
    if (cf) cf.innerHTML = '';
    return;
  }
  el.innerHTML = state.stageCart.map(function (c, i) {
    var bf = c.baseFlag || (function () { var ac = state.allCourses.find(function (x) { return x.code === c.code; }); return ac ? NX.baseFlag(ac) : 'rx'; })();
    var aFlags = NX.allowedFlags(bf);
    if (!aFlags.includes(c.flag)) { c.flag = aFlags[0]; NX.store.set('stageCart', state.stageCart); }
    var flOpts = aFlags.map(function (f) { return '<option value="' + f + '"' + (c.flag === f ? ' selected' : '') + '>' + NX.flagName(f) + '</option>'; }).join('');
    var zyOpts = [1, 2, 3].map(function (z) { return '<option value="' + z + '"' + (c.zy === z ? ' selected' : '') + '>' + z + '志愿</option>'; }).join('');
    var prob = NX.stageProbHtml(c);
    return '<div class="nx-stage-item" style="flex-direction:column;align-items:stretch;gap:2px">' +
      '<div style="display:flex;align-items:center;gap:4px">' +
      '<span class="nx-stage-name" style="min-width:80px">' + NX.esc(c.name) + (c.teacher ? ' <span style="color:#86868b;font-weight:400">' + NX.esc(c.teacher) + '</span>' : '') + '</span>' +
      '<span class="nx-stage-info">' + c.credits + '学分</span>' +
      '<select class="nx-stage-flag-sel" data-idx="' + i + '" style="padding:2px 4px;border-radius:6px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">' + flOpts + '</select>' +
      '<select class="nx-stage-zy-sel" data-idx="' + i + '" style="padding:2px 4px;border-radius:6px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">' + zyOpts + '</select>' +
      '<button class="nx-stage-rm" data-idx="' + i + '">✕</button></div>' + prob + '</div>';
  }).join('');

  el.querySelectorAll('.nx-stage-flag-sel').forEach(function (sel) {
    sel.onchange = function () {
      var i = parseInt(sel.dataset.idx);
      state.stageCart[i].flag = sel.value;
      NX.store.set('stageCart', state.stageCart);
      NX.renderStageCart();
      if (state.previewMode === 'stage') NX.renderPreviewTT(state.stageCart, document.getElementById('preview-info').textContent || '');
    };
  });
  el.querySelectorAll('.nx-stage-zy-sel').forEach(function (sel) {
    sel.onchange = function () {
      var i = parseInt(sel.dataset.idx);
      state.stageCart[i].zy = parseInt(sel.value);
      NX.store.set('stageCart', state.stageCart);
      NX.renderStageCart();
      if (state.previewMode === 'stage') NX.renderPreviewTT(state.stageCart, document.getElementById('preview-info').textContent || '');
    };
  });
  el.querySelectorAll('.nx-stage-rm').forEach(function (btn) {
    btn.onclick = function () { NX.removeFromStage(parseInt(btn.dataset.idx)); };
  });

  if (cf) {
    var conflicts = NX.detectConflicts(state.stageCart);
    if (conflicts.length) {
      cf.innerHTML = conflicts.map(function (c) {
        return '<div style="font-size:11px;color:#ff3b30">⚠ 时间冲突: ' + NX.esc(c.day) + ' ' + NX.esc(c.slot) + ' — ' + NX.esc(c.a) + ' 与 ' + NX.esc(c.b) + '</div>';
      }).join('');
    } else cf.innerHTML = '<div style="font-size:11px;color:#34c759">✓ 无时间冲突</div>';
  }
};

// ─── Drafts Rendering ───────────────────────────────────────────

NX.draftCourseProbHtml = function (c) {
  var state = NX.state;
  var ac = state.allCourses.find(function (x) { return x.code === c.code && String(x.seq || '0') === String(c.seq || '0'); });
  if (!ac) return '';
  if (state.isQueuePhase) {
    var qKey = c.code + '_' + (c.seq || '0');
    var qd = state.queueDataMap[qKey];
    if (qd) {
      var rc = qd.qRemaining > 0 ? '#34c759' : '#ff3b30';
      return '<div style="margin-top:2px;display:flex;gap:4px;align-items:center;flex-wrap:wrap"><span style="background:rgba(' + (qd.qRemaining > 0 ? '52,199,89' : '255,59,48') + ',.12);color:' + rc + ';padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600">余' + qd.qRemaining + '/' + qd.qCapacity + '</span>' + (qd.qQueue > 0 ? '<span style="background:rgba(255,149,0,.12);color:#ff9500;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600">排队' + qd.qQueue + '人</span>' : '') + '</div>';
    }
    return '';
  }
  return NX.fullProbGrid(ac, c.baseFlag || NX.baseFlag(ac)).replace(/margin-top:3px/, 'margin-top:2px');
};

NX.renderDrafts = function () {
  var state = NX.state;
  var el = document.getElementById('drafts');
  if (!el) return;
  if (!state.savedDrafts.length) { el.innerHTML = ''; return; }

  el.innerHTML = state.savedDrafts.map(function (d, di) {
    var cr = d.courses.reduce(function (s, c) { return s + (c.credits || 0); }, 0);
    var dt = new Date(d.createdAt);
    var exp = state.expandedDraft === di;
    var courseList = '';
    if (exp && d.courses.length) {
      courseList = '<div class="nx-draft-courses">';
      d.courses.forEach(function (c, ci) {
        var bf = c.baseFlag || (function () { var ac = state.allCourses.find(function (x) { return x.code === c.code; }); return ac ? NX.baseFlag(ac) : 'rx'; })();
        var aFlags = NX.allowedFlags(bf);
        if (!aFlags.includes(c.flag)) { c.flag = aFlags[0]; NX.store.set('drafts', state.savedDrafts); }
        var flOpts = aFlags.map(function (f) { return '<option value="' + f + '"' + (c.flag === f ? ' selected' : '') + '>' + NX.flagName(f) + '</option>'; }).join('');
        var zyOpts = [1, 2, 3].map(function (z) { return '<option value="' + z + '"' + (c.zy === z ? ' selected' : '') + '>' + z + '志愿</option>'; }).join('');
        var prob = NX.draftCourseProbHtml(c);
        courseList += '<div style="display:flex;align-items:center;gap:4px;padding:3px 0;font-size:11px;border-bottom:1px solid rgba(0,0,0,.03)">' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#1d1d1f">' + NX.esc(c.name) + '</span>' +
          '<span style="font-size:10px;color:#86868b">' + c.credits + '学分</span>' +
          '<select class="nx-draft-flag" data-di="' + di + '" data-ci="' + ci + '" style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">' + flOpts + '</select>' +
          '<select class="nx-draft-zy" data-di="' + di + '" data-ci="' + ci + '" style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">' + zyOpts + '</select>' +
          prob +
          '<button class="nx-draft-crm" data-di="' + di + '" data-ci="' + ci + '" style="width:16px;height:16px;border-radius:8px;border:none;background:rgba(255,59,48,.1);color:#ff3b30;font-size:9px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center">✕</button></div>';
      });
      courseList += '</div>';
    }
    var expIcon = exp ? '▼' : '▶';
    return '<div class="nx-draft-card"><div class="nx-draft-head"><span class="nx-draft-name" style="cursor:pointer" data-toggle="' + di + '">' + expIcon + ' ' + NX.esc(d.name) + '</span><span class="nx-draft-info">' + d.courses.length + '门 · ' + cr + '学分 · ' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</span></div><div class="nx-draft-acts"><button class="nx-draft-view" data-idx="' + di + '">预览 & 修改</button><button class="nx-draft-go" data-idx="' + di + '">提交选课</button><button class="nx-draft-export" data-idx="' + di + '">📤</button><button class="nx-draft-del" data-idx="' + di + '">删除</button></div>' + courseList + '</div>';
  }).join('');

  // Toggle expand
  el.querySelectorAll('[data-toggle]').forEach(function (span) {
    span.onclick = function () {
      var idx = parseInt(span.dataset.toggle);
      state.expandedDraft = state.expandedDraft === idx ? -1 : idx;
      NX.renderDrafts();
    };
  });
  // Flag/zy change in draft
  el.querySelectorAll('.nx-draft-flag').forEach(function (sel) {
    sel.onchange = function () {
      var di = parseInt(sel.dataset.di), ci = parseInt(sel.dataset.ci);
      state.savedDrafts[di].courses[ci].flag = sel.value;
      NX.store.set('drafts', state.savedDrafts);
      NX.renderDrafts();
      if (state.previewMode === 'draft' && state.previewDraftIdx === di) NX.renderPreviewTT(state.savedDrafts[di].courses, '草稿「' + state.savedDrafts[di].name + '」预览');
    };
  });
  el.querySelectorAll('.nx-draft-zy').forEach(function (sel) {
    sel.onchange = function () {
      var di = parseInt(sel.dataset.di), ci = parseInt(sel.dataset.ci);
      state.savedDrafts[di].courses[ci].zy = parseInt(sel.value);
      NX.store.set('drafts', state.savedDrafts);
      NX.renderDrafts();
      if (state.previewMode === 'draft' && state.previewDraftIdx === di) NX.renderPreviewTT(state.savedDrafts[di].courses, '草稿「' + state.savedDrafts[di].name + '」预览');
    };
  });
  // Remove course from draft
  el.querySelectorAll('.nx-draft-crm').forEach(function (btn) {
    btn.onclick = function () {
      var di = parseInt(btn.dataset.di), ci = parseInt(btn.dataset.ci);
      var name = state.savedDrafts[di].courses[ci].name;
      if (!confirm('从草稿移除「' + name + '」？')) return;
      state.savedDrafts[di].courses.splice(ci, 1);
      NX.store.set('drafts', state.savedDrafts);
      NX.renderDrafts();
      if (state.previewMode === 'draft' && state.previewDraftIdx === di) NX.renderPreviewTT(state.savedDrafts[di].courses, '草稿「' + state.savedDrafts[di].name + '」预览');
    };
  });
  // View/Preview draft
  el.querySelectorAll('.nx-draft-view').forEach(function (btn) {
    btn.onclick = function () {
      var idx = parseInt(btn.dataset.idx);
      var d = state.savedDrafts[idx];
      if (d) { state.previewDraftIdx = idx; NX.renderPreviewTT(d.courses, '草稿「' + d.name + '」预览'); }
    };
  });
  // Promote draft
  el.querySelectorAll('.nx-draft-go').forEach(function (btn) {
    btn.onclick = function () {
      var d = state.savedDrafts[parseInt(btn.dataset.idx)];
      if (!d) return;
      if (!confirm('确定提交「' + d.name + '」？\n将先退选所有已选课程，再选入该草稿中的 ' + d.courses.length + ' 门课程。')) return;
      NX.promoteDraft(d);
    };
  });
  // Delete draft
  el.querySelectorAll('.nx-draft-del').forEach(function (btn) {
    btn.onclick = function () { NX.deleteDraft(parseInt(btn.dataset.idx)); };
  });
  // Export draft
  el.querySelectorAll('.nx-draft-export').forEach(function (btn) {
    btn.onclick = function () {
      var d = state.savedDrafts[parseInt(btn.dataset.idx)];
      if (d) NX.exportDraft(d);
    };
  });
};

// ─── Course Detail Modal ────────────────────────────────────────

NX.showCourseModal = async function (code, teacherId) {
  var mask = document.getElementById('modal');
  var title = document.getElementById('modal-title');
  var body = document.getElementById('modal-body');
  var c = NX.state.allCourses.find(function (x) { return x.code === code; });
  title.textContent = c ? c.name + '（' + code + '）' : code;
  body.innerHTML = '<div class="nx-modal-loading"><span class="nx-spin"></span> 正在加载课程简介…</div>';
  mask.classList.add('show');
  try {
    var fields = await NX.fetchDetail(teacherId, code);
    if (!fields || !Object.keys(fields).length) {
      body.innerHTML = '<div class="nx-modal-loading">暂无课程简介信息</div>';
      return;
    }
    var order = ['课程编号', '课程名称', '总学时数', '总学分', '课程内容简介', 'Course Description', '考核安排', '联系人', '教材及参考书', '上课教师', '选课指导语', '先修要求', '教师教学特色', 'Office Hour', '成绩评定标准', '参考书'];
    var html = '';
    for (var i = 0; i < order.length; i++) {
      if (fields[order[i]] && fields[order[i]].length > 0) {
        html += '<div class="nx-modal-row"><div class="nx-modal-label">' + NX.esc(order[i]) + '</div><div class="nx-modal-val">' + NX.esc(fields[order[i]]) + '</div></div>';
      }
    }
    for (var key in fields) {
      if (fields.hasOwnProperty(key) && !order.includes(key) && fields[key] && fields[key].length > 0) {
        html += '<div class="nx-modal-row"><div class="nx-modal-label">' + NX.esc(key) + '</div><div class="nx-modal-val">' + NX.esc(fields[key]) + '</div></div>';
      }
    }
    body.innerHTML = html || '<div class="nx-modal-loading">暂无信息</div>';
  } catch (e) { body.innerHTML = '<div class="nx-modal-loading">加载失败</div>'; }
};

// ─── Plan Rendering ─────────────────────────────────────────────

NX.renderPlan = function (plan) {
  var el = document.getElementById('plan');
  var detail = document.getElementById('plan-detail');
  if (!plan.length) { el.innerHTML = '<div class="nx-st">暂无培养方案数据</div>'; if (detail) detail.textContent = ''; return; }
  var coverage = NX.checkPlanCoverage();
  var groups = {};
  coverage.forEach(function (c) { var g = c.group || c.attr || '其他'; if (!groups[g]) groups[g] = []; groups[g].push(c); });
  el.innerHTML = Object.entries(groups).map(function (entry) {
    var name = entry[0], items = entry[1];
    var cr = items.reduce(function (s, c) { return s + c.credits; }, 0);
    var cov = items.filter(function (c) { return c.covered; }).reduce(function (s, c) { return s + c.credits; }, 0);
    return '<div class="nx-plan-card" data-g="' + NX.esc(name) + '"><div class="nx-plan-num">' + cov + '<small style="font-size:12px;font-weight:400;color:#86868b">/' + cr + '学分</small></div><div class="nx-plan-lbl">' + NX.esc(name) + ' (' + items.length + '门)</div></div>';
  }).join('');
  var total = coverage.reduce(function (s, c) { return s + c.credits; }, 0);
  var totalCov = coverage.filter(function (c) { return c.covered; }).reduce(function (s, c) { return s + c.credits; }, 0);
  if (detail) detail.textContent = '共 ' + coverage.length + ' 门，' + totalCov + '/' + total + ' 学分已覆盖';
};

// ─── Plan View (培养方案详情页) ─────────────────────────────────

NX.renderPlanView = function (searchQuery) {
  var el = document.getElementById('list');
  var state = NX.state;
  if (!state.planData.length) { el.innerHTML = '<div class="nx-empty">暂无培养方案数据</div>'; return; }
  var coverage = NX.checkPlanCoverage();
  var filtered = coverage;
  if (searchQuery) {
    filtered = filtered.filter(function (p) { return p.name.toLowerCase().includes(searchQuery) || p.code.includes(searchQuery); });
  }
  var groups = {};
  filtered.forEach(function (p) { var g = p.group || p.attr || '其他'; if (!groups[g]) groups[g] = []; groups[g].push(p); });
  var totalCr = coverage.reduce(function (s, c) { return s + c.credits; }, 0);
  var coveredCr = coverage.filter(function (c) { return c.covered; }).reduce(function (s, c) { return s + c.credits; }, 0);
  var coveredN = coverage.filter(function (c) { return c.covered; }).length;

  var html = '<div style="margin-bottom:14px;padding:12px 16px;border-radius:12px;background:linear-gradient(135deg,rgba(124,106,239,.12),rgba(99,102,241,.06));font-size:13px">' +
    '<strong>培养方案进度</strong>: ' + coveredN + '/' + coverage.length + '门 · ' + coveredCr + '/' + totalCr + '学分' +
    '<div style="margin-top:6px;height:6px;background:rgba(0,0,0,.06);border-radius:3px;overflow:hidden">' +
    '<div style="height:100%;width:' + (totalCr ? Math.round(coveredCr / totalCr * 100) : 0) + '%;background:linear-gradient(90deg,#34c759,#30d158);border-radius:3px"></div></div></div>';

  var groupNames = Object.keys(groups);
  for (var gi = 0; gi < groupNames.length; gi++) {
    var groupName = groupNames[gi];
    var courses = groups[groupName];
    var gTotal = courses.reduce(function (s, c) { return s + c.credits; }, 0);
    var gCovered = courses.filter(function (c) { return c.covered; }).reduce(function (s, c) { return s + c.credits; }, 0);
    html += '<div style="margin-bottom:14px"><div style="font-size:13px;font-weight:700;color:#1d1d1f;margin-bottom:6px;padding:5px 12px;background:rgba(124,106,239,.08);border-radius:8px;display:flex;justify-content:space-between"><span>' + NX.esc(groupName) + '</span><span style="font-size:11px;font-weight:400;color:' + (gCovered >= gTotal ? '#34c759' : '#86868b') + '">' + gCovered + '/' + gTotal + '学分</span></div>';
    for (var ci = 0; ci < courses.length; ci++) {
      var p = courses[ci];
      var icon = p.covered ? '✅' : '❌';
      var bg = p.covered ? 'rgba(52,199,89,.06)' : 'rgba(255,59,48,.04)';
      var statusHtml = p.covered
        ? '<span style="color:#34c759;font-size:11px;white-space:nowrap">' + NX.esc(p.coveredBy || '已满足') + '</span>'
        : '<span style="color:#ff3b30;font-size:11px">未满足</span>';
      html += '<div class="nx-stage-item" style="background:' + bg + ';gap:8px"><span style="font-size:12px">' + icon + '</span><span class="nx-stage-name">' + NX.esc(p.name) + ' <span style="color:#86868b;font-size:10px">' + p.code + '</span></span><span class="nx-stage-info">' + p.credits + '学分</span>' + statusHtml + '</div>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
};

// ─── Filters ────────────────────────────────────────────────────

NX.filterCourses = function () {
  var state = NX.state;
  var q = (document.getElementById('search').value || '').toLowerCase();
  var f = document.querySelector('.nx-chip.on') ? document.querySelector('.nx-chip.on').dataset.f : 'all';
  if (f === 'plan') { NX.renderPlanView(q); return; }
  var list = state.allCourses.slice();
  if (q) list = list.filter(function (c) { return c.name.toLowerCase().includes(q) || c.code.includes(q) || (c.teacher || '').toLowerCase().includes(q); });
  if (f === 'available') list = list.filter(function (c) { return c.available; });
  else if (f === 'selected') {
    var seen = new Set();
    var candKeys = new Set(state.candidateCourses.map(function (c) { return c.code + '_' + (c.seq || '0'); }));
    list = list.filter(function (c) {
      if (!c.selected && !c.isCandidate && !candKeys.has(c.code + '_' + (c.seq || '0'))) return false;
      var k = c.code + '_' + (c.seq || '0');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  } else if (f === 'required') list = list.filter(function (c) { return c.attr === '必修'; });
  else if (f === 'elective') list = list.filter(function (c) { return c.attr === '限选'; });
  else if (f === 'sports') list = list.filter(function (c) { return c.attr === '体育' || (c.department || '').includes('体育') || (c.department || '').includes('体武'); });
  else if (f === 'queue') {
    var qKeys = new Set(state.candidateCourses.map(function (c) { return c.code + '_' + (c.seq || '0'); }));
    list = list.filter(function (c) { return qKeys.has(c.code + '_' + (c.seq || '0')); });
  }
  if (state.activeGroup) list = list.filter(function (c) { return (c.group || c.attr) === state.activeGroup; });

  // Extra filters
  var cfVal = document.getElementById('f-conflict') ? document.getElementById('f-conflict').value : '';
  if (cfVal) list = list.filter(function (c) { var cfs = NX.findPreviewConflicts(c); return cfVal === 'noconflict' ? cfs.length === 0 : cfs.length > 0; });
  var crVal = document.getElementById('f-credits') ? document.getElementById('f-credits').value : '';
  if (crVal) list = crVal === '5+' ? list.filter(function (c) { return c.credits >= 5; }) : list.filter(function (c) { return c.credits === parseInt(crVal); });
  var dfVal = document.getElementById('f-day') ? document.getElementById('f-day').value : '';
  var pfVal = document.getElementById('f-period') ? document.getElementById('f-period').value : '';
  if (dfVal || pfVal) {
    list = list.filter(function (c) {
      if (!c.time) return false;
      if (dfVal && pfVal) return c.time.includes(dfVal + '-' + pfVal + '(');
      if (dfVal) return new RegExp(dfVal + '-\\d').test(c.time);
      return new RegExp('\\d+-' + pfVal + '\\(').test(c.time);
    });
  }
  var tsVal = document.getElementById('f-tongshi') ? document.getElementById('f-tongshi').value : '';
  if (tsVal) {
    var tsMap = { TS1: '人文课组', TS2: '社科课组', TS3: '艺术课组', TS4: '科学课组' };
    list = list.filter(function (c) { return (c.tongshiGroup || '').includes(tsMap[tsVal] || ''); });
  }
  var featVal = document.getElementById('f-feature') ? document.getElementById('f-feature').value : '';
  if (featVal) list = list.filter(function (c) { return (c.courseFeature || '').includes(featVal); });
  var gradeVal = document.getElementById('f-grade') ? document.getElementById('f-grade').value : '';
  if (gradeVal) list = list.filter(function (c) { return (c.grade || '').includes(gradeVal); });
  var bksVal = document.getElementById('f-bksrem') ? document.getElementById('f-bksrem').value : '';
  if (bksVal === '>0') list = list.filter(function (c) { return (c.remaining || 0) > 0; });
  var yjsVal = document.getElementById('f-yjsrem') ? document.getElementById('f-yjsrem').value : '';
  if (yjsVal === '>0') list = list.filter(function (c) { return (c.gradRemaining || 0) > 0; });
  var xkNote = document.getElementById('f-xknote') ? (document.getElementById('f-xknote').value || '').trim().toLowerCase() : '';
  if (xkNote) list = list.filter(function (c) { return (c.xkTextNote || '').toLowerCase().includes(xkNote); });

  NX.renderCourses(list);
};

// ─── Search Clear ───────────────────────────────────────────────

NX.updateSearchClear = function () {
  var btn = document.getElementById('search-clear');
  var hasVal = !!(document.getElementById('search') || {}).value && document.getElementById('search').value.trim();
  if (btn) {
    if (hasVal) btn.classList.add('show');
    else btn.classList.remove('show');
  }
};

NX.filterByGroup = function (g) {
  NX.state.activeGroup = g;
  NX.filterCourses();
};
