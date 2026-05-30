/* ═══════════════════════════════════════════════════════════════
   NextTHUxk Local — AI: AI search + smart scheduling
   (mirrors extension ai.js, adapted for local server)
   ═══════════════════════════════════════════════════════════════ */

var NX = NX || {};

NX.aiSearch = async function () {
  var state = NX.state;
  var api = (document.getElementById('ai-api').value || '').trim();
  var model = (document.getElementById('ai-model').value || '').trim() || 'gpt-4o-mini';
  var token = (document.getElementById('ai-token').value || '').trim();
  var prompt = (document.getElementById('ai-search-prompt') || {}).value || '';
  prompt = (prompt || '').trim();
  var pref = (document.getElementById('ai-pref') || {}).value || '';
  pref = (pref || '').trim();
  var st = document.getElementById('ai-search-st');
  var results = document.getElementById('ai-search-results');
  var btn = document.getElementById('ai-search-btn');

  if (!api || !token) { st.className = 'nx-st err'; st.textContent = '❌ 请先填写 API URL 和 Token'; return; }
  if (!prompt) { st.className = 'nx-st err'; st.textContent = '❌ 请输入搜索描述'; return; }

  st.className = 'nx-st'; st.innerHTML = '<span class="nx-spin"></span> AI 正在搜索…';
  btn.disabled = true;
  results.innerHTML = '';

  try {
    var q = (document.getElementById('search').value || '').toLowerCase();
    var f = document.querySelector('.nx-chip.on') ? document.querySelector('.nx-chip.on').dataset.f : 'all';
    var filtered = state.allCourses.slice();
    if (q) filtered = filtered.filter(function (c) { return c.name.toLowerCase().includes(q) || c.code.includes(q) || (c.teacher || '').toLowerCase().includes(q); });
    if (f === 'available') filtered = filtered.filter(function (c) { return c.available; });
    else if (f === 'required') filtered = filtered.filter(function (c) { return c.attr === '必修'; });
    else if (f === 'elective') filtered = filtered.filter(function (c) { return c.attr === '限选'; });
    else if (f === 'sports') filtered = filtered.filter(function (c) { return c.attr === '体育' || (c.department || '').includes('体育'); });

    var previewCourses = [];
    var previewLabel = '无';
    if (state.previewMode === 'selected') {
      previewCourses = state.allCourses.filter(function (c) { return c.selected; }).concat(
        state.candidateCourses.filter(function (cc) { return !state.allCourses.some(function (ac) { return ac.selected && ac.code === cc.code; }); })
      );
      previewLabel = '当前已选';
    } else if (state.previewMode === 'stage') {
      previewCourses = state.stageCart;
      previewLabel = '暂存区';
    } else if (state.previewMode === 'draft' && state.previewDraftIdx >= 0 && state.savedDrafts[state.previewDraftIdx]) {
      previewCourses = state.savedDrafts[state.previewDraftIdx].courses;
      previewLabel = '草稿「' + state.savedDrafts[state.previewDraftIdx].name + '」';
    }

    var occupiedSlots = [];
    previewCourses.forEach(function (c) {
      NX.parseTimeSlots(c.time || '').forEach(function (s) {
        var k = s.day + ' ' + s.slot;
        if (!occupiedSlots.find(function (x) { return x.key === k; })) {
          occupiedSlots.push({ key: k, day: s.day, slot: s.slot, name: c.name || c.code });
        }
      });
    });

    var courseList = filtered.map(function (c) {
      var conflicts = NX.findPreviewConflicts(c);
      return {
        name: c.name, code: c.code, seq: c.seq, credits: c.credits,
        teacher: c.teacher, time: c.time, department: c.department,
        attr: c.attr, remaining: c.remaining, capacity: c.capacity,
        conflict: conflicts.length > 0,
        conflictWith: conflicts.map(function (cf) { return cf.name; }).join(', '),
        available: c.available, selected: c.selected,
        tongshiGroup: c.tongshiGroup, courseFeature: c.courseFeature, grade: c.grade,
      };
    });

    var apiPrompt = '你是清华大学选课AI助手。学生想在已筛选的课程中找课。\n\n' +
      '## 当前预览课表：' + previewLabel + '（' + previewCourses.length + '门）\n' +
      '已占用时间：' + (occupiedSlots.length ? occupiedSlots.map(function (s) { return s.key + '(' + s.name + ')'; }).join('、') : '无') + '\n\n' +
      '## 候选课程（共' + courseList.length + '门，已按用户条件筛选）\n' +
      JSON.stringify(courseList.slice(0, 200)) + '\n\n' +
      '## 学生需求\n' + prompt + '\n\n' +
      '## 学生偏好\n' + (pref || '无特殊偏好') + '\n\n' +
      '请从候选课程中推荐最匹配学生需求的课程。优先推荐不与预览课表冲突的课。如需推荐冲突课程请明确说明。\n\n' +
      '返回纯JSON（不要markdown代码块），格式：\n' +
      '{"recommendations":[{"code":"课程号","seq":"课序号","name":"课名","reason":"推荐理由（一句话）","conflict":false,"conflictWith":""}],"summary":"总体建议"}\n\n' +
      'conflict为true表示该课与预览课表时间冲突。最多推荐10门。';

    var resp = await fetch(api.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ model: model, messages: [{ role: 'system', content: '你是选课助手，只返回JSON。' }, { role: 'user', content: apiPrompt }], temperature: 0.3 }),
    });
    if (!resp.ok) throw new Error('API HTTP ' + resp.status);
    var data = await resp.json();
    var content = data.choices ? data.choices[0].message.content : null;
    if (!content) throw new Error('API 返回为空');
    var result = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

    var recs = result.recommendations || [];
    if (!recs.length) {
      results.innerHTML = '<div class="nx-st">未找到匹配课程</div>';
    } else {
      results.innerHTML = (result.summary ? '<div class="nx-st ok" style="margin-bottom:8px">' + NX.esc(result.summary) + '</div>' : '') +
        recs.map(function (r) {
          var course = state.allCourses.find(function (c) { return c.code === r.code && String(c.seq || '0') === String(r.seq || '0'); });
          var isConflict = r.conflict || (course && NX.findPreviewConflicts(course).length > 0);
          var borderColor = isConflict ? '#ff9500' : '#34c759';
          var conflictHtml = isConflict ? '<div style="font-size:10px;color:#ff9500;margin-top:4px">⚠ 与' + NX.esc(r.conflictWith || '预览课表') + '时间冲突</div>' : '';
          var addBtn = course && !course.selected ? '<button class="nx-stage-btn" data-code="' + NX.esc(r.code) + '" data-seq="' + NX.esc(r.seq || '0') + '" style="margin-top:4px;font-size:10px">暂存</button>' : '';
          return '<div style="padding:10px;margin-top:6px;border-radius:10px;border-left:3px solid ' + borderColor + ';background:rgba(0,0,0,.02)">' +
            '<div style="font-weight:700;font-size:13px">' + NX.esc(r.name) + ' <span style="color:#86868b;font-weight:400">' + NX.esc(r.code) + '</span></div>' +
            '<div style="font-size:11px;color:#86868b;margin-top:2px">' + (course ? NX.esc(course.teacher || '') + ' · ' + NX.esc(course.time || '') : '') + '</div>' +
            '<div style="font-size:12px;margin-top:4px;color:#1d1d1f">' + NX.esc(r.reason) + '</div>' +
            conflictHtml + addBtn + '</div>';
        }).join('');
      results.querySelectorAll('.nx-stage-btn').forEach(function (b) {
        b.onclick = function () {
          var ac = state.allCourses.find(function (c) { return c.code === b.dataset.code && String(c.seq || '0') === String(b.dataset.seq || '0'); });
          if (ac) NX.addToStage(ac.code, ac.seq, NX.baseFlag(ac), 3);
        };
      });
    }
    st.className = 'nx-st ok';
    st.textContent = '✅ 找到 ' + recs.length + ' 门推荐课程';
  } catch (e) {
    st.className = 'nx-st err'; st.textContent = '❌ ' + e.message;
  } finally { btn.disabled = false; }
};

