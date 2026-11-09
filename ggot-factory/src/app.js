// GGOT Factory Desk — UI. 데이터는 이 기기의 IndexedDB에만 저장된다(서버 전송·자동 동기화 없음).
import { uuid, mergeSuppliers, validate, splitPhotos, buildBackup, referencedPhotoIds, compareRows, filterRows, answerStats, toCsv } from './model.js';
import { visibleQuestions, PRODUCT_TYPES, EFFECTS, ANSWERS, EVIDENCE } from './questions.js';
import { t, getLang, setLang } from './i18n.js';
import * as store from './store.js';

export const APP_VERSION = '0.2.0';
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pref = {
  get(k, d) { try { const v = localStorage.getItem('ggot.' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ggot.' + k, String(v)); } catch { /* 사설 모드 등: 편의 설정만 잃음 */ } },
};

const WECHAT = ['추가 전', '요청 보냄', '추가 완료'];
const KINDS = ['자체 공장', '무역회사', '용기 업체', '기타', '미확인'];
const MOQ = ['500 이하', '1,000', '3,000', '5,000 이상', '직접 입력', '미확인'];
const SAMPLE = ['수령', '배송 예정', '미확보'];
const PRIORITY = ['우선 후보', '비교 후보', '보류'];
const ACTIONS = ['견적 요청', '샘플 요청', '자료 요청', '공장 방문', '답변 대기', '완료'];
const CATEGORIES = ['제품·샘플', '용기·패키지', '성분·자료', '견적·명함', '위챗 QR', '기타 참고'];
const AUTHORS = ['Tony', '金彤'];

let suppliers = [], current = null, product = null, view = 'list';
let photoCategory = '제품·샘플';
const thumbCache = new Map();
let photoJobs = 0, photoDone = Promise.resolve();
const cmp = { priority: '', author: '', type: '', effect: '', sample: '', evidence: false, q: '', question: '' };

/* ───────── 상태 메시지 ───────── */
let statusTimer;
function setStatus(text, sticky = false) {
  const el = $('#status');
  el.textContent = text;
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

/* ───────── 저장 큐: 모든 기록은 순서대로, 실패는 호출자에게 전파 ───────── */
let saveChain = Promise.resolve(), dirty = false, failed = false, timer = null;
function enqueue(fn) { const p = saveChain.catch(() => {}).then(fn); saveChain = p; return p; }
function touch(owner = current) { if (owner) owner.updatedAt = new Date().toISOString(); }
function save() {
  clearTimeout(timer); timer = null; dirty = false;
  const snapshot = structuredClone(suppliers);
  return enqueue(() => store.saveSuppliers(snapshot)).then(() => {
    if (!dirty) { failed = false; hideSaveError(); }
    pref.set('lastChangeAt', Date.now());
    setStatus(t('저장됨'));
  }, e => { dirty = true; failed = true; showSaveError(e); throw e; });
}
/** 텍스트 입력: 0.35초 모아서 저장 */
function saveLater() { touch(); dirty = true; clearTimeout(timer); timer = setTimeout(() => save().catch(() => {}), 350); }
/** 버튼 입력: 즉시 저장 (실패는 상단 경고줄로 표시) */
function saveNow() { touch(); return save().catch(() => {}); }
/** 화면 전환 전: 대기 중인 저장을 끝내고, 실패했으면 reject */
function flush() { return (dirty || timer || failed) ? save() : saveChain; }

function errorText(e) {
  const n = e?.name || '';
  if (n === 'QuotaExceededError' || /quota/i.test(e?.message || '')) return t('기기 저장공간이 부족합니다. 사진을 줄이거나 저장공간을 확보하세요.');
  if (n === 'InvalidStateError') return t('저장소 연결이 끊어졌습니다. 앱을 완전히 닫았다가 다시 여세요.');
  return (n ? n + ': ' : '') + (e?.message || String(e));
}
function showSaveError(e) {
  const bar = $('#savebar');
  bar.hidden = false;
  bar.querySelector('.msg').textContent = t('저장 실패!') + ' ' + errorText(e) + ' ' + t('앱을 닫지 말고 백업을 먼저 만드세요.');
}
function hideSaveError() { $('#savebar').hidden = true; }

addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && (dirty || timer)) save().catch(() => {}); });
addEventListener('pagehide', () => { if (dirty || timer) save().catch(() => {}); });
addEventListener('ggot-db-closed', () => showSaveError(new Error(t('다른 창에서 앱이 업데이트되어 저장소가 닫혔습니다. 앱을 다시 여세요.'))));

/* ───────── 데이터 생성/정리 ───────── */
function freshProduct() { return { id: uuid(), name: '', types: ['선크림'], effects: [], answers: {}, moq: '미확인', price: '', sample: '미확보', note: '' }; }
function nextName() {
  const n = suppliers.reduce((m, s) => Math.max(m, +(/^업체 (\d+)$/.exec(s.name)?.[1] || 0)), 0);
  return '업체 ' + String(Math.max(n, suppliers.length) + 1).padStart(3, '0');
}
function newSupplier() {
  const at = new Date().toISOString();
  const s = { id: uuid(), name: nextName(), author: author(), booth: '', wechat: '추가 전', contact: '', kind: '미확인', priority: '비교 후보', action: '견적 요청', products: [freshProduct()], photos: [], createdAt: at, updatedAt: at };
  suppliers.push(s);
  return s;
}
function normalize(list) {
  for (const s of list) {
    s.products = Array.isArray(s.products) && s.products.length ? s.products : [freshProduct()];
    s.photos = Array.isArray(s.photos) ? s.photos : [];
    for (const p of s.products) { p.types ||= []; p.effects ||= []; p.answers ||= {}; }
  }
  return list;
}
const author = () => $('#author').value;
const productLabel = (s, pid) => {
  if (!pid) return t('업체 공통');
  const i = s.products.findIndex(p => p.id === pid);
  return i < 0 ? t('삭제된 제품') : (s.products[i].name || t('제품') + ' ' + (i + 1));
};
const fmt = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? t('방금') : m < 60 ? m + t('분 전') : Math.round(m / 60) + t('시간 전'); };
const mb = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';

/* ───────── 공통 렌더 조각 ───────── */
const field = (label, key, value, opt = {}) => opt.area
  ? `<label class="fld"><span>${label}</span><textarea data-field="${key}" rows="3" placeholder="${esc(opt.ph || '')}">${esc(value)}</textarea></label>`
  : `<label class="fld"><span>${label}</span><input data-field="${key}" type="${opt.type || 'text'}" value="${esc(value)}" placeholder="${esc(opt.ph || '')}"${opt.mode ? ` inputmode="${opt.mode}"` : ''}></label>`;
