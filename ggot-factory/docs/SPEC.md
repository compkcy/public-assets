# 요구사항 및 확장 모델

## 첫 화면
큰 새 업체, 사진부터 등록, 최근 업체. 현장에서는 타이핑 최소. 업체 필수 이름 없음. 현재 임시 업체에 사진을 넣는 방식이며 별도 미분류 사진함은 후속.

## 제품/질문
제품: 선크림·미스트·세럼·젤·크림·버블·마스크팩·기타.
효능: 진정·보습·쿨링·피부장벽·자외선 차단.
공통 질문: 기존 처방, 소량 생산, 전성분, 중국 판매 경험, 커스텀 용기, 처방 변경 비용, 샤워 전후 사용 시점.
선크림: 해당 처방 SPF/PA, 내수성, 눈 시림 평가.
진정: 완제품 진정 평가, 민감피부/자극 자료.
보습: 지속시간 평가, 가벼운/고보습 비교 샘플.
쿨링: 성분과 피부 온도 평가 구분.
장벽: 완제품 평가 지표.
질문마다 답변+증빙단계, 다음 버전은 해당 없음과 개별 메모/사진 연결 추가. 질문 숨겨져도 기존 답변 삭제 금지.

## 업체/견적/샘플
Supplier UUID, createdAt/updatedAt, author, name, booth, contacts[], wechatStatus, priority, followup.
Product UUID + supplierId, types[], effects[], answers.
Quote UUID + productId, quantity, currency, unitPrice, tax, packaging, filling, testing, registrationSupport, tooling, shipping, paymentTerms, leadTime, date.
Sample UUID + productId, receiptState, batch, formulaNumber, testNotes.
Photo UUID + supplierId/productId/questionId nullable, category, note, favorite, mime, dimensions, storageRef.
Task UUID + supplierId, owner, dueDate, status. 담당자/정식 견적/샘플 테이블은 후속 구현.
현재 schemaVersion=1 suppliers 배열 내 products/photos로 저장. 이관 시 버전 migration과 원본 백업을 먼저 추가.

## 비교
회사 단위가 아니라 제품·견적 조건 단위. MOQ 범주와 정확값 분리. 가격 통화/수량/부대비용 미확인 시 최저가 순위 금지. 원료 자료와 완제품 시험 구분. 미확인=불가 아님. 임의 AI 점수 금지.

## 로드맵
P0 현장 안정성 → P1 PWA/배포/실기기 → P2 두 사용자 로그인·비공개 동기화 → P3 견적 이력·샘플 테스트·발주/납기/품질 관리.
