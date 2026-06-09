---
type: triage-suggestion
status: candidate
priority: high
source: docs/loop/state.md
updated: 2026-06-08
---
# triage 루프 scaffolding 체크인

## 배경

현재 triage 루프 설정 파일, 상태 파일, Obsidian triage vault가 untracked 상태로 남아 있습니다. 이 상태가 유지되면 매일 실행되는 자동화와 수동 triage가 같은 skill, loop state, Obsidian 기록을 안정적으로 공유하지 못할 수 있습니다.

## 관련 파일

- `.agents/skills/runasis-triage/SKILL.md`
- `.agents/skills/runasis-triage/agents/openai.yaml`
- `docs/loop/state.md`
- `obsidian/Triage/`
- `obsidian/Meta/노트 작성 규칙.md`

## 완료 기준

- triage skill, agent 설정, loop 상태 파일, Obsidian triage vault가 git 추적 대상이 됩니다.
- `docs/loop/state.md`, skill metadata, Obsidian triage 규칙이 서로 맞습니다.
- 애플리케이션 코드와 테스트 코드는 이 작업에서 변경하지 않습니다.

## 검증

```bash
git status --short
npm test
```

## 관련 노트

- [[현재 triage 상태]]
- [[2026-06-08 수동 triage]]
- [[triage 제안 MOC]]
