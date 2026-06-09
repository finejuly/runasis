---
type: moc
tags:
  - runasis
  - dev-onboarding
  - local-first
  - strava
updated: 2026-06-08
---
# Runasis 홈

Runasis 레포를 이해하고 운영하기 위한 Obsidian 시작점입니다. 이 vault는 개발 온보딩에서 시작해, 이후 [[개념 MOC|wiki]], [[사용자 Todo MOC|사용자 todo]], [[triage 제안 MOC|triage 제안]], [[현재 triage 상태|triage]] 기록을 누적하는 구조로 확장합니다.

## 빠른 링크

- [[Runasis 프로젝트 개요]]
- [[실행과 설정]]
- [[아키텍처와 데이터 흐름]]
- [[개발과 테스트]]
- [[개념 MOC]]
- [[사용자 Todo MOC]]
- [[triage 제안 MOC]]
- [[현재 triage 상태]]
- [[노트 작성 규칙]]

## 한 줄 요약

Runasis는 Strava 러닝 기록을 로컬 앱으로 가져와 훈련량, 개인 최고 기록, Riegel 기반 레이스 예측을 보여주는 비공식 로컬 우선 대시보드입니다.

## 자주 쓰는 명령

```bash
npm start
npm test
```

macOS에서는 `Runasis.command`를 더블클릭해 서버를 시작하고 브라우저를 열 수 있습니다.

## 민감정보 원칙

- `.env`와 `data/` 내부 내용은 vault에 복사하지 않습니다.
- Strava 인증 정보, 토큰, 활동 원본 JSON은 로컬에만 두고 노트에는 경로와 취급 원칙만 기록합니다.
- 민감 경로를 설명할 때도 실제 값이나 개인 활동 데이터는 넣지 않습니다.

## 현재 출발점

- 레포 문서 소스: `README.md`, `docs/loop/state.md`
- 앱 핵심 파일: `server.js`, `public/index.html`, `public/app.js`
- 테스트: `tests/runasis.test.js`
- Obsidian 확장 기준: [[노트 작성 규칙]]