NX.callAI = async function () {
  var state = NX.state;
  var api = (document.getElementById('ai-api').value || '').trim();
  var model = (document.getElementById('ai-model').value || '').trim() || 'gpt-4o-mini';
  var token = (document.getElementById('ai-token').value || '').trim();
  var pref = (document.getElementById('ai-pref').value || '').trim();
  var st = document.getElementById('ai-st');
  var btn = document.getElementById('ai-btn');

  if (!api || !token) { st.className = 'nx-st err'; st.textContent = '❌ 请填写 API URL 和 Token'; return; }

  st.className = 'nx-st'; st.innerHTML = '<span class="nx-spin"></span> AI 正在分析课程数据…';
  btn.disabled = true;

  try {
    var bxTyCourses = state.allCourses.filter(function (c) {
      return c.attr === '必修' || c.attr === '体育' || (c.department || '').includes('体育');
    }).map(function (c) {
      return { name: c.name, code: c.code, seq: c.seq || '', credits: c.credits, time: c.time || '', teacher: c.teacher || '', available: c.available, attr: c.attr, remaining: c.remaining };
    });

    var selectedInfo = state.allCourses.filter(function (c) { return c.selected; }).map(function (c) {
      return { name: c.name, code: c.code, seq: c.seq, credits: c.credits, time: c.time, zy: c.zy, typeLabel: c.typeLabel };
    });
    var selectedCredits = selectedInfo.reduce(function (s, c) { return s + (c.credits || 0); }, 0);

    var draftsInfo = state.savedDrafts.map(function (d) {
      return { name: d.name, courses: d.courses.map(function (c) { return { name: c.name, code: c.code, seq: c.seq, time: c.time, flag: c.flag, zy: c.zy, credits: c.credits }; }) };
    });

    var gradeNames = ['', '大一', '大二', '大三', '大四'];
    var prompt = '你是清华大学选课AI助手。请根据以下信息推荐最优选课方案，确保无时间冲突。\n\n' +
      '## 用户信息\n- 当前年级：' + (gradeNames[state.GRADE] || '未知') + '（第' + (state.GRADE || '?') + '年本科）\n- 当前学期：' + state.SEM + '\n\n' +
      '## 本学期可选的必修课和体育课（时间格式：星期-大节(周次)，如 3-2(全周) 表示周三第2大节）\n' +
      JSON.stringify(bxTyCourses, null, 1) + '\n\n' +
      '## 当前已选课表（' + selectedInfo.length + '门 · ' + selectedCredits + '学分）\n' +
      (selectedInfo.length ? JSON.stringify(selectedInfo, null, 1) : '无') + '\n\n' +
      '## 已保存的暂存课表\n' +
      (draftsInfo.length ? JSON.stringify(draftsInfo, null, 1) : '无') + '\n\n' +
      '## 用户偏好\n' + (pref || '无特殊偏好，请合理推荐') + '\n\n' +
      '重要约束：\n1. 只推荐与用户年级匹配的课程。例如大三学生不应选大一大二的体育课(如体育(1)、体育(2))，应选体育(3)或以上。\n' +
      '2. 课程名中的数字通常表示年级段：体育(1)=大一体育，体育(2)=大二体育，体育(3)=大三体育。\n' +
      '3. 请根据已有课表的时间空隙，从必修课和体育课中选择合适的课程组合。\n' +
      '4. 对于任选课和通识课，不需要逐门搜索，只需根据已有课表的空闲时段给出选课方向建议即可。\n\n' +
      '返回纯JSON（不要markdown代码块），格式：\n' +
      '{"courses":[{"code":"课号","seq":"课序","name":"课名","credits":3,"time":"3-2(全周)","teacher":"教师","flag":"bx","zy":3,"reason":"推荐理由"}],"total_credits":30,"summary":"整体分析","suggestions":["对任选/通识课的建议"]}\n\n' +
      'flag: bx=必修 xx=限选 rx=任选 ty=体育。zy: 志愿号1-3。结果将直接存入暂存草稿。';

    var resp = await fetch(api.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ model: model, messages: [{ role: 'system', content: '你是选课助手，只返回JSON。' }, { role: 'user', content: prompt }], temperature: 0.3 }),
    });
    if (!resp.ok) throw new Error('API HTTP ' + resp.status);
    var data = await resp.json();
    var content = data.choices ? data.choices[0].message.content : null;
    if (!content) throw new Error('API 返回为空');
    var schedule = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

    // Load AI result into staging cart
    state.stageCart = (schedule.courses || []).map(function (c) {
      var ac = state.allCourses.find(function (x) { return x.code === c.code; });
      return {
        code: c.code, seq: c.seq || '0', name: c.name || '', teacher: c.teacher || '',
        time: c.time || '', credits: c.credits || 0,
        flag: c.flag || 'bx', zy: c.zy || 3,
        baseFlag: ac ? NX.baseFlag(ac) : 'rx',
      };
    });
    NX.renderStageCart();
    NX.renderPreviewTT(state.stageCart, 'AI 推荐方案');
    NX.store.set('stageCart', state.stageCart);

    var aiName = 'AI推荐';
    var saved = NX.askReplaceDraft(aiName, state.stageCart);
    if (saved) {
      state.stageCart = [];
      NX.renderStageCart();
      NX.store.set('stageCart', state.stageCart);
    }

    var conflicts = NX.detectConflicts(state.stageCart.length ? state.stageCart : (state.savedDrafts[state.savedDrafts.length - 1] ? state.savedDrafts[state.savedDrafts.length - 1].courses : []));
    st.className = conflicts.length ? 'nx-st err' : 'nx-st ok';
    var msg = conflicts.length
      ? '⚠ AI方案有 ' + conflicts.length + ' 处时间冲突，请手动调整'
      : '✅ AI方案已生成！' + (schedule.courses ? schedule.courses.length : 0) + '门课 · ' + (schedule.total_credits || '?') + '学分';
    if (saved) msg += ' — 已保存为「' + aiName + '」';
    else msg += ' — 仅保留在暂存区';
    if (schedule.summary) msg += '\n' + schedule.summary;
    if (schedule.suggestions && schedule.suggestions.length) msg += '\n建议: ' + schedule.suggestions.join('; ');
    st.textContent = msg;

    NX.store.set('config', { api: api, model: model, token: token, pref: pref });
  } catch (e) {
    st.className = 'nx-st err'; st.textContent = '❌ ' + e.message;
  } finally { btn.disabled = false; }
};
