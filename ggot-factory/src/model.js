// 순수 데이터 로직: 검증·병합·사진 분리·비교 행·CSV. DOM/IndexedDB에 의존하지 않아 Node에서 테스트한다.
import { visibleQuestions, visibleTrust, RED_FLAGS } from './questions.js';

export const ID_RE = /^[A-Za-z0-9_-]{1,160}$/;
export const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** crypto.randomUUID는 HTTPS/localhost에서만 존재한다. LAN http 테스트에서도 동작하도록 대체 구현. */
export function uuid() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 키 순서와 무관한 비교용 직렬화 */
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const body = x => stable(omit(x, ['id', 'name', 'copyOf']));

/* ───── 두 기기 동기화 (파일 교환) ─────
 * 업체마다 rev = { 기기ID: 수정 횟수 } (버전 벡터)를 둔다. 기록을 고칠 때 자기 기기 카운터를 +1.
 * 가져오기 때 비교:
 *   - 가져온 쪽이 모든 기기 카운터에서 같거나 크다 → 상대가 내 변경을 이미 반영하고 더 고친 것 → 최신으로 갱신
 *   - 내 쪽이 같거나 크다 → 내가 더 최신 → 유지
 *   - 서로 모르는 변경이 양쪽에 있다(동시 수정) → 덮어쓰지 않고 "(가져온 사본)"으로 보존
 * 삭제도 기록 수정(deletedAt/purged)이라 같은 규칙으로 상대 기기에 전달된다.
 */
export const isGone = s => !!(s?.deletedAt || s?.purged);
export const bumpRev = (rev, device) => ({ ...(rev || {}), [device]: ((rev || {})[device] || 0) + 1 });
export function vvCompare(a = {}, b = {}) {
  let localBig = false, incomingBig = false;
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = (a || {})[k] || 0, y = (b || {})[k] || 0;
    if (x > y) localBig = true;
    if (y > x) incomingBig = true;
  }
  return localBig && incomingBig ? 'concurrent' : localBig ? 'local' : incomingBig ? 'incoming' : 'equal';
}

/**
 * 가져온 업체를 기존 목록에 합친다.
 * - 새 ID: 추가 / 같은 내용: 건너뜀 / 상대가 더 최신: 갱신(삭제 포함) / 내가 더 최신: 유지
 * - 동시 수정 또는 버전 정보 없는 0.2 이전 기록의 내용 차이: "(가져온 사본)"으로 보존(덮어쓰지 않음).
 *   같은 사본을 이미 가져왔으면 다시 만들지 않는다.
 * replaced: 갱신으로 교체된 기존 기록(사진 정리용)
 */
export function mergeSuppliers(local, incoming) {
  const map = new Map(local.map(x => [x.id, x]));
  const out = { added: 0, updated: 0, removed: 0, copies: 0, same: 0, kept: 0, replaced: [] };
  for (const x of incoming) {
    const old = map.get(x.id);
    if (!old && x.copyOf && map.has(x.copyOf) && ['local', 'equal'].includes(vvCompare(map.get(x.copyOf).rev, x.rev)) && x.rev && Object.keys(x.rev).length) {
      out.same++; continue; // 상대가 만든 '내 기록의 사본'인데 나는 이미 그 버전 이상 → 되돌아온 사본은 생략
    }
    if (!old) { map.set(x.id, x); if (!isGone(x)) out.added++; continue; }
    if (stable(old) === stable(x)) { out.same++; continue; }
    const c = vvCompare(old.rev, x.rev);
    if (c === 'incoming') {
      map.set(x.id, x); out.replaced.push(old);
      if (isGone(x) && !isGone(old)) out.removed++; else out.updated++;
      continue;
    }
    if (c === 'local') { out.kept++; continue; }
    // 동시 수정(또는 버전 정보 없음)
    if (isGone(x)) { out.kept++; continue; } // 상대는 지웠지만 나는 그 사이 고쳤다 → 내 기록 유지
    const already = [...map.values()].some(y => y.copyOf === x.id && body(y) === body(x));
    if (already) { out.same++; continue; }
    const id = x.id.slice(0, 80) + '-copy-' + uuid().slice(0, 8);
    map.set(id, { ...x, id, copyOf: x.id, deletedAt: undefined, name: (x.name || '') + ' (가져온 사본)' });
    out.copies++;
  }
  return { suppliers: [...map.values()], ...out };
}
/** 0.1 호환 API: 배열만 반환 */
export const merge = (a, b) => mergeSuppliers(a, b).suppliers;

const str = v => v === undefined || v === null || typeof v === 'string';
const revOk = r => r === undefined || (r && typeof r === 'object' && !Array.isArray(r) && Object.entries(r).every(([k, n]) => ID_RE.test(k) && Number.isInteger(n) && n >= 0));
/** 백업 파일 검증 (schemaVersion 1 형식 유지). 사진은 data:image jpeg/png/webp만 허용. */
export function validate(x) {
  return x?.schemaVersion === 1 && Array.isArray(x.suppliers) && x.suppliers.every(s =>
    typeof s.id === 'string' && ID_RE.test(s.id) && typeof s.name === 'string'
    && ['booth', 'contact', 'author', 'wechat', 'priority', 'action', 'followup', 'sector', 'decisionNote', 'deletedAt'].every(k => str(s[k]))
    && revOk(s.rev) && (s.purged === undefined || typeof s.purged === 'boolean')
    && Array.isArray(s.products) && Array.isArray(s.photos)
    && s.products.every(p => typeof p.id === 'string' && ID_RE.test(p.id) && Array.isArray(p.types) && Array.isArray(p.effects)
      && p.answers && typeof p.answers === 'object' && !Array.isArray(p.answers))
    && s.photos.every(p => typeof p.id === 'string' && ID_RE.test(p.id) && typeof p.data === 'string' && IMG_RE.test(p.data)
      && (p.original === undefined || (typeof p.original === 'string' && IMG_RE.test(p.original)))));
}