function chips(label, key, values, value, multi = false) {
  return `<div class="fld"><span>${label}</span><div class="chips">${values.map(v => {
    const on = multi ? (value || []).includes(v) : value === v;
    return `<button type="button" data-key="${key}" data-value="${esc(v)}" data-multi="${multi}" class="${on ? 'on' : ''}" aria-pressed="${on}">${esc(t(v))}</button>`;
  }).join('')}</div></div>`;
}
/** 한국어 화면: '한국어 / 中文' 병기, 중국어 화면: 중국어만 */
const bi = (ko, zhText) => (getLang() === 'zh' ? t(ko) : `${ko} / ${zhText}`);
const fileBtn = (text, attrs, cls = '') => `<label class="btn ${cls}">${text}<input class="vh" type="file" accept="image/*" ${attrs}></label>`;

/* ───────── 목록 ───────── */
function list() {
  view = 'list'; current = null; product = null; thumbCache.clear();
  app.innerHTML = `
  <div class="hero">
    <button type="button" class="primary big" data-act="new">＋ ${t('새 업체 등록')}</button>
    ${fileBtn('📷 ' + t('QR·명함 사진부터 등록'), 'capture="environment" data-quick', 'big alt')}
  </div>
  <div id="notices"></div>
  <input id="search" type="search" placeholder="${t('업체명·담당자·부스·제품 검색')}" aria-label="${t('검색')}">
  <h2>${t('업체 기록')} <small>${suppliers.length}</small></h2>
  <div id="cards" class="cards"></div>`;
  drawList();
  drawNotices();
}
function drawList() {
  const q = ($('#search')?.value || '').toLowerCase();
  const items = [...suppliers].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .filter(s => [s.name, s.contact, s.booth, ...s.products.map(p => p.name)].join(' ').toLowerCase().includes(q));
  $('#cards').innerHTML = items.map(s => `
    <button type="button" class="card" data-open="${esc(s.id)}">
      <h3>${esc(s.name || t('이름 없음'))}</h3>
      <p>${esc(s.booth || t('부스 미입력'))} · ${esc(s.author)} · ${t('위챗')} ${esc(t(s.wechat))}</p>
      <p>${s.products.length} ${t('제품')} · ${s.photos.length} ${t('사진')} · ${fmt(s.updatedAt || s.createdAt)}</p>
      <p><span class="tag p-${PRIORITY.indexOf(s.priority)}">${esc(t(s.priority))}</span> ${esc(t(s.action))}${s.followup ? ' · ' + esc(s.followup) : ''}</p>
    </button>`).join('') || `<p class="empty">${t('새 업체를 등록하세요')}</p>`;
}
async function drawNotices() {
  const box = $('#notices'); if (!box) return;
  const out = [];
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !standalone) out.push(`<p class="warn">${t('지금은 Safari 탭입니다. 홈 화면에 추가한 앱과 Safari 탭은 저장소가 따로입니다. 현장 입력은 홈 화면 앱 한 곳에서만 하세요.')}</p>`);
  const lastB = +pref.get('lastBackupAt', 0), lastC = +pref.get('lastChangeAt', 0);
  if (suppliers.length && lastC > lastB) out.push(`<p class="note">${lastB ? t('마지막 백업') + ': ' + ago(lastB) + '. ' : t('아직 백업이 없습니다. ')}${t('백업 이후 변경이 있습니다.')} <button type="button" class="link" data-act="backup">${t('백업 만들기')}</button></p>`);
  box.innerHTML = out.join('');
  try {
    const orphans = await findOrphans();
    if (orphans.length && view === 'list') box.insertAdjacentHTML('beforeend', `<p class="note">${t('업체에 연결되지 않은 사진')} ${orphans.length}${t('장')} <button type="button" class="link" data-act="orphans">${t('사진함 열기')}</button></p>`);
  } catch { /* 표시만 생략 */ }
}

