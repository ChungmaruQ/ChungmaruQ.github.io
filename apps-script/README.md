# SenseCraft Office Hours Apps Script

이 폴더는 Mac/Codex 자동화에 의존하지 않고 Google Apps Script가 6시간마다 `sensecraft/status.json`과 `sensecraft/office-hours-live.html`의 내장 상태값을 갱신하게 만드는 버전입니다.

```text
Google Apps Script
  -> Google Calendar 읽기
  -> Mindlogic FactChat API Gateway로 현재 일정 맥락 분류
  -> 휴대폰 위치 웹훅 상태 읽기
  -> GitHub Pages repo의 sensecraft/status.json 업데이트
  -> sensecraft/office-hours-live.html 안의 초기 상태값 업데이트

SenseCraft HMI
  -> GitHub Pages HTML 표시
```

`status.json`과 `office-hours-live.html`은 한 번의 GitHub commit으로 같이 업데이트합니다. 두 파일을 따로 커밋하면 GitHub Pages 배포가 연속으로 시작되어 이전 배포가 취소되거나 `Deployment failed, try again later`가 반복될 수 있기 때문입니다.

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
{"mon":[["09:30","12:00"],["13:00","18:00"]],"tue":[["09:30","12:00"],["13:00","18:00"]],"wed":[["09:30","12:00"],["13:00","18:00"]],"thu":[["09:30","12:00"],["13:00","18:00"]],"fri":[["09:30","12:00"],["13:00","18:00"]],"sat":[],"sun":[]}
```

`LUNCH_BREAK_JSON`은 기본적으로 아래 값과 같습니다. 명시적인 부재/오프사이트/수업/회의/재택 일정이 없고, 그 날짜에 정규 office hours가 있으면 12:00-13:00 동안 `Lunch Break`로 표시하고, `Next Available`은 13:00 이후로 계산합니다. office hours가 없는 휴일에는 자동 `Lunch Break`를 표시하지 않습니다.

```json
{"enabled":true,"start":"12:00","end":"13:00"}
```

`Remote`는 더 이상 “사무실 Wi-Fi가 아니고 일정이 없음”만으로 자동 추론하지 않습니다. 캘린더 제목에 `remote`, `재택`, `원격`, `wfh`, `work from home` 같은 키워드가 있거나, Google Calendar working location이 사무실이 아닌 곳으로 명시될 때만 내부적으로 부재 상태로 판단하고, 화면에는 `Out of Office`로 표시합니다.

`Lunch Break`도 캘린더 제목에 `lunch`, `lunch break`, `점심`, `식사` 같은 키워드가 있으면 해당 일정 시간에 명시적으로 표시할 수 있습니다.

Mindlogic FactChat API Gateway 분류기는 아래 값으로 켭니다.

```text
LLM_PROVIDER=mindlogic
LLM_ENABLED=true
LLM_MAX_EVENTS=3
LLM_DAILY_MAX_EVENTS=8
MINDLOGIC_API_KEY=동국 AI CHAT 서비스 API key
MINDLOGIC_BASE_URL=https://factchat-cloud.mindlogic.ai/v1/gateway
MINDLOGIC_MODEL=접근 가능한 모델 ID
```

Mindlogic 문서 기준으로 Gateway는 OpenAI 호환 Chat Completions를 지원하며, 기본 Base URL은 `https://factchat-cloud.mindlogic.ai/v1/gateway`, 인증은 `Authorization: Bearer YOUR_API_KEY` 방식입니다. 이 스크립트는 `/chat/completions/`를 호출합니다.

Daily mode에서는 오늘 일정의 제목/장소/시간/종일 여부를 LLM API에 보내고, 모델이 하루 상태를 `office`, `scheduled`, `away`, `campus`, `closed` 중 하나로 고릅니다. 예를 들어 `한의학연구원 방문`처럼 키워드 목록에 정확히 없더라도 외부 기관 방문 맥락이면 `away`로 판단합니다. 최종 공개 JSON에는 일정 제목, 장소, Mindlogic API key가 들어가지 않습니다. LLM 호출이 실패하면 기존 키워드/장소/오피스아워 규칙으로 자동 fallback합니다.

LLM API 연결을 확인하려면 Apps Script 편집기에서 `testLlmConnection`을 실행합니다. 로그에 `ok: true`, `code: 200`, `classification.day_status: "away"`가 나오면 정상입니다. API key는 로그에 출력하지 않습니다.

`permission_denied - No access to Model ...` 또는 `code: 403`이 나오면 API key는 인식됐지만 해당 모델 권한이 없는 상태입니다. `listMindlogicModels`를 실행해 접근 가능한 모델 ID가 나오는지 확인한 뒤, Script Properties의 `MINDLOGIC_MODEL`을 그 값으로 바꿉니다.

화면에 표시되는 현재 상태는 혼선을 줄이기 위해 아래 여섯 가지로 압축합니다.

```text
In Office
Out of Office
On Campus
In a Meeting
In Class
Lunch Break
```

내부적으로는 출장, 재택, 휴가 등을 계속 구분해 계산하지만, 문 앞 화면에는 위 여섯 상태 중 하나로만 표시합니다. Focus Time은 별도 상태로 표시하지 않습니다.

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

## 4. 6시간마다 자동 실행

