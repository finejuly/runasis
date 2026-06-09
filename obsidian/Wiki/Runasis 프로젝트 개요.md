---
type: wiki
tags:
  - runasis
  - overview
  - local-first
  - strava
updated: 2026-06-08
---
# Runasis 프로젝트 개요

Runasis는 Strava 계정의 러닝 기록을 로컬 머신으로 가져와 개인 훈련 기록을 분석하는 대시보드입니다. 외부 분석 서비스에 데이터를 다시 업로드하지 않고, 사용자의 Strava API 설정과 활동 데이터는 로컬에 저장하는 방향으로 설계되어 있습니다.

## 대상 사용자

- 자신의 러닝 훈련 이력을 자세히 보고 싶은 러너
- Strava 데이터를 별도 서비스에 맡기지 않고 로컬에서 분석하고 싶은 사용자
- 개인 최고 기록, 장거리 추세, 레이스 거리별 예측을 한 화면에서 보고 싶은 사용자

## 주요 기능

- 기간별 훈련 거리, 활동 수, 이동 시간, 상승 고도 요약
- 누적 추세, 주간 추세, 거리 분포, 롱런 목록
- 최신 활동 목록과 전체 활동 검색/정렬
- 저장된 activity stream 기반 개인 최고 기록
- 거리 기준 best, 시간 기준 best, 목표 페이스 기준 best
- Riegel 모델 기반 레이스 예측과 거리별 강약 비교

## 기술 형태

- 런타임: Node.js 18 이상
- 서버: `server.js` 단일 Node HTTP 서버
- 프론트엔드: `public/index.html`, `public/app.js`, `public/styles.css`
- 의존성: 현재 package dependency 없이 Node.js 내장 모듈 중심
- 테스트: `node --test` 기반 `tests/runasis.test.js`

## 관련 노트

- [[실행과 설정]]
- [[아키텍처와 데이터 흐름]]
- [[개발과 테스트]]
- [[현재 triage 상태]]