/* ───────── 업체 편집 ───────── */
function open(id, pid) {
  if (current?.id !== id) thumbCache.clear();
  current = suppliers.find(s => s.id === id);
  if (!current) return list();
  product = current.products.find(p => p.id === pid) || current.products[0];
  edit(); scrollTo(0, 0);
}
function edit() {
  view = 'edit';
  const s = current, p = product, qs = visibleQuestions(p), st = answerStats(p);
  const supPhotos = s.photos.filter(x => !x.productId), prodPhotos = s.photos.filter(x => x.productId);
  app.innerHTML = `
  <div class="crumb"><button type="button" class="ghost" data-act="list">← ${t('목록')}</button><span class="meta">${esc(s.author)} · ${fmt(s.createdAt)}</span></div>
  <h2 id="supName">${esc(s.name || t('이름 없음'))}</h2>
  ${s.copyOf ? `<p class="warn">${t('가져오기 중 같은 기록의 다른 내용이 있어 사본으로 보존된 업체입니다. 원본과 비교 후 정리하세요.')}</p>` : ''}

  <section class="card">
    <h3>1. ${t('업체 확인')}</h3>
    <p class="hint">${t('회사명을 모르면 임시 이름 그대로 두고 QR·명함 사진만 찍으세요. QR 사진은 저장만 되며 회사명 자동 인식이나 위챗 친구 추가는 하지 않습니다.')}</p>
    <div class="row2">
      ${fileBtn('📷 ' + t('위챗 QR 촬영'), 'capture="environment" data-photo data-cat="위챗 QR" data-scope="supplier"', 'alt')}
      ${fileBtn('📷 ' + t('명함 촬영'), 'capture="environment" data-photo data-cat="견적·명함" data-scope="supplier"', 'alt')}
    </div>
    ${thumbs(supPhotos)}
    <div class="grid">
      ${field(bi('회사명', '公司名称'), 's.name', s.name)}
      ${field(bi('부스', '展位'), 's.booth', s.booth)}
      ${field(bi('위챗 이름·담당자', '微信联系人'), 's.contact', s.contact)}
    </div>
    ${chips(bi('위챗 연결', '微信'), 's.wechat', WECHAT, s.wechat)}
    ${chips(bi('업체 유형', '企业类型'), 's.kind', KINDS, s.kind)}
    ${s.kind === '기타' || s.kindOther ? field(t('기타 업체 유형'), 's.kindOther', s.kindOther) : ''}
  </section>

  <section class="card">
    <h3>2. ${t('제품별 체크')}</h3>
    <div class="chips tabs">${s.products.map((x, i) => `<button type="button" data-product="${esc(x.id)}" class="${x.id === p.id ? 'on' : ''}">${esc(x.name || t('제품') + ' ' + (i + 1))}</button>`).join('')}<button type="button" data-act="addProduct">＋ ${t('제품 추가')}</button></div>
    ${field(bi('제품·샘플명', '产品样品名'), 'p.name', p.name)}
    ${chips(bi('제품 종류', '产品类型'), 'p.types', PRODUCT_TYPES, p.types, true)}
    ${p.types.includes('기타') || p.typeOther ? field(t('기타 제품 종류'), 'p.typeOther', p.typeOther) : ''}
    ${chips(bi('효능', '功效'), 'p.effects', EFFECTS, p.effects, true)}
    <div class="qhead">
      <b>${t('질문')} ${qs.length} · <span class="muted">${t('있음')} ${st.있음} · ${t('없음')} ${st.없음} · ${t('확인 필요')} ${st['확인 필요']} · ${t('미확인')} ${st.미확인}</span></b>
      <button type="button" data-act="copyZh">📋 ${t('중국어 질문 복사')}</button>
    </div>
    <p class="hint">${t('답변과 증빙은 따로 기록합니다. 체크는 효능 입증이나 규제 승인을 뜻하지 않습니다. 같은 버튼을 다시 누르면 선택이 지워집니다.')}</p>
    ${qs.map(([id, , ko, zh]) => {
      const a = p.answers[id] || {};
      const [first, second] = getLang() === 'zh' ? [zh, ko] : [ko, zh];
      return `<div class="question${a.answer ? '' : ' unknown'}">
        <b>${esc(first)}</b><div class="sub">${esc(second)}</div>${a.answer ? '' : `<span class="badge">${t('미확인')}</span>`}
        ${chips(bi('답변', '回答'), 'a.' + id, ANSWERS, a.answer || '')}
        ${chips(bi('증빙', '资料'), 'e.' + id, EVIDENCE, a.evidence || '')}
      </div>`;
    }).join('')}
    ${chips(bi('MOQ', '起订量'), 'p.moq', MOQ, p.moq)}
    <div class="grid">
      ${field(t('정확한 MOQ'), 'p.exactMoq', p.exactMoq, { mode: 'numeric' })}
      ${field(bi('단가·통화·수량 조건', '单价条件'), 'p.price', p.price, { ph: t('예: 3.2 RMB / 3,000개 / 용기 별도') })}
      ${field(bi('추가 비용', '额外费用'), 'p.extra', p.extra)}
      ${field(bi('납기', '交期'), 'p.lead', p.lead)}
    </div>
    ${chips(bi('샘플', '样品'), 'p.sample', SAMPLE, p.sample)}
    ${field(bi('추가 메모', '备注'), 'p.note', p.note, { area: true })}
    ${s.products.length > 1 ? `<button type="button" class="ghost danger-text" data-act="delProduct">${t('이 제품 삭제')}</button>` : ''}
  </section>

  <section class="card">
    <h3>3. ${t('참고 사진')} <small>${esc(productLabel(s, p.id))}</small></h3>
    <div class="chips">${CATEGORIES.map(c => `<button type="button" data-cat-pick="${esc(c)}" class="${c === photoCategory ? 'on' : ''}">${esc(t(c))}</button>`).join('')}</div>
    <div class="row2">
      ${fileBtn('📷 ' + t('촬영'), 'capture="environment" data-photo data-scope="product"', 'primary')}
      ${fileBtn('🖼 ' + t('사진 선택'), 'multiple data-photo data-scope="product"')}
    </div>
    <p class="hint">${t('긴 변 최대 1800px JPEG 압축본으로 저장합니다(원본 아님). 앱에서 촬영한 사진은 아이폰 사진 앱에 따로 저장되지 않습니다. 원본 보관은 [상태] 화면에서 켤 수 있습니다.')}</p>
    ${thumbs(prodPhotos, p.id)}
  </section>

  <section class="card">
    <h3>4. ${t('후속 조치')}</h3>
    ${chips(t('관심도'), 's.priority', PRIORITY, s.priority)}
    ${chips(t('다음 행동'), 's.action', ACTIONS, s.action)}
    ${field(t('후속 연락일'), 's.followup', s.followup, { type: 'date' })}
  </section>
  <button type="button" class="ghost danger-text" data-act="delSupplier">${t('이 업체 기록 삭제')}</button>
  <div class="sticky"><button type="button" class="primary" data-act="next">✓ ${t('완료 · 다음 업체')}</button><button type="button" data-act="list">${t('목록으로')}</button></div>`;
  hydrateThumbs();
}
function thumbs(photos, highlightPid) {
  if (!photos.length) return '';
  return `<div class="photos">${photos.map(x => `
    <button type="button" class="ph${highlightPid && x.productId === highlightPid ? ' cur' : ''}" data-photo-open="${esc(x.id)}">
      <img data-thumb="${esc(x.id)}" alt="${esc(t(x.category))}">
      <span>${x.star ? '★ ' : ''}${esc(t(x.category))}${x.productId ? ' · ' + esc(productLabel(current, x.productId)) : ''}</span>
      ${x.note ? `<em>${esc(x.note)}</em>` : ''}
    </button>`).join('')}</div>`;
}
function rerender() { const y = scrollY; edit(); scrollTo(0, y); }

/* ───────── 사진 ───────── */
function draw(im, w, h, max, q) {
  const k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', q), out = { url, w: c.width, h: c.height };
  c.width = c.height = 0; // iOS 캔버스 메모리 즉시 반환
  if (!url.startsWith('data:image/jpeg')) throw new Error(t('사진 변환 실패(메모리 부족 가능)'));
  return out;
}
async function loadImage(src) { const im = new Image(); im.decoding = 'async'; im.src = src; await im.decode(); return im; }
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    let im;
    try { im = await loadImage(url); } catch { throw new Error(t('이미지를 해독할 수 없습니다')); }
    const w = im.naturalWidth, h = im.naturalHeight;
    if (!w || !h) throw new Error(t('이미지 크기를 읽을 수 없습니다'));
    const full = draw(im, w, h, 1800, 0.85), th = draw(im, w, h, 360, 0.72);
    return { data: full.url, thumb: th.url, width: full.w, height: full.h };
  } finally { URL.revokeObjectURL(url); }
}
const readDataURL = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
const dataBytes = d => Math.round((d.length - d.indexOf(',') - 1) * 3 / 4);

