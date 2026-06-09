---
type: triage-suggestion
status: candidate
priority: medium
source: docs/loop/state.md
updated: 2026-06-08
---
# Riegel scale control 상호작용 테스트

## 배경

Riegel analysis에는 Expected vs Current chart와 Baseline Prediction chart가 공유하는 linear/log x축 scale toggle이 있습니다. 기존 테스트는 관련 UI 일부를 확인하지만, 한 그룹에서 scale을 바꿨을 때 모든 Riegel scale button의 active 상태와 두 chart의 scale이 함께 바뀌는지는 직접 검증하지 않습니다.

2026-06-08 triage에서 `public/index.html`의 두 `.riegel-scale-option` 그룹과 `public/app.js`의 공유 click binding을 다시 확인했습니다.

## 관련 파일

- `public/index.html`
- `public/app.js`
- `tests/runasis.test.js`

## 완료 기준

- Riegel scale toggle 그룹 중 하나를 클릭했을 때 공유 선택 상태가 일관되게 갱신되는 테스트가 추가됩니다.
- Expected vs Current chart와 Baseline Prediction chart가 같은 scale 선택을 쓰는지 확인합니다.
- 테스트가 gap을 드러낼 경우에만 `public/app.js`를 수정합니다.

## 검증

```bash
npm test
```

## 관련 노트

- [[개발과 테스트]]
- [[아키텍처와 데이터 흐름]]
- [[triage 제안 MOC]]
