'use strict';
// Topic data contains headings, one-way fingerprints and hashed topic features only.
window.MBESections = {
  data: null, nodes: new Map(), assignments: new Map(), error: '', revision: 0,
  async prepare() {
    try {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      const r = await fetch('./sections-data.json?v=20261101', { cache: 'no-cache',signal:controller.signal }).finally(()=>clearTimeout(timer));
      if (!r.ok) throw new Error('目录暂不可用');
      this.data = await r.json();
      for (const n of this.data.catalog) this.nodes.set(n.id, n);
      this.stops = new Set(this.data.model.stopwords);
    } catch (e) { this.error = e.message; }
  },
  norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); },
  async fingerprint(q) {
    const text = this.norm(q.stem.join(' ')) + '|' + 'ABCD'.split('').map(k => this.norm(q.options[k] || '')).join('|');
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2,'0')).join('');
  },
  features(q) {
    const text = q.stem.join(' ') + ' ' + Object.values(q.options).join(' ');
    const words = (text.toLowerCase().match(/[a-z]{3,}/g) || []).filter(w => !this.stops.has(w));
    const c = new Map(), dim = this.data.model.dimension;
    const add = s => { const k = parseInt(fnv(s),16) % dim; c.set(k,(c.get(k)||0)+1); };
    words.forEach(add); for (let i=0;i<words.length-1;i++) add(words[i]+' '+words[i+1]);
    let norm=0;
    for (const [k,v] of c) { const w=(1+Math.log(v))*this.data.model.idf[k]; c.set(k,w); norm+=w*w; }
    norm=Math.sqrt(norm)||1; for(const [k,v] of c)c.set(k,v/norm);
    return c;
  },
  async indexBanks() {
    if (!this.data) return;
    const rev=++this.revision, next=new Map();
    for(const q of Q.values()) {
      if(q.code==='NCBE')continue; // The separately reserved mock bank stays separate.
      const group=groupOf(q.code).k, hash=await this.fingerprint(q);
      const exact=this.data.exact[group+':'+hash];
      if(exact) { next.set(q.id,{id:exact,kind:'book'}); continue; }
      const v=this.features(q), scores=[];
      for(const [id,weights] of Object.entries(this.data.model.centroids)) {
        if(!id.startsWith(group+'.'))continue;
        let score=0; for(const [k,w] of weights)score+=(v.get(k)||0)*w;
        scores.push([id,score]);
      }
      scores.sort((a,b)=>b[1]-a[1]);
      if(scores.length && scores[0][1]>=0.12) {
        let [id,score]=scores[0], node=this.nodes.get(id);
        // Prefer a broad chapter over a fragile fine-grained guess.
        if(node.parent && (score<0.25 || (scores[1] && score-scores[1][1]<0.025))) id=node.parent;
        next.set(q.id,{id,kind:'auto',score});
      }
    }
    if(rev===this.revision)this.assignments=next;
  },
  assignment(qid) {
    const manual=ST.recs[qid]?.g?.[0];
    if(manual==='unassigned')return {id:'unassigned',kind:'manual'};
    if(manual && this.nodes.has(manual))return {id:manual,kind:'manual'};
    return this.assignments.get(qid) || {id:'unassigned',kind:'unassigned'};
  },
  matches(qid, filter=ST.cfg.section || '') {
    if(!filter)return true;
    const a=this.assignment(qid), n=this.nodes.get(a.id);
    return filter===a.id || n?.parent===filter;
  },
  label(qid) {
    const a=this.assignment(qid), n=this.nodes.get(a.id);
    if(!n)return '待分节';
    const p=n.parent ? this.nodes.get(n.parent) : null;
    return (p ? p.title+' · ' : '')+n.title;
  },
  summary() {
    const counts={book:0,auto:0,manual:0,unassigned:0};
    for(const q of Q.values())if(q.code!=='NCBE')counts[this.assignment(q.id).kind]++;
    return `伴读精确匹配 ${counts.book} 题 · 自动建议 ${counts.auto} 题 · 手动调整 ${counts.manual} 题 · 待分节 ${counts.unassigned} 题`;
  },
  picker(codes, selected=ST.cfg.section || '', id='section-filter', all=true) {
    if(!this.data)return `<p class="small muted">${esc(this.error || '正在载入伴读目录…')}</p>`;
    const groups=new Set(codes.map(c=>groupOf(c).k)), counts=new Map();
    for(const q of Q.values())if(codes.includes(q.code) && q.ans) {
      const a=this.assignment(q.id),n=this.nodes.get(a.id); counts.set(a.id,(counts.get(a.id)||0)+1);
      if(n?.parent)counts.set(n.parent,(counts.get(n.parent)||0)+1);
    }
    let options=all ? '<option value="">全部章节</option><option value="unassigned" '+(selected==='unassigned'?'selected':'')+'>待分节</option>' : '<option value="">恢复自动分节</option><option value="unassigned" '+(selected==='unassigned'?'selected':'')+'>暂不分节</option>';
    for(const parent of this.data.catalog.filter(n=>!n.parent && groups.has(n.group))) {
      const gn=GROUPS.find(g=>g.k===parent.group)?.n || parent.group;
      options+=`<optgroup label="${esc(gn+' · '+parent.title)}">`;
      for(const n of this.data.catalog.filter(n=>n.id===parent.id || n.parent===parent.id)) {
        options+=`<option value="${esc(n.id)}" ${selected===n.id?'selected':''}>${n.parent?'　'+esc(n.title):'整章 · '+esc(n.title)}${all?'（'+(counts.get(n.id)||0)+'）':''}</option>`;
      }
      options+='</optgroup>';
    }
    return `<select id="${id}" aria-label="伴读章节">${options}</select>`;
  },
  questionPanel(q) {
    if(q.code==='NCBE' || !this.data)return '';
    const a=this.assignment(q.id),kind={book:'伴读精确匹配',auto:'自动建议，可调整',manual:'已手动调整',unassigned:'待分节'}[a.kind];
    return `<details class="card stack" style="margin-top:16px"><summary>伴读分节 · ${esc(this.label(q.id))}</summary><p class="small muted">${kind}。按题目内容关联伴读目录，不改变题号或原题。</p>${this.picker([q.code],ST.recs[q.id]?.g?.[0]||'','question-section',false)}</details>`;
  }
};
