# Runasis cloud deployment

이 구성은 한 사람만 사용하는 Runasis를 다음처럼 배포한다.

```text
Browser
  └─ Vercel (정적 프론트엔드, /api·/auth 프록시)
       └─ Cloud Run (Node API, Strava OAuth, 분석)
            ├─ Firestore (상태, 활동 목록, 정제된 상세)
            ├─ Cloud Storage (gzip 원본 상세·스트림, PB 캐시)
            ├─ Cloud Tasks (버튼으로 시작한 동기화 배치)
            └─ Secret Manager (Strava 비밀키, 세션 비밀키)
```

Cloud SQL은 사용하지 않는다. 현재 조회는 한 사용자 아래의 활동을 통째로 읽고 파생 기록을 계산하는 방식이라 Firestore 문서와 Cloud Storage 객체가 더 단순하고 저렴하다.

이번 범위에서 제외한 항목:

- Cloud Scheduler 자동 동기화
- Strava Webhook 실시간 갱신
- Firebase Auth 계정 시스템

현재 로그인은 Strava OAuth 결과의 athlete id가 `RUNASIS_ALLOWED_ATHLETE_ID`와 일치할 때만 30일 보안 세션을 발급한다.

## 1. 준비

필요한 도구:

- 결제 계정이 연결된 Google Cloud 프로젝트
- `gcloud` CLI
- Vercel 프로젝트와 확정된 프로덕션 주소
- Strava API 애플리케이션

Vercel 프로젝트를 먼저 만들고 최종 주소를 정한다. 예:

```text
https://runasis-example.vercel.app
```

Strava의 `Authorization Callback Domain`에는 이 주소의 호스트만 입력한다.

```text
runasis-example.vercel.app
```

Google Cloud에 로그인한다.

```bash
gcloud auth login
gcloud auth application-default login
```

## 2. GCP 리소스와 Cloud Run 생성

저장소 루트에서 필요한 값을 환경 변수로 둔다. 셸 히스토리에 비밀키를 남기고 싶지 않으면 `read -s`나 별도 보안 셸을 사용한다.

```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export RUNASIS_PUBLIC_ORIGIN="https://runasis-example.vercel.app"
export RUNASIS_ALLOWED_ATHLETE_ID="your-numeric-strava-athlete-id"
export STRAVA_CLIENT_ID="your-strava-client-id"
export STRAVA_CLIENT_SECRET="your-strava-client-secret"
```

필요하면 기본 리전과 리소스 이름을 바꿀 수 있다.

```bash
export RUNASIS_REGION="us-west1"
export RUNASIS_SERVICE="runasis"
export RUNASIS_BUCKET="${GOOGLE_CLOUD_PROJECT}-runasis-data"
export RUNASIS_QUEUE="runasis-sync"
```

부트스트랩을 실행한다.

```bash
./deploy/gcp-bootstrap.sh
```

이 스크립트는 API 활성화, 기본 Firestore 데이터베이스, 비공개 버킷, 서비스 계정, 최소 IAM, 작업 큐, Secret Manager 버전, Cloud Run 서비스를 만든다. 기존 Firestore 데이터베이스나 버킷은 삭제하지 않는다. 마지막에 다음 값을 출력한다.

```text
Cloud Run: https://runasis-xxxxx.us-west1.run.app
Vercel build env: RUNASIS_API_ORIGIN=https://runasis-xxxxx.us-west1.run.app
Strava callback: https://runasis-example.vercel.app/auth/strava/callback
```

Cloud Run 서비스는 Vercel 프록시가 접근할 수 있도록 네트워크 수준에서는 공개되어 있다. 데이터 API는 앱 내부의 서명된 세션, 허용된 athlete id, 동일 출처 검사, CSRF 토큰으로 다시 보호된다. 버킷과 Firestore는 서비스 계정만 접근한다.

## 3. Vercel 배포

Vercel 프로젝트의 Production 환경 변수에 부트스트랩이 출력한 Cloud Run 주소를 넣는다.

```text
RUNASIS_API_ORIGIN=https://runasis-xxxxx.us-west1.run.app
```

