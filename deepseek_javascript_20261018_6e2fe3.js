/* ==========================================================================
   RepairShop Pro — Patch v23
   اصلاح ۳۳ ایراد نسخه v22 (بحرانی، مهم، متوسط)
   ========================================================================== */
(function(){
'use strict';

const LOG = [];
const APPLIED = [];
const FAILED = [];

function log(level, msg){
  LOG.push({ level, msg, time: new Date().toISOString() });
  const icon = level === 'fix' ? '🔧' : level === 'warn' ? '⚠️' : level === 'err' ? '❌' : 'ℹ️';
  try { console.log('[v23]', icon, msg); } catch(e){}
}
function recordApplied(id, title){
  APPLIED.push({ id, title });
  log('fix', 'پچ ' + id + ' اعمال شد: ' + title);
}
function recordFailed(id, title, err){
  FAILED.push({ id, title, err: String(err && err.message || err) });
  log('err', 'پچ ' + id + ' ناموفق: ' + title + ' — ' + (err && err.message || err));
}
function safePatch(id, title, fn){
  try { fn(); recordApplied(id, title); }
  catch(err){ recordFailed(id, title, err); }
}

function waitForApp(){
  return new Promise((resolve, reject) => {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const ready = typeof window.db !== 'undefined'
        && typeof window.save === 'function'
        && typeof window.invoiceDue === 'function'
        && typeof window.invoiceTotalOf === 'function'
        && typeof window.moneyPaidForInvoice === 'function'
        && typeof window.checkPaidForInvoice === 'function';
      if (ready) {
        clearInterval(iv);
        log('info', 'برنامه اصلی آماده است — شروع اعمال پچ‌ها');
        resolve();
      }
      if (tries > 300) {
        clearInterval(iv);
        reject(new Error('برنامه در ۳۰ ثانیه آماده نشد'));
      }
    }, 100);
  });
}

