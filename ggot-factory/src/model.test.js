import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, mergeSuppliers, validate, csvCell, toCsv, splitPhotos, buildBackup, answerStats, compareRows, filterRows, uuid, referencedPhotoIds } from './model.js';
import { visibleQuestions, questions } from './questions.js';

const IMG = 'data:image/jpeg;base64,AAAA';
const a = { id: 'a', name: 'A', products: [{ id: 'p', types: [], effects: [], answers: {} }], photos: [] };

test('backup validation (0.1 테스트 유지 + 강화)', () => {
  assert.equal(validate({ schemaVersion: 1, suppliers: [a] }), true);
  assert.equal(validate({ schemaVersion: 2, suppliers: [a] }), false);
  assert.equal(validate({ schemaVersion: 1, suppliers: [{ ...a, photos: [{ id: 'x', data: 'javascript:bad' }] }] }), false);
  assert.equal(validate({ schemaVersion: 1, suppliers: [{ ...a, photos: [{ id: 'x', data: IMG }] }] }), true);
  assert.equal(validate({ schemaVersion: 1, suppliers: [{ ...a, photos: [{ id: 'x', data: 'data:image/svg+xml;base64,AAAA' }] }] }), false, 'SVG 거부');
  assert.equal(validate({ schemaVersion: 1, suppliers: [{ ...a, id: 'a" onclick="x' }] }), false, '속성 주입 ID 거부');
  assert.equal(validate({ schemaVersion: 1, suppliers: [{ ...a, photos: [{ id: 'x', data: IMG, original: 'data:text/html;base64,AA' }] }] }), false);
  assert.equal(validate({ schemaVersion: 1, suppliers: [{ ...a, booth: { evil: 1 } }] }), false);
});

test('duplicates and conflicts preserve existing data', () => {
  assert.equal(merge([a], [a]).length, 1);
  const x = merge([a], [{ ...a, name: 'edited' }]);
  assert.equal(x.length, 2); assert.equal(x[0].name, 'A'); assert.notEqual(x[1].id, a.id);
  assert.equal(x[1].copyOf, 'a');
});

test('같은 변경 백업을 두 번 가져와도 사본은 하나', () => {
  const edited = { ...a, name: 'edited', booth: 'B1' };
  const once = mergeSuppliers([a], [edited]);
  const twice = mergeSuppliers(once.suppliers, [edited]);
  assert.equal(once.copies, 1); assert.equal(twice.copies, 0); assert.equal(twice.suppliers.length, 2);
});

test('키 순서가 달라도 같은 기록으로 판단', () => {
  const b = { photos: [], products: a.products, name: 'A', id: 'a' };
  assert.equal(mergeSuppliers([a], [b]).same, 1);
});

test('csv escapes formula and quotation', () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell('a"b'), '"a""b"');
  for (const c of ['+1', '-1', '@x', '\tx', '\rx']) assert.ok(csvCell(c).startsWith('"\''), c);
  assert.ok(toCsv([['한국어', '中文']]).startsWith('﻿"한국어","中文"'), 'BOM + 한중');
});

test('사진 분리/백업 왕복: 데이터 동일, 메타 보존', () => {
  const s = { ...a, photos: [{ id: 'ph1', productId: 'p', category: '위챗 QR', note: '메모', star: true, data: IMG, original: 'data:image/png;base64,BBBB' }] };
  const { suppliers, records } = splitPhotos([s]);
  assert.equal(suppliers[0].photos[0].data, undefined);
  assert.deepEqual(suppliers[0].photos[0].original, { kept: true });
  assert.equal(records.length, 1);
  const { backup, missing } = buildBackup(suppliers, new Map(records.map(r => [r.id, r])), 'T');
  assert.equal(missing, 0);
  assert.equal(validate(backup), true);
  assert.deepEqual(backup.suppliers[0].photos[0], s.photos[0]);
  assert.equal(buildBackup(suppliers, new Map()).missing, 1, '없는 사진은 빼고 개수 보고');
  assert.deepEqual([...referencedPhotoIds(suppliers)], ['ph1']);
});

test('질문 표시: 제품 종류·효능별, 자외선 차단은 선크림 질문', () => {
  const ids = p => visibleQuestions(p).map(q => q[0]);
  assert.ok(ids({ types: ['미스트'], effects: [] }).includes('mist_spray'));
  assert.ok(!ids({ types: ['미스트'], effects: [] }).includes('spf'));
  assert.ok(ids({ types: ['미스트'], effects: ['자외선 차단'] }).includes('spf'));
  for (const [t, id] of [['세럼', 'serum_pct'], ['젤', 'gel_feel'], ['크림', 'cream_stab'], ['버블', 'bubble_foam'], ['마스크팩', 'mask_ess']]) assert.ok(ids({ types: [t], effects: [] }).includes(id), t);
  for (const [e, id] of [['진정', 'calm'], ['보습', 'moisture'], ['쿨링', 'cool'], ['피부장벽', 'barrier']]) assert.ok(ids({ types: [], effects: [e] }).includes(id), e);
  assert.equal(new Set(questions.map(q => q[0])).size, questions.length, '질문 id 중복 없음');
  assert.ok(questions.every(q => q[2] && q[3]), '모든 질문 한·중');
});

