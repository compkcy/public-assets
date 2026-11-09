# 출시 전 수동 검증
표기: [x] = Chromium 자동 테스트(scripts/e2e.cjs)로 확인, [ ] = 실기기 확인 필요. 자세한 내용은 VERIFICATION.md.

- [x] 390px 아이폰, 1440px Windows에서 가로 잘림 없이 조작 (Chromium)
- [x] 회사명 없이 QR 사진으로 등록 후 다음 업체 (Chromium)
- [x] 제품 2개에서 각각 응답/사진/가격이 섞이지 않음 (Chromium)
- [x] 진정/보습 변경으로 질문 표시 변경, 숨겨진 답변 유지 (Chromium)
- [x] 입력 후 리로드, IndexedDB 유지 (Chromium)
- [x] 저장 실패 시 다음 업체로 이동 차단 및 복구 안내 (Chromium)
- [ ] 카메라/앨범/JPEG/PNG/HEIC 처리 성공 또는 정확한 실패 안내 (JPEG/PNG·깨진 파일 안내는 Chromium 확인, 카메라·HEIC는 아이폰 필요)
- [x] 사진 포함 백업을 새 브라우저로 복원하고 사진/답변 대조 (Chromium)
- [x] Tony/金彤 파일 병합, 동일 기록 충돌 때 원본 보존 (Chromium)
- [x] CSV에서 한글/중국어 정상, 수식문자 메모 실행되지 않음 (Chromium)
- [x] QR 사진 등록이 친구 추가/회사명 OCR로 표시되지 않음 (Chromium)
- [ ] HTTPS/PWA 최초 방문 후 비행기 모드 재실행/기록/재연결 (Chromium: 서버 종료 후 실행·입력·재연결 확인 / 아이폰 홈 화면 앱 필요)
- [ ] 로그인 구현 후 다른 계정 자료 및 사진 접근 차단 검증
- [ ] 아이폰 공유 시트 "파일에 저장" 및 AirDrop으로 백업 전달 후 다른 아이폰에서 합치기
- [x] 0.1 데이터가 있던 브라우저에서 0.2 첫 실행 시 이관, 원본 보관 (Chromium)
