// IndexedDB 저장소. 이 기기·이 브라우저(홈 화면 앱) 전용. 서버로 전송하지 않는다.
// v1: state['suppliers'] 안에 사진 data URL까지 저장 → 매 입력마다 전체 사진을 다시 기록해 아이폰에서 느려짐.
// v2: state['suppliers']는 메타데이터만, 사진은 photos(원본 크기 압축본)/thumbs(목록용 작은 사진) 저장소로 분리.
//     v1→v2 이관 시 원본 전체를 state['backup-before-v2']에 먼저 보관한다.
import { splitPhotos } from './model.js';

const NAME = 'ggot-factory', VERSION = 2;
let db;

export function open() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(NAME, VERSION); } catch (e) { return reject(e); }
    req.onupgradeneeded = e => {
      const d = req.result, t = req.transaction;
      if (!d.objectStoreNames.contains('state')) d.createObjectStore('state');
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs', { keyPath: 'id' });
      if (e.oldVersion === 1) {
        const st = t.objectStore('state');
        const g = st.get('suppliers');
        g.onsuccess = () => {
          const old = g.result;
          if (!Array.isArray(old)) return;
          st.put({ savedAt: new Date().toISOString(), schemaVersion: 1, suppliers: old }, 'backup-before-v2');
          const { suppliers, records } = splitPhotos(old);
          const ps = t.objectStore('photos');
          records.forEach(r => ps.put(r));
          st.put(suppliers, 'suppliers');
        };
      }
    };
    req.onsuccess = () => {
      db = req.result;
      db.onversionchange = () => { db.close(); dispatchEvent(new CustomEvent('ggot-db-closed')); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('다른 탭/창에 이 앱이 열려 있어 저장소를 업그레이드할 수 없습니다. 다른 탭을 닫고 다시 여세요.'));
  });
}

/** 트랜잭션이 완료(commit)되어야 resolve. 오류/중단은 reject로 전파한다. */
function run(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let t, out;
    try { t = db.transaction(stores, mode); } catch (e) { return reject(e); }
    try {
      const r = fn(t);
      if (typeof IDBRequest !== 'undefined' && r instanceof IDBRequest) r.onsuccess = () => { out = r.result; };
      else out = r;
    } catch (e) { try { t.abort(); } catch {} return reject(e); }
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error || new Error('저장 트랜잭션 오류'));
    t.onabort = () => reject(t.error || new Error('저장 트랜잭션 중단'));
  });
}

export const getState = key => run(['state'], 'readonly', t => t.objectStore('state').get(key));
export const putState = (key, value) => run(['state'], 'readwrite', t => { t.objectStore('state').put(value, key); });
export const deleteState = key => run(['state'], 'readwrite', t => { t.objectStore('state').delete(key); });

export const saveSuppliers = snapshot => putState('suppliers', snapshot);

/** 사진 레코드 + 썸네일 저장 (한 트랜잭션) */
export const putPhoto = (record, thumb) => run(['photos', 'thumbs'], 'readwrite', t => {
  t.objectStore('photos').put(record);
  if (thumb) t.objectStore('thumbs').put({ id: record.id, thumb });
});
export const putThumb = (id, thumb) => run(['thumbs'], 'readwrite', t => { t.objectStore('thumbs').put({ id, thumb }); });

function getMany(store, ids) {
  return run([store], 'readonly', t => {
    const st = t.objectStore(store), m = new Map();
    ids.forEach(id => { const r = st.get(id); r.onsuccess = () => { if (r.result) m.set(id, r.result); }; });
    return m;
  });
}
export const getPhotos = ids => getMany('photos', ids);
export const getThumbs = ids => getMany('thumbs', ids);
export const photoKeys = () => run(['photos'], 'readonly', t => t.objectStore('photos').getAllKeys());

export const deletePhotos = ids => run(['photos', 'thumbs'], 'readwrite', t => {
  ids.forEach(id => { t.objectStore('photos').delete(id); t.objectStore('thumbs').delete(id); });
});

/** 백업 합치기: 사진과 업체 목록을 한 트랜잭션으로 기록 → 일부만 저장되는 상태를 만들지 않는다. */
export const importAtomic = (suppliers, records) => run(['state', 'photos'], 'readwrite', t => {
  const ps = t.objectStore('photos');
  records.forEach(r => ps.put(r));
  t.objectStore('state').put(suppliers, 'suppliers');
});
