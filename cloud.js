/* Independent Supabase Auth, per-user progress, and private question-bank files. */
'use strict';
window.MBECloud = {
  client: null, user: null, ready: false, error: '', files: [], busy: false,
  message: '', recovery: false, timer: null, generation: 0, pending: new Set(),
  configured() { const c = window.MBE_CLOUD_CONFIG; return !!(c && c.url && c.publishableKey); },
  validConfig(c) {
    const u = new URL(c.url);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !/^\/?$/.test(u.pathname)) throw new Error('云服务地址必须是 HTTPS 项目根地址');
    const k = c.publishableKey;
    if (k.startsWith('sb_secret_')) throw new Error('禁止在网页使用私密密钥');
    if (!k.startsWith('sb_publishable_')) {
      try { if (JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'anon') throw 0; }
      catch (_) { throw new Error('请使用公开的 publishable 或 anon key'); }
    }
    return u.origin;
  },
  async prepare() {
    if (!this.configured()) return;
    try {
      const c = window.MBE_CLOUD_CONFIG, url = this.validConfig(c);
      await loadScript('./vendor/supabase.js', 'supabase');
      this.recovery = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
      this.client = window.supabase.createClient(url, c.publishableKey, { auth: {
        persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
        storageKey: 'mbe-auth-' + new URL(url).hostname
      } });
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      this.user = data.session?.user || null;
      this.ready = true;
      if (this.recovery) history.replaceState(null, '', location.pathname + location.search + '#more');
      const initial = this.user?.id || null;
      this.client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') { this.recovery = true; setTimeout(() => go('more'), 0); }
        if ((session?.user?.id || null) !== initial) {
          // Never merge one account's live state into another account's database.
          this.generation++; this.pending.clear();
          if (typeof Sync !== 'undefined') { Sync.col = null; clearInterval(this.timer); }
          setTimeout(async () => { await Local.flush(); location.reload(); }, 0);
        }
      });
    } catch (e) { this.error = '云服务连接失败，已保留本机模式：' + e.message; }
  },
  databaseName() {
    if (!this.ready || !this.user) return 'mbe-qbank';
    return 'mbe-qbank:' + new URL(window.MBE_CLOUD_CONFIG.url).hostname + ':' + this.user.id;
  },
  redraw() {
    for (const el of document.querySelectorAll('[data-cloud-message]')) { el.textContent = this.message; el.hidden = !this.message; }
    if (typeof softRender === 'function') softRender();
  },
  note(e) { this.message = e?.message || String(e); this.redraw(); },
  async connect(sync) {
    if (!this.ready || !this.user) {
      sync.set(this.error ? 'error' : (this.configured() ? 'signedout' : 'unconfigured')); return;
    }
    const generation = this.generation;
    sync.col = {
      doc: key => ({ set: async body => {
        const { data, error } = await this.client.rpc('mbe_save_document', { p_key: key, p_body: body });
        if (error) throw error;
        if (generation === this.generation) sync.onSnap({ docs: [{ id: key, data: () => data }], metadata: { fromCache: false } });
      } })
    };
    const pull = async () => {
      if (generation !== this.generation || this.pulling) return;
      this.pulling = true;
      try {
        // Paginate: a long study history can exceed the API's default 1000 rows.
        let rows = [], start = 0;
        for (;;) {
          const { data, error } = await this.client.from('mbe_documents').select('doc_key,body')
            .eq('user_id', this.user.id).order('doc_key').range(start, start + 499);
          if (error) throw error;
          rows.push(...data); if (data.length < 500) break; start += 500;
        }
        if (generation !== this.generation) return;
        sync.onSnap({ docs: rows.map(r => ({ id: r.doc_key, data: () => r.body })), metadata: { fromCache: false } });
        sync.lastOk = now();
        if (!sync.busy && !sync.dirty.size) sync.set('on');
        sync.kick();
      } catch (e) { if (generation === this.generation) { sync.set('offline'); this.error = '进度未同步：' + e.message; } }
      finally { this.pulling = false; }
    };
    sync.set('connecting');
    await pull();
    this.pull = pull;
    this.timer = setInterval(pull, 30000);
    window.addEventListener('online', pull);
    window.addEventListener('focus', pull);
    await this.refreshFiles();
    this.redraw();
  },
  accountPanel() {
    if (!this.ready) return `<div class="card stack"><h2>账号与云同步</h2><p class="small muted">${esc(this.error || '云同步尚未启用。当前记录保存在这台设备，可继续刷题和导出备份。')}</p></div>`;
    const msg = `<p class="small" data-cloud-message role="status" ${this.message ? '' : 'hidden'}>${esc(this.message)}</p>`;
    if (!this.user) return `<section class="card stack"><h2>登录并同步</h2>
      <p class="small muted">使用同一个邮箱账号，在电脑和手机同步进度及私有题库。未登录时只保存在本机。</p>
      <form id="cloud-login" class="stack"><label class="field">邮箱<input id="cloud-email" type="email" autocomplete="email" required></label>
      <label class="field">密码<input id="cloud-password" type="password" autocomplete="current-password" minlength="8" required></label>
      <div class="row"><button class="btn primary" type="submit" ${this.busy ? 'disabled' : ''}>登录</button>
      <button class="btn" type="button" data-cloud="signup" ${this.busy ? 'disabled' : ''}>注册账号</button>
      <button class="btn ghost" type="button" data-cloud="reset" ${this.busy ? 'disabled' : ''}>忘记密码</button></div></form>${msg}</section>`;
    return `<section class="card stack"><h2>账号与云同步</h2><p>${esc(this.user.email || '已登录')}</p>
      <div class="syncpill"></div><p class="small muted">进度自动同步。PDF 和题库的备份状态请在下方查看；离线时继续保存在此账号的本机空间。</p>
      <div class="row"><button class="btn" data-cloud="sync" ${this.busy ? 'disabled' : ''}>立即同步</button>
      <button class="btn" data-cloud="migrate" ${this.busy ? 'disabled' : ''}>导入本机旧数据</button>
      <button class="btn ghost" data-cloud="logout" ${this.busy ? 'disabled' : ''}>退出登录</button></div>
      <p class="small muted">首次登录后，可用“导入本机旧数据”合并此前未登录时的进度、题库及本机 PDF。原数据会保留。</p>
      ${this.recovery ? '<form id="cloud-recovery" class="stack"><label>新密码<input id="cloud-new-password" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn primary" type="submit">保存新密码</button></form>' : ''}${msg}</section>`;
  },
  libraryPanel() {
    if (!this.user || !this.ready) return '';
    const rows = this.files.map(f => `<tr><td>${esc(CODES[f.code] || f.code)}</td><td>${esc(f.file_name)}</td>
      <td>${f.pdf_path ? '题库及 PDF' : '仅题库'}</td><td>${esc(fmtFull(new Date(f.updated_at).getTime()))}</td>
      <td><button class="btn" data-cloud="restore" data-code="${esc(f.code)}" ${this.busy ? 'disabled' : ''}>下载到本机</button></td></tr>`).join('');
    return `<section class="card stack"><h2>私有云题库</h2><p class="small muted">仅此账号可以读取。已导入本机的 PDF 可随题库一起备份；在其他设备登录后，点击“下载到本机”即可使用。</p>
      <div class="row"><button class="btn primary" data-cloud="upload" ${this.busy ? 'disabled' : ''}>备份本机题库到云端</button>
      <button class="btn" data-cloud="refresh" ${this.busy ? 'disabled' : ''}>刷新列表</button></div>
      <p class="small" data-cloud-message role="status" ${this.message ? '' : 'hidden'}>${esc(this.message)}</p>
      ${rows ? `<div class="scrollx"><table class="t"><thead><tr><th>科目</th><th>文件</th><th>云端内容</th><th>备份时间</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="small muted">尚未读取到云端题库。上传成功的题库才会列在这里。</p>'}</section>`;
  },
  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    try { await fn(); }
    catch (e) { this.message = '操作未完成：' + e.message; }
    finally { this.busy = false; this.redraw(); }
  },
  async auth(action) {
    await this.run(async () => {
      if (ACTIVE) throw new Error('请先保存并退出当前题组');
      const email = $('#cloud-email')?.value.trim(), password = $('#cloud-password')?.value;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请填写有效邮箱');
      const redirectTo = location.origin + location.pathname;
      let result;
      if (action === 'reset') result = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
      else {
        if (!password || password.length < 8) throw new Error('请填写至少 8 位密码');
        result = action === 'signup' ? await this.client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }) :
          await this.client.auth.signInWithPassword({ email, password });
      }
      if (result.error) throw result.error;
      if ($('#cloud-password')) $('#cloud-password').value = '';
      this.message = action === 'reset' ? '若此邮箱已注册，将收到重设密码邮件。' : action === 'signup' ? '注册请求已提交，请检查邮箱并完成确认。' : '登录成功，正在打开账号空间…';
    });
  },
  async action(action, code) {
    if (['login','signup','reset'].includes(action)) return this.auth(action);
    return this.run(async () => {
      if (!this.user) throw new Error('请先登录');
      if (action === 'logout') {
        if (ACTIVE) throw new Error('请先保存并退出当前题组');
        await Local.flush();
        if (Sync.dirty.size || Sync.busy || this.pending.size) {
          if (!await confirmBox('仍有记录尚未同步。退出后记录会保留在此账号的本机空间，下次登录再同步。继续退出？', '退出登录')) return;
        }
        const { error } = await this.client.auth.signOut({ scope: 'local' }); if (error) throw error;
      } else if (action === 'sync') {
        if (this.pull) await this.pull(); await Sync.kick();
        this.message = Sync.status === 'on' ? '进度已同步。' : '进度仍在同步或等待网络；本机记录已保留。';
      } else if (action === 'refresh') { await this.refreshFiles(true); this.message = '云端题库列表已刷新。'; }
      else if (action === 'upload') {
        let n = 0;
        for (const key of Object.keys(BANK)) { await this.uploadBank(key); n++; this.message = `已备份 ${n} 个题库`; }
        await this.refreshFiles(true); this.message = `已备份 ${n} 个题库。PDF 是否已保存请查看列表。`;
      } else if (action === 'restore') { await this.restoreBank(code); this.message = '题库已下载到本机。'; }
      else if (action === 'migrate') {
        if (ACTIVE) throw new Error('请先保存并退出当前题组');
        if (!await confirmBox('将此浏览器未登录时的进度、题库及 PDF 合并到当前账号？原始数据会保留，暂不上传 PDF。', '合并到当前账号')) return;
        await this.importGuest(); this.message = '旧数据已合并，进度将自动同步。PDF 可点击“备份本机题库到云端”上传。';
      } else if (action === 'password') {
        const password = $('#cloud-new-password')?.value;
        if (!password || password.length < 8) throw new Error('新密码至少 8 位');
        const { error } = await this.client.auth.updateUser({ password }); if (error) throw error;
        this.recovery = false; this.message = '密码已更新。';
      }
    });
  },
  async refreshFiles(strict = false) {
    if (!this.user) return;
    const { data, error } = await this.client.from('mbe_library').select('*').eq('user_id', this.user.id).order('code');
    if (error) { if (strict) throw error; this.message = '未能读取云端题库：' + error.message; return; }
    this.files = data;
  },
  async digest(blob) {
    const bytes = blob instanceof Blob ? await blob.arrayBuffer() : blob;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2,'0')).join('');
  },
  async uploadBank(code, sourcePdf) {
    if (!this.user || !CODES[code] || !BANK[code]) throw new Error('未登录或题库不存在');
    const bank = BANK[code], generation = this.generation, uid = this.user.id;
    await this.refreshFiles(true);
    const rawPdf = sourcePdf || await IDB.get('pdfs', code);
    const pdf = rawPdf ? (rawPdf instanceof Blob ? rawPdf : new Blob([rawPdf], { type: 'application/pdf' })) : null;
    if (pdf && pdf.size > 50 * 1024 * 1024) throw new Error('单份 PDF 超过当前 50 MB 上传限制；本机原文件已保留');
    const bankBlob = new Blob([JSON.stringify(bank)], { type: 'application/json' });
    const bankHash = await this.digest(bankBlob), pdfHash = pdf ? await this.digest(pdf) : null;
    const prior = this.files.find(f => f.code === code);
    if (!pdf && prior?.pdf_path && prior.bank_sha256 !== bankHash) throw new Error('云端已有此科的其他版本及 PDF，请保留本机原 PDF 后再上传；云端原文件未改动');
    const root = uid + '/' + code + '/';
    const put = async (path, blob, contentType) => {
      const { error } = await this.client.storage.from('mbe-private').upload(path, blob, { contentType, upsert: false });
      // Immutable content-addressed objects: an existing matching hash is reusable.
      if (error && !['409','Duplicate','409 Conflict'].includes(String(error.statusCode || error.status))) throw error;
    };
    await put(root + bankHash + '.json', bankBlob, 'application/json');
    if (pdf) await put(root + pdfHash + '.pdf', pdf, 'application/pdf');
    if (generation !== this.generation) throw new Error('账号已变更，请重新操作');
    // A bank-only upload must not erase a previous cloud PDF for this subject.
    const { error } = await this.client.from('mbe_library').upsert({ user_id: uid, code,
      file_name: bank.file, bank_path: root + bankHash + '.json', bank_sha256: bankHash,
      pdf_path: pdf ? root + pdfHash + '.pdf' : (prior?.pdf_path || null), pdf_sha256: pdfHash || prior?.pdf_sha256 || null, size: bank.size,
      updated_at: new Date().toISOString() }, { onConflict: 'user_id,code' });
    if (error) throw error;
  },
  async afterImport(entries) {
    if (!this.user) return;
    await this.run(async () => {
      for (const entry of entries) await this.uploadBank(entry.code, entry.file);
      await this.refreshFiles(true); this.message = '导入的题库和原 PDF 已备份到私有云。';
    });
  },
  async restoreBank(code) {
    if (ACTIVE) throw new Error('请先保存并退出当前题组');
    await this.refreshFiles(true);
    const f = this.files.find(x => x.code === code);
    if (!f || !CODES[code]) throw new Error('云端题库不存在');
    const generation = this.generation, root = this.user.id + '/' + code + '/';
    if (f.bank_path !== root + f.bank_sha256 + '.json' || (f.pdf_path && f.pdf_path !== root + f.pdf_sha256 + '.pdf')) throw new Error('云端文件路径不匹配');
    if (BANK[code] && !await confirmBox('下载将替换此账号本机的同科题库。做题记录会保留。继续？', '下载')) return;
    const get = async (path, hash) => {
      const { data, error } = await this.client.storage.from('mbe-private').download(path);
      if (error) throw error;
      if (await this.digest(data) !== hash) throw new Error('文件校验失败，未替换本机题库');
      return data;
    };
    const bankBlob = await get(f.bank_path, f.bank_sha256), bank = JSON.parse(await bankBlob.text());
    if (bank.code !== code || !Array.isArray(bank.qs) || bank.qs.some(q => typeof q.id !== 'string' || !q.id.startsWith(code + '-'))) throw new Error('题库结构不匹配');
    const pdf = f.pdf_path ? await get(f.pdf_path, f.pdf_sha256) : null;
    if (generation !== this.generation) throw new Error('账号已变更，未替换本机数据');
    // Both downloads and hashes succeed before one atomic local transaction.
    await this.replaceBank(code, { ...bank, hasPdf: !!pdf }, pdf ? await pdf.arrayBuffer() : null);
    delete PDFDOCS[code]; await loadBanks();
  },
  replaceBank(code, bank, pdf) {
    if (!IDB.db) throw new Error('当前浏览器不允许持久保存，请更换正常浏览模式');
    return new Promise((resolve, reject) => {
      const t = IDB.db.transaction(['banks','pdfs'], 'readwrite');
      t.objectStore('banks').put(bank, code);
      if (pdf) t.objectStore('pdfs').put(pdf, code); else t.objectStore('pdfs').delete(code);
      t.oncomplete = resolve; t.onabort = t.onerror = () => reject(t.error || new Error('本机空间不足'));
    });
  },
  async importGuest() {
    const guest = await new Promise((resolve, reject) => {
      const r = indexedDB.open('mbe-qbank', 1);
      r.onupgradeneeded = () => { for (const s of ['banks','pdfs','kv']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const read = store => new Promise((resolve, reject) => {
      const t = guest.transaction(store), out = {}, r = t.objectStore(store).openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { out[c.key] = c.value; c.continue(); } };
      t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error);
    });
    try {
      const kv = await read('kv'), banks = await read('banks'), pdfs = await read('pdfs');
      for (const [k,v] of Object.entries(kv)) {
        if (k.startsWith('q_')) for (const [qid,r] of Object.entries(v.recs || {})) { ST.recs[qid] = mergeRec(ST.recs[qid], r); touchRec(qid); }
        else if (k.startsWith('s_')) {
          const sid = k.slice(2), cur = ST.sessions[sid];
          if (!cur || (v.u || 0) > (cur.u || 0)) { ST.sessions[sid] = clone(v); Local.mark(k); Sync.mark(k); }
        }
      }
      // Existing account libraries remain untouched; only absent subjects are copied.
      for (const [code,bank] of Object.entries(banks)) if (CODES[code] && !BANK[code]) {
        await this.replaceBank(code, { ...bank, hasPdf: !!pdfs[code] }, pdfs[code] || null);
      }
      await Local.flush(); await loadBanks();
    } finally { guest.close(); }
  }
};
