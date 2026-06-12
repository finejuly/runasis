# Runasis 루프 상태

이 파일은 Runasis triage 루프의 지속 상태 기록입니다. 실제 작업 목록과 진행 상태는 Obsidian의 `Work/` 상태 폴더가 정본입니다.

## 루프 규칙

- 모드: triage 전용.
- 주기: 매일 아침, 그리고 사용자가 요청할 때 수동 실행.
- 기본 skill: `$runasis-triage`.
- triage 중 쓰기 허용 대상: `docs/loop/state.md`, `obsidian/Triage/현재 triage 상태.md`, `obsidian/Triage/History/`, `obsidian/Work/작업.md`, `obsidian/Work/Inbox/`, `obsidian/Work/Next/`, `obsidian/Work/Doing/`, `obsidian/Work/Blocked/`, `obsidian/Work/Done/`, `obsidian/Work/Dropped/`.
- triage 중 금지: 애플리케이션 코드 수정, 테스트 수정, 브랜치 생성, 커밋, PR 생성, Strava 데이터 fetch, `.env` 읽기, private activity JSON 검사.
- 작업 관리는 `obsidian/Work/`를 정본으로 삼음. 작업 하나는 파일 하나이고, 현재 상태는 파일이 들어 있는 상태 폴더가 나타냄.
- 사용자가 daily note나 임시 메모에 적은 내용과 triage가 발견한 항목은 같은 `work-item` 형식으로 관리하고, 출처는 `source` 속성과 태그로만 추적함.
- `status` frontmatter, 별도 Todo 목록, 별도 Suggestions 목록, Archive 폴더는 사용하지 않음.
- 상태 파일과 Obsidian triage 노트 언어: 한국어.
- 검증 기준: `npm test`.
- 제안 운영: 새 제안은 기존 작업 파일과 중복이면 병합하고, 활성 `Work/Next/`, `Work/Doing/`, `Work/Blocked/` 항목은 5-7개 이내로 유지.
- worktree에서 실행했으면 repo-local triage skill과 `docs/loop/state.md`는 git 추적 파일로 유지하고, Obsidian vault 문서 변경은 기본 저장소의 `obsidian/` symlink 정본에 반영한다.

수동 실행 프롬프트:

```text
Use $runasis-triage to run a read-mostly Runasis repo triage. Keep the repo-local triage skill at .agents/skills/runasis-triage/, keep docs/loop/state.md and obsidian/Triage/현재 triage 상태.md as compact Korean loop summaries, record dated history under obsidian/Triage/History/, and create/update/move work-item files under obsidian/Work/{Inbox,Next,Doing,Blocked,Done,Dropped}/. Treat the containing folder as status; do not add status frontmatter or maintain separate Todo/Suggestions/Archive indexes. If the run happens in a detached worktree, keep tracked repo metadata in git, sync Obsidian vault changes back through the base repository obsidian/ symlink, and remove the temporary worktree after verification when no user work must remain there.
```

## 현재 기준선

- 저장소: `finejuly/runasis`
- 기준 브랜치: `main`
- 최근 기록된 테스트 기준선: 2026-06-12 daily triage 중 `npm test` 97개 통과.
- 최근 기록된 커밋: `b564e09 Refine analysis selection hierarchy`.
- 주요 리스크 영역: Strava 토큰/설정 처리, 로컬 데이터 삭제, personal-best 계산, Riegel projection, SVG 차트 라벨/레이아웃 회귀, `server.js`와 `public/app.js`의 큰 파일 유지보수성.

## Obsidian 운영

- 작업 안내: `obsidian/Work/작업.md`
- 상태 변경: 작업 파일을 `Work/Inbox/`, `Work/Next/`, `Work/Doing/`, `Work/Blocked/`, `Work/Done/`, `Work/Dropped/` 사이에서 이동
- triage 실행 상태: `obsidian/Triage/현재 triage 상태.md`
- 실행 기록: `obsidian/Triage/History/`
- 작업 파일에는 배경, 관련 파일, 완료 기준, 검증 방법을 한 파일 안에 유지함.
- `obsidian/Triage/현재 triage 상태.md`와 이 파일은 작업별 상태판이 아니므로 작업 추가/이동 때마다 목록을 맞춰 갱신하지 않음.

## 최근 실행 메모

- 2026-06-12: detached worktree `c493/Runasis`에서 triage-only pass를 실행했고, 앱 코드 실패 없이 `npm test` 97개 통과를 재확인했다.
- 2026-06-12: repo-local triage skill과 `docs/loop/state.md`는 새 worktree에서도 따라가도록 git 추적 대상으로 복구하고, Obsidian vault 내용은 기본 저장소의 `obsidian/` symlink 정본에만 유지하기로 정리했다.
- 2026-06-12: `Triage scaffold baseline`은 `repo-local triage 스킬 복구`와 같은 주제를 중복으로 다뤄서 별도 Next 항목으로 유지하지 않기로 했다.
- 2026-06-12: 오늘의 작은 후보는 analysis smoke test 보강, 저장소 링크 표시 결정, repo-local triage skill/메타데이터 기준 정리로 압축했다.
- 2026-06-11: detached worktree에서 triage-only pass를 실행했고, 앱 코드 실패 없이 `npm test` 96개 통과를 재확인했다.
- 2026-06-11: worktree에는 `.agents/skills/runasis-triage/`와 루프 문서 사본이 없어서 최소 triage 노트를 만들었고, 기준 정본은 기본 저장소의 `docs/loop/`와 `obsidian/`로 계속 유지한다.
- 2026-06-11: 신규 triage 후보로 저장소 링크 표시 정리, repo-local triage 스킬 복구, `Runasis.command` 스모크 테스트 검토를 Inbox에 추가했다.
- 2026-06-09: reviewed 상태였던 Riegel scale control 테스트와 malformed static URL path 처리는 최근 커밋 및 테스트 기준으로 완료 처리함.
- 2026-06-09: triage 루프 scaffolding git 추적 제안은 사용자 피드백에 따라 dropped 처리함.
- 2026-06-09: 사용자 메모와 triage 제안을 분리 목록으로 관리하지 않고, `obsidian/Work/` 상태 폴더를 Trello식 보드처럼 사용하도록 vault와 triage 규칙을 정리함.

## 보류

- `public/app.js` 또는 `server.js`를 크게 분리하는 작업은 유용하지만 첫 triage 후속 작업으로는 범위가 큼.
- browser 기반 visual QA는 Analysis 화면 확장 후 가치가 있지만, 현재는 Node 내장 테스트만으로 검증 가능한 작은 작업을 우선함.