/** 사진 저장: 사진 레코드를 먼저 기록 → 업체 메타데이터 저장. 메타 저장 실패 시 사진은 '미연결 사진함'에서 복구 가능. */
async function addPhotos(files, owner, productId, category) {
  files = [...files];
  if (!files.length) return;
  photoJobs++;
  let finish; photoDone = Promise.all([photoDone, new Promise(r => { finish = r; })]);
  const fails = []; let ok = 0;
  setStatus(`${t('사진 처리 중…')} 0/${files.length}`, true);
  try {
    for (const [i, file] of files.entries()) {
      try {
        if (file.size > 60e6) throw new Error(t('파일이 너무 큽니다'));
        const c = await compress(file);
        const id = uuid(), rec = { id, data: c.data };
        let original;
        if (pref.get('keepOriginal', '0') === '1') {
          if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= 15e6) {
            const d = await readDataURL(file);
            if (/^data:image\/(jpeg|png|webp);base64,/.test(d)) { rec.original = d; original = { kept: true, mime: file.type, bytes: file.size }; }
          }
          original ||= { kept: false, reason: (file.type || t('형식 알 수 없음')) + (file.size > 15e6 ? ' >15MB' : '') };
        }
        await store.putPhoto(rec, c.thumb);
        thumbCache.set(id, c.thumb);
        owner.photos.push({ id, productId, category, note: '', star: false, createdAt: new Date().toISOString(), author: author(), width: c.width, height: c.height, mime: 'image/jpeg', bytes: dataBytes(c.data), ...(original ? { original } : {}) });
        touch(owner);
        ok++;
        setStatus(`${t('사진 처리 중…')} ${i + 1}/${files.length}`, true);
      } catch (e) {
        fails.push(`${file.name || 'photo'} (${file.type || t('형식 알 수 없음')}): ${errorText(e)}`);
      }
    }
    if (ok) await save().catch(() => {});
  } finally { photoJobs--; finish(); }
  setStatus(ok ? `${t('사진 저장')} ${ok}${t('장')}` : t('저장된 사진 없음'));
  if (fails.length) alert(t('일부 사진을 처리하지 못했습니다. JPG/PNG로 다시 선택하세요.') + '\n\n' + fails.join('\n'));
  if (view === 'edit' && current === owner) rerender();
}
async function makeThumb(data) { const im = await loadImage(data); return draw(im, im.naturalWidth, im.naturalHeight, 360, 0.72).url; }
async function hydrateThumbs() {
  const ids = [...new Set([...document.querySelectorAll('img[data-thumb]')].map(i => i.dataset.thumb))].filter(id => !thumbCache.has(id));
  try {
    if (ids.length) {
      const m = await store.getThumbs(ids);
      m.forEach((v, k) => thumbCache.set(k, v.thumb));
      const miss = ids.filter(id => !m.has(id));
      if (miss.length) {
        const full = await store.getPhotos(miss);
        for (const [id, r] of full) {
          try { const th = await makeThumb(r.data); thumbCache.set(id, th); store.putThumb(id, th).catch(() => {}); } catch { /* 표시 생략 */ }
        }
      }
    }
  } catch (e) { setStatus(t('사진 미리보기를 불러오지 못했습니다') + ': ' + errorText(e)); }
  document.querySelectorAll('img[data-thumb]').forEach(i => {
    const v = thumbCache.get(i.dataset.thumb);
    if (v) i.src = v; else i.classList.add('missing');
  });
}
async function deletePhotoData(ids) {
  const used = referencedPhotoIds(suppliers);
  const gone = ids.filter(id => !used.has(id));
  if (gone.length) await enqueue(() => store.deletePhotos(gone));
  gone.forEach(id => thumbCache.delete(id));
}
async function findOrphans() {
  const keys = await store.photoKeys(), used = referencedPhotoIds(suppliers);
  return keys.filter(k => !used.has(k));
}

/* ───────── 사진 확대보기 / 메모 / 삭제 ───────── */
const viewer = $('#viewer');
let viewing = null;
async function openViewer(id) {
  const s = current, x = s?.photos.find(p => p.id === id);
  if (!x) return;
  viewing = { s, x };
  viewer.innerHTML = `
    <div class="vbar"><button type="button" data-v="close">✕ ${t('닫기')}</button><button type="button" data-v="star">${x.star ? '★' : '☆'} ${t('중요')}</button><button type="button" class="danger" data-v="delete">${t('삭제')}</button></div>
    <div class="vimg"><img id="vimg" alt="${esc(t(x.category))}"></div>
    <div class="vform">
      <label class="fld"><span>${t('분류')}</span><select data-v="category">${CATEGORIES.map(c => `<option value="${esc(c)}"${c === x.category ? ' selected' : ''}>${esc(t(c))}</option>`).join('')}</select></label>
      <label class="fld"><span>${t('연결 제품')}</span><select data-v="product"><option value="">${t('업체 공통')}</option>${s.products.map((p, i) => `<option value="${esc(p.id)}"${p.id === x.productId ? ' selected' : ''}>${esc(p.name || t('제품') + ' ' + (i + 1))}</option>`).join('')}</select></label>
      <label class="fld"><span>${t('사진 메모')}</span><textarea data-v="note" rows="3">${esc(x.note)}</textarea></label>
      <p class="meta">${x.width || '?'}×${x.height || '?'} JPEG · ${x.bytes ? mb(x.bytes) : ''} · ${t('압축본')}${x.original?.kept ? ' · ' + t('원본 보관됨') : x.original ? ' · ' + t('원본 보관 안 됨') + ' (' + esc(x.original.reason || '') + ')' : ''} · ${fmt(x.createdAt)}</p>
    </div>`;
  viewer.hidden = false;
  document.body.classList.add('noscroll');
  $('#vimg').src = thumbCache.get(id) || '';
  try {
    const r = (await store.getPhotos([id])).get(id);
    if (r && viewing?.x === x) $('#vimg').src = r.data;
    else if (!r) setStatus(t('사진 원본 데이터를 찾을 수 없습니다'));
  } catch (e) { setStatus(errorText(e)); }
}
function closeViewer() {
  viewer.hidden = true; viewer.innerHTML = ''; document.body.classList.remove('noscroll');
  const s = viewing?.s; viewing = null;
  if (view === 'edit' && s === current) rerender();
}
viewer.addEventListener('click', async e => {
  const b = e.target.closest('button[data-v]'); if (!b || !viewing) return;
  const { s, x } = viewing;
  if (b.dataset.v === 'close') return closeViewer();
  if (b.dataset.v === 'star') { x.star = !x.star; touch(s); saveNow(); b.textContent = (x.star ? '★ ' : '☆ ') + t('중요'); }
  if (b.dataset.v === 'delete') {
    if (!confirm(t('이 사진을 삭제할까요? 되돌릴 수 없습니다.'))) return;
    s.photos = s.photos.filter(p => p !== x); touch(s);
    try { await save(); await deletePhotoData([x.id]); setStatus(t('사진 삭제됨')); }
    catch { s.photos.push(x); alert(t('저장 실패로 사진을 삭제하지 않았습니다.')); }
    closeViewer();
  }
});
viewer.addEventListener('input', e => {
  if (!viewing) return;
  const el = e.target, { s, x } = viewing;
  if (el.dataset.v === 'note') { x.note = el.value; touch(s); dirty = true; clearTimeout(timer); timer = setTimeout(() => save().catch(() => {}), 350); }
});
viewer.addEventListener('change', e => {
  if (!viewing) return;
  const el = e.target, { s, x } = viewing;
  if (el.dataset.v === 'category') { x.category = el.value; touch(s); saveNow(); }
  if (el.dataset.v === 'product') { x.productId = el.value || null; touch(s); saveNow(); }
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !viewer.hidden) closeViewer(); });

