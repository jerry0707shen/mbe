'use strict';
window.MBEBuiltin={
  manifest:null,errors:[],done:0,busy:false,
  async json(url){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),25000);
    try{const r=await fetch(url,{signal:c.signal,cache:'no-cache'});if(!r.ok)throw new Error('暂时无法载入');return await r.json();}finally{clearTimeout(t);}
  },
  progress(){const el=document.querySelector('[data-builtin-progress]');if(el)el.textContent=`正在准备内置题库 ${this.done}/${this.manifest?.banks?.length||9}…`;},
  async ensure(){
    if(this.busy)return;this.busy=true;this.errors=[];this.done=0;
    try{
      let m;try{m=await this.json('./builtin-manifest.json');}catch{m=await IDB.get('kv','_builtin_manifest');if(!m)throw new Error('暂时无法载入');}
      if(!Array.isArray(m.banks)||m.banks.length>12||m.banks.some(b=>!CODES[b.code]||b.url!=='banks/'+b.code+'.json'||!/^[a-f0-9]{64}$/.test(b.sha256)))throw new Error('内置题库目录校验失败');
      this.manifest=m;await IDB.put('kv','_builtin_manifest',m);this.progress();const existing=await IDB.all('banks');let next=0;
      await Promise.all(Array.from({length:3},async()=>{
        while(next<m.banks.length){const b=m.banks[next++];
          try{
            // Existing imported/account banks and their answer corrections take precedence.
            if(existing[b.code])continue;
            const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
            let bytes;
            try{const r=await fetch('./'+b.url+'?v='+encodeURIComponent(m.version),{signal:controller.signal});if(!r.ok)throw new Error('载入失败');bytes=await r.arrayBuffer();}finally{clearTimeout(timer);}
            const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
            if(hash!==b.sha256)throw new Error('完整性校验失败');
            const bank=JSON.parse(new TextDecoder().decode(bytes));
            if(bank.code!==b.code||bank.n!==b.n||!Array.isArray(bank.qs)||bank.qs.length!==b.n||new Set(bank.qs.map(q=>q.id)).size!==b.n||bank.qs.some(q=>!q.id?.startsWith(b.code+'-')||!Array.isArray(q.stem)||!q.options||!/^[A-D]$/.test(q.ans)))throw new Error('题目结构校验失败');
            // No practice records, sessions, notes or configuration are touched here.
            await IDB.put('banks',b.code,bank);
          }catch(e){this.errors.push(b.code);}
          finally{this.done++;this.progress();}
        }
      }));
    }catch(e){this.errors.push('manifest');}
    finally{this.busy=false;}
  },
  panel(){
    return `<section class="card stack"><div class="row between"><h1>内置题库</h1><span class="tag acc">${this.manifest?.total||2003} 题</span></div><p class="small muted" style="margin:0">题目已随网页提供，打开即可做题。登录后自动同步做题记录。</p>${this.errors.length?'<p class="small muted">部分题库暂未载入，已载入的题目可继续使用。</p><div><button type="button" class="btn" data-builtin-retry>重新准备题库</button></div>':''}</section>`;
  }
};
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-builtin-retry]');if(!b || ACTIVE)return;
  b.disabled=true;b.textContent='正在准备…';
  try{await MBEBuiltin.ensure();await loadBanks();render();}finally{b.disabled=false;}
});
