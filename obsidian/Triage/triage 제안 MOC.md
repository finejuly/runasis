---
type: moc
tags:
  - runasis
  - triage
  - suggestion
updated: 2026-06-08
---
# triage 제안 MOC

Runasis triage가 발견한 제안을 관리하는 목차입니다. 사용자가 직접 입력한 Todo는 [[사용자 Todo MOC]]에서 따로 관리합니다.

최근 확인: 2026-06-08 21:38 PDT 수동 triage에서 `npm test` 77개 통과.

## 활성 제안

- [[triage 루프 scaffolding 체크인]]: triage 루프 설정 파일을 git에 포함하는 운영 안정화 제안
- [[Riegel scale control 상호작용 테스트]]: Riegel linear/log 공유 토글의 회귀 방지 테스트 제안
- [[malformed static URL path 처리]]: 잘못된 static URL encoding을 명시적으로 처리하는 서버 입력 경계 제안

## 관리 규칙

- 제안은 triage 실행 결과에서 온 항목만 둡니다.
- 제안 하나는 `Triage/Suggestions/` 아래 노트 하나로 관리합니다.
- 사용자 입력 Todo와 중복되면 이 노트에는 triage 출처와 판단 맥락만 남기고, 사용자 요청은 [[사용자 Todo MOC]] 쪽에서 관리합니다.

## 관련 노트

- [[현재 triage 상태]]
- [[2026-06-08 수동 triage]]
- [[노트 작성 규칙]]