/* ───────── 이동 / 등록 ───────── */
function create() {
  current = newSupplier(); product = current.products[0]; thumbCache.clear();
  edit(); scrollTo(0, 0);
  return save().catch(() => {});
}
async function goNext(btn) {
  btn.disabled = true;
  try {
    if (photoJobs) { setStatus(t('사진 저장이 끝날 때까지 기다리는 중…'), true); await photoDone; }
    await flush();
    await create();
    setStatus(t('저장 완료. 다음 업체를 입력하세요.'));
  } catch (e) {
    alert(t('저장에 실패하여 다음 업체로 넘어가지 않았습니다.') + '\n' + errorText(e) + '\n\n' + t('상단의 [다시 저장]을 누르거나 백업을 먼저 만드세요. 앱을 닫으면 저장되지 않은 입력이 사라질 수 있습니다.'));
  } finally { btn.disabled = false; }
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 대체 */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'vh'; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* 무시 */ }
  ta.remove();
  if (!ok) showModal(`<p>${t('자동 복사가 막혔습니다. 아래 글을 길게 눌러 복사하세요.')}</p><textarea readonly rows="10">${esc(text)}</textarea>`);
  return ok;
}
function zhInquiry(p) {
  const qs = visibleQuestions(p), pending = qs.filter(([id]) => !p.answers[id]?.answer), use = pending.length ? pending : qs;
  return [`您好！关于${p.name ? `「${p.name}」` : '贵司产品'}，想确认以下问题：`, ...use.map(([, , , zh], i) => `${i + 1}. ${zh}`), '如有相关资料，麻烦发给我们，谢谢！'].join('\n');
}
function showModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="mbox">${html}<button type="button" data-act="closeModal">${t('닫기')}</button></div>`;
  m.hidden = false;
}

/* ───────── 비교표 ───────── */
const heads = () => [t('업체'), t('부스'), t('작성자'), t('제품'), t('종류'), t('효능'), 'MOQ', t('정확한 MOQ'), t('단가 조건'), t('추가 비용'), t('납기'), t('샘플'), t('응답 현황'), t('증빙 확보'),
  ...(cmp.question ? [t('선택 질문 답변'), t('선택 질문 증빙')] : []), t('관심도'), t('다음 행동'), t('후속 연락일'), t('위챗')];
function rowValues({ s, p, index, stats: st }) {
  const tr = v => t(v);
  const a = cmp.question ? p.answers[cmp.question] : null;
  const shown = cmp.question && visibleQuestions(p).some(([id]) => id === cmp.question);
  return [s.name, s.booth || '', s.author || '', p.name || t('제품') + ' ' + (index + 1),
    [...p.types.map(tr), p.typeOther].filter(Boolean).join('/'), p.effects.map(tr).join('/') || t('미확인'),
    tr(p.moq || '미확인'), p.exactMoq || '', p.price || t('미확인'), p.extra || '', p.lead || '', tr(p.sample || '미확보'),
    `${t('있음')} ${st.있음} · ${t('없음')} ${st.없음} · ${t('확인 필요')} ${st['확인 필요']} · ${t('미확인')} ${st.미확인}`, `${st.증빙}/${st.total}`,
    ...(cmp.question ? [a?.answer ? tr(a.answer) : (shown ? t('미확인') : t('해당 질문 아님')), a?.evidence ? tr(a.evidence) : ''] : []),
    tr(s.priority || ''), tr(s.action || ''), s.followup || '', tr(s.wechat || '')];
}
const sel = (key, label, values) => `<label class="fld"><span>${label}</span><select data-cmp="${key}"><option value="">${t('전체')}</option>${values.map(v => `<option value="${esc(v)}"${cmp[key] === v ? ' selected' : ''}>${esc(t(v))}</option>`).join('')}</select></label>`;
function compare() {
  view = 'compare'; current = null; product = null;
  const qopts = (() => { const seen = new Map(); suppliers.forEach(s => s.products.forEach(p => visibleQuestions(p).forEach(q => seen.set(q[0], q)))); return [...seen.values()]; })();
  app.innerHTML = `
  <h2>${t('공장·제품 비교')}</h2>
  <p class="hint">${t('제품 단위 비교입니다. 점수·순위는 매기지 않습니다. 단가는 통화·수량·부대비용이 확인될 때만 비교하세요. 미확인은 불가가 아니며, 자료 확보는 효능 검증과 다릅니다.')}</p>
  <div class="filters">
    ${sel('priority', t('관심도'), PRIORITY)}${sel('author', t('작성자'), AUTHORS)}${sel('type', t('제품 종류'), PRODUCT_TYPES)}${sel('effect', t('효능'), EFFECTS)}${sel('sample', t('샘플'), SAMPLE)}
    <label class="fld"><span>${t('질문 열 추가')}</span><select data-cmp="question"><option value="">${t('없음')}</option>${qopts.map(([id, , ko, zh]) => `<option value="${esc(id)}"${cmp.question === id ? ' selected' : ''}>${esc(getLang() === 'zh' ? zh : ko)}</option>`).join('')}</select></label>
    <label class="fld"><span>${t('검색')}</span><input type="search" data-cmp="q" value="${esc(cmp.q)}"></label>
    <label class="check"><input type="checkbox" data-cmp="evidence"${cmp.evidence ? ' checked' : ''}> ${t('증빙 확보된 제품만')}</label>
  </div>
  <div class="row2"><button type="button" data-act="csv">⬇ CSV ${t('내보내기')}</button><button type="button" class="ghost" data-act="resetCmp">${t('필터 초기화')}</button></div>
  <p class="meta" id="cmpCount"></p>
  <div id="table" class="scroll"></div>`;
  drawCompare();
}
function currentRows() { return filterRows(compareRows(suppliers), cmp); }
function drawCompare() {
  const rows = currentRows(), h = heads();
  $('#cmpCount').textContent = `${rows.length} / ${compareRows(suppliers).length} ${t('제품')}`;
  $('#table').innerHTML = rows.length ? `<table class="cmp"><thead><tr>${h.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r =>
    `<tr data-open="${esc(r.s.id)}" data-pid="${esc(r.p.id)}" tabindex="0">${rowValues(r).map((v, i) => `<td data-label="${esc(h[i])}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : `<p class="empty">${t('조건에 맞는 제품이 없습니다')}</p>`;
}
function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
function exportCsv() {
  const rows = currentRows();
  downloadBlob(new Blob([toCsv([heads(), ...rows.map(rowValues)])], { type: 'text/csv;charset=utf-8' }), `GGOT-comparison-${stamp()}.csv`);
  setStatus(t('CSV 다운로드를 시작했습니다'));
}