그 다음 Production 배포를 실행한다. `scripts/build-vercel.js`가 `public/`을 정적 출력으로 복사하고 `/api/*`, `/auth/*`만 Cloud Run으로 프록시한다.

CLI 예:

```bash
vercel env add RUNASIS_API_ORIGIN production
vercel --prod
```

배포 후 아래를 확인한다.

```bash
curl -i "https://runasis-example.vercel.app/api/status"
curl -i "https://runasis-xxxxx.us-west1.run.app/healthz"
```

첫 번째 응답은 로그인 전 상태만 보여야 하고, 두 번째 응답은 `{"ok":true}`여야 한다.

## 4. 기존 로컬 데이터 이전

마이그레이션은 기본적으로 dry run이며 로컬 파일을 수정하거나 지우지 않는다.

```bash
GOOGLE_CLOUD_PROJECT="your-project-id" \
RUNASIS_STORAGE_BUCKET="your-project-id-runasis-data" \
npm run migrate:gcp
```

표시된 활동 수, 상세 수, 스트림 수를 확인한 뒤 적용한다.

```bash
GOOGLE_CLOUD_PROJECT="your-project-id" \
RUNASIS_STORAGE_BUCKET="your-project-id-runasis-data" \
npm run migrate:gcp:apply
```

완료 시 Firestore에서 활동·상세·원본 플래그 수를 다시 읽어 검증한다. 로컬 `data/`는 그대로 남으므로 클라우드 화면을 확인한 뒤 별도로 보관하면 된다.

## 5. 운영 확인

- `Sync` 버튼은 즉시 Cloud Tasks 작업을 만들고 화면은 동기화 상태 문서 하나만 읽는 `/api/sync-job`을 폴링한다.
- 작업 큐 동시 실행 수는 1, Cloud Run 최대 인스턴스도 1이라 한 사용자 데이터에 대한 동시 쓰기를 피한다.
- 상세·스트림은 한 번에 최대 40개씩 가져온다.
- Strava 429 응답을 만나면 다음 상세 배치를 15분 뒤로 미룬다.
- 상세 수집이 세 배치 연속 전혀 진행되지 않으면 무한 작업 생성을 멈추고, 수집된 데이터로 기록을 다시 계산한 뒤 경고 상태를 남긴다.
- 원본 스트림은 gzip 객체, 조회용 메타데이터는 Firestore 문서로 저장한다.
- Cloud Run 파일 시스템에는 영구 데이터를 쓰지 않는다.

로그 확인:

```bash
gcloud run services logs read runasis --region=us-west1 --limit=100
gcloud tasks queues describe runasis-sync --location=us-west1
```

## 예상 비용

현재 약 100 MiB의 개인 데이터와 수동 동기화 빈도라면 보통 월 `US$0`에 가깝고, 무료 한도를 조금 벗어나도 센트 단위일 가능성이 높다.

- Cloud Run은 최소 인스턴스가 0이며 요청 처리 시간만 과금된다.
- 기본 Firestore 한 곳은 1 GiB 저장, 일 50,000 읽기와 20,000 쓰기까지 무료 할당량이 있다.
- `us-west1` Standard Cloud Storage는 월 5 GB와 일정 작업량의 Always Free 대상이다.
- Cloud Tasks는 월 첫 100만 작업이 무료다.
- 소스 배포 시 Cloud Build와 Artifact Registry 사용량은 별도이며, 이미지가 누적되면 소액이 생길 수 있다.
- Vercel 요금은 선택한 플랜과 트래픽에 따른다.

가격과 무료 한도는 바뀔 수 있으므로 실제 배포 시 [Cloud Run pricing](https://cloud.google.com/run/pricing), [Firestore pricing](https://cloud.google.com/firestore/pricing), [Cloud Storage pricing](https://cloud.google.com/storage/pricing), [Cloud Tasks pricing](https://cloud.google.com/tasks/pricing)을 다시 확인한다.

예산 알림은 결제를 막는 상한이 아니므로 낮은 금액의 Billing Budget 알림을 별도로 설정하는 것이 좋다.