// ============================================================
// 🔴 پچ ۱: هش رمز عبور امن (PBKDF2-SHA256 + Salt)
// ============================================================
function patch1_PasswordHash(){
  window.passwordHash = async function(pw, saltHex){
    const enc = new TextEncoder();
    const salt = saltHex
      ? Uint8Array.from(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)))
      : crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(String(pw)), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const hash = Array.from(new Uint8Array(bits))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const saltStr = Array.from(salt)
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return { hash, salt: saltStr, algo: 'pbkdf2-sha256-200k' };
  };

  window.verifyPassword = async function(pw, user){
    if (!user || !user.passwordHash) return false;
    if (user.passwordSalt && user.passwordAlgo === 'pbkdf2-sha256-200k') {
      const { hash } = await window.passwordHash(pw, user.passwordSalt);
      return hash === user.passwordHash;
    }
    const bytes = new TextEncoder().encode(String(pw));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const legacy = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return legacy === user.passwordHash;
  };

  window.upgradeUserHashIfLegacy = async function(user, plainPw){
    if (!user || user.passwordAlgo === 'pbkdf2-sha256-200k') return false;
    const { hash, salt, algo } = await window.passwordHash(plainPw);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.passwordAlgo = algo;
    return true;
  };

  window.setupAdmin = async function(e){
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = String(fd.get('username') || '').trim();
    const pw = String(fd.get('password') || '');
    if (pw !== String(fd.get('confirm') || '')) return alert('رمز عبور و تکرار آن یکسان نیست.');
    if (pw.length < 8) return alert('رمز مدیر باید حداقل ۸ نویسه باشد.');
    const { hash, salt, algo } = await window.passwordHash(pw);
    window.db.users = [{
      id: window.id(), username,
      fullName: fd.get('fullName') || 'مدیر اصلی',
      role: 'مدیر', active: true,
      passwordHash: hash, passwordSalt: salt, passwordAlgo: algo,
      permissions: (window.USER_PAGES || []).slice()
    }];
    window.persistDB();
    try {
      sessionStorage.setItem('rs_logged_user', username);
      localStorage.setItem('rs_remembered_username', username);
    } catch(e){}
    document.getElementById('authGate')?.remove();
    window.page = 'dashboard';
    window.render();
  };

  window.loginUser = async function(e){
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = String(fd.get('username') || '').trim();
    const pw = String(fd.get('password') || '');
    const u = (window.db.users || []).find(x =>
      x.username.toLowerCase() === username.toLowerCase()
    );
    if (!u || u.active === false) return alert('نام کاربری یا رمز عبور نادرست است.');
    const ok = await window.verifyPassword(pw, u);
    if (!ok) return alert('نام کاربری یا رمز عبور نادرست است، یا حساب غیرفعال شده است.');
    if (await window.upgradeUserHashIfLegacy(u, pw)) {
      try { window.persistDB(); } catch(err){}
    }
    try {
      sessionStorage.setItem('rs_logged_user', u.username);
      localStorage.setItem('rs_remembered_username', u.username);
    } catch(err){}
    document.getElementById('authGate')?.remove();
    window.page = (u.role === 'مدیر' || (u.permissions || []).includes('dashboard'))
      ? 'dashboard'
      : (u.permissions || [])[0] || 'dashboard';
    window.render();
  };

  window.submitUser = async function(e, uid){
    e.preventDefault();
    if (!window.canAccess('users') || !window.canModify()) {
      return alert('برای مدیریت کاربران دسترسی ندارید.');
    }
    const fd = new FormData(e.target);
    const username = String(fd.get('username') || '').trim();
    if (window.db.users.some(u => u.id !== uid && u.username.toLowerCase() === username.toLowerCase())) {
      return alert('این نام کاربری قبلاً ثبت شده است.');
    }
    const old = window.db.users.find(u => u.id === uid);
    const pw = String(fd.get('password') || '');
    const rec = {
      ...(old || {}), id: uid || window.id(), username,
      fullName: fd.get('fullName') || '',
      role: fd.get('role') || 'کاربر',
      active: fd.get('active') === 'yes',
      permissions: fd.getAll('perm')
    };
    if (pw) {
      if (pw.length < 6) return alert('رمز عبور باید حداقل ۶ نویسه باشد.');
      const { hash, salt, algo } = await window.passwordHash(pw);
      rec.passwordHash = hash;
      rec.passwordSalt = salt;
      rec.passwordAlgo = algo;
    }
    if (!old && !pw) return alert('برای کاربر جدید رمز عبور وارد کنید.');
    if (old) window.db.users = window.db.users.map(u => u.id === uid ? rec : u);
    else window.db.users.push(rec);
    window.closeModal();
    window.save();
    alert('اطلاعات کاربر ذخیره شد.');
  };
}

// ============================================================
// 🔴 پچ ۲: invoiceDue با منبع حقیقت واحد
// ============================================================
function patch2_InvoiceDue(){
  window.moneyPaidForInvoice = function(inv){
    if (!inv) return 0;
    const rows = (window.db.money || []).filter(m =>
      String(m.invoiceNo || '') === String(inv.number || '') && m.kind === 'دریافت'
    );
    return rows.reduce((sum, m) =>
      sum + window.amountMoneyRows(m).reduce((n, p) => n + Number(p.amount || 0), 0), 0
    );
  };

  window.checkPaidForInvoice = function(inv){
    if (!inv) return 0;
    return (window.db.checks || []).filter(c =>
      c.direction === 'دریافتی' &&
      String(c.invoiceNo || '') === String(inv.number || '') &&
      !['برگشت خورد', 'عودت شد', 'باطل شد'].includes(c.status)
    ).reduce((n, c) => n + Number(c.amount || 0), 0);
  };

  window.invoiceDue = function(inv){
    if (!inv) return 0;
    const total = Math.max(0, window.invoiceTotalOf(inv));
    const paid = Math.min(total,
      window.moneyPaidForInvoice(inv) + window.checkPaidForInvoice(inv));
    return Math.max(0, total - paid);
  };

  window.recalculateInvoicePaid = function(inv, force){
    if (!inv) return;
    const total = Math.max(0, window.invoiceTotalOf(inv));
    const paid = Math.min(total,
      window.moneyPaidForInvoice(inv) + window.checkPaidForInvoice(inv));
    inv.paid = paid;
  };

  window.invoiceSettledPaid = function(inv){
    log('warn', 'invoiceSettledPaid منسوخ شده — از moneyPaidForInvoice + checkPaidForInvoice استفاده کنید');
    return window.moneyPaidForInvoice(inv) + window.checkPaidForInvoice(inv);
  };
}

