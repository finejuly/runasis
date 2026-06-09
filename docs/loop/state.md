# Runasis 루프 상태

이 파일은 Runasis triage 루프의 지속 상태 기록입니다.

## 루프 규칙

- 모드: triage 전용.
- 주기: 매일 아침, 그리고 사용자가 요청할 때 수동 실행.
- 기본 skill: `$runasis-triage`.
- triage 중 쓰기 허용 대상: `docs/loop/state.md`, `obsidian/Triage/현재 triage 상태.md`, `obsidian/Triage/History/`, `obsidian/Triage/Suggestions/`, `obsidian/Triage/triage 제안 MOC.md`.
- triage 중 금지: 애플리케이션 코드 수정, 테스트 수정, 브랜치 생성, 커밋, PR 생성, Strava 데이터 fetch, `.env` 읽기, private activity JSON 검사.
- `obsidian/Todo/`는 사용자가 직접 입력한 Todo 전용이며, triage가 발견한 항목은 `obsidian/Triage/Suggestions/`에서 관리함.
- 상태 파일과 Obsidian triage 노트 언어: 한국어.
- 검증 기준: `npm test`.
- 제안 운영: 새 제안은 기존 제안과 중복이면 병합하고, 활성 제안은 5-7개 이내로 유지.

수동 실행 프롬프트:

```text
Use $runasis-triage to run a read-mostly Runasis repo triage and update docs/loop/state.md plus obsidian/Triage notes in Korean.
```

## 현재 기준선

- 저장소: `finejuly/runasis`
- 설정 당시 main 브랜치: `main`
- 설정 당시 테스트 기준선: 2026-06-08에 `npm test` 76개 통과.
- 주요 리스크 영역: Strava 토큰/설정 처리, 로컬 데이터 삭제, personal-best 계산, Riegel projection, SVG 차트 라벨/레이아웃 회귀, `server.js`와 `public/app.js`의 큰 파일 유지보수성.

## 최근 실행

- 날짜: 2026-06-08
- 유형: 수동 triage
- 브랜치: `main`
- 작업트리 상태: triage 설정 파일과 Obsidian vault가 아직 `.agents/`, `docs/`, `obsidian/` 아래 untracked 상태로 남아 있음. 애플리케이션/테스트/asset 파일 변경은 보이지 않음.
- 최신 커밋: `9142f76 Merge pull request #15 from finejuly/codex/linear-log-axis-helper`
- 테스트 결과: `npm test` 77개 통과.
- 결과: triage workflow가 `docs/loop/state.md`와 `obsidian/Triage/`를 함께 갱신하도록 동작함을 확인함. 기존 3개 활성 제안은 여전히 유효하고, 이번 실행에서 새 제안은 추가하지 않음.

## 활성 제안

1. triage 루프 scaffolding을 git에 체크인하기.
   - 영향: 매일 실행되는 worktree 자동화와 이후 수동 실행이 같은 `$runasis-triage` skill, 루프 상태, Obsidian triage 노트를 안정적으로 보게 됨.
   - 근거: `git status --short`가 `?? .agents/`, `?? docs/`, `?? obsidian/`를 보고함.
   - 관련 파일: `.agents/skills/runasis-triage/SKILL.md`, `.agents/skills/runasis-triage/agents/openai.yaml`, `docs/loop/state.md`, `obsidian/Triage/`.
   - 검증: `git status --short`, `npm test`.

2. 공유 Riegel scale control 상호작용 테스트 추가하기.
   - 영향: 최근 추가된 두 Riegel 차트 패널의 공유 linear/log control 동작을 보호함.
   - 근거: `public/index.html`에는 `.riegel-scale-option` 토글 그룹이 두 개 있고, `public/app.js`는 일치하는 모든 버튼을 `renderRiegelAnalysis()`에 바인딩함. 기존 테스트는 Expected vs Current 토글 존재와 personal-best scale 공유 동작은 확인하지만, Riegel 두 그룹 중 하나를 클릭했을 때 공유 버튼 컬렉션의 active 상태와 두 차트의 scale이 함께 바뀌는지는 직접 검증하지 않음.
   - 관련 파일: `tests/runasis.test.js`, 테스트가 gap을 드러내면 `public/app.js`.
   - 검증: `npm test`.

3. malformed static URL path를 500 대신 명시적으로 처리하기.
   - 영향: 잘못된 percent-encoding이 포함된 static 요청이 내부 오류처럼 보이지 않게 하고, local server의 입력 처리 경계를 더 명확히 함.
   - 근거: `server.js`의 `resolveStaticFilePath()`는 `decodeURIComponent(urlPathname)`를 직접 호출함. 현재 테스트는 public directory escape만 검증하고 malformed escape 처리나 응답 status는 검증하지 않음.
   - 관련 파일: `server.js`, `tests/runasis.test.js`.
   - 검증: malformed static path 요청 테스트를 추가한 뒤 `npm test`.

## 다음 수동 작업

- `triage 루프 scaffolding을 git에 체크인하기`를 먼저 처리하는 것이 가장 좋음. `$runasis-triage` skill, loop state, Obsidian triage vault가 아직 untracked라서, 자동/수동 triage 루프의 지속성이 현재 가장 큰 운영 리스크임.

## 완료된 제안

- 2026-06-08: 반복되는 linear/log 차트 축 매핑을 `buildLinearLogXAxisScale` helper로 추출함.
  - 영향: time-best, Riegel expected/equivalent, personal-best 차트의 중복 x축 매핑 블록을 줄임.
  - 관련 파일: `public/app.js`, `tests/runasis.test.js`.
  - 검증: `npm test` 77개 통과.

## 보류

- `public/app.js` 또는 `server.js`를 크게 분리하는 작업은 유용하지만 첫 triage 후속 작업으로는 범위가 큼.
- 차트 레이아웃에 대한 브라우저 기반 visual QA도 나중에 가치가 있지만, 현재 의존성 없는 테스트 구성을 고려하면 작은 unit/integration test가 더 낮은 리스크의 다음 단계임.
- Riegel 정보 모달 3개는 `role="dialog"`와 `aria-labelledby`는 있지만 `aria-describedby`가 없음. clear-data 확인 모달은 이미 `aria-describedby`를 갖고 있어 접근성 정리 제안이 될 수 있지만, 현재는 static URL 처리보다 우선순위가 낮음.
