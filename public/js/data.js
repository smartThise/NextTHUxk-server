/* ═══════════════════════════════════════════════════════════════
   NextTHUxk Local — Data: API 封装层（全部走 /api/* 后端代理）
   ═══════════════════════════════════════════════════════════════ */

var NX = NX || {};

// ─── Low-level API helpers ──────────────────────────────────────

NX.apiFetch = async function (path) {
  var resp = await fetch('/api' + path);
  if (!resp.ok) {
    var err = await resp.json().catch(function () { return { error: 'HTTP ' + resp.status }; });
    throw new Error(err.error || 'HTTP ' + resp.status);
  }
  return resp.json();
};

NX.apiPost = async function (path, body) {
  var resp = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
};

// ─── High-level Data API ────────────────────────────────────────

// 一次性获取全部初始化数据（后端缓存慢数据，快数据实时拉）
NX.fetchInitData = async function (sem, forceRefresh) {
  var d = await NX.apiFetch('/init?sem=' + sem + (forceRefresh ? '&refresh=1' : ''));
  return {
    plan: d.plan || [],
    catalog: d.catalog || [],
    volunteer: d.volunteer || {},
    selected: d.selected || [],
    queueMap: d.queueMap || {},
    queuePhase: !!d.queuePhase,
    candidates: d.candidates || [],
  };
};

NX.fetchPlan = async function (sem) {
  return NX.apiFetch('/plan?sem=' + sem);
};

NX.fetchCourses = async function (sem) {
  return NX.apiFetch('/courses?sem=' + sem);
};

NX.fetchVolunteer = async function (sem) {
  return NX.apiFetch('/volunteer?sem=' + sem);
};

NX.fetchSelected = async function (sem) {
  return NX.apiFetch('/selected?sem=' + sem);
};

NX.fetchQueue = async function (sem) {
  return NX.apiFetch('/queue?sem=' + sem);
};

NX.fetchCandidates = async function (sem) {
  return NX.apiFetch('/candidates?sem=' + sem);
};

NX.fetchLevelTable = async function (sem) {
  return NX.apiFetch('/levelTable?sem=' + sem);
};

NX.fetchDetail = async function (teacherId, code) {
  return NX.apiFetch('/detail?teacherId=' + encodeURIComponent(teacherId || '') + '&code=' + code);
};

// ─── Operations ─────────────────────────────────────────────────

NX.submitCourse = async function (sem, code, seq, zy, flag) {
  var res = await NX.apiPost('/submit?sem=' + sem, {
    code: code, seq: seq, zy: parseInt(zy), flag: flag,
  });
  // 验证结果
  if (res.ok) {
    await new Promise(function (r) { setTimeout(r, 2000); });
    var sel = await NX.fetchSelected(sem);
    var found = sel.some(function (s) { return s.code === code && String(s.seq) === String(seq); });
    if (found) return { ok: true, msg: '选课成功' };
    var cand = await NX.fetchCandidates(sem);
    var foundQ = cand.some(function (s) { return s.code === code && String(s.seq) === String(seq); });
    return foundQ ? { ok: true, msg: '已加入候补队列' } : { ok: false, msg: '选课未生效，请确认课程类型是否正确' };
  }
  return res;
};

NX.dropCourse = async function (sem, code, seq, isQueue) {
  var res = await NX.apiPost('/drop?sem=' + sem, {
    code: code, seq: seq, isQueue: !!isQueue,
  });
  if (res.ok) {
    await new Promise(function (r) { setTimeout(r, 1500); });
    if (isQueue) {
      var cand = await NX.fetchCandidates(sem);
      var still = cand.some(function (s) { return s.code === code && String(s.seq) === String(seq); });
      return still ? { ok: false, msg: '退出队列未生效' } : { ok: true, msg: '已退出候补队列' };
    }
    var sel = await NX.fetchSelected(sem);
    var still = sel.some(function (s) { return s.code === code && String(s.seq) === String(seq); });
    return still ? { ok: false, msg: '退选未生效' } : { ok: true, msg: '退选成功' };
  }
  return res;
};

NX.changeVolunteer = async function (sem, code, seq, targetZy) {
  var res = await NX.apiPost('/changeZy?sem=' + sem, {
    code: code, seq: seq, zy: targetZy,
  });
  if (res.ok) {
    await new Promise(function (r) { setTimeout(r, 1000); });
  }
  return res;
};

// ─── Merge (static data combination) ────────────────────────────

NX.mergeStaticData = function (catalog, volData, plan) {
  var courses = catalog.length ? catalog : plan.map(function (c) {
    return Object.assign({}, c, { available: true, teacher: '', time: '', capacity: '', selected: false, queue: '' });
  });

  // Deduplicate by code+seq (parallel pagination can produce overlapping pages)
  var seen = {};
  courses = courses.filter(function (c) {
    var key = NX.keyOf(c);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });

  if (Object.keys(volData).length) {
    courses.forEach(function (c) {
      var key = c.seq ? c.code + '_' + c.seq : null;
      var v = (key && volData[key]) ? volData[key] : Object.values(volData).find(function (v) { return v.code === c.code; });
      if (v) {
        c.volRequired = v.volRequired;
        c.volElective = v.volElective;
        c.volOptional = v.volOptional;
        c.volSports = v.volSports || '';
        c.volCapacity = v.capacity || c.capacity;
        c.volApplied = v.applied || 0;
        if ((c.attr === '体育' || (c.department || '').includes('体育') || (c.name || '').includes('体育')) && v.volSports) {
          c.volApplied = v.applied || 0;
          c.volCapacity = v.capacity || c.volCapacity;
        }
      }
    });
  }

  if (plan.length) {
    var pm = {};
    plan.forEach(function (p) { pm[p.code] = p.attr; });
    courses.forEach(function (c) { if (!c.attr && pm[c.code]) c.attr = pm[c.code]; });
  }

  return courses;
};
