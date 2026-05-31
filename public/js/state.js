/* ═══════════════════════════════════════════════════════════════
   NextTHUxk Local — State: stage/draft/conflict/zy/plan coverage
   ═══════════════════════════════════════════════════════════════ */

var NX = NX || {};

// ─── Timetable Parsing ──────────────────────────────────────────

NX.parseTimeSlots = function (timeStr) {
  if (!timeStr) return [];
  var slots = [];
  var dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var slotLabels = ['1-2节', '3-4节', '5-6节', '7-8节', '9-10节', '11-12节'];
  var re = /(\d+)\s*[-–—]\s*(\d+)\s*\([^)]*\)/g;
  var m;
  while ((m = re.exec(timeStr)) !== null) {
    var dayNum = parseInt(m[1]);
    var dajie = parseInt(m[2]);
    if (dayNum >= 1 && dayNum <= 7 && dajie >= 1 && dajie <= 6) {
      var day = dayLabels[dayNum - 1];
      var slot = slotLabels[dajie - 1];
      // Deduplicate: split time ranges (e.g. "1-2(1-8周),1-2(9-16周)")
      // produce identical day+slot entries — keep only the first
      if (!slots.some(function (s) { return s.day === day && s.slot === slot; })) {
        slots.push({ day: day, slot: slot });
      }
    }
  }
  return slots;
};

NX.detectConflicts = function (courses) {
  var slotMap = {};
  var conflicts = [];
  courses.forEach(function (c) {
    NX.parseTimeSlots(c.time).forEach(function (s) {
      var k = s.day + '|' + s.slot;
      if (slotMap[k]) conflicts.push({ day: s.day, slot: s.slot, a: slotMap[k], b: c.name });
      else slotMap[k] = c.name;
    });
  });
  return conflicts;
};

NX.findPreviewConflicts = function (course) {
  var state = NX.state;
  var previewCourses = [];
  if (state.previewMode === 'selected') {
    previewCourses = state.allCourses.filter(function (c) { return c.selected; });
  } else if (state.previewMode === 'stage') {
    previewCourses = state.stageCart;
  } else if (state.previewMode === 'draft' && state.previewDraftIdx >= 0 && state.savedDrafts[state.previewDraftIdx]) {
    previewCourses = state.savedDrafts[state.previewDraftIdx].courses;
  }
  if (!previewCourses.length) return [];
  var slots = NX.parseTimeSlots(course.time || '');
  if (!slots.length) return [];
  var conflicts = [];
  previewCourses.forEach(function (pc) {
    if (pc.code === course.code && String(pc.seq || '0') === String(course.seq || '0')) return;
    var pcSlots = NX.parseTimeSlots(pc.time || '');
    slots.forEach(function (s) {
      pcSlots.forEach(function (ps) {
        if (s.day === ps.day && s.slot === ps.slot) {
          var name = pc.name || pc.code;
          if (!conflicts.some(function (c) { return c.name === name && c.day === s.day; })) {
            conflicts.push({ name: name, day: s.day, slot: s.slot });
          }
        }
      });
    });
  });
  return conflicts;
};

// ─── Stage Cart ─────────────────────────────────────────────────

NX.addToStage = function (code, seq, flag, zy) {
  var state = NX.state;
  var c = state.allCourses.find(function (x) { return x.code === code && String(x.seq || '0') === String(seq || '0'); });
  if (!c) return;
  if (state.stageCart.some(function (s) { return s.code === code && String(s.seq) === String(seq || '0'); })) {
    NX.showXkResult({ ok: false, msg: '该课程已在暂存区' }); return;
  }
  state.stageCart.push({
    code: c.code, seq: c.seq || '0', name: c.name, teacher: c.teacher || '',
    time: c.time || '', credits: c.credits || 0,
    flag: flag, zy: parseInt(zy) || 3,
    baseFlag: NX.baseFlag(c),
  });
  NX.renderStageCart();
  NX.store.set('stageCart', state.stageCart);
  NX.showXkResult({ ok: true, msg: '已暂存「' + c.name + '」' });
};

NX.removeFromStage = function (idx) {
  var state = NX.state;
  state.stageCart.splice(idx, 1);
  NX.renderStageCart();
  NX.store.set('stageCart', state.stageCart);
  NX.filterCourses();
};