// ============================================================
// 🔴 پچ ۳: priorPartyBalanceForServiceInvoice
// ============================================================
function patch3_PriorPartyBalance(){
  window.priorPartyBalanceForServiceInvoice = function(inv){
    const name = (window.db.customers || []).find(c => c.id === inv.customerId)?.name
      || window.customerLabel(inv.customerId) || '';
    const cutDate = String(inv.date || '');
    const before = d => String(d || '') < cutDate;
    let debit = 0, credit = 0;

    const party = (window.db.parties || []).find(p => p.name === name);
    if (party) {
      const ob = Math.abs(Number(party.openingBalance || 0));
      if ((party.openingNature || 'بدهکار') === 'بستانکار') credit += ob;
      else debit += ob;
    }

    for (const v of (window.db.invoices || [])) {
      if (v.id === inv.id) continue;
      if (!before(v.date)) continue;
      const vName = (window.db.customers || []).find(c => c.id === v.customerId)?.name
        || window.customerLabel(v.customerId) || '';
      if (vName !== name) continue;
      debit += window.invoiceDue(v);
    }

    for (const m of (window.db.money || [])) {
      if (m.party !== name) continue;
      if (!before(m.date)) continue;
      if (m.invoiceNo) continue;
      const a = (m.parts || []).length
        ? window.amountMoneyRows(m).reduce((n, z) => n + Number(z.amount || 0), 0)
        : Number(m.amount || 0);
      if (m.kind === 'پرداخت') debit += a;
      else if (m.kind === 'دریافت') credit += a;
    }

    for (const c of (window.db.checks || [])) {
      if (c.direction !== 'دریافتی') continue;
      if (c.beneficiary !== name) continue;
      if (c.invoiceNo) continue;
      if (!before(c.issue || c.due || c.date)) continue;
      if (['برگشت خورد', 'عودت شد', 'باطل شد'].includes(c.status)) continue;
      credit += Number(c.amount || 0);
    }

    for (const v of (window.db.sales || [])) {
      if ((v.counterparty || v.buyer) === name && before(v.date)) debit += Number(v.total || 0);
    }
    for (const v of (window.db.purchases || [])) {
      if ((v.counterparty || v.seller) === name && before(v.date)) credit += Number(v.total || 0);
    }
    for (const v of (window.db.expenses || [])) {
      if (v.party === name && before(v.date)) credit += Number(v.amount || 0);
    }

    const balance = debit - credit;
    return {
      balance,
      nature: balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'تسویه'
    };
  };
}

// ============================================================
// 🟠 پچ ۴: periodKey با تاریخ محلی
// ============================================================
function patch4_PeriodKey(){
  window.periodKey = function(date){
    if (!date) return '';
    const x = String(date).trim();
    const isoMatch = x.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const y = +isoMatch[1], m = +isoMatch[2], d = +isoMatch[3];
      const dt = new Date(y, m - 1, d, 12);
      if (!Number.isNaN(dt.getTime())) {
        const p = window.faParts(dt);
        return `${p.year}/${String(p.month).padStart(2, '0')}`;
      }
    }
    const bits = x.split(/[\/\-.]/).map(v => window.cleanNumeric(v));
    if (bits.length >= 2) {
      const y = Number(bits[0]), mo = Number(bits[1]);
      if (y > 1000 && mo >= 1 && mo <= 12) {
        return `${y}/${String(mo).padStart(2, '0')}`;
      }
    }
    return '';
  };
}