/** 업체 목록에서 사진 바이너리(data URL)를 분리한다. DB v2는 메타데이터와 사진을 다른 저장소에 둔다. */
export function splitPhotos(suppliers) {
  const records = new Map();
  const meta = suppliers.map(s => ({
    ...s,
    photos: (s.photos || []).map(p => {
      const { data, original, ...m } = p;
      if (typeof data === 'string' && !records.has(p.id)) records.set(p.id, original ? { id: p.id, data, original } : { id: p.id, data });
      if (typeof original === 'string') m.original = { kept: true };
      return m;
    }),
  }));
  return { suppliers: meta, records: [...records.values()] };
}

/** 영구 삭제: 내용과 사진을 지우고 동기화에 필요한 id·rev·삭제 시각만 남긴다. */
export const purgeStub = (s, device, at = new Date().toISOString()) => ({ id: s.id, name: '', purged: true, deletedAt: s.deletedAt || at, updatedAt: at, rev: bumpRev(s.rev, device), products: [], photos: [] });

/** 메타데이터 + 사진 레코드 → 백업 JSON 객체. 사진 레코드가 없는 사진은 빼고 개수를 알린다. */
export function buildBackup(suppliers, recordMap, exportedAt = new Date().toISOString()) {
  let missing = 0;
  const out = suppliers.map(s => ({
    ...s,
    photos: s.photos.flatMap(p => {
      const r = recordMap.get(p.id);
      if (!r?.data) { missing++; return []; }
      const { original, ...m } = p;
      return [r.original ? { ...m, data: r.data, original: r.original } : { ...m, data: r.data }];
    }),
  }));
  return { backup: { schemaVersion: 1, app: 'ggot-factory', exportedAt, suppliers: out }, missing };
}

/**
 * 저장·가져오기 때 공통 정리. 0.2의 업체 유형 '용기 업체'는 0.3에서 업종(sector) '용기·패키지'로 옮기고
 * 업태(kind)는 공장/무역 여부를 모르므로 '미확인'으로 둔다. 기존 제품은 '화장품' 구분으로 본다.
 */
export function normalizeSupplier(s, freshProduct) {
  if (s.purged) { s.products = []; s.photos = []; return s; } // 영구 삭제 표시(동기화용)만 남은 기록
  if (s.kind === '용기 업체') { s.sector ||= '용기·패키지'; s.kind = '미확인'; }
  s.products = Array.isArray(s.products) && s.products.length ? s.products : [freshProduct()];
  s.photos = Array.isArray(s.photos) ? s.photos : [];
  for (const p of s.products) { p.types ||= []; p.effects ||= []; p.answers ||= {}; p.line ||= '화장품'; }
  return s;
}

/** 신뢰 확인 현황: 점수가 아니라 확인/주의/미확인 개수와 위험 신호 목록 그대로. */
export function trustStats(s) {
  const items = visibleTrust(s), st = { 확인: 0, 주의: 0, 미확인: 0, total: items.length, flags: [] };
  for (const [id] of items) { const v = s.trust?.[id]; st[v === '확인' || v === '주의' ? v : '미확인']++; }
  st.flags = (Array.isArray(s.flags) ? s.flags : []).filter(f => RED_FLAGS.includes(f));
  return st;
}

export const referencedPhotoIds = suppliers => new Set(suppliers.flatMap(s => s.photos.map(p => p.id)));

export const DONE_EVIDENCE = ['자료 수령', '검토 완료'];
/** 표시 중인 질문 기준 응답 현황. 답이 없으면 '미확인'(불가 아님). */
export function answerStats(p) {
  const st = { 있음: 0, 없음: 0, '확인 필요': 0, '해당 없음': 0, 미확인: 0, 증빙: 0, total: 0 };
  for (const [id] of visibleQuestions(p)) {
    const a = p.answers?.[id];
    st.total++;
    st[a?.answer && a.answer in st ? a.answer : '미확인']++;
    if (DONE_EVIDENCE.includes(a?.evidence)) st.증빙++;
  }
  return st;
}

/** 비교표 행: 회사가 아니라 제품 단위. 점수/순위는 만들지 않는다. */
export function compareRows(suppliers) {
  return suppliers.filter(s => !isGone(s)).flatMap(s => s.products.map((p, i) => ({ s, p, index: i, stats: answerStats(p) })));
}

export function filterRows(rows, f = {}) {
  const q = (f.q || '').trim().toLowerCase();
  return rows.filter(({ s, p }) =>
    (!f.priority || s.priority === f.priority)
    && (!f.author || s.author === f.author)
    && (!f.sector || (s.sector || '') === f.sector)
    && (!f.line || (p.line || '화장품') === f.line)
    && (!f.noFlags || trustStats(s).flags.length === 0)
    && (!f.type || p.types.includes(f.type))
    && (!f.effect || p.effects.includes(f.effect))
    && (!f.sample || p.sample === f.sample)
    && (!f.evidence || answerStats(p).증빙 > 0)
    && (!q || [s.name, s.booth, s.contact, p.name, p.note, s.kindOther, p.typeOther].join(' ').toLowerCase().includes(q)));
}

/** CSV 셀: 따옴표 이스케이프 + 수식 주입 방어(=,+,-,@,탭,CR로 시작하면 ' 접두) */
export const csvCell = x => '"' + String(x ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
export const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
