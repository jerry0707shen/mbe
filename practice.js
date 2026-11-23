'use strict';

window.MBEPractice = (() => {
  const fmt = new Intl.NumberFormat('zh-CN');
  const num = n => fmt.format(n);
  const pctValue = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 100;
    return Math.max(0.1, Math.min(99.9, Math.round(1000 * a / b) / 10));
  };
  const dailyCodes = () => GROUPS.flatMap(g => g.c).filter(c => BANK[c]);
  const hasChoice = a => Array.isArray(a) && /^[A-D]$/.test(a[2]);
  const attempts = r => Array.isArray(r?.a) ? r.a.filter(hasChoice) : [];
  const answered = r => Array.isArray(r?.a) && r.a.some(hasChoice);
  const arrow = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const companionOrder = ['CIV', 'CL', 'CON', 'CRIM', 'EVI', 'RP', 'TOR'];
  const groupEn = { CON: 'Contracts', TOR: 'Torts', CRIM: 'Criminal Law & Procedure', EVI: 'Evidence', CIV: 'Civil Procedure', CL: 'Constitutional Law', RP: 'Real Property' };
  const empty = () => ({ total: 0, done: 0, firstOk: 0, lastOk: 0, today: 0 });
  const sum = (m, key) => { if (!m.has(key)) m.set(key, empty()); return m.get(key); };
  const time = a => Number(a[1]) || 0;
  let group = '';

  function chapter(id) {
    const a = MBESections.assignment(id), n = MBESections.nodes.get(a.id);
    return n ? (n.parent || n.id) : 'unassigned';
  }
  function chapterKey(id, code) { return id === 'unassigned' ? id + ':' + groupOf(code).k : id; }
  function groups() { return GROUPS.filter(g => g.c.some(c => BANK[c])); }
  function focusGroup() {
    const available = groups();
    return available.find(g => g.k === group) || available.find(g => ST.cfg.groups.includes(g.k)) || available[0];
  }
  function selected() {
    if (!MBESections.data) return [];
    return MBESections.selection().filter(id => id === 'unassigned' || groups().some(g => g.k === MBESections.nodes.get(id)?.group));
  }
  function selectedScope(sections = selected()) {
    const legacy = sections.includes('unassigned');
    const chapterGroups = new Set(sections.filter(id => id !== 'unassigned').map(id => MBESections.nodes.get(id)?.group));
    const codes = legacy ? dailyCodes() : groups().filter(g => chapterGroups.has(g.k)).flatMap(g => g.c);
    return { codes, sections };
  }
  function blockScope() {
    const sections = selected();
    if (sections.length) return selectedScope(sections);
    const loaded = groupsAll().filter(g => g.c.some(c => BANK[c]));
    const chosen = loaded.filter(g => ST.cfg.groups.includes(g.k));
    const fallback = focusGroup() || loaded[0];
    return { codes: (chosen.length ? chosen : fallback ? [fallback] : []).flatMap(g => g.c), sections: [] };
  }
  function ids(scope, pool) {
    const codes = new Set(scope.codes), sections = new Set(scope.sections);
    const out = [];
    for (const q of Q.values()) {
      if (!q.ans || !codes.has(q.code) || (sections.size && !sections.has(chapter(q.id)))) continue;
      if (pool === 'unseen' && answered(ST.recs[q.id])) continue;
      if (pool === 'done' && !answered(ST.recs[q.id])) continue;
      out.push(q.id);
    }
    return out;
  }
  function stats() {
    const result = { all: empty(), groups: new Map(), chapters: new Map() }, t = today();
    for (const q of Q.values()) {
      if (!q.ans || q.code === 'NCBE') continue;
      let first, last;
      for (const a of attempts(ST.recs[q.id])) {
        if (!first || time(a) < time(first)) first = a;
        if (!last || time(a) >= time(last)) last = a;
      }
      const g = groupOf(q.code).k, ch = chapterKey(chapter(q.id), q.code);
      for (const roll of [result.all, sum(result.groups, g), sum(result.chapters, ch)]) {
        roll.total++;
        if (!first) continue;
        roll.done++;
        if (first[3]) roll.firstOk++;
        if (last[3]) roll.lastOk++;
        if (time(first) && dayNum(time(first)) === t) roll.today++;
      }
    }
    return result;
  }
  function bar(p, name) {
    return `<span class="study-bar" role="img" aria-label="${esc(name)}：已做 ${p.done} / ${p.total}，最近答对 ${p.lastOk} 道，待巩固 ${p.done - p.lastOk} 道"><i class="study-bar-right" style="width:${p.total ? 100 * p.lastOk / p.total : 0}%"></i><i class="study-bar-missed" style="width:${p.total ? 100 * (p.done - p.lastOk) / p.total : 0}%"></i></span>`;
  }
  function launch(scope, key = '', pool = 'unseen') {
    const g = focusGroup();
    let details;
    if (scope === 'selection') {
      const chapters = selected();
      if (!chapters.length) return;
      details = { ...selectedScope(chapters), name: MBESections.selectionTitle(chapters) };
    } else if (scope === 'chapter' && g && (key === 'unassigned' || MBESections.nodes.get(key)?.group === g.k)) {
      details = { codes: g.c, sections: [key], name: g.n + ' · ' + MBESections.selectionTitle([key]) };
    } else if (scope === 'subject' && g) {
      details = { codes: g.c, sections: [], name: g.n };
    } else if (scope === 'daily') {
      details = { codes: dailyCodes(), sections: [], name: '全科' };
    }
    if (details) startFree({ ...details, pool: pool === 'done' ? 'done' : 'unseen' });
  }
  function goTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function showGroup(key) {
    if (!groups().some(g => g.k === key)) return;
    group = key;
    render();
    goTo('practice-chapters');
  }
  function hero(p, prepared) {
    const left = p.total - p.done, cover = pctValue(p.done, p.total);
    const sub = !prepared ? '正在载入题库。' : !p.total ? '当前题库暂无可判分的日常练习题。' : left ? '每题提交后即可查看解析。' : '日常题库已全部做过。可以重练或回看错题。';
    return `<section class="study-hero" aria-labelledby="practice-title">
      <div class="study-intro"><h1 id="practice-title">做题</h1><p>${sub}</p>
        <div class="study-hero-actions">
          ${left ? `<button type="button" class="btn primary study-start" id="startfree" data-launch="daily">开始未做题 <span>${num(left)} 题</span>${arrow}</button>` : p.done ? `<button type="button" class="btn primary study-start" data-launch="daily" data-practice-pool="done">重练已做题 ${arrow}</button>` : `<button type="button" class="btn study-start" ${prepared ? 'disabled' : 'data-builtin-retry'}>${prepared ? '暂无新题' : '重新准备题库'}</button>`}
          ${p.total ? `<button type="button" class="study-hero-link" data-study-scroll="practice-subjects">选科目与章节 ${arrow}</button>` : ''}
        </div>
      </div>
      ${p.total ? `<div class="study-hero-meter">
        <div><span>日常题库覆盖</span><strong>${cover}%</strong></div>
        <div class="bar" role="img" aria-label="已做 ${p.done} / ${p.total} 题"><i style="width:${cover}%"></i></div>
        <span>已做 ${num(p.done)} / ${num(p.total)} 题</span>
      </div>` : ''}
    </section>`;
  }
  function overview(p) {
    return `<div class="study-overview" aria-label="练习概览">
      <div><span>今日新做</span><strong>${num(p.today)}<small> 题</small></strong></div>
      <div><span>未做题</span><strong>${num(p.total - p.done)}<small> 题</small></strong></div>
      <div><span>首做正确率</span><strong>${pct(p.firstOk,p.done)}</strong></div>
      <div><span>最近正确率</span><strong>${pct(p.lastOk,p.done)}</strong></div>
    </div>`;
  }
  function subjectCards(model, focused, selection) {
    const cards = groups().sort((a,b) => companionOrder.indexOf(a.k) - companionOrder.indexOf(b.k)).map(g => {
      const p = model.groups.get(g.k) || empty();
      const ix = String(companionOrder.indexOf(g.k) + 1).padStart(2,'0');
      const count = selection.filter(id => MBESections.nodes.get(id)?.group === g.k).length;
      return `<button type="button" class="study-subject" data-study-group="${g.k}" data-progress-group="${g.k}" aria-pressed="${g.k === focused.k}">
        <span class="study-subject-top"><span class="study-number">${ix}</span><span>${count ? `已选 ${count} 章` : `${pctValue(p.done,p.total)}%`}</span></span>
        <span class="study-subject-name">${g.n}</span><span class="study-subject-en">${groupEn[g.k]}</span>
        ${bar(p, g.n)}<span class="study-subject-foot">已做 ${p.done} / ${p.total}</span>
      </button>`;
    }).join('');
    return `<section class="study-subjects" aria-labelledby="practice-subjects">
      <div class="study-section-head"><h2 id="practice-subjects" tabindex="-1">各科进度</h2><p>点选科目，查看章节与练习进度。</p></div>
      <div class="study-subject-grid">${cards}</div>
    </section>`;
  }
  function chapterCard(id, title, p, selection, unassigned = false) {
    const chosen = selection.includes(id), left = p.total - p.done;
    const match = /^([A-Z]+)\s+(.+)$/.exec(title);
    const code = match ? match[1] : '…', label = match ? match[2] : title;
    const status = !p.total ? '暂无题目' : !p.done ? '未开始' : left ? `已做 ${pctValue(p.done,p.total)}%` : '已做完';
    const quick = left ? `<button type="button" class="study-row-action" data-launch="chapter" data-study-chapter="${esc(id)}" aria-label="做 ${esc(title)} 的未做题">做新题 ${arrow}</button>` : '';
    return `<article class="study-chapter${chosen ? ' is-picked' : ''}">
      <${unassigned ? 'div' : 'label'} class="study-chapter-top${unassigned ? ' is-unassigned' : ''}">
        ${unassigned ? '' : `<input type="checkbox" data-section-check="${esc(id)}" ${chosen ? 'checked' : ''} ${!p.total && !chosen ? 'disabled' : ''} aria-label="勾选整章 ${esc(title)}">`}
        <span class="study-chapter-code">${esc(code)}</span><strong>${esc(label)}</strong><span class="study-state${p.done && !left ? ' is-complete' : ''}">${status}</span>
      </${unassigned ? 'div' : 'label'}>
      ${bar(p, title)}
      <div class="study-chapter-foot"><div><span>${p.total ? `${p.done} / ${p.total} 题` : '当前题库暂无此章题目'}</span>${p.done ? `<span>最近答对 ${p.lastOk} / ${p.done}</span>` : ''}</div>${quick}</div>
    </article>`;
  }
  function chapters(model, focused, selection) {
    const p = model.groups.get(focused.k) || empty(), left = p.total - p.done;
    const available = MBESections.data;
    const rows = [...MBESections.nodes.values()].filter(n => n.group === focused.k && !n.parent).map(n => chapterCard(n.id, n.title, model.chapters.get(n.id) || empty(), selection)).join('');
    const unmapped = model.chapters.get('unassigned:' + focused.k);
    const scope = selectedScope(selection), selectedNew = selection.length ? ids(scope,'unseen').length : 0;
    const selectedDone = selection.length ? ids(scope,'done').length : 0;
    const selectedBar = selection.length ? `<div class="study-selection">
      <div><strong>已选 ${selection.length} 章</strong><span>${selectedNew ? num(selectedNew) + ' 道未做' : selectedDone ? '所选章节已经做过一遍' : '所选章节暂无可用题'}</span></div>
      <div><button type="button" class="study-text-btn" data-section-reset>清空</button>
        ${selectedNew ? `<button type="button" class="btn primary" data-launch="selection">开始所选章节 ${arrow}</button>` : selectedDone ? `<button type="button" class="btn" data-launch="selection" data-practice-pool="done">重练所选章节 ${arrow}</button>` : ''}
      </div></div>` : '';
    return `<section class="study-chapters" aria-labelledby="practice-chapters"><div class="study-chapters-head">
      <div><h2 id="practice-chapters" tabindex="-1">${focused.n}章节</h2>
      <p>${available ? '可直接勾选整章，也可跨科目多选。' : '章节目录暂未载入，仍可按科目练习。'}</p></div>
      <div class="study-chapters-actions"><button type="button" class="study-text-btn" data-study-scroll="practice-subjects">切换科目</button>${left ? `<button type="button" class="btn primary" data-launch="subject">做这科的 ${num(left)} 道新题 ${arrow}</button>` : p.done ? `<button type="button" class="btn" data-launch="subject" data-practice-pool="done">重练这科 ${arrow}</button>` : ''}</div>
      </div>${selectedBar}
      ${available ? `<div class="study-legend" aria-label="进度条图例"><span><i class="study-bar-right"></i>最近答对</span><span><i class="study-bar-missed"></i>待巩固</span><span><i class="study-bar-unseen"></i>未做</span></div>
      <div class="study-chapter-grid" role="group" aria-label="${focused.n}整章多选">${rows}${unmapped?.total ? chapterCard('unassigned','待分节',unmapped,selection,true) : ''}</div>` : ''}
      </section>`;
  }
  function alternatives(p) {
    const wb = wbItems({all:true}).length;
    const scope = blockScope(), c = ST.cfg, chapters = scope.sections.length;
    const avail = poolIds(scope.codes,c.pool,scope.sections).length;
    const timedGroups = groupsAll().filter(g => g.c.some(x => BANK[x])).map(g => `<button type="button" class="chip" data-grp="${g.k}" aria-pressed="${g.c.some(x => scope.codes.includes(x))}">${g.n}</button>`).join('');
    const pools = [['unseen','未做过'],['all','全部'],['wrong','做错过'],['flag','已标记'],['wb','错题本中']].map(([k,n]) => `<button type="button" data-pool="${k}" aria-pressed="${c.pool === k}">${n}</button>`).join('');
    const mock = [1,2].map(k => {
      const s = Object.values(ST.sessions).filter(x => x.kind === 'mock' + k).sort((a,b) => b.u - a.u)[0];
      return `<button type="button" class="btn study-mock" data-mock="${k}"><strong>第 ${k} 场</strong><span>${s?.done ? '已完成 · ' + mockScore(s) : s && answeredCount(s) ? '进行中' : '100 题 · 3 小时'}</span>${arrow}</button>`;
    }).join('');
    return `<section class="study-alternatives" aria-labelledby="study-alternatives-title">
      <div class="study-section-head"><h2 id="study-alternatives-title">专项与模考</h2></div>
      <div class="study-alt-grid"><a class="study-alt-link" href="#wrongbook">${I.book}<span><b>回顾错题</b><small>${wb ? `错题本中有 ${num(wb)} 题` : '答错的题会收在这里'}</small></span>${arrow}</a>
      <button type="button" class="study-alt-link" data-launch="daily" data-practice-pool="done" ${p.done ? '' : 'disabled'}>${I.grid}<span><b>重练已做题</b><small>${p.done ? `从已做的 ${num(p.done)} 题中练习` : '完成第一题后可重练'}</small></span>${arrow}</button>
      <details class="study-detail" data-home-detail="practice" ${HOME_DETAILS.practice ? 'open' : ''}><summary><span><b>定量练习与考试</b><small>自选题数、题池和时限</small></span></summary>
        <div class="stack study-detail-body">
          ${chapters ? `<p class="small muted">范围：上方勾选的 ${chapters} 章</p>` : `<div class="field"><div class="label">选择科目</div><div class="chips">${timedGroups}</div></div>`}
          <div class="field"><div class="label">题池</div><div class="seg">${pools}</div><div class="small muted">可用 ${num(avail)} 题</div></div>
          <div class="field"><div class="label">模式</div><div class="modes">
            <button type="button" class="mode" data-mode="practice" aria-pressed="${c.mode === 'practice'}"><b>练习</b><span>每题提交后看解析</span></button>
            <button type="button" class="mode" data-mode="exam" aria-pressed="${c.mode === 'exam'}"><b>考试</b><span>倒计时，交卷后看成绩</span></button></div></div>
          <div class="row study-timing"><div class="field"><label class="label" for="qcount">题数</label><input id="qcount" class="num" type="number" min="1" max="200" value="${c.count}"></div>
            <div class="field"><label class="label" for="qpace">每题分钟</label><input id="qpace" class="num" type="number" min="0.5" max="10" step="0.1" value="${c.pace}"></div></div>
          <label class="check"><input type="checkbox" id="shuf" ${c.shuffle ? 'checked' : ''}>打乱题序</label>
          <label class="check"><input type="checkbox" id="askc" ${c.askConf ? 'checked' : ''}>记录作答把握</label>
          <div class="row"><button type="button" class="btn primary" id="start" ${avail ? '' : 'disabled'}>开始${c.mode === 'exam' ? '考试' : '练习'} ${arrow}</button><span class="small muted">${Math.min(avail,c.count)} 题${c.mode === 'exam' && avail ? ' · ' + fmtSec(Math.round(Math.min(avail,c.count) * c.pace * 60)) : ''}</span></div>
      </div></details>
      <details class="study-detail" data-home-detail="mock" ${HOME_DETAILS.mock ? 'open' : ''}><summary><span><b>NCBE 全真模考</b><small>与日常题池分开</small></span></summary>
        <div class="stack study-detail-body">${BANK.NCBE ? mock : '<p class="small muted">NCBE 题库载入后可开始模考。</p>'}</div></details></div>
      </section>`;
  }
  function view() {
    const model = stats(), p = model.all, focused = focusGroup(), selection = selected();
    return `<div class="study-home">${hero(p,!bankEmpty())}${overview(p)}
      ${focused ? subjectCards(model,focused,selection) + chapters(model,focused,selection) : ''}
      ${!bankEmpty() ? alternatives(p) : ''}
      <details class="study-detail study-stat-detail" data-home-detail="stats" ${HOME_DETAILS.stats || VIEW === 'stats' ? 'open' : ''}>
        <summary id="practice-stats" tabindex="-1"><span><b>详细统计</b><small>近 14 天、各科正确率与错因</small></span>${I.chart}</summary>
        <div class="study-detail-body"><p class="small muted study-stat-note">详细统计也计入已作答的 NCBE 模考题。</p>${viewStats()}</div>
      </details>${backupBanner()}</div>`;
  }
  return { view, ids, launch, showGroup, goTo, answered, attempts, blockScope };
})();
