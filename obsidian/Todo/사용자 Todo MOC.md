---
type: moc
tags:
  - runasis
  - todo
updated: 2026-06-08
---
# 사용자 Todo MOC

사용자가 직접 입력한 Runasis 관련 Todo를 관리하는 목차입니다. triage가 발견한 제안은 [[triage 제안 MOC]]에서 따로 관리합니다.

## 사용자 입력 Todo

아직 등록된 사용자 Todo가 없습니다.

## 상태 규칙

- `candidate`: 사용자가 입력했고 아직 구현 전인 항목
- `active`: 현재 작업 중인 항목
- `done`: 구현과 검증이 끝난 항목
- `deferred`: 의도적으로 보류한 항목

## 우선순위 규칙

- `high`: 운영 안정성이나 데이터 안전성에 직접 관련된 항목
- `medium`: 회귀 방지나 입력 경계 강화 항목
- `low`: 개선 가치는 있지만 현재 리스크가 낮은 항목

## 관련 노트

- [[현재 triage 상태]]
- [[triage 제안 MOC]]
- [[개발과 테스트]]