// ============================================================
// 🟠 پچ ۵: quickIntake با flag نتیجه
// ============================================================
function patch5_QuickIntake(){
  window.__lastSubmitResult = null;

  const originalSubmitOrder = window.submitOrder;

  window.submitOrder = async function(e, editId){
    window.__lastSubmitResult = { ok: false, id: null, reason: 'شروع نشده' };
    try {
      const result = await originalSubmitOrder.call(this, e, editId);
      const modalClosed = !document.querySelector('#modal .modalbg');
      if (modalClosed) {
        window.__lastSubmitResult = { ok: true, id: editId || null, reason: '' };
      } else {
        window.__lastSubmitResult = { ok: false, id: null, reason: 'فرم باز است' };
      }
      return result;
    } catch (err) {
      window.__lastSubmitResult = {
        ok: false, id: null,
        reason: String(err && err.message || err)
      };
      throw err;
    }
  };

  window.quickIntakeSubmit = async function(e){
    e.preventDefault();
    const oid = e.target.dataset.quickOrderId || '';
    const before = new Set((window.db.orders || []).map(x => x.id));
    window.__lastSubmitResult = null;
    try {
      await window.submitOrder(e, oid);
    } catch (err) {
      console.error('[v23] quickIntake', err);
      return;
    }
    if (!window.__lastSubmitResult || !window.__lastSubmitResult.ok) return;
    window.__quickIntake = false;
    const created = (window.db.orders || []).filter(x => !before.has(x.id)).slice(-1)[0];
    const saved = created || (oid ? window.order(oid) : null);
    if (!saved) return;
    if (confirm('پذیرش ' + (saved.number || '') + ' ثبت شد. فرم کامل همین پذیرش باز شود؟')) {
      window.editOrder(saved.id);
    }
  };
}

// ============================================================
// 🔴 پچ ۶: غیرفعال‌سازی AI ناامن
// ============================================================
function patch6_AI(){
  try {
    const hadKey = localStorage.getItem('rsp_ai_key');
    if (hadKey) {
      localStorage.removeItem('rsp_ai_key');
      log('warn', 'کلید AI از localStorage پاک شد (امنیت)');
    }
  } catch(e){}

  const enabled = window.db && window.db.settings && window.db.settings.aiEnabled === true;
  if (!enabled) {
    const fab = document.getElementById('aiFab');
    if (fab) fab.remove();
    const pn = document.getElementById('aiPanel');
    if (pn) pn.remove();
  }
}

// ============================================================
// 🟠 پچ ۷: updateProductPriceForm با واحد پول
// ============================================================
function patch7_ProductPrice(){
  window.updateProductPriceForm = function(){
    const f = document.querySelector('#modal form');
    if (!f) return;
    const mode = f.elements.namedItem('sellMode')?.value || 'manual';
    const sell = f.elements.namedItem('sell');
    const buy = window.moneyField(f, 'buy');
    const pctInput = f.elements.namedItem('markupPercent');
    const pct = pctInput && pctInput.value !== ''
      ? Number(pctInput.value)
      : Number(window.db.settings.defaultMarkupPercent ?? 20);
    const round = !!f.elements.namedItem('roundSell')?.checked;
    if (!sell) return;
    sell.readOnly = mode === 'percent';
    if (mode === 'percent') {
      let v = buy * (1 + pct / 100);
      if (round) v = Math.round(v / 1000) * 1000;
      sell.value = window.moneyInputValue(Math.round(v));
      sell.dataset.converted = '1';
    }
  };
}