test('응답 현황: 미응답은 미확인, 숨겨진 답변은 유지되지만 집계 제외', () => {
  const p = { types: ['선크림'], effects: [], answers: { spf: { answer: '있음', evidence: '자료 수령' }, calm: { answer: '있음' } } };
  const st = answerStats(p);
  assert.equal(st.있음, 1); assert.equal(st.증빙, 1); assert.equal(st.미확인, st.total - 1);
  assert.ok(p.answers.calm, '숨겨진 질문 답변 삭제 안 함');
});

test('비교 필터', () => {
  const s1 = { id: 's1', name: '광저우 A', author: 'Tony', priority: '우선 후보', products: [{ id: 'x', name: '미스트', types: ['미스트'], effects: ['보습'], answers: {}, sample: '수령' }], photos: [] };
  const s2 = { id: 's2', name: '상하이 B', author: '金彤', priority: '보류', products: [{ id: 'y', types: ['선크림'], effects: [], answers: { spf: { answer: '있음', evidence: '검토 완료' } }, sample: '미확보' }, { id: 'z', types: ['크림'], effects: ['진정'], answers: {} }], photos: [] };
  const rows = compareRows([s1, s2]);
  assert.equal(rows.length, 3, '제품 단위');
  assert.equal(filterRows(rows, { author: '金彤' }).length, 2);
  assert.equal(filterRows(rows, { type: '미스트' }).length, 1);
  assert.equal(filterRows(rows, { effect: '진정' }).length, 1);
  assert.equal(filterRows(rows, { evidence: true }).length, 1);
  assert.equal(filterRows(rows, { q: '광저우' }).length, 1);
  assert.equal(filterRows(rows, { priority: '보류', sample: '미확보' }).length, 1);
});

