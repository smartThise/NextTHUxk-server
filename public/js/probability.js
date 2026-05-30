/* ═══════════════════════════════════════════════════════════════
   NextTHUxk Local — Probability: calculation, formatting
   (pure computation, no DOM/network — identical to extension)
   ═══════════════════════════════════════════════════════════════ */

var NX = NX || {};

// ─── Volunteer Formatting ──────────────────────────────────────

NX.fmtVol = function (v) {
  if (!v) return '';
  var priMatch = v.match(/^\((\d+)\)/);
  var pri = priMatch ? parseInt(priMatch[1]) : 0;
  var cleaned = v.replace(/^\(\d+\)/, '');
  var parts = cleaned.split(',').map(function (n) { return parseInt(n) || 0; });
  if (parts.every(function (n) { return n === 0; }) && !pri) return '';
  var s = parts.join('/');
  if (pri) s = '优先' + pri + '/' + s;
  return s;
};

NX.volColor = function (course) {
  var cap = course.volCapacity || course.capacity || 0;
  var applied = course.volApplied || 0;
  if (!cap || cap === 0) return { level: 'unknown', color: '#86868b', bg: 'rgba(134,134,139,.08)', pct: 0 };
  var ratio = applied / cap;
  if (ratio <= 0.8) return { level: 'easy', color: '#34c759', bg: 'rgba(52,199,89,.1)', pct: Math.min(ratio * 100, 100) };
  if (ratio <= 1.2) return { level: 'medium', color: '#ff9500', bg: 'rgba(255,149,0,.1)', pct: Math.min(ratio * 100, 100) };
  return { level: 'hard', color: '#ff3b30', bg: 'rgba(255,59,48,.1)', pct: Math.min(ratio * 100, 100) };
};

// ─── Probability Calculation ───────────────────────────────────

NX.parseVolArr = function (s) {
  if (!s) return null;
  var priMatch = String(s).match(/^\((\d+)\)/);
  var pri = priMatch ? parseInt(priMatch[1]) : 0;
  var cleaned = String(s).replace(/^\(\d+\)/, '');
  var nums = cleaned.match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  var arr = nums.slice(0, 3).map(function (n) { return parseInt(n, 10) || 0; });
  arr.priority = pri;
  return arr;
};

NX.calcProb = function (course, flag, zy) {
  var cap = parseInt(course.volCapacity || course.capacity || 0, 10) || 0;
  if (!cap) return { prob: -1, label: '无数据', color: '#86868b' };
  var zyIdx = zy - 1;

  // 体育
  if (flag === 'ty') {
    var vols = NX.parseVolArr(course.volSports);
    if (!vols) return { prob: -1, label: '无数据', color: '#86868b' };
    var rem = cap;
    for (var i = 0; i < zyIdx; i++) rem -= vols[i];
    return NX.probResult(rem, vols[zyIdx]);
  }

  // 必修/限选/任选
  var bxV = NX.parseVolArr(course.volRequired);
  var xxV = NX.parseVolArr(course.volElective);
  var rxV = NX.parseVolArr(course.volOptional);
  var rem = cap;

  if (bxV) {
    if (flag === 'bx') {
      for (var i = 0; i < zyIdx; i++) rem -= bxV[i];
      return NX.probResult(rem, bxV[zyIdx]);
    }
    for (var i = 0; i < 3; i++) rem -= bxV[i];
  }
  if (xxV) {
    if (flag === 'xx') {
      for (var i = 0; i < zyIdx; i++) rem -= xxV[i];
      return NX.probResult(rem, xxV[zyIdx]);
    }
    for (var i = 0; i < 3; i++) rem -= xxV[i];
  }
  if (rxV) {
    var pri = rxV.priority || 0;
    if (flag === 'rx') {
      rem -= pri;
      for (var i = 0; i < zyIdx; i++) rem -= rxV[i];
      return NX.probResult(rem, rxV[zyIdx]);
    }
    rem -= pri;
    for (var i = 0; i < 3; i++) rem -= rxV[i];
  }

  return { prob: -1, label: '无数据', color: '#86868b' };
};

NX.probResult = function (rem, applicants) {
  if (!Number.isFinite(rem) || !Number.isFinite(applicants)) {
    return { prob: -1, label: '无数据', percentLabel: '无数据', ratioLabel: '无数据', color: '#86868b' };
  }
  var remShown = Math.max(0, Math.round(rem));
  var applicantsShown = Math.max(0, Math.round(applicants));
  if (rem <= 0) return { prob: 0, label: '0%', percentLabel: '0%', ratioLabel: remShown + '/' + applicantsShown, color: '#ff3b30' };
  var prob = applicants === 0 ? 1 : Math.min(1, rem / applicants);
  if (!Number.isFinite(prob)) return { prob: -1, label: '无数据', percentLabel: '无数据', ratioLabel: '无数据', color: '#86868b' };
  var color;
  if (prob >= 0.8) color = '#34c759';
  else if (prob >= 0.5) color = '#ff9500';
  else color = '#ff3b30';
  var percentLabel = Math.round(prob * 100) + '%';
  var ratioLabel = remShown + '/' + applicantsShown;
  return { prob: prob, label: percentLabel, percentLabel: percentLabel, ratioLabel: ratioLabel, color: color };
};