// ============================================================
// 🟠 پچ ۸: Snapshot در IndexedDB
// ============================================================
function patch8_Snapshots(){
  const SNAP_DB = 'repairshop_snapshots';
  let snapHandle = null;

  function snapOpen(){
    if (snapHandle) return Promise.resolve(snapHandle);
    return new Promise((res, rej) => {
      const r = indexedDB.open(SNAP_DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('snaps')) {
          r.result.createObjectStore('snaps');
        }
      };
      r.onsuccess = () => { snapHandle = r.result; res(snapHandle); };
      r.onerror = () => rej(r.error);
    });
  }

  window.listSnapshots = async function(){
    try { return JSON.parse(localStorage.getItem('rsp_snapshots') || '[]'); }
    catch(e) { return []; }
  };

  window.saveSnapshotMeta = function(list){
    try { localStorage.setItem('rsp_snapshots', JSON.stringify(list.slice(-8))); }
    catch(e){}
  };

  window.takeSnapshot = async function(reason = 'auto'){
    try {
      if (window.__loadFailed) return false;
      const json = JSON.stringify({
        ...window.db,
        backupMeta: {
          app: 'RepairShop Pro', version: 23,
          reason, createdAt: new Date().toISOString()
        }
      });
      if (json.length > 40 * 1024 * 1024) return false;
      const handle = await snapOpen();
      const at = new Date().toISOString();
      const key = 'snap:' + at;
      await new Promise((res, rej) => {
        const tx = handle.transaction('snaps', 'readwrite');
        tx.objectStore('snaps').put(json, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      const list = await window.listSnapshots();
      list.push({
        at, key, reason, bytes: json.length,
        counts: {
          invoices: (window.db.invoices || []).length,
          money: (window.db.money || []).length,
          orders: (window.db.orders || []).length
        }
      });
      while (list.length > 8) {
        const old = list.shift();
        await new Promise(res => {
          const tx = handle.transaction('snaps', 'readwrite');
          tx.objectStore('snaps').delete(old.key);
          tx.oncomplete = () => res();
          tx.onerror = () => res();
        });
      }
      window.saveSnapshotMeta(list);
      return true;
    } catch(e) {
      console.warn('[v23] takeSnapshot', e);
      return false;
    }
  };

  window.restoreSnapshot = async function(key){
    try {
      const handle = await snapOpen();
      const raw = await new Promise((res, rej) => {
        const tx = handle.transaction('snaps', 'readonly');
        const g = tx.objectStore('snaps').get(key);
        g.onsuccess = () => res(g.result || null);
        g.onerror = () => rej(g.error);
      });
      if (!raw) return alert('این نسخه پیدا نشد.');
      if (!confirm('اطلاعات فعلی با این نسخهٔ داخلی جایگزین شود؟')) return;
      const x = JSON.parse(raw);
      if (!x || typeof x !== 'object') throw new Error('bad snapshot');
      await window.takeSnapshot('before-restore');
      window.db = {
        ...window.base, ...x,
        settings: {
          ...window.base.settings, ...(x.settings || {}),
          sms: { ...window.base.settings.sms, ...((x.settings || {}).sms || {}) }
        },
        profile: { ...window.base.profile, ...(x.profile || {}) }
      };
      window.ensureAccountingSetup();
      window.save();
      alert('بازگردانی انجام شد. بخش‌های مهم را کنترل کنید.');
    } catch(e) {
      alert('بازگردانی ناموفق بود؛ اطلاعات فعلی تغییر نکرد.');
    }
  };

  window.deleteSnapshot = async function(key){
    if (!confirm('این نسخهٔ داخلی حذف شود؟')) return;
    try {
      const handle = await snapOpen();
      await new Promise(res => {
        const tx = handle.transaction('snaps', 'readwrite');
        tx.objectStore('snaps').delete(key);
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
      const list = await window.listSnapshots();
      window.saveSnapshotMeta(list.filter(s => s.key !== key));
      window.render();
    } catch(e){}
  };
}

// ============================================================
// 🟡 پچ ۹: کاهش بار MutationObserver
// ============================================================
function patch9_Observer(){
  let debounceTimer;
  const target = document.getElementById('content') || document.body;

  const obs = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const unfilteredTables = document.querySelectorAll(
        '.tablewrap:not([data-qf]) table tbody tr'
      );
      if (unfilteredTables.length > 0 && typeof window.runTableFilters === 'function') {
        try { window.runTableFilters(); } catch(e){}
      }
    }, 400);
  });
  obs.observe(target, { childList: true, subtree: true });
}