// ─── Draft Management ───────────────────────────────────────────

NX.askReplaceDraft = function (name, courses) {
  var state = NX.state;
  if (state.savedDrafts.length < 5) {
    state.savedDrafts.push({ id: Date.now(), name: name, courses: courses.map(function (c) { return Object.assign({}, c); }), createdAt: Date.now() });
    NX.renderDrafts();
    NX.store.set('drafts', state.savedDrafts);
    return true;
  }
  var list = state.savedDrafts.map(function (d, i) {
    return (i + 1) + '. ' + d.name + ' (' + d.courses.length + '门·' + d.courses.reduce(function (s, c) { return s + (c.credits || 0); }, 0) + '学分)';
  }).join('\n');
  var choice = prompt('草稿已满(5/5)，输入要替换的编号(1-5)，取消则不保存：\n' + list);
  if (!choice) return false;
  var idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= 5) { NX.showXkResult({ ok: false, msg: '已取消' }); return false; }
  state.savedDrafts[idx] = { id: Date.now(), name: name, courses: courses.map(function (c) { return Object.assign({}, c); }), createdAt: Date.now() };
  NX.renderDrafts();
  NX.store.set('drafts', state.savedDrafts);
  return true;
};

NX.saveDraft = function () {
  var state = NX.state;
  var nameEl = document.getElementById('draft-name');
  var name = (nameEl ? nameEl.value : '').trim() || '草稿' + (state.savedDrafts.length + 1);
  if (!state.stageCart.length) { NX.showXkResult({ ok: false, msg: '暂存区没有课程' }); return; }
  if (NX.askReplaceDraft(name, state.stageCart)) {
    state.stageCart = [];
    if (nameEl) nameEl.value = '';
    NX.renderStageCart();
    NX.store.set('stageCart', state.stageCart);
    NX.filterCourses();
    NX.showXkResult({ ok: true, msg: '草稿「' + name + '」已保存' });
  }
};

NX.saveSelectedAsDraft = function () {
  var state = NX.state;
  var selected = state.allCourses.filter(function (c) { return c.selected; });
  if (!selected.length) { NX.showXkResult({ ok: false, msg: '没有已选课程' }); return; }
  var courses = selected.map(function (c) {
    return {
      code: c.code, seq: c.seq || '0', name: c.name, teacher: c.teacher || '',
      time: c.time || '', credits: c.credits || 0,
      flag: NX.typeCodeToFlag(c.typeCode), zy: c.zy || 3,
      baseFlag: NX.baseFlag(c),
    };
  });
  var d = new Date();
  var name = '已选课表 ' + (d.getMonth() + 1) + '/' + d.getDate();
  if (NX.askReplaceDraft(name, courses)) {
    NX.showXkResult({ ok: true, msg: '已选课程已保存为「' + name + '」' });
  }
};

NX.deleteDraft = function (idx) {
  NX.state.savedDrafts.splice(idx, 1);
  NX.renderDrafts();
  NX.store.set('drafts', NX.state.savedDrafts);
};

NX.exportDraft = function (draft) {
  var data = {
    v: 1, name: draft.name,
    courses: draft.courses.map(function (c) {
      return { code: c.code, seq: c.seq, name: c.name, teacher: c.teacher, time: c.time, credits: c.credits, flag: c.flag, zy: c.zy, baseFlag: c.baseFlag };
    }),
  };
  var json = JSON.stringify(data);
  navigator.clipboard.writeText(json).then(
    function () { NX.showXkResult({ ok: true, msg: '「' + draft.name + '」已复制到剪贴板' }); },
    function () {
      var ta = document.createElement('textarea');
      ta.value = json; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
      NX.showXkResult({ ok: true, msg: '「' + draft.name + '」已复制到剪贴板' });
    }
  );
};

NX.exportStageCart = function () {
  var state = NX.state;
  if (!state.stageCart.length) { NX.showXkResult({ ok: false, msg: '暂存区没有课程' }); return; }
  NX.exportDraft({ name: '暂存课表', courses: state.stageCart });
};

