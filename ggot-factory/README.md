# GGOT Factory Desk 0.1
박람회 기록부터 공장관리로 확장하는 초기 실행 프로젝트.

## Windows 시작
1. ZIP을 압축 해제하고 ggot-factory 폴더를 연다.
2. Node.js가 설치된 환경에서 PowerShell 실행.
3. `npm start`
4. PC 브라우저에서 http://localhost:5173 접속.
5. Claude Code에서 이 폴더를 열고 START_HERE.md 내용을 붙여넣기.
외부 npm 패키지가 없어 npm install이 필요 없다. Node 20 이상 권장. Node 설치와 Claude Code 인증 설정은 이 ZIP에 포함되지 않는다.

## iPhone
같은 Wi-Fi에서 PC의 LAN IP로 http://PC주소:5173 접속하는 개발 테스트가 가능하다. 방화벽/네트워크에 따라 연결이 차단될 수 있다. localhost는 PC 자신만 가리킨다. 카메라 파일 선택은 iPhone에서 직접 검증해야 한다. 안정적인 현장용은 HTTPS 배포와 PWA 구현 후 사용한다. 현재 서비스워커 미구현으로 서버가 끊긴 뒤 재접속/새로고침 오프라인 사용은 보장하지 않는다.

## 포함 기능
- 임시 이름으로 새 업체 등록, 작성자 Tony/金彤
- 위챗 상태와 담당자 기록, QR 사진 보관 (QR 해독/위챗 자동 연동 없음)
- 업체별 다제품, 종류·효능 복수선택, 한중 질문
- 응답과 증빙 분리, MOQ/가격/납기/메모
- 사진 촬영·선택, 분류·메모·중요 표시. 최대 1800px JPEG 압축본 저장, 원본 보관 아님
- IndexedDB 저장, 검색, 제품 단위 비교표, 관심도 필터, CSV
- 사진 포함 JSON 백업/가져오기. 동일 ID의 내용이 다르면 사본 보존

## 기록 보관
자동 공동 동기화 없음. 각 기기·브라우저·접속 주소별 별도 데이터다. 작성자 선택은 로그인/인증이 아니다. 개인정보 보호모드 사용을 피하고 전시 중 수시로 백업한다. 브라우저 데이터 정리/저장공간 회수 시 기록이 사라질 수 있다. 사진을 많이 넣으면 백업 용량도 커진다. 두 사람의 JSON을 가져와 합칠 수 있지만 회사명이 같은 별도 UUID는 자동 병합하지 않는다. 반복 수정 충돌 사본은 검토 후 정리해야 한다.

## 테스트 상태
`npm test`: 백업 검증/병합/CSV 방어의 Node 단위 테스트.
`node --check src/app.js`: 구문 검사.
실제 Safari/Chrome UI, 사진 촬영, 저장공간 한계, PWA, 두 사람 공동 연동은 미검증/미구현. 출시 전 docs/ACCEPTANCE.md 수행.

## 구조
src/app.js UI와 IndexedDB, src/model.js 병합·검증, src/questions.js 질문 데이터.
docs/SPEC.md 확장 요구사항, CLAUDE.md 개발 가이드, START_HERE.md 붙여넣기 프롬프트.