/* ───────── 백업 / 가져오기 ───────── */
function backupView() {
  view = 'backup'; current = null; product = null;
  const lastB = +pref.get('lastBackupAt', 0);
  app.innerHTML = `
  <h2>${t('백업 · 합치기')}</h2>
  <section class="card">
    <h3>${t('사진 포함 백업 만들기')}</h3>
    <p class="hint">${t('기록은 이 기기에만 있습니다. 자동 동기화가 없으므로 전시 중 여러 번 백업하세요. 백업 파일에는 위챗 QR·연락처·견적이 들어 있으니 공개된 곳에 올리지 마세요.')}</p>
    <button type="button" class="primary" data-act="makeBackup">${t('백업 파일 만들기')}</button>
    <div id="backupOut"></div>
    <p class="meta">${t('마지막 백업')}: ${lastB ? new Date(lastB).toLocaleString() : t('없음')}</p>
  </section>
  <section class="card">
    <h3>${t('백업 합치기 (가져오기)')}</h3>
    <p class="hint">${t('다른 기기(Tony/金彤)의 백업 파일을 이 기기 기록에 합칩니다. 기존 기록은 덮어쓰지 않습니다. 같은 기록인데 내용이 다르면 "(가져온 사본)"으로 따로 보존합니다. 회사명이 같아도 다른 기록은 자동으로 합치지 않습니다.')}</p>
    <label class="btn">📂 ${t('백업 파일 선택')}<input class="vh" type="file" accept="application/json,.json" data-import></label>
  </section>`;
}
let preparedBackup = null;
async function makeBackup(btn) {
  btn.disabled = true;
  const out = $('#backupOut');
  out.textContent = t('백업 준비 중…');
  try {
    await flush().catch(() => {}); // 저장 실패 중이어도 메모리의 최신 기록으로 백업한다
    const ids = [...referencedPhotoIds(suppliers)];
    const recs = await store.getPhotos(ids);
    const { backup, missing } = buildBackup(structuredClone(suppliers), recs);
    const name = `GGOT-backup-${author()}-${stamp()}.json`.replace(/[^\w.\-一-鿿]/g, '_');
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    preparedBackup = { blob, name };
    const canShare = !!navigator.canShare?.({ files: [new File([blob], name, { type: 'application/json' })] });
    out.innerHTML = `<p>${esc(name)} · ${mb(blob.size)} · ${suppliers.length} ${t('업체')} · ${ids.length - missing} ${t('사진')}</p>
      ${missing ? `<p class="warn">${t('사진 데이터를 찾지 못해 백업에서 빠진 사진')}: ${missing}</p>` : ''}
      <div class="row2">${canShare ? `<button type="button" class="primary" data-act="shareBackup">${t('공유 · 파일에 저장')}</button>` : ''}<button type="button" data-act="downloadBackup">⬇ ${t('다운로드')}</button></div>
      <p class="hint">${t('iPhone: [공유 · 파일에 저장] → "파일에 저장" → iCloud Drive 또는 나의 iPhone. 위챗으로 보내면 파일이 텐센트 서버를 거칩니다.')}</p>`;
  } catch (e) {
    out.innerHTML = `<p class="warn">${t('백업 만들기 실패')}: ${esc(errorText(e))}</p>`;
  } finally { btn.disabled = false; }
}
async function shareBackup() {
  if (!preparedBackup) return;
  const file = new File([preparedBackup.blob], preparedBackup.name, { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: preparedBackup.name });
    pref.set('lastBackupAt', Date.now());
    setStatus(t('공유 시트에서 저장을 완료했는지 파일 앱에서 확인하세요'));
  } catch (e) {
    if (e?.name !== 'AbortError') alert(t('공유 실패') + ': ' + errorText(e) + '\n' + t('[다운로드]를 사용하세요.'));
  }
}
function downloadBackup() {
  if (!preparedBackup) return;
  downloadBlob(preparedBackup.blob, preparedBackup.name);
  pref.set('lastBackupAt', Date.now());
  setStatus(t('다운로드를 시작했습니다. 파일 앱/다운로드 폴더에서 확인하세요'));
}
async function importFile(file) {
  try {
    if (!file) return;
    if (file.size > 800e6) throw new Error(t('파일이 너무 큽니다'));
    let x;
    try { x = JSON.parse(await file.text()); } catch { throw new Error(t('JSON 백업 파일이 아닙니다')); }
    if (!validate(x)) throw new Error(t('지원하지 않는 백업 형식이거나 손상된 파일입니다'));
    const { suppliers: incoming, records } = splitPhotos(normalize(x.suppliers));
    const r = mergeSuppliers(suppliers, incoming);
    await enqueue(() => store.importAtomic(structuredClone(r.suppliers), records));
    suppliers = r.suppliers;
    if (!dirty && !timer) { failed = false; hideSaveError(); }
    pref.set('lastChangeAt', Date.now());
    list();
    const msg = `${t('합치기 완료')}: ${t('추가')} ${r.added}, ${t('사본 보존')} ${r.copies}, ${t('동일하여 건너뜀')} ${r.same}`;
    setStatus(msg); alert(msg);
  } catch (e) {
    alert(t('가져오기 실패 — 이 기기의 기록은 바뀌지 않았습니다.') + '\n' + errorText(e));
  }
}

