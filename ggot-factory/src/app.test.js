// 정적 점검: 번역 누락, 서비스워커 캐시 목록, 서버 허용 목록
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dictionary } from './i18n.js';
import { PRODUCT_TYPES, EFFECTS, ANSWERS, EVIDENCE } from './questions.js';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');

test('모든 UI 문구와 선택지에 중국어 번역이 있음', () => {
  const app = read('src/app.js'), html = read('index.html');
  const keys = new Set([...app.matchAll(/\b(?:t|bi)\('((?:[^'\\]|\\.)*)'[,)]/g)].map(m => m[1]));
  [...html.matchAll(/data-t="([^"]+)"/g)].forEach(m => keys.add(m[1]));
  for (const list of ['WECHAT', 'KINDS', 'MOQ', 'SAMPLE', 'PRIORITY', 'ACTIONS', 'CATEGORIES']) {
    const m = app.match(new RegExp(`const ${list} = \\[([^\\]]+)\\]`));
    assert.ok(m, list);
    [...m[1].matchAll(/'([^']+)'/g)].forEach(x => keys.add(x[1]));
  }
  [...PRODUCT_TYPES, ...EFFECTS, ...ANSWERS, ...EVIDENCE].forEach(k => keys.add(k));
  const missing = [...keys].filter(k => !(k in dictionary));
  assert.deepEqual(missing, []);
});

test('서비스워커가 캐시하는 파일이 모두 존재하고 서버가 제공함', async () => {
  const sw = read('sw.js');
  const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const { createServer } = await import('../server.mjs');
  const srv = createServer().listen(0);
  await new Promise(r => srv.once('listening', r));
  try {
    for (const a of assets) {
      if (a !== './') assert.ok(fs.existsSync(new URL(a, root)), a);
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/${a.replace('./', '')}`);
      assert.equal(res.status, 200, a);
    }
    // app.js가 import하는 모듈이 모두 캐시 목록에 있어야 오프라인 실행 가능
    for (const f of fs.readdirSync(new URL('src/', root)).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) assert.ok(assets.includes('./src/' + f), f);
    for (const bad of ['package.json', 'src/model.test.js', '..%2Fpackage.json', 'docs/SPEC.md', 'server.mjs']) {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/${bad}`);
      assert.equal(res.status, 404, bad);
    }
  } finally { srv.close(); }
});
