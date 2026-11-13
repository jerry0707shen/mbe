'use strict';
// Only authenticated, submitted questions are sent by ID. Keys never enter this file.
window.MBETeaching={
  states:new Map(),pending:new Map(),version:'20261113-1',
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
    const messages={signedout:'登录后可读取私有云端解析。',offline:'联网后可载入中文解析与英文示范。',loading:'正在准备英文示范与中文解析，首次可能需要约一分钟…',review:'本题的来源或答案需要核对，暂不展示未经核对的新解析。',reserved:'此题属于保留的 NCBE 练习题，继续保留原解析。',free_credit_limit:'免费生成额度已用尽或到期，已有解析仍可阅读。',cloud_bank_required:'请先将这份题库备份到云端，再载入新解析。',answer_first:'作答记录尚未同步，请稍后重试。',error:'新解析暂未载入，做题记录已保留。'};
    const key=state?.state||'loading';
    return `<div class="teaching-status" role="status"><p>${messages[key]||messages.error}</p>${state?.state==='review'&&state.reason?`<p>${this.safe(state.reason)}</p>`:''}${!['signedout','loading','reserved','review','free_credit_limit'].includes(key)?`<button class="btn" type="button" data-teaching-retry="${esc(q.id)}">重新载入解析</button>`:''}</div>`;
  },
  panel(q){
    const state=this.states.get(q.id);
    setTimeout(()=>this.ensure(q),0);
    return `<section class="teaching" aria-label="题目解析"><div data-teaching-content="${esc(q.id)}">${this.content(q,state)}</div><details class="teaching-original"><summary>原题英文解析与 PDF 原页</summary>${originalExplHTML(q)}</details></section>`;
  },
  paint(q){
    for(const el of document.querySelectorAll('[data-teaching-content]'))if(el.dataset.teachingContent===q.id)el.innerHTML=this.content(q,this.states.get(q.id));
  },
  async ensure(q,retry=false){
    if(this.pending.has(q.id))return this.pending.get(q.id);
    if(this.states.has(q.id)&&!retry)return;
    const cloud=window.MBECloud,uid=cloud?.user?.id,generation=cloud?.generation;
    const valid=()=>cloud?.user?.id===uid && cloud?.generation===generation;
    const run=(async()=>{
      try{
        const hash=await MBESections.fingerprint(q),cacheKey='teaching:'+this.version+':'+hash;
        const cached=await IDB.get('kv',cacheKey).catch(()=>null);
        if(!valid())return;
        if(cached?.answer===q.ans && cached?.knowledge && cached?.essay && cached?.zh){this.states.set(q.id,{state:'ready',body:cached});this.paint(q);return;}
        if(!uid){this.states.set(q.id,{state:'signedout'});this.paint(q);return;}
        if(!navigator.onLine){this.states.set(q.id,{state:'offline'});this.paint(q);return;}
        this.states.set(q.id,{state:'loading'});this.paint(q);
        // The existing merge RPC makes this retry idempotent; it does not add an attempt.
        const key='q_'+chunkOf(q.id),documentBody=docBody(key);
        if(documentBody){const {error}=await cloud.client.rpc('mbe_save_document',{p_key:key,p_body:documentBody});if(error)throw new Error('answer_first');}
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),130000);
        const {data,error}=await cloud.client.functions.invoke('mbe-teaching',{body:{qid:q.id},signal:controller.signal}).finally(()=>clearTimeout(timer));
        if(!valid())return;
        let state=data;
        if(error){let code='error';try{const body=await error.context?.json();code=body?.error||code;}catch{}throw new Error(code);}
        if(state?.state==='busy')state={state:'error'};
        if(state?.body?.answer!==q.ans && state?.state==='ready')state={state:'review'};
        this.states.set(q.id,state||{state:'error'});
        if(state?.state==='ready')await IDB.put('kv',cacheKey,state.body).catch(()=>{});
        this.paint(q);
      }catch(e){
        if(!valid())return;
        const allowed=['free_credit_limit','cloud_bank_required','answer_first'];
        this.states.set(q.id,{state:allowed.includes(e.message)?e.message:(navigator.onLine?'error':'offline')});this.paint(q);
      }finally{this.pending.delete(q.id);}
    })();
    this.pending.set(q.id,run);return run;
  }
};
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-teaching-retry]');if(!b)return;
  const q=Q.get(b.dataset.teachingRetry);if(q)MBETeaching.ensure(q,true);
});
