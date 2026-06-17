# SenseCraft Office Hours Apps Script

이 폴더는 Mac/Codex 자동화에 의존하지 않고 Google Apps Script가 15분마다 `sensecraft/status.json`과 `sensecraft/office-hours-live.html`의 내장 상태값을 갱신하게 만드는 버전입니다.

```text
Google Apps Script
  -> Google Calendar 읽기
  -> Mindlogic FactChat API Gateway로 현재 일정 맥락 분류
  -> Seeed 배터리 API 읽기
  -> 휴대폰 위치 웹훅 상태 읽기
  -> GitHub Pages repo의 sensecraft/status.json 업데이트
  -> sensecraft/office-hours-live.html 안의 초기 상태값 업데이트

SenseCraft HMI
  -> GitHub Pages HTML 표시
```

## 1. Apps Script 프로젝트 만들기

1. <https://script.google.com/> 에서 새 프로젝트를 만듭니다.
2. `Code.gs` 내용을 Apps Script 편집기의 `Code.gs`에 붙여넣습니다.
3. 프로젝트 설정에서 `appsscript.json` 표시를 켭니다.
4. `appsscript.json` 내용을 이 폴더의 `appsscript.json`과 같게 바꿉니다.

## 2. Script Properties 설정

Apps Script 왼쪽 `Project Settings` -> `Script properties`에 `script-properties.example.json`의 값을 하나씩 넣습니다.

반드시 실제 값으로 바꿀 항목:

```text
GITHUB_TOKEN
SEEED_BATTERY_API_KEY
MINDLOGIC_API_KEY
LOCATION_WEBHOOK_SECRET
OFFICE_LAT
OFFICE_LNG
```

GitHub token은 fine-grained personal access token을 추천합니다.

```text
Repository access: ChungmaruQ/ChungmaruQ.github.io
Repository permissions: Contents = Read and write
```

SenseCraft 프리뷰에서 빈 화면이 뜨는 빈도를 줄이기 위해 상태 JSON은 HTML과 같은 GitHub Pages 도메인에 둡니다. Script Properties의 GitHub 관련 값은 아래처럼 맞춥니다.

```text
GITHUB_OWNER=ChungmaruQ
GITHUB_REPO=ChungmaruQ.github.io
GITHUB_BRANCH=main
GITHUB_PATH=sensecraft/status.json
GITHUB_LIVE_HTML_PATH=sensecraft/office-hours-live.html
```

`OFFICE_LAT`, `OFFICE_LNG`는 사무실 기준 좌표입니다. 정확한 좌표가 필요하면 Google Maps에서 사무실 위치를 우클릭해서 복사하면 됩니다.

`OFFICE_HOURS_JSON`은 Script Properties에 아래처럼 원본 JSON으로 넣습니다. 바깥 따옴표나 `\"` 같은 백슬래시는 넣지 않습니다.

```json
{"mon":[["09:30","12:00"],["13:00","17:00"]],"tue":[["09:30","12:00"],["13:00","17:00"]],"wed":[["09:30","12:00"],["13:00","17:00"]],"thu":[["09:30","12:00"],["13:00","17:00"]],"fri":[["09:30","12:00"],["13:00","17:00"]],"sat":[],"sun":[]}
```

`FOCUS_TIME_JSON`은 기본적으로 아래 값과 같습니다. 부재/오프사이트/회의 등 현재 일정을 막는 항목이 없으면 10:00-12:00 동안 `Focus Time`으로 표시합니다.

```json
{"enabled":true,"start":"10:00","end":"12:00"}
```

Mindlogic FactChat API Gateway 분류기는 아래 값으로 켭니다.

```text
LLM_PROVIDER=mindlogic
LLM_ENABLED=true
LLM_MAX_EVENTS=3
MINDLOGIC_API_KEY=동국 AI CHAT 서비스 API key
MINDLOGIC_BASE_URL=https://factchat-cloud.mindlogic.ai/v1/gateway
MINDLOGIC_MODEL=claude-sonnet-4-6
```

Mindlogic 문서 기준으로 Gateway는 OpenAI 호환 Chat Completions를 지원하며, 기본 Base URL은 `https://factchat-cloud.mindlogic.ai/v1/gateway`, 인증은 `Authorization: Bearer YOUR_API_KEY` 방식입니다. 이 스크립트는 `/chat/completions/`를 호출합니다.