/* ───────── 상태 / 설정 ───────── */
let swInfo = t('확인 중');
async function statusView() {
  view = 'status'; current = null; product = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const photos = suppliers.reduce((n, s) => n + s.photos.length, 0), prods = suppliers.reduce((n, s) => n + s.products.length, 0);
  app.innerHTML = `
  <h2>${t('저장 · 오프라인 상태')}</h2>
  <section class="card"><dl class="info">
    <dt>${t('저장 위치')}</dt><dd>${t('이 기기의 이 앱(브라우저 저장소)에만 저장됩니다. 서버로 보내지 않으며 Tony/金彤 기기 간 자동 동기화는 없습니다.')}</dd>
    <dt>${t('실행 방식')}</dt><dd>${standalone ? t('홈 화면 앱') : t('브라우저 탭')}</dd>
    <dt>${t('오프라인 실행')}</dt><dd id="offline">${esc(swInfo)}</dd>
    <dt>${t('영구 저장')}</dt><dd id="persist">…</dd>
    <dt>${t('사용량')}</dt><dd id="usage">…</dd>
    <dt>${t('기록')}</dt><dd>${suppliers.length} ${t('업체')} · ${prods} ${t('제품')} · ${photos} ${t('사진')}</dd>
    <dt>${t('마지막 백업')}</dt><dd>${+pref.get('lastBackupAt', 0) ? new Date(+pref.get('lastBackupAt', 0)).toLocaleString() : t('없음')}</dd>
    <dt>${t('앱 버전')}</dt><dd>${APP_VERSION}</dd>
  </dl></section>
  <section class="card">
    <h3>${t('사진 설정')}</h3>
    <label class="check"><input type="checkbox" data-pref="keepOriginal"${pref.get('keepOriginal', '0') === '1' ? ' checked' : ''}> ${t('원본도 함께 보관 (JPEG/PNG/WebP, 15MB 이하만 · 용량과 백업 크기가 크게 늘어남)')}</label>
    <p class="hint">${t('기본은 긴 변 최대 1800px JPEG 압축본만 저장합니다. HEIC 원본은 보관하지 않습니다.')}</p>
  </section>
  <section class="card" id="extra"></section>`;
  const extra = $('#extra');
  try {
    const persisted = await navigator.storage?.persisted?.();
    $('#persist').textContent = persisted === undefined ? t('이 브라우저는 확인 불가') : persisted ? t('허용됨 (브라우저가 임의로 지우지 않도록 요청됨)') : t('미허용 — 홈 화면 앱으로 사용하고 자주 백업하세요');
    const est = await navigator.storage?.estimate?.();
    $('#usage').textContent = est ? `${mb(est.usage || 0)} / ${t('한도 약')} ${mb(est.quota || 0)}` : t('확인 불가');
  } catch { /* 표시 생략 */ }
  $('#offline').textContent = await offlineState();
  const parts = [];
  try {
    const orphans = await findOrphans();
    parts.push(`<p>${t('업체에 연결되지 않은 사진')}: ${orphans.length}${t('장')} ${orphans.length ? `<button type="button" class="link" data-act="orphans">${t('사진함 열기')}</button>` : ''}</p>`);
    const old = await store.getState('backup-before-v2');
    if (old) parts.push(`<p>${t('0.1 형식 원본 보관본이 있습니다')} (${esc(old.savedAt)}). <button type="button" class="link" data-act="dlOld">${t('내려받기')}</button> <button type="button" class="link danger-text" data-act="delOld">${t('삭제')}</button></p>`);
  } catch (e) { parts.push(`<p class="warn">${esc(errorText(e))}</p>`); }
  extra.innerHTML = `<h3>${t('복구')}</h3>` + parts.join('');
}
async function offlineState() {
  if (!('serviceWorker' in navigator)) return t('미지원 브라우저');
  if (!isSecureContext) return t('HTTPS가 아니어서 오프라인 실행 불가 (LAN 테스트 주소)');
  try {
    if (!navigator.serviceWorker.controller) return t('준비 중 — 앱을 한 번 닫았다가 다시 여세요');
    const keys = await caches.keys(), ok = keys.some(k => k.startsWith('ggot-')) && !!(await caches.match('./index.html'));
    return ok ? t('준비됨 — 인터넷 없이 실행 가능') + ` (${keys.filter(k => k.startsWith('ggot-')).join(', ')})` : t('캐시 없음');
  } catch (e) { return errorText(e); }
}
async function orphansView() {
  view = 'orphans'; current = null; product = null;
  app.innerHTML = `<h2>${t('미연결 사진함')}</h2><p class="hint">${t('저장 중 문제가 생기거나 업체가 지워져 어느 업체에도 연결되지 않은 사진입니다. 업체에 연결하거나 삭제하세요.')}</p><div id="orph" class="photos"></div>`;
  const ids = await findOrphans();
  const opts = [...suppliers].reverse().map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  $('#orph').innerHTML = ids.map(id => `<div class="ph"><img data-thumb="${esc(id)}" alt=""><select data-orph-target="${esc(id)}"><option value="">${t('업체 선택')}</option>${opts}</select><button type="button" data-orph-link="${esc(id)}">${t('연결')}</button><button type="button" class="danger-text" data-orph-del="${esc(id)}">${t('삭제')}</button></div>`).join('') || `<p class="empty">${t('미연결 사진이 없습니다')}</p>`;
  hydrateThumbs();
}

