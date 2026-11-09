// 브라우저 종단 검증 (합성 데이터만 사용). 실행: npm run e2e   (Playwright 필요: NODE_PATH에 전역 설치 경로)
// 결과 스크린샷: E2E_OUT 폴더(기본 ./e2e-out)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const OUT = process.env.E2E_OUT || path.join(__dirname, '..', 'e2e-out');
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ggot-e2e-'));
let pass = 0; const fails = [];
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fails.push(name); console.log('  ✗ ' + name + ' ' + extra); } };

(async () => {
  const { createServer } = await import(path.join(__dirname, '..', 'server.mjs'));
  let srv = createServer().listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const port = srv.address().port, URL0 = `http://localhost:${port}/`;
  const browser = await chromium.launch();
  const dialogs = [];
  const hook = page => { page.on('dialog', d => { dialogs.push(d.message()); d.accept(); }); page.on('pageerror', e => fails.push('pageerror: ' + e.message)); };
  const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

  // ── 테스트 이미지 생성 (합성)
  const mk = await browser.newPage();
  const imgs = await mk.evaluate(() => {
    const make = (w, h, type, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '80px sans-serif'; g.fillText('TEST', 40, 120); return c.toDataURL(type, .9).split(',')[1]; };
    return { jpg: make(3000, 2000, 'image/jpeg', '#7B4DFF'), png: make(800, 1200, 'image/png', '#D4FF3F'), qr: make(600, 600, 'image/png', '#222') };
  });
  await mk.close();
  const files = { jpg: path.join(tmp, 'sample.jpg'), png: path.join(tmp, 'pack.png'), qr: path.join(tmp, 'qr.png'), bad: path.join(tmp, 'broken.jpg') };
  fs.writeFileSync(files.jpg, Buffer.from(imgs.jpg, 'base64')); fs.writeFileSync(files.png, Buffer.from(imgs.png, 'base64'));
  fs.writeFileSync(files.qr, Buffer.from(imgs.qr, 'base64')); fs.writeFileSync(files.bad, 'not an image');

  // ── 1. 아이폰 폭(390) 기기 A
  console.log('1. 모바일 390px: 등록·다제품·사진·리로드');
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const A = await ctxA.newPage(); hook(A);
  await A.goto(URL0); await A.waitForSelector('[data-act=new]');
  check('첫 화면 가로 넘침 없음 (390)', await noOverflow(A));
  await A.screenshot({ path: path.join(OUT, 'm390-list-empty.png') });

  // QR부터 등록 (회사명 없이)
  await A.setInputFiles('input[data-quick]', files.qr);
  await A.waitForSelector('#supName');
  await A.waitForFunction(() => window.__ggot.suppliers[0]?.photos.length === 1);
  check('QR 사진부터 임시 이름 업체 생성', (await A.textContent('#supName')).startsWith('업체 0'));
  check('QR 사진이 친구추가/OCR로 표시되지 않음', !/(친구 추가 완료|자동 인식됨|OCR 완료)/.test(await A.textContent('#app')));
  await A.click('[data-act=next]');
  await A.waitForFunction(() => window.__ggot.suppliers.length === 2);
  check('완료·다음 업체로 새 업체 생성', (await A.textContent('#supName')).includes('업체 002'));

  // 업체 2: 이름 입력, 제품 2개
  await A.fill('[data-field="s.name"]', '합성테스트 화장품 有限公司');
  await A.fill('[data-field="s.booth"]', '9.2 B15');
  await A.click('[data-key="p.types"][data-value="선크림"]'); // 선크림 해제
  await A.click('[data-key="p.types"][data-value="미스트"]');
  await A.click('[data-key="p.effects"][data-value="진정"]');
  check('미스트+진정 → 미스트·진정 질문 표시', await A.isVisible('[data-key="a.mist_spray"]') && await A.isVisible('[data-key="a.calm"]'));
  check('선크림 해제 → SPF 질문 숨김', !(await A.$('[data-key="a.spf"]')));
  await A.click('[data-key="a.calm"][data-value="있음"]');
  await A.click('[data-key="e.calm"][data-value="자료 수령"]');
  await A.fill('[data-field="p.price"]', '=1+1 RMB / 3,000');
  await A.fill('[data-field="p.name"]', '진정 미스트');
  // 진정 해제 후 답변 유지 확인
  await A.click('[data-key="p.effects"][data-value="진정"]');
  check('진정 해제 → 질문 숨김', !(await A.$('[data-key="a.calm"]')));
  await A.click('[data-key="p.effects"][data-value="진정"]');
  check('진정 다시 선택 → 기존 답변 유지', await A.getAttribute('[data-key="a.calm"][data-value="있음"]', 'aria-pressed') === 'true');
  // 같은 버튼 다시 누르면 해제
  await A.click('[data-key="a.small"][data-value="없음"]'); await A.click('[data-key="a.small"][data-value="없음"]');
  check('답변 버튼 재탭 시 미확인으로', await A.getAttribute('[data-key="a.small"][data-value="없음"]', 'aria-pressed') === 'false');

  // 제품 1 사진 (JPEG 3000x2000 → 1800 압축)
  await A.setInputFiles('input[data-photo][data-scope=product]:not([multiple])', files.jpg);
  await A.waitForFunction(() => window.__ggot.suppliers[1].photos.length === 1);
  // 제품 2 추가
  await A.click('[data-act=addProduct]');
  await A.fill('[data-field="p.name"]', '보습 크림');
  await A.click('[data-key="p.types"][data-value="크림"]');
  await A.click('[data-key="a.cream_stab"][data-value="확인 필요"]');
  await A.fill('[data-field="p.exactMoq"]', '5000');
  await A.setInputFiles('input[data-photo][multiple]', [files.png, files.bad]);
  await A.waitForFunction(() => window.__ggot.suppliers[1].photos.length === 2);
  await A.waitForTimeout(300);
  check('깨진 파일은 정확한 실패 안내', dialogs.some(m => m.includes('broken.jpg') && m.includes('JPG/PNG')), JSON.stringify(dialogs));
  const s2 = await A.evaluate(() => window.__ggot.suppliers[1]);
  const [p1, p2] = s2.products;
  check('제품별 사진 연결 분리', s2.photos[0].productId === p1.id && s2.photos[1].productId === p2.id);
  check('제품별 답변/가격 분리', p1.answers.calm?.answer === '있음' && !p2.answers.calm && p2.answers.cream_stab?.answer === '확인 필요' && p1.price.startsWith('=1+1') && !p2.price);
  check('사진 1800px JPEG 압축', s2.photos[0].width === 1800 && s2.photos[0].height === 1200 && s2.photos[0].mime === 'image/jpeg');
  check('편집 화면 가로 넘침 없음 (390)', await noOverflow(A));
  await A.evaluate(() => scrollTo(0, 0)); await A.screenshot({ path: path.join(OUT, 'm390-edit-top.png') });
  await A.locator('.question').first().scrollIntoViewIfNeeded(); await A.screenshot({ path: path.join(OUT, 'm390-edit-questions.png') });

  // 사진 확대보기·메모·분류
  await A.click('.ph >> nth=0');
  await A.waitForSelector('#viewer:not([hidden]) #vimg');
  await A.waitForFunction(() => document.querySelector('#vimg').naturalWidth >= 1000);
  check('확대보기에서 원본 크기(압축본 1800px) 로드', await A.evaluate(() => document.querySelector('#vimg').naturalWidth) === 1800 || await A.evaluate(() => document.querySelector('#vimg').naturalWidth) === 1200);
  await A.fill('[data-v=note]', '용기 샘플 – 합성');
  await A.click('[data-v=star]');
  await A.screenshot({ path: path.join(OUT, 'm390-photo-viewer.png') });
  await A.click('[data-v=close]');
  await A.evaluate(() => window.__ggot.flush());

  // 리로드 → 유지
  await A.reload(); await A.waitForSelector('[data-open]');
  const after = await A.evaluate(() => window.__ggot.suppliers);
  check('리로드 후 업체 2개 유지', after.length === 2);
  check('리로드 후 사진 메모/중요 유지', after[1].photos.some(p => p.note === '용기 샘플 – 합성' && p.star));
  await A.screenshot({ path: path.join(OUT, 'm390-list.png') });
  await A.click(`[data-open="${after[1].id}"]`);
  await A.waitForFunction(() => [...document.querySelectorAll('img[data-thumb]')].every(i => i.complete && i.naturalWidth > 0));
  check('리로드 후 사진 미리보기 표시', true);

  // 중국어 전환 + 문의 복사
  await A.click('#lang');
  check('중국어 UI 전환 (답변/증빙 버튼 포함)', (await A.textContent('#app')).includes('已收到资料') && (await A.textContent('nav')).includes('对比表'));
  await A.click('[data-act=copyZh]');
  const clip = await A.evaluate(() => navigator.clipboard.readText());
  check('중국어 문의 복사 (미응답 질문)', clip.startsWith('您好') && clip.includes('能小批量生产吗') && !clip.includes('有成品舒缓测试报告吗'), clip.slice(0, 80));
  await A.screenshot({ path: path.join(OUT, 'm390-edit-zh.png') });
  await A.click('#lang');

  // 저장 실패 시 다음 업체 차단
  console.log('2. 저장 실패 처리');
  dialogs.length = 0;
  await A.evaluate(() => { window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('simulated', 'QuotaExceededError'); }; });
  await A.fill('[data-field="s.contact"]', '왕 경리');
  await A.click('[data-act=next]');
  await A.waitForTimeout(500);
  check('저장 실패 시 다음 업체로 이동 안 함', (await A.evaluate(() => window.__ggot.suppliers.length)) === 2 && (await A.inputValue('[data-field="s.name"]')).includes('합성테스트'));
  check('저장 실패 경고줄 + 저장공간 안내', await A.isVisible('#savebar') && (await A.textContent('#savebar')).includes('저장공간'));
  check('실패 알림 표시', dialogs.some(m => m.includes('넘어가지 않았습니다')));
  await A.screenshot({ path: path.join(OUT, 'm390-save-failed.png') });
  await A.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
  await A.click('#savebar [data-act=retry]');
  await A.waitForSelector('#savebar', { state: 'hidden' });
  check('[다시 저장] 성공 시 경고 해제', true);

  // 백업 다운로드
  console.log('3. 사진 포함 백업 → 새 브라우저 복원');
  await A.click('nav [data-nav=backup]');
  await A.click('[data-act=makeBackup]');
  await A.waitForSelector('[data-act=downloadBackup]');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('[data-act=downloadBackup]')]);
  const backupPath = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(backupPath);
  const bk = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check('백업 파일: schemaVersion 1, 사진 data 포함', bk.schemaVersion === 1 && bk.suppliers.flatMap(s => s.photos).length === 3 && bk.suppliers.every(s => s.photos.every(p => p.data.startsWith('data:image/jpeg'))));

  // ── 4. 데스크톱 1440 새 브라우저(기기 B)
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const B = await ctxB.newPage(); hook(B);
  await B.goto(URL0); await B.waitForSelector('[data-act=new]');
  // B에서 자체 기록 1건 (金彤)
  await B.selectOption('#author', '金彤');
  await B.click('[data-act=new]');
  await B.fill('[data-field="s.name"]', '金彤 합성 업체');
  await B.click('[data-key="s.priority"][data-value="우선 후보"]');
  await B.evaluate(() => window.__ggot.flush());
  await B.click('nav [data-nav=backup]');
  dialogs.length = 0;
  await B.setInputFiles('input[data-import]', backupPath);
  await B.waitForFunction(() => window.__ggot.suppliers.length === 3);
  check('복원/합치기: B 기록 유지 + A 기록 추가', (await B.evaluate(() => window.__ggot.suppliers.map(s => s.name))).includes('金彤 합성 업체'));
  const bS = await B.evaluate(() => window.__ggot.suppliers.find(s => s.name.startsWith('합성테스트')));
  check('복원 후 답변 대조 일치', JSON.stringify(bS.products) === JSON.stringify(after[1].products));
  await B.click(`[data-open="${bS.id}"]`);
  await B.waitForFunction(() => document.querySelectorAll('img[data-thumb]').length === 2 && [...document.querySelectorAll('img[data-thumb]')].every(i => i.complete && i.naturalWidth > 0));
  check('복원 후 사진 표시', true);
  check('편집 화면 가로 넘침 없음 (1440)', await noOverflow(B));
  await B.screenshot({ path: path.join(OUT, 'd1440-edit.png'), fullPage: false });
  // 같은 파일 다시 → 중복 없음
  await B.click('nav [data-nav=backup]');
  await B.setInputFiles('input[data-import]', backupPath);
  await B.waitForTimeout(500);
  check('같은 백업 재가져오기 → 중복 없음', (await B.evaluate(() => window.__ggot.suppliers.length)) === 3);
  // 충돌: B에서 A 기록 수정 후 A 원본 다시 가져오기 → 사본 보존
  await B.click('nav [data-nav=list]');
  await B.click(`[data-open="${bS.id}"]`);
  await B.fill('[data-field="s.booth"]', 'B에서 수정');
  await B.evaluate(() => window.__ggot.flush());
  await B.click('nav [data-nav=backup]');
  await B.setInputFiles('input[data-import]', backupPath);
  await B.waitForFunction(() => window.__ggot.suppliers.length === 4);
  const names = await B.evaluate(() => window.__ggot.suppliers.map(s => s.name + '|' + s.booth));
  check('충돌 시 기존(B 수정본) 유지 + 가져온 사본 보존', names.some(n => n.endsWith('|B에서 수정')) && names.some(n => n.includes('(가져온 사본)|9.2 B15')));

  // 비교표 + CSV
  console.log('4. 비교표·CSV');
  await B.click('nav [data-nav=compare]');
  check('비교표: 제품 단위 행', (await B.$$('table.cmp tbody tr')).length === 6);
  await B.selectOption('[data-cmp=type]', '크림');
  check('필터: 제품 종류=크림', (await B.$$('table.cmp tbody tr')).length === 2);
  await B.selectOption('[data-cmp=type]', '');
  await B.selectOption('[data-cmp=question]', 'calm');
  check('질문 열 추가 (진정 시험자료)', (await B.textContent('table.cmp')).includes('자료 수령'));
  check('비교표 가로 넘침 없음 (1440)', await noOverflow(B));
  await B.screenshot({ path: path.join(OUT, 'd1440-compare.png') });
  const [csvDl] = await Promise.all([B.waitForEvent('download'), B.click('[data-act=csv]')]);
  const csvPath = path.join(tmp, 'c.csv'); await csvDl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  check('CSV: BOM·한글·중국어 정상', csv.startsWith('﻿') && csv.includes('합성테스트 화장품 有限公司'));
  check('CSV: 수식 문자 무력화', csv.includes(`"'=1+1 RMB / 3,000"`));
  await B.click('nav [data-nav=list]');
  await B.screenshot({ path: path.join(OUT, 'd1440-list.png') });

  // 모바일 비교표 (카드)
  await A.click('nav [data-nav=compare]');
  check('비교표 가로 넘침 없음 (390, 카드형)', await noOverflow(A));
  await A.screenshot({ path: path.join(OUT, 'm390-compare.png') });

  // 사진 삭제 (확인창)
  console.log('5. 사진 삭제·미연결 사진함');
  await A.click('nav [data-nav=list]');
  await A.click(`[data-open="${after[1].id}"]`);
  dialogs.length = 0;
  await A.click('.ph >> nth=0');
  await A.waitForSelector('[data-v=delete]');
  await A.click('[data-v=delete]');
  await A.waitForFunction(() => window.__ggot.suppliers[1].photos.length === 1);
  check('사진 삭제 전 확인창', dialogs.some(m => m.includes('삭제할까요')));
  // 미연결 사진: 사진 저장 후 메타 저장 실패 상황 시뮬레이션
  await A.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('ggot-factory'); q.onsuccess = () => r(q.result); });
    await new Promise(r => { const t = db.transaction('photos', 'readwrite'); t.objectStore('photos').put({ id: 'orphan-test', data: document.querySelector('img[data-thumb]').src }); t.oncomplete = r; });
    db.close();
  });
  await A.click('nav [data-nav=list]');
  await A.waitForSelector('[data-act=orphans]');
  await A.click('[data-act=orphans]');
  await A.selectOption('[data-orph-target="orphan-test"]', after[0].id);
  await A.click('[data-orph-link="orphan-test"]');
  await A.waitForFunction(() => window.__ggot.suppliers[0].photos.some(p => p.id === 'orphan-test'));
  check('미연결 사진을 업체에 연결', true);

  // ── 6. 0.1(DB v1) 기존 데이터 이관
  console.log('6. 0.1 데이터 보존 이관');
  const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const C = await ctxC.newPage(); hook(C);
  await C.goto(URL0 + 'manifest.webmanifest');
  await C.evaluate(async img => {
    const db = await new Promise(r => { const q = indexedDB.open('ggot-factory', 1); q.onupgradeneeded = () => q.result.createObjectStore('state'); q.onsuccess = () => r(q.result); });
    const legacy = [{ id: 'legacy-1', name: '0.1 기존 업체', author: 'Tony', booth: 'A1', wechat: '추가 완료', contact: '', kind: '미확인', priority: '우선 후보', action: '견적 요청', createdAt: '2026-10-01T00:00:00Z',
      products: [{ id: 'lp', name: '', types: ['선크림'], effects: [], answers: { spf: { answer: '있음' } }, moq: '미확인', price: '', sample: '미확보', note: '' }],
      photos: [{ id: 'lph', productId: 'lp', category: '위챗 QR', data: 'data:image/jpeg;base64,' + img, note: '기존 메모', star: true }] }];
    await new Promise(r => { const t = db.transaction('state', 'readwrite'); t.objectStore('state').put(legacy, 'suppliers'); t.oncomplete = r; });
    db.close();
  }, imgs.jpg.length < 3e6 ? (await (async () => { const p = await browser.newPage(); const d = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; c.getContext('2d').fillRect(0, 0, 400, 300); return c.toDataURL('image/jpeg').split(',')[1]; }); await p.close(); return d; })()) : '');
  await C.goto(URL0); await C.waitForSelector('[data-open="legacy-1"]');
  const mig = await C.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('ggot-factory'); q.onsuccess = () => r(q.result); });
    const get = (s, k) => new Promise(r => { const q = db.transaction(s).objectStore(s).get(k); q.onsuccess = () => r(q.result); });
    const out = { version: db.version, meta: await get('state', 'suppliers'), backup: await get('state', 'backup-before-v2'), photo: await get('photos', 'lph') };
    db.close(); return out;
  });
  check('DB v2 이관', mig.version === 2);
  check('이관 전 원본 보관 (backup-before-v2)', mig.backup?.suppliers?.[0]?.photos?.[0]?.data?.startsWith('data:image/jpeg'));
  check('이관 후 메타에는 사진 데이터 없음, 사진 저장소로 이동', mig.meta[0].photos[0].data === undefined && mig.photo?.data?.startsWith('data:image/jpeg'));
  check('이관 후 답변/메모 유지', mig.meta[0].products[0].answers.spf.answer === '있음' && mig.meta[0].photos[0].note === '기존 메모');
  await C.click('[data-open="legacy-1"]');
  await C.waitForFunction(() => { const i = document.querySelector('img[data-thumb]'); return i && i.complete && i.naturalWidth > 0; });
  check('이관된 사진 미리보기 표시(썸네일 자동 생성)', true);

  // ── 7. PWA 오프라인
  console.log('7. PWA 오프라인 실행');
  await A.goto(URL0);
  await A.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => {});
  if (!(await A.evaluate(() => !!navigator.serviceWorker.controller))) { await A.reload(); await A.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }); }
  await A.click('nav [data-nav=status]');
  await A.waitForFunction(() => document.querySelector('#offline').textContent.includes('준비됨'), null, { timeout: 15000 }).catch(() => {});
  check('상태 화면: 오프라인 준비됨', (await A.textContent('#offline')).includes('준비됨'), await A.textContent('#offline'));
  await A.screenshot({ path: path.join(OUT, 'm390-status.png') });
  const manifest = await A.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  check('manifest: standalone + 아이콘 192/512', manifest.display === 'standalone' && manifest.icons.some(i => i.sizes === '512x512'));
  // 서버 완전 종료 후 새 탭에서 앱 시작
  await new Promise(r => { srv.closeAllConnections?.(); srv.close(r); });
  const before = await A.evaluate(() => window.__ggot.suppliers.length);
  const A2 = await ctxA.newPage(); hook(A2);
  await A2.goto(URL0); await A2.waitForSelector('[data-act=new]', { timeout: 10000 });
  check('서버 종료 상태에서 앱 시작(캐시)', (await A2.evaluate(() => window.__ggot.suppliers.length)) === before);
  await A.close();
  await A2.click('[data-act=new]');
  await A2.fill('[data-field="s.name"]', '오프라인 입력 업체');
  await A2.evaluate(() => window.__ggot.flush());
  await A2.reload(); await A2.waitForSelector('[data-act=new]');
  check('오프라인 입력 후 재실행해도 유지', (await A2.evaluate(() => window.__ggot.suppliers.map(s => s.name))).includes('오프라인 입력 업체'));
  // 서버 재가동(재연결) 후 정상
  srv = createServer().listen(port, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  await A2.reload(); await A2.waitForSelector('[data-act=new]');
  check('서버 재연결 후 기록 유지', (await A2.evaluate(() => window.__ggot.suppliers.length)) === before + 1);

  // 새 버전 배포 → [지금 적용] 후에만 교체
  console.log('8. 새 버전 업데이트 안내');
  const swPath = path.join(__dirname, '..', 'sw.js'), swOrig = fs.readFileSync(swPath, 'utf8');
  try {
    fs.writeFileSync(swPath, swOrig.replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-e2e'"));
    await A2.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await A2.waitForSelector('#updatebar:not([hidden])', { timeout: 15000 });
    check('새 버전 설치 후 [지금 적용] 안내 표시 (자동 교체 안 함)', true);
    await Promise.all([A2.waitForEvent('load', { timeout: 15000 }), A2.click('#updatebar button')]);
    await A2.waitForSelector('[data-act=new]');
    await A2.waitForFunction(async () => (await caches.keys()).some(k => k.endsWith('-e2e')), null, { timeout: 10000 });
    check('적용 후 새 캐시로 교체, 기록 유지', (await A2.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('ggot-')).length)) === 1 && (await A2.evaluate(() => window.__ggot.suppliers.length)) === before + 1);
  } finally { fs.writeFileSync(swPath, swOrig); }

  console.log(`\n결과: ${pass} 통과, ${fails.length} 실패`);
  fails.forEach(f => console.log('  실패: ' + f));
  await browser.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
