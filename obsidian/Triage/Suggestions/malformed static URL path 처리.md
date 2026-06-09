---
type: triage-suggestion
status: candidate
priority: medium
source: docs/loop/state.md
updated: 2026-06-08
---
# malformed static URL path 처리

## 배경

static file path 해석에서 잘못된 percent encoding이 들어오면 내부 오류처럼 보일 수 있습니다. local server 입력 경계를 더 명확히 하려면 malformed static URL을 500 대신 명시적인 client error로 처리하는 테스트와 구현이 필요합니다.

2026-06-08 triage에서 `resolveStaticFilePath()`가 `decodeURIComponent(urlPathname)`를 직접 호출하고, 현재 테스트가 malformed percent-encoding 응답 status를 직접 검증하지 않는 것을 다시 확인했습니다.

## 관련 파일

- `server.js`
- `tests/runasis.test.js`

## 완료 기준

- malformed static path 요청의 응답 status가 명시적으로 검증됩니다.
- `resolveStaticFilePath()` 또는 호출부가 decoding 오류를 서버 내부 오류로 노출하지 않습니다.
- 기존 public directory escape 방어는 유지됩니다.

## 검증

```bash
npm test
```

## 관련 노트

- [[개발과 테스트]]
- [[아키텍처와 데이터 흐름]]
- [[triage 제안 MOC]]