Apps Script는 현재 겹치는 일정의 제목/장소/시간만 LLM API에 보내고, 모델은 `state`, `detail_kind`, `event_id`만 고릅니다. 최종 공개 JSON에는 일정 제목, 장소, Mindlogic API key가 들어가지 않습니다. LLM 호출이 실패하면 기존 키워드/장소/오피스아워 규칙으로 자동 fallback합니다.

OpenAI API로 되돌리고 싶으면 아래 값을 대신 넣으면 됩니다.

```text
LLM_PROVIDER=openai
OPENAI_API_KEY=OpenAI API key
OPENAI_MODEL=gpt-5.5
```

## 3. 최초 실행

Apps Script 편집기에서 함수 선택을 `previewSenseCraftJson`으로 바꾼 뒤 실행합니다.

처음 실행할 때 Google Calendar 읽기, 외부 요청 권한을 승인해야 합니다. 로그에 표시용 JSON이 나오면 정상입니다.

이 버전은 Apps Script 내장 `CalendarApp`으로 캘린더를 읽습니다. 그래서 Google Cloud Console에서 Calendar API를 따로 활성화하지 않아도 됩니다. Cloud Console에서 `액세스 요청`이 나오면 무시하고, 최신 `Code.gs`를 다시 붙여넣은 뒤 실행하세요.

그 다음 `refreshSenseCraftJson`을 실행합니다. GitHub의 `ChungmaruQ/ChungmaruQ.github.io` 저장소에 `sensecraft/status.json`과 `sensecraft/office-hours-live.html`이 업데이트되면 성공입니다.

## 4. 15분마다 자동 실행

`installQuarterHourlyTrigger` 함수를 한 번 실행합니다.

이후 Apps Script가 15분마다 `refreshSenseCraftJson`을 실행합니다. Mac이 꺼져 있어도 Apps Script 쪽에서 동작합니다.

## 5. 위치 웹훅 배포

Apps Script에서 `Deploy` -> `New deployment` -> `Web app`을 선택합니다.

```text
Execute as: Me
Who has access: Anyone
```

배포 후 나오는 Web app URL이 휴대폰 자동화에서 호출할 주소입니다.

웹훅은 두 가지 입력을 지원합니다.

직접 상태 전송:

```json
{
  "secret": "LOCATION_WEBHOOK_SECRET 값",
  "presence": "away"
}
```

현재 좌표 전송:

```json
{
  "secret": "LOCATION_WEBHOOK_SECRET 값",
  "latitude": 37.1234,
  "longitude": 127.1234
}
```

좌표를 보내면 Apps Script가 `OFFICE_LAT`, `OFFICE_LNG`, `OFFICE_RADIUS_KM` 기준으로 `office` 또는 `away`를 판단합니다. 좌표 자체는 저장하지 않고, 최종 상태와 대략적인 거리만 Script Properties에 남깁니다.

웹훅 호출은 기본적으로 `sensecraft/status.json`을 즉시 다시 발행합니다. 위치 상태만 저장하고 다음 15분 주기까지 기다리고 싶다면 payload에 `"publish": false`를 추가하면 됩니다.

## 6. iPhone Shortcuts / Android 자동화

iPhone Shortcuts에서는 위치 기반 개인 자동화를 만들고 `Get Contents of URL`로 Web app URL에 `POST` 요청을 보냅니다.

사무실 10km 밖으로 나갔을 때:

```json
{
  "secret": "LOCATION_WEBHOOK_SECRET 값",
  "presence": "away"
}
```

사무실에 돌아왔을 때:

```json
{
  "secret": "LOCATION_WEBHOOK_SECRET 값",
  "presence": "office"
}
```

Android는 Tasker, Automate, Home Assistant Companion App 같은 앱에서 같은 Web app URL로 POST하면 됩니다.

## 7. 공개 JSON

SenseCraft HMI에는 아래 stable URL을 씁니다. 이 HTML은 현재 상태를 자체적으로 한 번 품고 있어서, 기기가 리프레시 순간 한 컷만 잡아도 로딩 화면 대신 마지막 갱신 상태가 먼저 보입니다.

```text
https://chungmaruq.github.io/sensecraft/office-hours-live.html
```

이 HTML은 내장 상태를 먼저 표시한 뒤, 같은 도메인의 공개 JSON을 다시 읽어 최신 상태로 보정합니다.

```text
https://chungmaruq.github.io/sensecraft/status.json
```

공개 JSON에는 일정 제목, GitHub token, Seeed API key, Mindlogic API key, 위치 좌표가 들어가지 않습니다.