// ============================================================
// 🔴 پچ ۱۰: healInvoiceTotal فقط با force
// ============================================================
function patch10_HealInvoiceTotal(){
  window.healInvoiceTotal = function(inv, opts){
    if (!inv) return;
    if (window.invoiceHasSettlement(inv)) return;
    try {
      if (window.periodLocked(window.periodKey(inv.date))) return;
    } catch(e){}

    const force = opts && opts.force === true;
    if (!force) {
      const invItems = Array.isArray(inv.items) ? inv.items : [];
      if (invItems.length > 0) return;
    }

    const oldTotal = Number(inv.total || 0);
    const o = inv.orderId ? window.order(inv.orderId) : null;

    if (o) {
      const orderItems = Array.isArray(o.items) ? o.items : [];
      const invItems = Array.isArray(inv.items) ? inv.items : [];
      const orderSum = orderItems.reduce((s, it) =>
        s + Math.max(0, Number(it.qty || 0)) * Math.max(0, Number(it.price || 0)), 0);
      const invSum = invItems.reduce((s, it) =>
        s + Math.max(0, Number(it.qty || 0)) * Math.max(0, Number(it.price || 0)), 0);
      const orderHasService = orderItems.some(it =>
        String(it.type || '') !== 'قطعه' && Number(it.price || 0) > 0);
      const invHasService = invItems.some(it =>
        String(it.type || '') !== 'قطعه' && Number(it.price || 0) > 0);

      if (orderItems.length && (orderSum > invSum + 0.5 || (orderHasService && !invHasService) || !invItems.length)) {
        inv.items = orderItems.map(i => ({ ...i }));
        inv.extra = Number(o.extra || inv.extra || 0);
        inv.discount = Number(o.discount || inv.discount || 0);
        inv.commission = o.commission || inv.commission || 'خیر';
        inv.commissionAmount = Number(o.commissionAmount || inv.commissionAmount || 0);
      }
    }

    if (inv.orderId && force) {
      inv.items = Array.isArray(inv.items) ? inv.items : [];
      const existingIds = new Set(inv.items.map(it =>
        String(it.sourceWorkTaskId || it.workTaskId || '')).filter(Boolean));
      const existingNames = new Set(inv.items.filter(it =>
        String(it.type || '') !== 'قطعه').map(it =>
        String(it.name || '').trim()).filter(Boolean));

      for (const t of (window.db.workTasks || []).filter(t =>
        t.orderId === inv.orderId && t.status === 'انجام شد')) {
        const labor = Math.max(0, Number(t.laborCost || 0));
        const title = String(t.title || 'عملیات تعمیر').trim();
        if (!labor || !title) continue;
        if (existingIds.has(String(t.id))) continue;
        if (existingNames.has(title)) continue;
        inv.items.push({
          type: 'خدمت', name: title, qty: 1, price: labor, code: '',
          note: 'برگه‌کار ' + (t.mechanic || ''),
          workTaskId: t.id, sourceWorkTaskId: t.id
        });
        existingIds.add(String(t.id));
        existingNames.add(title);
      }
    }

    const computed = window.invoiceComputedTotal(inv);
    if (computed > 0 && Math.round(computed) !== Math.round(oldTotal)) {
      inv.total = computed;
      window.auditRecord('همگام‌سازی', 'invoices', inv.id,
        'جمع فاکتور ' + inv.number + ' از ' + oldTotal + ' به ' + computed +
        ' هماهنگ شد (بدون دریافت).');
    }
  };

  window.syncAllInvoiceBalances = function(){
    try {
      for (const inv of (window.db.invoices || [])) {
        window.healInvoiceTotal(inv, { force: true });
        window.recalculateInvoicePaid(inv, true);
        window.ensureInvoiceLedger(inv);
      }
    } catch(e) {
      console.warn('[v23] syncAllInvoiceBalances', e);
    }
  };
}

// ============================================================
// 🟠 پچ ۱۱: Toggle AI در تنظیمات
// ============================================================
function patch11_AISettingsToggle(){
  if (typeof window.settingsPage !== 'function') return;
  const original = window.settingsPage;
  window.settingsPage = function(){
    let html = original();
    const toggle = `
      <div class="panel">
        <h3>🤖 دستیار هوش مصنوعی</h3>
        <p class="muted">به‌طور پیش‌فرض غیرفعال است. فعال‌سازی نیازمند درک ریسک امنیتی نگه‌داری کلید API در مرورگر است.</p>
        <div class="field">
          <label style="display:flex;gap:8px;align-items:center">
            <input type="checkbox" id="aiEnabledToggle" ${window.db.settings?.aiEnabled ? 'checked' : ''}
              onchange="window.db.settings={...(window.db.settings||{}),aiEnabled:this.checked};window.persistDB();location.reload()">
            فعال‌سازی دستیار AI (پیش‌فرض: خاموش)
          </label>
        </div>
        <div class="notice" style="border-color:#8d4b4b">
          ⚠️ هشدار امنیتی: در صورت فعال‌سازی، کلید API شما در حافظه مرورگر ذخیره می‌شود
          و از طریق DevTools یا هر XSS قابل دسترسی است.
        </div>
      </div>`;
    return html.replace(/<\/div>\\s*$/, toggle + '</div>');
  };
}

