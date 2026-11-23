'use strict';
// Only authenticated, submitted questions are sent by ID. Keys never enter this file.
window.MBETeaching={
  states:new WeakMap(),pending:new WeakMap(),cache:new Map(),database:null,generation:-1,version:'20261113-1',
  get prefix(){return 'teaching:'+this.version+':';},
  hydrate(kv){
    this.database=IDB.db || IDB.mem;
    this.generation=MBECloud.generation;
    this.cache.clear();
    this.states=new WeakMap();
    this.pending=new WeakMap();
    for(const [key,body] of Object.entries(kv)){
      if(key.startsWith(this.prefix))this.cache.set(key.slice(this.prefix.length),body);
    }
  },
  inScope(){return !!this.database && this.database===(IDB.db || IDB.mem) && this.generation===MBECloud.generation;},
  matches(q,body){return body?.answer===q.ans && body?.knowledge && Array.isArray(body?.essay?.paragraphs) && body?.zh?.options;},
  read(q){
    if(!this.inScope())return null;
    const saved=this.cache.get(MBESections.fingerprints.get(q.id));
    if(this.matches(q,saved))return {state:'ready',body:saved};
    const state=this.states.get(q);
    return state?.state==='ready' && !this.matches(q,state.body) ? null : state;
  },
  safe(s){return esc(String(s).replace(/"([^"]+)"/g,'“$1”').replace(/(\p{L})'(?=\p{L})/gu,'$1’').replace(/'([^']+)'/g,'‘$1’').replace(/\{REF:[^|}]+\|([^}]+)\}/g,'$1')).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');},
  paragraphs(items){return (items||[]).map(p=>`<p>${this.safe(p)}</p>`).join('');},
  content(q,state){
    if(state?.body){
      const b=state.body,k=b.knowledge,chapter=MBESections.nodes.get(k.chapter_id),sub=MBESections.nodes.get(k.subsection_id);
      return `<aside class="knowledge-box" aria-label="本题知识点"><div class="teaching-kicker">本题知识点</div><dl><div><dt>章节</dt><dd>${esc(chapter?.title||'待核对')}</dd></div><div><dt>子章节</dt><dd>${esc(sub?.title||'本章综合')}</dd></div><div><dt>子知识点</dt><dd>${(k.concepts||[]).map(x=>`<span class="concept-tag">${esc(x)}</span>`).join('')}</dd></div></dl></aside>
        <section class="essay-model" lang="en"><div class="teaching-kicker">01 · 英文 Essay 式示范</div><h3>${esc(b.essay.title)}</h3><div class="etext">${this.paragraphs(b.essay.paragraphs)}</div></section>
        <section class="chinese-analysis" lang="zh-CN"><div class="teaching-kicker">02 · 中文解析</div><p class="teaching-summary">${this.safe(b.zh.summary)}</p><h4>适用规则</h4>${this.paragraphs(b.zh.rule)}<h4>本题如何适用</h4>${this.paragraphs(b.zh.application)}
        <div class="option-analysis">${'ABCD'.split('').map(letter=>`<section class="analysis-choice ${letter===q.ans?'correct':''}"><h4>${letter} · ${letter===q.ans?'正确':'错误'}</h4><p>${this.safe(b.zh.options[letter])}</p></section>`).join('')}</div>
        ${b.zh.flow?.length>1?`<ol class="rule-flow" aria-label="判断路径">${b.zh.flow.map(x=>`<li>${this.safe(x)}</li>`).join('')}</ol>`:''}
        <aside class="takeaway"><b>判断点</b><p>${this.safe(b.zh.takeaway)}</p></aside></section>
        <p class="small muted teaching-footnote">依本题事实示范 essay 的规则适用与论证；供写法练习。AI 辅助编写，可对照下方原题解析核对。</p>`;
    }
    const messages={signedout:'登录后可读取私有云端解析。',offline:'联网后可载入中文解析与英文示范。',loading:'正在载入。可先阅读下方原题解析。',review:'本题的来源或答案需要核对，暂不展示未经核对的新解析。',reserved:'此题属于保留的 NCBE 练习题，继续保留原解析。',free_credit_limit:'免费生成额度已用尽或到期，已有解析仍可阅读。',cloud_bank_required:'请先将这份题库备份到云端，再载入新解析。',answer_first:'作答记录尚未同步，请稍后重试。',error:'新解析暂未载入，做题记录已保留。'};
    const key=this.status(state);
    return `<div class="teaching-status" role="status"><p>${messages[key]||messages.error}</p>${state?.state==='review'&&state.reason?`<p>${this.safe(state.reason)}</p>`:''}${!['signedout','loading','reserved','review','free_credit_limit'].includes(key)?`<button class="btn" type="button" data-teaching-retry="${esc(q.id)}">重新载入解析</button>`:''}</div>`;
  },
  status(state){return state?.state || (!MBECloud.user ? 'signedout' : navigator.onLine ? 'loading' : 'offline');},
  statusLabel(state){
    const key=this.status(state);
    return ({ready:'可查看',signedout:'登录后可用',offline:'联网后可用',loading:'正在载入',reserved:'仅原题解析'})[key] || '暂不可用';
  },
  mounted(q){
    const el=document.querySelector('[data-teaching-view]');
    return el?.dataset.teachingView===q.id ? el : null;
  },
  panel(q){
    const state=this.read(q), ready=!!state?.body, previous=this.mounted(q);
    const extraOpen=previous ? previous.querySelector('.teaching-extra').open : ready;
    const origOpen=previous ? previous.querySelector('.teaching-original').open : !ready;
    if(!state)setTimeout(()=>{if(this.mounted(q))this.ensure(q);},0);
    return `<section class="teaching" aria-label="题目解析" data-teaching-view="${esc(q.id)}">
      <div data-teaching-reference>${window.MBEReferences?.panel(q,state)||''}</div>
      <details class="teaching-extra"${extraOpen?' open':''}><summary>英文示范与中文解析<span class="teaching-summary-status" data-ready="${ready}">${this.statusLabel(state)}</span></summary>
      <div data-teaching-content>${this.content(q,state)}</div></details>
      <details class="teaching-original"${origOpen?' open':''}><summary>原题英文解析与 PDF 原页</summary>${originalExplHTML(q)}</details></section>`;
  },
  paint(q){
    const el=this.inScope() ? this.mounted(q) : null;
    if(!el)return;
    const state=this.read(q), label=el.querySelector('.teaching-summary-status');
    label.textContent=this.statusLabel(state); label.dataset.ready=String(!!state?.body);
    el.querySelector('[data-teaching-content]').innerHTML=this.content(q,state);
    if(state?.body){
      const slot=el.querySelector('[data-teaching-reference]');
      const open=slot.querySelector('.reference-source')?.open;
      slot.innerHTML=window.MBEReferences?.panel(q,state)||'';
      if(open){const details=slot.querySelector('.reference-source');if(details)details.open=true;}
    }
  },
  async ensure(q,retry=false){
    if(!this.inScope() || Q.get(q.id)!==q)return;
    if(this.pending.has(q))return this.pending.get(q);
    const prev=this.read(q);
    if(prev?.body || (prev && !retry))return;
    const cloud=window.MBECloud,uid=cloud.user?.id,generation=cloud.generation,db=this.database;
    const valid=()=>this.inScope() && this.database===db && cloud.user?.id===uid && cloud.generation===generation && Q.get(q.id)===q;
    const run=(async()=>{
      try{
        const hash=MBESections.fingerprints.get(q.id) || await MBESections.fingerprint(q);
        if(!valid())return;
        const cacheKey=this.prefix+hash;
        const warmed=this.cache.get(hash);
        const cached=this.matches(q,warmed) ? warmed : await IDB.get('kv',cacheKey).catch(()=>null);
        if(!valid())return;
        if(this.matches(q,cached)){this.cache.set(hash,cached);this.states.set(q,{state:'ready',body:cached});this.paint(q);return;}
        if(!uid){this.states.set(q,{state:'signedout'});this.paint(q);return;}
        if(!navigator.onLine){this.states.set(q,{state:'offline'});this.paint(q);return;}
        this.states.set(q,{state:'loading'});this.paint(q);
        // The existing merge RPC makes this retry idempotent; it does not add an attempt.
        const key='q_'+chunkOf(q.id),documentBody=docBody(key);
        if(documentBody){const {error}=await cloud.client.rpc('mbe_save_document',{p_key:key,p_body:documentBody});if(error)throw new Error('answer_first');}
        if(!valid())return;
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),130000);
        const {data,error}=await cloud.client.functions.invoke('mbe-teaching',{body:{qid:q.id},signal:controller.signal}).finally(()=>clearTimeout(timer));
        if(!valid())return;
        let state=data;
        if(error){let code='error';try{const body=await error.context?.json();code=body?.error||code;}catch{}throw new Error(code);}
        if(state?.state==='busy')state={state:'error'};
        if(state?.state==='ready' && !this.matches(q,state.body))state={state:'review'};
        this.states.set(q,state||{state:'error'});
        if(state?.state==='ready'){
          this.cache.set(hash,state.body);
          await IDB.put('kv',cacheKey,state.body).catch(()=>{});
        }
        if(valid())this.paint(q);
      }catch(e){
        if(!valid())return;
        const allowed=['free_credit_limit','cloud_bank_required','answer_first'];
        this.states.set(q,{state:allowed.includes(e.message)?e.message:(navigator.onLine?'error':'offline')});this.paint(q);
      }finally{this.pending.delete(q);}
    })();
    this.pending.set(q,run);return run;
  }
};
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-teaching-retry]');if(!b)return;
  const q=Q.get(b.dataset.teachingRetry);if(q)MBETeaching.ensure(q,true);
});
