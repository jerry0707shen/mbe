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
  filterExpanded: new Set(), filterScroll: 0, filterFocus: '',
  selection(value) {
    if(value===undefined){const saved=ST.cfg.sections;value=Array.isArray(saved) && (ST.cfg.section || '')===(saved[0] || '')?saved:(ST.cfg.section || '');}
    const ids=[...new Set((Array.isArray(value)?value:[value]).filter(x=>typeof x==='string' && x))];
    return ids.filter(id=>!ids.includes(this.nodes.get(id)?.parent));
  },
  setSelection(value) {
    const ids=this.selection(value);ST.cfg.sections=ids;ST.cfg.section=ids[0] || '';touchCfg();
  },
  selectionTitle(value) {
    const ids=this.selection(value);
    return !ids.length?'全部章节':ids.length===1?(this.nodes.get(ids[0])?.title || '待分节'):'已选 '+ids.length+' 个章节';
  },
  matches(qid, filter=this.selection()) {
    const ids=this.selection(filter);if(!ids.length)return true;
    const a=this.assignment(qid), n=this.nodes.get(a.id);
    return ids.some(id=>id===a.id || n?.parent===id);
  },
  rememberPicker() {
    const el=document.getElementById('section-filter');if(!el)return;
    this.filterExpanded=new Set([...el.querySelectorAll('[data-section-expand][open]')].map(x=>x.dataset.sectionExpand));
    this.filterScroll=el.querySelector('.section-checklist')?.scrollTop || 0;
    this.filterFocus=document.activeElement?.dataset.sectionCheck || '';
  },
  bindPicker() {
    const el=document.getElementById('section-filter');if(!el)return;
    const ids=this.selection();
    for(const cb of el.querySelectorAll('[data-section-parent]'))cb.indeterminate=!cb.checked && ids.some(id=>this.nodes.get(id)?.parent===cb.dataset.sectionCheck);
    const list=el.querySelector('.section-checklist');if(list)list.scrollTop=this.filterScroll;
    const focus=[...el.querySelectorAll('[data-section-check]')].find(x=>x.dataset.sectionCheck===this.filterFocus);
    if(focus)focus.focus({preventScroll:true});this.filterFocus='';
  },
  multiPicker(codes) {
    if(!this.data)return `<p class="small muted">${esc(this.error || '正在载入伴读目录…')}</p>`;
    const ids=this.selection(),groups=new Set(codes.map(c=>groupOf(c).k)),counts=new Map();
    for(const q of Q.values())if(codes.includes(q.code) && q.ans){const a=this.assignment(q.id),p=this.nodes.get(a.id)?.parent;counts.set(a.id,(counts.get(a.id)||0)+1);if(p)counts.set(p,(counts.get(p)||0)+1);}
    const row=(n,parent=false)=>{const included=ids.includes(n.id)||ids.includes(n.parent);return `<label class="section-choice"><input type="checkbox" data-section-check="${esc(n.id)}" ${parent?'data-section-parent':''} ${included?'checked':''} ${ids.includes(n.parent)?'disabled':''}><span>${parent?'整章 · ':''}${esc(n.title)}</span><span class="small muted">${counts.get(n.id)||0} 题</span></label>`;};
    const chapters=this.data.catalog.filter(n=>!n.parent && groups.has(n.group)).map(n=>{
      const title=groups.size>1?((GROUPS.find(g=>g.k===n.group)?.n || n.group)+' · '+n.title):n.title;
      return `<section class="section-chapter">${row({...n,title},true)}<details data-section-expand="${esc(n.id)}" ${this.filterExpanded.has(n.id)?'open':''}><summary>小节</summary><div class="section-children">${this.data.catalog.filter(c=>c.parent===n.id).map(c=>row(c)).join('')}</div></details></section>`;
    }).join('');
    return `<div id="section-filter" class="section-picker" role="group" aria-labelledby="section-filter-label"><div class="section-actions"><span class="small muted">${ids.length?'已选 '+ids.length+' 项':'全部章节'}</span><button type="button" class="btn ghost" data-section-reset>全部章节／清空选择</button></div><div class="section-checklist">${chapters}${row({id:'unassigned',title:'待分节'})}</div><div class="small muted section-tip">勾选即生效；选整章包含其下所有小节</div></div>`;
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