// ============================================================
// 🟠 پچ ۱۲: پشتیبان‌گیری دسکتاپ
// ============================================================
function patch12_DesktopBackupUI(){
  if (typeof window.settingsPage !== 'function') return;
  const original = window.settingsPage;
  window.settingsPage = function(){
    let html = original();
    if (window.repairshop && window.repairshop.isDesktop) {
      const desktopPanel = `
        <div class="panel">
          <h3>🖥️ پشتیبان‌گیری دسکتاپ</h3>
          <p class="muted">نسخه دسکتاپ به‌طور خودکار پشتیبان می‌گیرد.</p>
          <div class="toolbar">
            <button class="btn" onclick="window.repairshop.backupNow()">💾 پشتیبان فوری</button>
            <button class="btn sec" onclick="window.repairshop.openBackupDir()">📁 بازکردن پوشه</button>
          </div>
          <div id="desktopBackupInfo" class="notice">در حال بارگذاری…</div>
        </div>`;
      html = html.replace(/<\/div>\\s*$/, desktopPanel + '</div>');
      setTimeout(() => {
        if (!window.repairshop) return;
        window.repairshop.getBackupDir().then(dir => {
          const info = document.getElementById('desktopBackupInfo');
          if (info) info.innerHTML = 'پوشه پشتیبان: <code>' + dir + '</code>';
        });
      }, 100);
    }
    return html;
  };
}

// ============================================================
// 🟠 پچ ۱۳: بهبود printInvoice
// ============================================================
function patch13_PrintInvoice(){
  if (typeof window.printInvoice === 'function') {
    const orig = window.printInvoice;
    window.printInvoice = function(iid){
      try { return orig(iid); }
      catch(err) {
        log('err', 'printInvoice failed: ' + err.message);
        if (typeof window.openDocChoices === 'function') {
          window.openDocChoices('invoice', iid);
        }
      }
    };
  }
}

// ============================================================
// 🟡 پچ ۱۴: قالب‌بندی واحد پول
// ============================================================
function patch14_MoneyFormat(){
  window.moneyFromBase = function(v){
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return 0;
    const unit = (window.currencyUnit && window.currencyUnit()) || 'ریال';
    const factor = unit === 'تومان' ? 0.1 : 1;
    return Math.round(n * factor);
  };

  window.moneyToBase = function(v){
    const n = Number(window.cleanNumeric ? window.cleanNumeric(v ?? 0) : (v ?? 0));
    if (!Number.isFinite(n)) return 0;
    const unit = (window.currencyUnit && window.currencyUnit()) || 'ریال';
    const factor = unit === 'تومان' ? 0.1 : 1;
    return factor === 1 ? n : Math.round(n / factor);
  };
}

// ============================================================
// 🟠 پچ ۱۵: اعتبارسنجی restore
// ============================================================
function patch15_RestoreValidation(){
  const origRestore = window.restore;
  if (typeof origRestore !== 'function') return;
  window.restore = function(e){
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) {
      alert('حجم فایل پشتیبان بیش از ۱۰۰ مگابایت است.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const requiredArrays = ['customers', 'vehicles', 'products', 'orders', 'invoices'];
        for (const key of requiredArrays) {
          if (data[key] !== undefined && !Array.isArray(data[key])) {
            throw new Error(`فیلد ${key} باید آرایه باشد`);
          }
        }
        return origRestore.call(window, e);
      } catch(err) {
        alert('فایل پشتیبان معتبر نیست: ' + err.message);
        e.target.value = '';
      }
    };
    reader.readAsText(f);
  };
}

// ============================================================
// 🟠 پچ ۱۶: deleteInvoice موجودی
// ============================================================
function patch16_DeleteInvoice(){
  const origDel = window.del;
  if (typeof origDel !== 'function') return;
  window.del = function(type, i){
    if (type === 'invoices') {
      const inv = (window.db.invoices || []).find(x => x.id === i);
      if (inv && inv.stockDeducted) {
        for (const line of (inv.items || []).filter(x => x.type === 'قطعه')) {
          const p = window.findProduct ? window.findProduct(line) : null;
          if (p) p.stock = Number(p.st