`installSixHourlyTrigger` 함수를 한 번 실행합니다.

이후 Apps Script가 6시간마다 `refreshSenseCraftJson`을 실행합니다. Mac이 꺼져 있어도 Apps Script 쪽에서 동작합니다. 기존 `installQuarterHourlyTrigger` 또는 `installHourlyTrigger`를 실행해도 이제 같은 6시간 트리거로 맞춰집니다.

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
  "presence": "campus"
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

브라우저 주소창이나 북마크에서 직접 상태를 바꾸고 싶으면 같은 Web app URL에 쿼리 파라미터를 붙여 `GET`으로 호출할 수 있습니다.

```text
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?secret=LOCATION_WEBHOOK_SECRET값&presence=office
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?secret=LOCATION_WEBHOOK_SECRET값&presence=campus
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?secret=LOCATION_WEBHOOK_SECRET값&presence=away
```

브라우저 주소는 방문 기록에 남을 수 있으니, 이 방식은 개인 기기에서만 쓰는 것을 권장합니다. 상태만 저장하고 즉시 GitHub Pages를 갱신하지 않으려면 `&publish=false`를 붙이면 됩니다.

`presence`는 `office`, `campus`, `away`를 지원합니다. `office`는 사무실 Wi-Fi에 연결된 상태, `campus`는 캠퍼스 안이지만 사무실 Wi-Fi에서 벗어난 상태, `away`는 5km 밖처럼 캠퍼스 밖인 상태로 쓰면 됩니다.

`away` presence는 오늘 더 이상 사무실로 돌아오지 않는 상태로 봅니다. `Next Available`은 오늘 남은 시간을 건너뛰고, 내일 이후 캘린더 일정, 점심시간, office hours를 기준으로 가장 가까운 방문 가능 시간을 계산합니다. `campus` presence는 캠퍼스 안에서 잠시 자리를 비운 상태로 보고, 화면에는 `On Campus` / `Back soon.` / `Soon`으로 표시합니다.

`OFFICE_EXIT_GRACE_MINUTES`는 사무실 Wi-Fi가 잠깐 끊겼을 때 바로 `On Campus`로 바뀌지 않게 하는 유예시간입니다. 기본값은 `5`분입니다. `office`에서 `campus`로 바뀐 직후 이 시간 안에는 계속 `In Office`로 해석하고, 그 이후에도 `campus` 상태가 유지되면 `On Campus`로 표시합니다. `campus -> office`와 `office/campus -> away`는 유예 없이 즉시 반영합니다.

`office` presence가 최근 상태로 남아 있으면 정규 office hours 이후에도, 명시적인 회의/수업/부재 일정이 없는 한 `Available`로 표시합니다.

정규 office hours 자체만으로는 `In Office`가 되지 않습니다. `In Office`는 최근 presence가 `office`일 때만 표시합니다.

정규 office hours 안에서 `office` presence가 잡히면 캘린더의 외부/부재/재택 같은 위치성 상태보다 우선해서 `Available`로 표시합니다. 일정이 바뀌어서 실제로 사무실에 돌아온 상황을 반영하기 위한 규칙입니다. 단, 수업/회의/Busy처럼 실제 응대가 어려운 일정은 Wi-Fi가 잡혀도 그대로 유지합니다.

정규 office hours 안에서 사무실 Wi-Fi가 끊긴 상태이지만 5km 반경 안이면 `On Campus`로 표시합니다. 원격/재택 상태를 명시하려면 캘린더 일정 제목에 `remote`, `재택`, `원격` 등을 적고, 화면에는 `Out of Office`로 표시합니다.

좌표를 보내면 Apps Script가 `OFFICE_LAT`, `OFFICE_LNG`, `OFFICE_RADIUS_KM` 기준으로 `office` 또는 `away`를 판단합니다. 좌표와 함께 `"presence": "campus"`를 보내면 반경 안에서는 `campus`로 저장되고, 반경 밖이면 `away`로 저장됩니다. 좌표 자체는 저장하지 않고, 최종 상태와 대략적인 거리만 Script Properties에 남깁니다.

웹훅 호출은 기본적으로 위치 상태만 저장합니다. 위치 변경 직후 `sensecraft/status.json`까지 즉시 다시 발행하고 싶다면 payload에 `"publish": true`를 추가하면 됩니다.

## 6. iPhone Shortcuts / Android 자동화

iPhone Shortcuts에서는 Wi-Fi 또는 위치 기반 개인 자동화를 만들고 `Get Contents of URL`로 Web app URL에 `POST` 요청을 보냅니다.

사무실 Wi-Fi에 연결됐을 때:

```json
{
  "secret": "LOCATION_WEBHOOK_SECRET 값",
  "presence": "office"
}
```

사무실 Wi-Fi 연결이 끊겼을 때:

```json
{
  "secret": "LOCATION_WEBHOOK_SECRET 값",
  "presence": "campus"
}
```

사무실 5km 밖으로 나갔을 때:

```json
{
  "secret": "LOCATION_WEBHOOK_SECRET 값",
  "presence": "away"
}
```

캠퍼스 반경 안으로 돌아왔지만 아직 사무실 Wi-Fi에 연결되지 않았을 때:

```json
{
  "secret": "LOCATION_WEBHOOK_SECRET 값",
  "presence": "campus"
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
