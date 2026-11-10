# 요구사항 및 확장 모델

## 첫 화면
큰 새 업체, 사진부터 등록, 최근 업체. 현장에서는 타이핑 최소. 업체 필수 이름 없음. 사진부터 등록은 임시 업체에 사진을 넣는 방식. 미연결 사진함(0.2)은 저장 실패·업체 삭제로 남은 사진의 복구용.

## 제품/질문
제품: 선크림·미스트·세럼·젤·크림·버블·마스크팩·기타.
효능: 진정·보습·쿨링·피부장벽·자외선 차단.
공통 질문: 기존 처방, 소량 생산, 전성분, 중국 판매 경험, 커스텀 용기, 처방 변경 비용, 샤워 전후 사용 시점.
선크림: 해당 처방 SPF/PA, 내수성, 눈 시림 평가.
진정: 완제품 진정 평가, 민감피부/자극 자료.
보습: 지속시간 평가, 가벼운/고보습 비교 샘플.
쿨링: 성분과 피부 온도 평가 구분.
장벽: 완제품 평가 지표.
미스트·세럼·젤·크림·버블·마스크팩 종류별 질문(0.2 추가). 질문마다 답변+증빙단계, '해당 없음'(0.2 추가). 개별 메모/사진 연결은 후속. 질문 숨겨져도 기존 답변 삭제 금지.

## 업체/견적/샘플
Supplier UUID, createdAt/updatedAt, author, name, booth, contacts[], wechatStatus, priority, followup.
Product UUID + supplierId, types[], effects[], answers.
Quote UUID + productId, quantity, currency, unitPrice, tax, packaging, filling, testing, registrationSupport, tooling, shipping, paymentTerms, leadTime, date.
Sample UUID + productId, receiptState, batch, formulaNumber, testNotes.
Photo UUID + supplierId/productId/questionId nullable, category, note, favorite, mime, dimensions, storageRef.
Task UUID + supplierId, owner, dueDate, status. 담당자/정식 견적/샘플 테이블은 후속 구현.
백업 파일은 schemaVersion=1 (suppliers 배열 내 products/photos, 사진 data URL 포함). 기기 저장소는 IndexedDB v2: 메타데이터(state.suppliers)와 사진(photos/thumbs) 분리. v1→v2 이관 시 원본 전체를 state['backup-before-v2']에 먼저 보관(0.2 구현).

## 비교
회사 단위가 아니라 제품·견적 조건 단위. MOQ 범주와 정확값 분리. 가격 통화/수량/부대비용 미확인 시 최저가 순위 금지. 원료 자료와 완제품 시험 구분. 미확인=불가 아님. 임의 AI 점수 금지.

## 로드맵
P0 현장 안정성 → P1 PWA/배포/실기기 → P2 두 사용자 로그인·비공개 동기화 → P3 견적 이력·샘플 테스트·발주/납기/품질 관리.

## 업종·용기 (0.3)
업체 업종(sector): 화장품 OEM·ODM / 용기·패키지 / 기타. 업태(kind): 자체 공장 / 무역회사 / 기타 / 미확인. 0.2의 kind '용기 업체'는 sector '용기·패키지' + kind '미확인'으로 정리.
제품 구분(line): 화장품 / 패키지. 패키지 제품은 효능 대신 소재(materials)·용량·규격(spec)을 기록하고, 패키지 공통 11문항 + 용기 종류별 문항을 표시. 화장품 질문과 섞지 않음.

## 판단 기준 (0.3) — 점수·순위 없음
1. 필수 조건(통과/미통과는 사람이 판단): 소량 MOQ 가능, 영업집조 회사명·주소 일치, 결제 계좌명 = 회사명, 화장품 제조사는 化妆品生产许可证.
2. 신뢰 확인 체크리스트(업체 단위): 항목마다 확인/주의/미확인. 업종별로 항목이 다름. 개수만 표시하고 가중치·합산 점수 없음.
3. 위험 신호: 정해진 목록에서 선택. 하나라도 있으면 비교표에서 바로 보이고 '위험 신호 없는 업체만' 필터 제공.
4. 증빙 수준(질문 단위): 업체 설명 < 자료 요청 < 자료 수령 < 검토 완료. 업체 설명만 있는 답은 사실 확인으로 보지 않음.
5. 최종 판단: 관심도(우선/비교/보류) + 판단 근거 메모를 사람이 작성. 비교표·CSV에 근거가 함께 표시.

## 삭제·동기화 (0.4)
- 업체 삭제는 휴지통(deletedAt) → 복원 또는 영구 삭제(purged 표시만 남기고 내용·사진 삭제). 목록 선택 삭제, 편집 화면 상단 삭제.
- 두 기기 동기화는 서버 없이 동기화 파일(=백업 JSON, schemaVersion 1) 교환. 업체마다 rev = {기기ID: 수정 횟수} 버전 벡터.
  상대가 더 최신 → 갱신, 내가 더 최신 → 유지, 동시 수정 → "(가져온 사본)" 보존. 삭제도 같은 규칙으로 전달. 0.3 이전(rev 없음) 기록은 내용이 다르면 사본.
- 기기ID는 IndexedDB state['device']. 작성자(Tony/金彤) 선택과 무관하며 인증이 아님.
- 서버 실시간 동기화는 "후속 공동관리" 단계(서비스 선택·자격증명·중국/홍콩 실측 후).