// ─── Flag / Type Helpers ────────────────────────────────────────

NX.flagName = function (flag) {
  return flag === 'bx' ? '必修' : flag === 'xx' ? '限选' : flag === 'rx' ? '任选' : '体育';
};

NX.probBg = function (color) {
  if (color === '#34c759') return 'rgba(52,199,89,.14)';
  if (color === '#ff9500') return 'rgba(255,149,0,.14)';
  if (color === '#ff3b30') return 'rgba(255,59,48,.14)';
  return 'rgba(142,142,147,.12)';
};

NX.courseFlag = function (course) {
  var a = (course.attr || '').trim();
  if (a === '限选') return 'xx';
  if (a === '任选') return 'rx';
  if (a === '体育') return 'ty';
  if (a === '必修') return 'bx';
  return 'rx';
};

NX.isSportsCourse = function (course) {
  return (course.attr || '') === '体育'
    || (course.department || '').includes('体育')
    || (course.name || '').includes('体育')
    || course.typeLabel === '体育'
    || course.typeCode === 'ty';
};

NX.baseFlag = function (course) {
  if (NX.isSportsCourse(course)) return 'ty';
  return NX.courseFlag(course);
};

NX.allowedFlags = function (bf) {
  if (bf === 'ty') return ['ty'];
  if (bf === 'bx') return ['bx', 'xx', 'rx'];
  if (bf === 'xx') return ['xx', 'rx'];
  return ['rx'];
};

NX.typeCodeToFlag = function (typeCode) {
  return typeCode === '006' ? 'bx' : typeCode === '008' ? 'xx' : typeCode === '007' ? 'rx' : typeCode === 'ty' ? 'ty' : 'bx';
};

NX.zyTypeOf = function (course) {
  if (course.typeLabel === '体育' || course.typeCode === 'ty') return 'ty';
  return { '006': 'bx', '008': 'xx', '007': 'rx' }[course.typeCode] || 'bx';
};

// ─── Current Prob Display ──────────────────────────────────────

NX.currentProbMeta = function (course, flag, zy) {
  var p = NX.calcProb(course, flag, zy);
  return {
    prob: p.prob, label: p.label, percentLabel: p.percentLabel,
    ratioLabel: p.ratioLabel, color: p.color,
    flag: flag, zy: zy,
    flagLabel: NX.flagName(flag),
    bg: NX.probBg(p.color),
  };
};

NX.currentProbLine = function (course, flag, zy) {
  var esc = NX.esc;
  var p = NX.currentProbMeta(course, flag, zy);
  var pillClass = p.prob >= 0 ? '' : ' nx-prob-pill-muted';
  var pillStyle = p.prob >= 0 ? 'style="background:' + p.bg + ';color:' + p.color + '"' : '';
  var detail = p.ratioLabel && p.ratioLabel !== '无数据' ? ' · ' + p.ratioLabel : '';
  return '<div class="nx-prob-line nx-current-prob" data-code="' + esc(course.code) + '" data-seq="' + esc(course.seq || '0') + '" data-flag="' + esc(flag) + '" data-zy="' + esc(zy) + '"><span class="nx-prob-label">当前选法</span><span class="nx-prob-pill' + pillClass + '" ' + pillStyle + '>' + esc(p.flagLabel) + ' · ' + p.zy + '志愿 · ' + (p.percentLabel || p.label) + detail + '</span></div>';
};

NX.fullProbGrid = function (courseOrAc, bf) {
  var aFlags = NX.allowedFlags(bf);
  var rows = [];
  for (var fi = 0; fi < aFlags.length; fi++) {
    var f = aFlags[fi];
    var cells = [];
    for (var z = 1; z <= 3; z++) {
      var p = NX.calcProb(courseOrAc, f, z);
      if (p.prob >= 0) {
        cells.push('<span style="color:' + p.color + ';font-weight:600">' + z + '志愿:' + p.label + '</span>');
      } else {
        cells.push('<span style="color:#86868b">' + z + '志愿:' + p.label + '</span>');
      }
    }
    rows.push('<span style="color:#86868b;font-size:9px">' + NX.flagName(f) + '</span> ' + cells.join(' '));
  }
  return rows.length ? '<div style="margin-top:3px;line-height:1.4;font-size:9px">' + rows.join('<br>') + '</div>' : '';
};