test('uuid 대체 구현 (HTTPS가 아닌 LAN 테스트 주소용)', () => {
  const orig = globalThis.crypto.randomUUID;
  try {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally { Object.defineProperty(globalThis.crypto, 'randomUUID', { value: orig, configurable: true }); }
});

import { normalizeSupplier, trustStats } from './model.js';
import { PACK_TYPES, visibleTrust } from './questions.js';

test('0.3: 기존 "용기 업체"는 업종으로 이동, 기존 제품은 화장품 구분', () => {
  const s = normalizeSupplier({ id: 'v', name: 'V', kind: '용기 업체', products: [{ id: 'p', types: ['선크림'], effects: [], answers: { spf: { answer: '있음' } } }], photos: [] }, () => ({}));
  assert.equal(s.sector, '용기·패키지'); assert.equal(s.kind, '미확인');
  assert.equal(s.products[0].line, '화장품'); assert.equal(s.products[0].answers.spf.answer, '있음');
});

test('0.3: 용기·패키지 제품 질문 — 화장품 질문과 섞이지 않음', () => {
  const ids = p => visibleQuestions(p).map(q => q[0]);
  const pack = { line: '패키지', types: ['펌프 용기'], effects: ['진정'], answers: {} };
  assert.ok(ids(pack).includes('pk_mold') && ids(pack).includes('pk_pump'));
  assert.ok(!ids(pack).includes('formula') && !ids(pack).includes('calm'), '화장품·효능 질문 제외');
  assert.ok(!ids({ line: '화장품', types: ['선크림'], effects: [] }).some(id => id.startsWith('pk_')));
  for (const t of PACK_TYPES.filter(x => x !== '기타 패키지')) assert.ok(questions.some(q => q[1] === t), t + ' 전용 질문');
});

test('0.3: 신뢰 확인 — 개수만 집계, 업종별 항목, 알 수 없는 위험 신호 무시', () => {
  const cos = { sector: '화장품 OEM·ODM', trust: { license: '확인', payment: '주의', bogus: '확인' }, flags: ['계좌명이 회사명과 다름', '<script>'] };
  const st = trustStats(cos);
  assert.equal(st.확인, 1); assert.equal(st.주의, 1); assert.equal(st.total, visibleTrust(cos).length);
  assert.deepEqual(st.flags, ['계좌명이 회사명과 다름']);
  assert.ok(!visibleTrust({ sector: '용기·패키지' }).some(t => t[0] === 'prodlicense'), '용기 업체에는 화장품 생산허가증 항목 없음');
});

test('0.3: 업종·구분·위험신호 필터', () => {
  const a1 = { id: 'a1', name: 'Pack', sector: '용기·패키지', flags: [], products: [{ id: 'x', line: '패키지', types: ['튜브'], effects: [], answers: {} }], photos: [] };
  const a2 = { id: 'a2', name: 'Cos', sector: '화장품 OEM·ODM', flags: ['답변이 계속 바뀜'], products: [{ id: 'y', line: '화장품', types: ['크림'], effects: [], answers: {} }], photos: [] };
  const rows = compareRows([a1, a2]);
  assert.equal(filterRows(rows, { sector: '용기·패키지' }).length, 1);
  assert.equal(filterRows(rows, { line: '화장품' }).length, 1);
  assert.equal(filterRows(rows, { noFlags: true })[0].s.id, 'a1');
  assert.equal(filterRows(rows, { type: '튜브' }).length, 1);
});

import { vvCompare, bumpRev, isGone, purgeStub } from './model.js';

const sup = (extra = {}) => ({ id: 's1', name: 'S', products: [{ id: 'p', types: [], effects: [], answers: {} }], photos: [], ...extra });

test('0.4 동기화: 상대가 더 최신이면 갱신, 내가 최신이면 유지', () => {
  const base = sup({ rev: { A: 3 } });
  const theirs = sup({ rev: { A: 3, B: 2 }, booth: 'B가 수정' });
  const r1 = mergeSuppliers([base], [theirs]);
  assert.equal(r1.updated, 1); assert.equal(r1.suppliers.length, 1); assert.equal(r1.suppliers[0].booth, 'B가 수정');
  assert.equal(r1.replaced[0], base);
  const r2 = mergeSuppliers([theirs], [base]); // 오래된 파일을 다시 받아도
  assert.equal(r2.kept, 1); assert.equal(r2.suppliers[0].booth, 'B가 수정');
});

test('0.4 동기화: 동시 수정은 덮어쓰지 않고 사본', () => {
  const mine = sup({ rev: { A: 4 }, booth: 'A 수정' });
  const theirs = sup({ rev: { A: 3, B: 1 }, booth: 'B 수정' });
  assert.equal(vvCompare(mine.rev, theirs.rev), 'concurrent');
  const r = mergeSuppliers([mine], [theirs]);
  assert.equal(r.copies, 1); assert.equal(r.suppliers.find(x => x.id === 's1').booth, 'A 수정');
  assert.equal(mergeSuppliers(r.suppliers, [theirs]).copies, 0, '같은 충돌 파일 재수신 시 사본 추가 없음');
});

test('0.4 동기화: 삭제(휴지통·영구삭제)가 상대에게 전달', () => {
  const s = sup({ rev: { A: 2 } });
  const trashed = sup({ rev: { A: 3 }, deletedAt: '2026-11-10T00:00:00Z' });
  const r = mergeSuppliers([s], [trashed]);
  assert.equal(r.removed, 1); assert.ok(isGone(r.suppliers[0]));
  assert.equal(compareRows(r.suppliers).length, 0, '휴지통 업체는 비교표 제외');
  const stub = purgeStub(trashed, 'A');
  assert.deepEqual([stub.products, stub.photos, stub.purged, stub.rev.A], [[], [], true, 4]);
  assert.equal(validate({ schemaVersion: 1, suppliers: [stub] }), true);
  const r2 = mergeSuppliers([s], [stub]);
  assert.equal(r2.removed, 1); assert.equal(r2.suppliers[0].purged, true);
  // 상대가 지웠지만 내가 그 사이 고친 경우 → 내 기록 유지
  const editedMine = sup({ rev: { A: 2, B: 5 }, booth: '내가 수정' });
  assert.equal(mergeSuppliers([editedMine], [trashed]).suppliers[0].booth, '내가 수정');
  // 처음 보는 삭제 기록은 추가 수로 세지 않음
  assert.equal(mergeSuppliers([], [stub]).added, 0);
});

test('0.4 rev 검증과 증가', () => {
  assert.deepEqual(bumpRev(undefined, 'A'), { A: 1 });
  assert.deepEqual(bumpRev({ A: 1, B: 2 }, 'A'), { A: 2, B: 2 });
  assert.equal(validate({ schemaVersion: 1, suppliers: [sup({ rev: { 'a"b': 1 } })] }), false);
  assert.equal(validate({ schemaVersion: 1, suppliers: [sup({ rev: { A: -1 } })] }), false);
  assert.equal(validate({ schemaVersion: 1, suppliers: [sup({ rev: { A: 2 } })] }), true);
});

test('0.4 동기화: 상대 기기에 생긴 "내 기록의 사본"이 되돌아오면 생략', () => {
  const mine = sup({ rev: { A: 5 }, booth: 'A 최신' });
  const echoed = sup({ id: 's1-copy-1234', copyOf: 's1', name: 'S (가져온 사본)', rev: { A: 4 }, booth: 'A 예전' });
  assert.equal(mergeSuppliers([mine], [echoed]).suppliers.length, 1);
  const theirsCopy = sup({ id: 's1-copy-9999', copyOf: 's1', name: 'S (가져온 사본)', rev: { A: 4, B: 1 }, booth: 'B 버전' });
  assert.equal(mergeSuppliers([mine], [theirsCopy]).added, 1, '상대 변경이 담긴 사본은 유지');
});
