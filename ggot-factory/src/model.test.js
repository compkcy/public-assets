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