NX.importToStage = function (jsonStr) {
  var state = NX.state;
  try {
    var data = JSON.parse(jsonStr.trim());
    if (!data.courses || !Array.isArray(data.courses)) throw new Error('数据格式错误');
    var added = 0;
    data.courses.forEach(function (c) {
      if (!state.stageCart.some(function (s) { return s.code === c.code && String(s.seq) === String(c.seq); })) {
        state.stageCart.push({
          code: c.code, seq: c.seq || '0', name: c.name || '', teacher: c.teacher || '',
          time: c.time || '', credits: c.credits || 0,
          flag: c.flag || 'bx', zy: c.zy || 3,
          baseFlag: c.baseFlag || (function () {
            var ac = state.allCourses.find(function (x) { return x.code === c.code; });
            return ac ? NX.baseFlag(ac) : 'rx';
          })(),
        });
        added++;
      }
    });
    NX.renderStageCart();
    NX.store.set('stageCart', state.stageCart);
    NX.showXkResult({ ok: true, msg: '已导入 ' + added + ' 门课程到暂存区' });
  } catch (e) { NX.showXkResult({ ok: false, msg: '导入失败: ' + e.message }); }
};

// ─── Draft Promotion (submit all) ───────────────────────────────

NX.promoteDraft = async function (draft) {
  var state = NX.state;
  NX.showToast('⏳ 正在获取已选课程…', 'loading');
  try {
    var current = await NX.fetchSelected(state.SEM);
    for (var i = 0; i < current.length; i++) {
      NX.showToast('⏳ 退选 ' + (i + 1) + '/' + current.length + ': ' + current[i].name, 'loading');
      await NX.dropCourse(state.SEM, current[i].code, current[i].seq, false);
      await new Promise(function (r) { setTimeout(r, 1000); });
    }
    for (var i = 0; i < draft.courses.length; i++) {
      var c = draft.courses[i];
      NX.showToast('⏳ 选课 ' + (i + 1) + '/' + draft.courses.length + ': ' + c.name, 'loading');
      await NX.submitCourse(state.SEM, c.code, c.seq, c.zy || 3, c.flag || 'bx');
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
    await NX.refreshSelected();
    NX.showXkResult({ ok: true, msg: '课表「' + draft.name + '」已全部提交！' });
    var sel = state.allCourses.filter(function (c) { return c.selected; });
    NX.renderPreviewTT(sel, '当前已选');
  } catch (e) { NX.showXkResult({ ok: false, msg: '提交出错: ' + e.message }); }
};

// ─── ZY Resolution (volunteer / zhiyuan) ────────────────────────

NX.showZyModal = function (missingZy) {
  var state = NX.state;
  return new Promise(function (resolve) {
    var mask = document.getElementById('zy-modal');
    var body = document.getElementById('zy-modal-body');
    if (!mask || !body) { resolve(missingZy.map(function () { return 3; })); return; }
    body.innerHTML = '<div class="nx-zy-hint">以下课程未能自动获取志愿信息，请手动确认：</div>' +
      missingZy.map(function (c, i) {
        var flag = NX.courseFlag(c) === 'ty' ? '体育' : (c.typeLabel || '?');
        var curZy = c.zy || 3;
        return '<div class="nx-zy-row">' +
          '<span class="nx-zy-name">' + NX.esc(c.name) + '</span>' +
          '<span class="nx-zy-type">' + NX.esc(flag) + '</span>' +
          '<select class="nx-zy-select nx-zy-modal-sel" data-idx="' + i + '">' +
          '<option value="1"' + (curZy === 1 ? ' selected' : '') + '>第1志愿</option>' +
          '<option value="2"' + (curZy === 2 ? ' selected' : '') + '>第2志愿</option>' +
          '<option value="3"' + (curZy === 3 ? ' selected' : '') + '>第3志愿</option>' +
          '</select></div>';
      }).join('');
    mask.classList.add('show');
    var finish = function () {
      mask.classList.remove('show');
      var values = [];
      body.querySelectorAll('.nx-zy-modal-sel').forEach(function (sel) { values.push(parseInt(sel.value) || 3); });
      resolve(values);
    };
    document.getElementById('zy-modal-ok').onclick = finish;
    document.getElementById('zy-modal-close').onclick = finish;
  });
};

NX.resolveCourseZy = async function (courses, selMap, zyCache) {
  var state = NX.state;
  var cacheUpdated = false;
  var missingZy = [];
  var levelMap = null;
  for (var i = 0; i < courses.length; i++) {
    var c = courses[i];
    var key = c.code + '_' + (c.seq || '0');
    var s = selMap[key];
    c.selected = !!s;
    if (s) {
      if (s.zy > 0) {
        c.zy = s.zy; c.typeCode = s.typeCode; c.typeLabel = s.typeLabel;
        zyCache[key] = { zy: s.zy, typeCode: s.typeCode, typeLabel: s.typeLabel, confirmed: true };
        cacheUpdated = true;
      } else {
        var cached = zyCache[key];
        if (cached && cached.zy > 0 && cached.confirmed) {
          c.zy = cached.zy; c.typeCode = cached.typeCode; c.typeLabel = cached.typeLabel;
        } else {
          if (!levelMap) levelMap = await NX.fetchLevelTable(state.SEM);
          var lt = levelMap[key];
          if (lt) { c.typeCode = lt.typeCode; c.typeLabel = lt.typeLabel; }
          else { c.typeCode = s.typeCode; c.typeLabel = s.typeLabel; }
          c.zy = (cached && cached.zy > 0) ? cached.zy : 0;
          missingZy.push(c);
        }
      }
    } else {
      c.zy = 0; c.typeCode = ''; c.typeLabel = '';
    }
  }
  if (missingZy.length) {
    if (state.isQueuePhase) {
      missingZy.forEach(function (c) {
        c.zy = 3;
        zyCache[c.code + '_' + (c.seq || '0')] = { zy: 3, typeCode: c.typeCode, typeLabel: c.typeLabel, confirmed: false };
      });
      cacheUpdated = true;
      return cacheUpdated;
    }
    var values = await NX.showZyModal(missingZy);
    missingZy.forEach(function (c, i) {
      if (values[i] > 0) {
        c.zy = values[i];
        zyCache[c.code + '_' + (c.seq || '0')] = { zy: c.zy, typeCode: c.typeCode, typeLabel: c.typeLabel, confirmed: false };
        cacheUpdated = true;
      }
    });
  }
  return cacheUpdated;
};

NX.canAdjustZy = function (code, seq, targetZy) {
  var state = NX.state;
  var course = state.allCourses.find(function (c) { return c.code === code && String(c.seq || '0') === String(seq || '0'); });
  if (!course) return false;
  var zt = NX.zyTypeOf(course);
  var count = 0;
  state.allCourses.forEach(function (c) {
    if (!c.selected) return;
    if (c.code === code && String(c.seq || '0') === String(seq || '0')) return;
    if (NX.zyTypeOf(c) !== zt) return;
    if (c.zy === targetZy) count++;
  });
  var limits = NX.ZY_LIMITS[zt] || NX.ZY_LIMITS.bx;
  return count < (limits[targetZy - 1] ? limits[targetZy - 1][1] : 0);
};

// ─── Refresh Selected ───────────────────────────────────────────

NX.refreshSelected = async function () {
  var state = NX.state;
  var selected = await NX.fetchSelected(state.SEM);
  var selMap = {};
  selected.forEach(function (s) { selMap[s.code + '_' + (s.seq || '0')] = s; });
  var zyCache = (await NX.store.get('zyCache')) || {};
  var cacheUpdated = await NX.resolveCourseZy(state.allCourses, selMap, zyCache);
  if (cacheUpdated) await NX.store.set('zyCache', zyCache);
  try {
    state.candidateCourses = await NX.fetchCandidates(state.SEM);
  } catch (e) { /* keep existing */ }
  var candKeys = new Set(state.candidateCourses.map(function (c) { return c.code + '_' + (c.seq || '0'); }));
  state.allCourses.forEach(function (c) {
    c.isCandidate = candKeys.has(c.code + '_' + (c.seq || '0'));
  });
  NX.filterCourses();
  NX.renderPreviewTT(
    state.allCourses.filter(function (c) { return c.selected; }).concat(
      state.candidateCourses.filter(function (cc) { return !state.allCourses.some(function (ac) { return ac.selected && ac.code === cc.code && String(ac.seq || '0') === String(cc.seq || '0'); }); })
    ),
    '当前已选'
  );
};

// ─── Preview Remove Handler ─────────────────────────────────────

NX.handlePreviewRemove = async function (code, seq) {
  var state = NX.state;
  if (state.previewMode === 'selected') {
    var c = state.allCourses.find(function (x) { return x.code === code && String(x.seq || '0') === String(seq); });
    var name = c ? c.name : code;
    if (!confirm('确认退选「' + name + '」？')) return;
    var res = await NX.dropCourse(state.SEM, code, seq, false);
    NX.showXkResult(res);
    if (res.ok) await NX.launch();
  } else if (state.previewMode === 'stage') {
    var idx = state.stageCart.findIndex(function (s) { return s.code === code && String(s.seq) === String(seq); });
    var name = idx >= 0 ? state.stageCart[idx].name : code;
    if (!confirm('从暂存区移除「' + name + '」？')) return;
    NX.removeFromStage(idx);
    NX.renderPreviewTT(state.stageCart, document.getElementById('preview-info').textContent || '');
  } else if (state.previewMode === 'draft') {
    var draft = state.savedDrafts[state.previewDraftIdx];
    if (!draft) return;
    var idx = draft.courses.findIndex(function (s) { return s.code === code && String(s.seq) === String(seq); });
    var name = idx >= 0 ? draft.courses[idx].name : code;
    if (!confirm('从草稿移除「' + name + '」？')) return;
    draft.courses.splice(idx, 1);
    await NX.store.set('drafts', state.savedDrafts);
    NX.renderDrafts();
    NX.renderPreviewTT(draft.courses, '草稿「' + draft.name + '」预览');
  }
};

// ─── Plan Coverage ──────────────────────────────────────────────

NX.checkPlanCoverage = function () {
  var state = NX.state;
  var codes = new Set();
  var detail = {};
  var collect = function (list) {
    list.forEach(function (c) {
      codes.add(c.code);
      if (!detail[c.code]) detail[c.code] = c;
    });
  };
  collect(state.allCourses.filter(function (c) { return c.selected; }));
  collect(state.stageCart);
  state.savedDrafts.forEach(function (d) { collect(d.courses); });

  var isSports = function (code) {
    var c = state.allCourses.find(function (x) { return x.code === code; });
    return c && ((c.department || '').includes('体育') || (c.attr || '') === '体育');
  };
  var hasSports = Array.from(codes).some(isSports) || state.stageCart.some(function (c) { return isSports(c.code); });

  var isSecondLang = function (code) {
    var c = state.allCourses.find(function (x) { return x.code === code; });
    return c && (c.name.includes('第二外国语') || c.name.includes('二外'));
  };
  var hasSecondLang = Array.from(codes).some(isSecondLang) || state.stageCart.some(function (c) { return isSecondLang(c.code); });

  var isAdvEnglish = function (code) {
    var c = state.allCourses.find(function (x) { return x.code === code; });
    return c && (c.name.includes('进阶读写') || c.name.includes('进阶'));
  };
  var hasAdvEnglish = Array.from(codes).some(isAdvEnglish) || state.stageCart.some(function (c) { return isAdvEnglish(c.code); });

  var isBasicEnglish = function (code) {
    var c = state.allCourses.find(function (x) { return x.code === code; });
    return c && (c.name.includes('阅读写作') || c.name.includes('听说交流'));
  };

  return state.planData.map(function (p) {
    var covered = codes.has(p.code);
    var coveredBy = covered && detail[p.code] ? (detail[p.code].teacher || detail[p.code].name) : '';
    if (!covered && (p.attr === '体育' || p.name.includes('体育') || (p.group || '').includes('体育'))) {
      if (hasSports) { covered = true; coveredBy = '(已有体育课)'; }
    }
    if (!covered && /英语\(3\)/.test(p.name)) {
      if (hasAdvEnglish) { covered = true; coveredBy = '(英语进阶读写)'; }
      else if (hasSecondLang) { covered = true; coveredBy = '(第二外国语替代)'; }
    }
    if (!covered && /英语\([12]\)/.test(p.name)) {
      if (Array.from(codes).some(function (code) { return isBasicEnglish(code); }) || state.stageCart.some(function (c) { return isBasicEnglish(c.code); })) {
        covered = true; coveredBy = '(英语阅读写作/听说交流)';
      }
    }
    return Object.assign({}, p, { covered: covered, coveredBy: coveredBy });
  });
};