/* ───────── 이벤트 (위임) ───────── */
function setField(path, value) {
  const [a, k] = path.split('.');
  (a === 's' ? current : product)[k] = value;
}
app.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.field && current) {
    setField(el.dataset.field, el.value); saveLater();
    if (el.dataset.field === 's.name') $('#supName').textContent = el.value || t('이름 없음');
  } else if (el.id === 'search') drawList();
  else if (el.dataset.cmp === 'q') { cmp.q = el.value; drawCompare(); }
});
app.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('input[type=file][data-photo]')) {
    const scope = el.dataset.scope, files = [...el.files]; el.value = '';
    if (current) addPhotos(files, current, scope === 'supplier' ? null : product.id, el.dataset.cat || photoCategory);
  } else if (el.matches('input[type=file][data-quick]')) {
    const files = [...el.files]; el.value = '';
    if (!files.length) return;
    const saved = create(), owner = current; // create()는 current를 즉시 바꾼다
    saved.then(() => addPhotos(files, owner, null, '위챗 QR'));
  } else if (el.matches('input[type=file][data-import]')) {
    const f = el.files[0]; el.value = ''; importFile(f);
  } else if (el.dataset.cmp) {
    cmp[el.dataset.cmp] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.cmp === 'question') compare(); else drawCompare();
  } else if (el.dataset.pref) {
    pref.set(el.dataset.pref, el.checked ? '1' : '0');
    setStatus(t('설정 저장됨'));
  }
});
app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act],[data-key],[data-product],[data-open],[data-photo-open],[data-cat-pick],[data-orph-link],[data-orph-del]');
  if (!b) return;
  const d = b.dataset;
  if (d.key) {
    const [a, k] = d.key.split('.'), v = d.value;
    if (a === 'a' || a === 'e') {
      const slot = a === 'a' ? 'answer' : 'evidence', ans = (product.answers[k] ??= {});
      if (ans[slot] === v) delete ans[slot]; else ans[slot] = v;
      if (!ans.answer && !ans.evidence) delete product.answers[k];
    } else {
      const obj = a === 's' ? current : product;
      obj[k] = d.multi === 'true' ? ((obj[k] || []).includes(v) ? obj[k].filter(x => x !== v) : [...(obj[k] || []), v]) : v;
    }
    saveNow(); rerender(); return;
  }
  if (d.product) { product = current.products.find(x => x.id === d.product); rerender(); return; }
  if (d.open) return open(d.open, d.pid);
  if (d.photoOpen) return openViewer(d.photoOpen);
  if (d.catPick) { photoCategory = d.catPick; rerender(); return; }
  if (d.orphLink) {
    const target = suppliers.find(s => s.id === app.querySelector(`[data-orph-target="${CSS.escape(d.orphLink)}"]`).value);
    if (!target) return alert(t('연결할 업체를 고르세요'));
    target.photos.push({ id: d.orphLink, productId: null, category: '기타 참고', note: t('미연결 사진함에서 연결'), star: false, createdAt: new Date().toISOString() });
    touch(target);
    try { await save(); orphansView(); } catch { target.photos.pop(); }
    return;
  }
  if (d.orphDel) {
    if (!confirm(t('이 사진을 삭제할까요? 되돌릴 수 없습니다.'))) return;
    try { await deletePhotoData([d.orphDel]); orphansView(); } catch (err) { alert(errorText(err)); }
    return;
  }
  switch (d.act) {
    case 'new': return create();
    case 'list': return list();
    case 'next': return goNext(b);
    case 'backup': return backupView();
    case 'orphans': return orphansView();
    case 'addProduct': product = freshProduct(); current.products.push(product); saveNow(); return rerender();
    case 'delProduct': {
      if (!confirm(t('이 제품의 답변·가격 기록을 삭제할까요? 사진은 업체 공통으로 남습니다.'))) return;
      const gone = product;
      current.products = current.products.filter(p => p !== gone);
      current.photos.forEach(x => { if (x.productId === gone.id) x.productId = null; });
      product = current.products[0]; saveNow(); return rerender();
    }
    case 'delSupplier': {
      if (!confirm(t('이 업체와 제품·사진 기록을 모두 삭제할까요? 되돌릴 수 없습니다. 먼저 백업을 권장합니다.'))) return;
      const gone = current, idx = suppliers.indexOf(gone);
      suppliers.splice(idx, 1);
      try { await save(); await deletePhotoData(gone.photos.map(x => x.id)); list(); setStatus(t('삭제됨')); }
      catch { suppliers.splice(idx, 0, gone); alert(t('저장 실패로 삭제하지 않았습니다.')); }
      return;
    }
    case 'copyZh': { const ok = await copyText(zhInquiry(product)); if (ok) setStatus(t('중국어 질문을 복사했습니다. 위챗에 붙여넣으세요.')); return; }
    case 'csv': return exportCsv();
    case 'resetCmp': Object.assign(cmp, { priority: '', author: '', type: '', effect: '', sample: '', evidence: false, q: '', question: '' }); return compare();
    case 'makeBackup': return makeBackup(b);
    case 'shareBackup': return shareBackup();
    case 'downloadBackup': return downloadBackup();
    case 'dlOld': { const old = await store.getState('backup-before-v2'); downloadBlob(new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: old.savedAt, suppliers: old.suppliers })], { type: 'application/json' }), 'GGOT-backup-before-v2.json'); return; }
    case 'delOld': if (confirm(t('0.1 형식 원본 보관본을 삭제할까요? 먼저 내려받기를 권장합니다.'))) { await store.deleteState('backup-before-v2'); statusView(); } return;
  }
});
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr[data-open]')) open(e.target.dataset.open, e.target.dataset.pid); });
$('#modal').addEventListener('click', e => { if (e.target.closest('[data-act=closeModal]') || e.target.id === 'modal') $('#modal').hidden = true; });
$('#savebar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'retry') save().then(() => setStatus(t('저장됨')), () => {});
  if (b.dataset.act === 'backup') backupView();
});

/* ───────── 머리글 / 언어 / 작성자 ───────── */
function applyStatic() {
  document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'ko';
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  $('#lang').textContent = getLang() === 'zh' ? '한국어' : '中文';
}
function rerenderView() {
  applyStatic();
  ({ list, edit: rerender, compare, backup: backupView, status: statusView, orphans: orphansView })[view]?.();
}
$('#lang').onclick = () => { setLang(getLang() === 'zh' ? 'ko' : 'zh'); rerenderView(); };
$('#author').value = AUTHORS.includes(pref.get('author', 'Tony')) ? pref.get('author', 'Tony') : 'Tony';
$('#author').onchange = () => pref.set('author', author());
document.querySelector('nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-nav]'); if (!b) return;
  ({ new: create, list, compare, backup: backupView, status: statusView })[b.dataset.nav]();
  if (b.dataset.nav !== 'new') scrollTo(0, 0);
});

/* ───────── 서비스워커 (오프라인 실행) ───────── */
let reloading = false;
async function registerSW() {
  if (!('serviceWorker' in navigator) || !isSecureContext) { swInfo = await offlineState(); return; }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    const offer = () => { if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg); };
    offer();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
    swInfo = await offlineState();
  } catch (e) { swInfo = t('서비스워커 등록 실패') + ': ' + errorText(e); }
}
function showUpdate(reg) {
  const bar = $('#updatebar');
  bar.hidden = false;
  bar.querySelector('button').onclick = async () => {
    try { if (photoJobs) await photoDone; await flush(); } catch { return alert(t('저장 실패 상태에서는 업데이트하지 않습니다. 먼저 백업하세요.')); }
    reloading = true;
    reg.waiting?.postMessage('skipWaiting');
  };
}

/* ───────── 시작 ───────── */
applyStatic();
try {
  await store.open();
  suppliers = normalize((await store.getState('suppliers')) || []);
  list();
  navigator.storage?.persist?.().catch(() => {});
} catch (err) {
  $('#status').textContent = t('저장소 열기 실패') + ': ' + errorText(err);
  app.innerHTML = `<p class="warn">${t('이 브라우저에서 저장소를 열 수 없어 입력을 막았습니다. 개인정보 보호(비공개) 모드를 끄고 다시 여세요.')}</p>`;
  document.querySelectorAll('nav button').forEach(b => { b.disabled = true; });
}
registerSW();
window.__ggot = { get suppliers() { return suppliers; }, flush, version: APP_VERSION }; // 자동 검증용
