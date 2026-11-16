'use strict';
// This catalog contains source headings and locators only. Resolve after submission.
window.MBEReferences = {
  data: null, error: '',
  async prepare() {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    const url = new URL('./reference-data.json?v=20261116-1', location.href).href;
    let cache, saved;
    try {
      try { cache = await window.caches?.open('mbe-reference-headings-v1'); saved = await cache?.match(url); } catch (_) {}
      if (!navigator.onLine && saved) { this.data = await saved.json(); this.error = ''; return; }
      const r = await fetch(url, { cache: 'no-cache', signal: controller.signal });
      if (!r.ok) throw new Error('索引暂未载入');
      const copy = r.clone(); this.data = await r.json(); this.error = '';
      if (cache) await cache.put(url, copy).catch(() => {});
    } catch (e) {
      if (saved) { this.data = await saved.json(); this.error = ''; }
      else this.error = '参考索引暂未载入，联网后请刷新。';
    }
    finally { clearTimeout(timer); }
  },
  suggest(q) {
    if (!MBESections.data) return null;
    const group = q.code === 'NCBE' ? null : groupOf(q.code).k;
    // Use the educational objective after submission; never put hints into the question.
    const text = [q.obj || '', q.obj || '', ...(q.expl || []).slice(0, 4)].join(' ').slice(0, 9000);
    const v = MBESections.features({ stem: [text || q.stem.join(' ')], options: {} });
    const scores = [];
    for (const [id, weights] of Object.entries(MBESections.data.model.centroids)) {
      if (group && !id.startsWith(group + '.')) continue;
      let score = 0; for (const [k, w] of weights) score += (v.get(k) || 0) * w;
      scores.push([id, score]);
    }
    scores.sort((a, b) => b[1] - a[1]);
    if (!scores.length || scores[0][1] < .12) return null;
    let [id, score] = scores[0];
    const node = MBESections.nodes.get(id);
    if (node?.parent && (score < .25 || scores[1] && score - scores[1][1] < .025)) id = node.parent;
    return { id, kind: 'auto', score };
  },
  resolve(q, state) {
    if (!this.data) return null;
    const catalog = this.data.catalog, a = MBESections.assignment(q.id);
    const valid = id => catalog[id] && (q.code === 'NCBE' || catalog[id].group === groupOf(q.code).k);
    let chosen = a;
    if (a.kind !== 'manual' && !(a.kind === 'book' && valid(a.id))) {
      const k = state?.body?.knowledge;
      const fingerprint = MBESections.fingerprints.get(q.id), linked = this.data.objective_links?.[fingerprint];
      const existing = this.data.analysis_links?.[fingerprint];
      if (valid(linked)) chosen = { id: linked, kind: 'objective' };
      else if (valid(k?.subsection_id)) chosen = { id: k.subsection_id, kind: 'analysis' };
      else if (valid(k?.chapter_id)) chosen = { id: k.chapter_id, kind: 'analysis' };
      else if (valid(existing)) chosen = { id: existing, kind: 'analysis' };
      else if (!valid(a.id)) chosen = this.suggest(q);
    }
    if (!chosen || !valid(chosen.id)) return null;
    return { ...catalog[chosen.id], id: chosen.id, kind: chosen.kind };
  },
  panel(q, state) {
    const r = this.resolve(q, state);
    if (!r) return `<aside class="reference-box" aria-label="知识点索引"><div class="teaching-kicker">知识点索引</div><p class="small muted">${esc(this.error || '本题索引待核对，可在下方选择伴读分节。')}</p></aside>`;
    const parent = this.data.catalog[r.parent];
    const exact = r.kind === 'book' || r.kind === 'manual';
    const kind = r.kind === 'manual' ? '已手动指定' : r.kind === 'objective' ? '按原解析考点关联' : exact ? '伴读定位' : '建议索引 · 可在下方调整';
    const title = (parent ? parent.title + ' · ' : '') + r.title;
    const page = r.page_scope === 'point' ? `参考资料第 ${r.source_page} 页` : `参考资料本章从第 ${r.source_page} 页起`;
    const precision = r.parent ? '' : ' · 章级定位';
    return `<aside class="reference-box" aria-label="知识点索引"><div class="reference-heading"><span class="teaching-kicker">知识点索引</span><span class="small muted">${esc(kind + precision)}</span></div><div class="reference-main"><strong class="reference-index">${esc(r.index)}</strong><div class="reference-title">${esc(title)}</div></div><p class="reference-locator">${esc(page)} · 单科伴读第 ${r.companion_page} 页</p><details class="reference-source"><summary>编号与资料定位</summary><p>${esc(this.data.source_name)}；单科文件：${esc(r.companion_file)}。</p><p>第一个数字对应科目，字母对应章，带圈数字对应小节。章级条目及原稿没有独立编号的基础部分保留原层级。</p></details></aside>`;
  }
};
