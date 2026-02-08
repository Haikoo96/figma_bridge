# Figma Bridge — Claude Code에서 Figma로 디자인 바로 넣기

Claude Code에서 디자인을 설명하면 Figma에 네이티브 편집 가능한 노드로 바로 생성해주는 로컬 브릿지입니다. 복사-붙여넣기도, 내보내기도 필요 없습니다.

---

## 목차

1. [작동 원리](#작동-원리)
2. [아키텍처 개요](#아키텍처-개요)
3. [디렉토리 구조](#디렉토리-구조)
4. [사전 준비](#사전-준비)
5. [설치 가이드](#설치-가이드)
6. [세션 시작하기](#세션-시작하기)
7. [사용 가능한 도구](#사용-가능한-도구)
8. [디자인 JSON 스키마](#디자인-json-스키마)
9. [예제](#예제)
10. [문제 해결](#문제-해결)
11. [알려진 제한 사항](#알려진-제한-사항)

---

## 작동 원리

```
사용자 (터미널)
    │
    │  "타이틀과 버튼이 있는 카드 만들어줘"
    ▼
┌─────────────┐      stdio       ┌───────────────────┐     WebSocket     ┌──────────────────┐
│ Claude Code  │ ──────────────► │  MCP 서버           │ ──────────────► │  Figma 플러그인 UI │
│ (터미널)      │                 │  (Node.js)         │   port 9876     │  (ui.html)        │
│              │ ◄────────────── │  figma-bridge-mcp/ │ ◄────────────── │                   │
└─────────────┘   도구 결과       └───────────────────┘   ack 메시지      └────────┬──────────┘
                                                                                 │
                                                                        postMessage
                                                                                 │
                                                                                 ▼
                                                                        ┌──────────────────┐
                                                                        │  Figma 플러그인    │
                                                                        │  메인 스레드       │
                                                                        │  (code.js)        │
                                                                        │                   │
                                                                        │  네이티브 Figma    │
                                                                        │  노드 생성         │
                                                                        └──────────────────┘
```

**흐름을 쉽게 설명하면:**

1. Claude Code에 디자인 생성을 요청합니다.
2. Claude Code가 JSON 디자인 트리를 담아 `push_to_figma` MCP 도구를 호출합니다.
3. **MCP 서버** (`server.js`)가 stdio로 호출을 받아 포트 `9876`의 **WebSocket**을 통해 디자인 데이터를 전달합니다.
4. **Figma 플러그인 UI** (`ui.html`)가 WebSocket 메시지를 받아 `postMessage`로 **플러그인 메인 스레드** (`code.js`)에 전달합니다.
5. **플러그인 메인 스레드**가 JSON을 읽고 실제 Figma 노드(프레임, 텍스트, 사각형, 타원 등)를 오토레이아웃, 채우기, 스트로크 등 모든 속성과 함께 생성합니다.
6. 완료 확인(ack)이 같은 경로를 통해 돌아옵니다.

---

## 아키텍처 개요

브릿지는 서로 통신하는 **두 개의 독립 컴포넌트**로 구성됩니다:

### 컴포넌트 1: MCP 서버 (`figma-bridge-mcp/`)

- Claude Code가 자동으로 실행하는 Node.js 프로세스입니다.
- **stdio** (표준 MCP 프로토콜)를 통해 Claude Code와 통신합니다.
- Figma 플러그인이 접속하는 **포트 9876의 WebSocket 서버**를 엽니다.
- 세 가지 도구를 제공합니다: `push_to_figma`, `push_svg_to_figma`, `get_status`.

### 컴포넌트 2: Figma 플러그인 (`figma-bridge-plugin/`)

- Figma Desktop에 임포트하는 로컬 개발용 플러그인입니다.
- 두 부분으로 구성됩니다:
  - **`ui.html`** — `ws://localhost:9876`에 WebSocket 연결을 여는 iframe. 네트워크 레이어 역할을 합니다 (Figma 메인 스레드는 직접 네트워크 요청을 할 수 없습니다).
  - **`code.js`** — Figma API에 접근하는 플러그인 메인 스레드. UI로부터 디자인 데이터를 받아 네이티브 Figma 노드를 생성합니다.

---

## 디렉토리 구조

```
figma-bridge/
├── .mcp.json                        # Claude Code에 MCP 서버 등록
├── figma-bridge-mcp/                # MCP 서버 (Node.js)
│   ├── server.js                    # 메인 서버 — stdio + WebSocket
│   ├── package.json                 # 의존성 패키지
│   └── node_modules/                # 설치된 패키지
└── figma-bridge-plugin/             # Figma 플러그인
    ├── manifest.json                # 플러그인 메타데이터 및 권한
    ├── code.js                      # 메인 스레드 — Figma 노드 생성
    └── ui.html                      # UI iframe — WebSocket 연결
```

---

## 사전 준비

- **Node.js** (v18 이상)
- **Figma Desktop 앱** (브라우저 버전은 로컬 개발 플러그인을 실행할 수 없습니다)
- **Claude Code** CLI 설치 및 정상 작동 확인

---

## 설치 가이드

### 1단계: MCP 서버 의존성 설치

```bash
cd figma-bridge/figma-bridge-mcp
npm install
```

설치되는 패키지:
- `@modelcontextprotocol/sdk` — MCP 프로토콜 SDK
- `ws` — WebSocket 라이브러리
- `zod` — 스키마 검증

### 2단계: MCP 설정 확인

루트 디렉토리의 `.mcp.json` 파일이 Claude Code에 MCP 서버 실행 방법을 알려줍니다. 다음 내용이 있어야 합니다:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": ["figma-bridge-mcp/server.js"]
    }
  }
}
```

`figma-bridge/` 디렉토리에서 Claude Code를 시작하면 자동으로 읽습니다. 수동으로 서버를 시작할 필요가 없습니다.

### 3단계: Figma 플러그인 임포트

1. **Figma Desktop**을 엽니다.
2. 작업할 Figma 파일을 엽니다.
3. 메뉴에서: **Plugins > Development > Import plugin from manifest...**
4. 다음 파일을 선택합니다:
   ```
   figma-bridge/figma-bridge-plugin/manifest.json
   ```
5. **Plugins > Development** 아래에 "Figma Bridge" 플러그인이 나타납니다.

> **참고:** manifest 임포트는 한 번만 하면 됩니다. Figma가 세션 간에 기억합니다. 플러그인 파일을 수정하면 플러그인을 다시 실행할 때 자동으로 변경 사항이 반영됩니다.

### 4단계: 플러그인 manifest 확인

`manifest.json`에 WebSocket 연결을 위한 네트워크 접근 권한이 포함되어야 합니다:

```json
{
  "name": "Figma Bridge",
  "id": "figma-bridge-local-dev",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "capabilities": [],
  "enableProposedApi": false,
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": ["none"],
    "reasoning": "Connects to local MCP bridge server via WebSocket",
    "devAllowedDomains": [
      "ws://localhost:9876"
    ]
  }
}
```

**중요한 세부 사항:**
- localhost 접근에는 `allowedDomains`가 아닌 `devAllowedDomains`를 사용해야 합니다.
- `ws://` 스킴이 반드시 포함되어야 합니다 — `localhost`만 쓰면 manifest 오류가 발생합니다.
- 프로덕션 도메인이 없으므로 `allowedDomains`는 `["none"]`으로 설정합니다.

---

## 세션 시작하기

브릿지를 사용할 때마다 다음 순서를 따르세요:

### 1. Claude Code 시작

```bash
cd figma-bridge
claude
```

Claude Code가 `.mcp.json`을 읽고 MCP 서버 (`server.js`)를 자동으로 시작합니다. 이때 포트 `9876`의 WebSocket 서버도 함께 시작됩니다.

### 2. Figma 플러그인 실행

Figma Desktop에서:
1. 대상 Figma 파일을 엽니다.
2. 디자인을 넣고 싶은 **페이지**로 이동합니다.
3. 플러그인 실행: **Plugins > Development > Figma Bridge**
4. 작은 플러그인 창이 나타나며 연결 상태를 표시합니다:
   - **초록색 점** = 연결됨 (디자인 수신 준비 완료)
   - **노란색 점** = 연결 중...
   - **빨간색 점** = 연결 끊김 (MCP 서버가 실행 중이 아님)

### 3. 연결 확인

Claude Code에서 연결 상태를 확인할 수 있습니다:

```
> Figma bridge 연결 상태 확인해줘
```

Claude가 `get_status`를 호출하여 플러그인 연결 여부를 알려줍니다.

### 순서가 중요합니다!

| Claude Code를 먼저 시작 | 그 다음 Figma 플러그인 실행 |
|---|---|
| WebSocket 서버(포트 9876)가 준비되려면 MCP 서버가 먼저 실행 중이어야 합니다. | 플러그인 UI가 실행 시 `ws://localhost:9876`에 접속합니다. 서버가 없으면 3초마다 재시도합니다. |

---

## 사용 가능한 도구

### `push_to_figma`

구조화된 JSON 디자인 트리를 Figma에 푸시합니다. 오토레이아웃이 완전 지원되는 **네이티브 편집 가능한** Figma 노드(프레임, 텍스트, 사각형 등)를 생성합니다.

**입력:** 디자인 트리를 설명하는 JSON 문자열.

**결과물:** 직접 만든 것과 동일하게 선택, 편집, 크기 조절, 인스펙트가 가능한 실제 Figma 노드.

### `push_svg_to_figma`

SVG 마크업을 Figma에 단일 벡터 노드로 푸시합니다.

**입력:**
- `svg` — SVG 마크업 문자열
- `name` (선택) — Figma에서의 노드 이름

**장단점:** 빠르고 간단하지만, 결과물이 하나의 플래튼된 벡터여서 개별 레이어로 편집할 수 없습니다.

### `get_status`

Figma 플러그인의 현재 연결 상태를 확인합니다.

**반환값:** "connected and ready" 또는 "NOT connected."

---

## 디자인 JSON 스키마

`push_to_figma` 도구는 노드의 JSON 트리를 받습니다. 모든 노드는 `type`과 선택적 속성을 가집니다.

### 노드 타입

| 타입 | 설명 | Figma 대응 |
|------|------|-----------|
| `FRAME` | 오토레이아웃 지원 컨테이너 | Frame |
| `TEXT` | 텍스트 레이어 | Text |
| `RECTANGLE` | 사각형 도형 | Rectangle |
| `ELLIPSE` | 원 / 타원 도형 | Ellipse |
| `SVG` | 인라인 SVG (트리 내) | Vector 그룹 |

### 공통 속성 (모든 노드 타입)

| 속성 | 타입 | 설명 |
|------|------|------|
| `name` | string | Figma에서의 레이어 이름 |
| `width` | number / `"FILL"` / `"HUG"` | px 너비, 또는 부모 채우기, 또는 콘텐츠 맞춤 |
| `height` | number / `"FILL"` / `"HUG"` | px 높이, 또는 부모 채우기, 또는 콘텐츠 맞춤 |
| `fill` | string | 16진수 색상, 예: `"#FF5500"` |
| `opacity` | number | 0 ~ 1 |
| `stroke` | object | `{ color: "#hex", weight: number, align: "INSIDE"/"OUTSIDE"/"CENTER" }` |
| `strokeDashes` | array | 대시 패턴, 예: `[4, 4]` |
| `x` | number | X 좌표 (절대 위치 지정 시에만) |
| `y` | number | Y 좌표 (절대 위치 지정 시에만) |

### FRAME 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `layoutMode` | `"VERTICAL"` / `"HORIZONTAL"` | 오토레이아웃 방향 |
| `padding` | 배열 또는 숫자 | `[위, 오른쪽, 아래, 왼쪽]` 또는 균일 패딩 |
| `itemSpacing` | number | 자식 요소 간 간격 |
| `primaryAxisAlignItems` | `"MIN"` / `"CENTER"` / `"MAX"` / `"SPACE_BETWEEN"` | 주축 정렬 |
| `counterAxisAlignItems` | `"MIN"` / `"CENTER"` / `"MAX"` | 교차축 정렬 |
| `primaryAxisSizingMode` | `"FIXED"` / `"AUTO"` | 주축 크기 조절 |
| `counterAxisSizingMode` | `"FIXED"` / `"AUTO"` | 교차축 크기 조절 |
| `cornerRadius` | number | 모서리 반경 (px) |
| `clipsContent` | boolean | 오버플로 클리핑 |
| `children` | array | 자식 노드 |

### TEXT 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `content` | string | 텍스트 문자열 |
| `fontSize` | number | 폰트 크기 (px) |
| `fontFamily` | string | 폰트 패밀리, 예: `"Inter"` |
| `fontWeight` | string | 굵기: `"Regular"`, `"Medium"`, `"SemiBold"`, `"Bold"`, 또는 숫자 `"400"`-`"900"` |
| `textAlignHorizontal` | `"LEFT"` / `"CENTER"` / `"RIGHT"` / `"JUSTIFIED"` | 수평 정렬 |
| `textAlignVertical` | `"TOP"` / `"CENTER"` / `"BOTTOM"` | 수직 정렬 |
| `textAutoResize` | `"WIDTH_AND_HEIGHT"` / `"HEIGHT"` / `"NONE"` | 텍스트 박스 리사이즈 방식 |
| `lineHeight` | number | 줄 높이 배수 (예: `1.5` = 150%) |

### 크기 값 설명

| 값 | 의미 | Figma 대응 |
|----|------|-----------|
| `375` (숫자) | 고정 너비/높이 (px) | Fixed size |
| `"FILL"` | 부모 크기에 맞게 늘리기 | Fill container |
| `"HUG"` | 콘텐츠에 맞게 줄이기 | Hug contents |

---

## 예제

### 간단한 카드

```json
{
  "type": "FRAME",
  "name": "Card",
  "width": 327,
  "height": "HUG",
  "fill": "#F6F7F8",
  "cornerRadius": 16,
  "layoutMode": "VERTICAL",
  "padding": [20, 20, 20, 20],
  "itemSpacing": 8,
  "children": [
    {
      "type": "TEXT",
      "content": "카드 제목",
      "fontSize": 18,
      "fontWeight": "Bold",
      "fill": "#1A1A1A",
      "textAutoResize": "WIDTH_AND_HEIGHT"
    },
    {
      "type": "TEXT",
      "content": "여기에 설명 텍스트가 들어갑니다.",
      "fontSize": 14,
      "fontWeight": "Regular",
      "fill": "#6B7280",
      "textAutoResize": "WIDTH_AND_HEIGHT"
    }
  ]
}
```

### 버튼

```json
{
  "type": "FRAME",
  "name": "Button",
  "width": 200,
  "height": 48,
  "fill": "#333333",
  "cornerRadius": 12,
  "layoutMode": "HORIZONTAL",
  "primaryAxisAlignItems": "CENTER",
  "counterAxisAlignItems": "CENTER",
  "children": [
    {
      "type": "TEXT",
      "content": "시작하기",
      "fontSize": 14,
      "fontWeight": "SemiBold",
      "fill": "#FFFFFF",
      "textAutoResize": "WIDTH_AND_HEIGHT"
    }
  ]
}
```

### 모바일 화면 레이아웃

```json
{
  "type": "FRAME",
  "name": "Mobile Screen",
  "width": 375,
  "height": 812,
  "fill": "#FFFFFF",
  "layoutMode": "VERTICAL",
  "padding": [60, 24, 24, 24],
  "itemSpacing": 16,
  "clipsContent": true,
  "children": [
    {
      "type": "TEXT",
      "content": "화면 제목",
      "fontSize": 24,
      "fontWeight": "Bold",
      "fill": "#1A1A1A",
      "textAutoResize": "WIDTH_AND_HEIGHT"
    },
    {
      "type": "FRAME",
      "name": "Card",
      "width": "FILL",
      "height": "HUG",
      "fill": "#F6F7F8",
      "cornerRadius": 16,
      "layoutMode": "VERTICAL",
      "padding": [16, 16, 16, 16],
      "itemSpacing": 8,
      "children": [
        {
          "type": "TEXT",
          "content": "카드 내용이 여기에 들어갑니다",
          "fontSize": 14,
          "fill": "#2D2D2D",
          "textAutoResize": "WIDTH_AND_HEIGHT"
        }
      ]
    }
  ]
}
```

### SVG 푸시

빠른 벡터 그래픽은 `push_svg_to_figma`를 사용하세요:

```xml
<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" stroke="#333" stroke-width="2"/>
  <path d="M8 12l3 3 5-5" stroke="#333" stroke-width="2" stroke-linecap="round"/>
</svg>
```

---

## 문제 해결

### "An error occurred while running this plugin" 오류

**원인:** `code.js`의 문법 오류일 가능성이 높습니다.

Figma 플러그인 샌드박스는 구버전 JavaScript 파서를 사용합니다. 지원되지 않을 수 있는 최신 문법을 피하세요:
- `catch {` 대신 `catch (e) {`를 사용하세요 (optional catch binding 미지원).
- 일부 경우 optional chaining (`foo?.bar`)을 피하세요.
- 브라우저 콘솔 (Figma 우클릭 > Inspect > Console)에서 정확한 오류를 확인하세요.

### 빨간 점 / "Disconnected" 표시

**원인:** MCP 서버가 실행 중이 아니어서 포트 9876의 WebSocket이 사용 불가합니다.

**해결:**
1. `figma-bridge/` 디렉토리에서 Claude Code가 실행 중인지 확인하세요.
2. WebSocket 서버가 리스닝 중인지 확인:
   ```bash
   lsof -i :9876
   ```
3. 아무것도 리스닝하지 않으면 Claude Code를 재시작하세요. MCP 서버가 자동 시작됩니다.

### manifest 오류: "Invalid value for allowedDomains"

**원인:** `networkAccess` 필드가 잘못 설정되었습니다.

**규칙:**
- localhost 도메인은 `allowedDomains`가 아닌 `devAllowedDomains`에 넣으세요.
- 스킴과 포트가 필수입니다: `localhost`나 `ws://localhost`가 아닌 `ws://localhost:9876`를 사용하세요.
- 유효한 스킴: `http://`, `https://`, `ws://`, `wss://`.

### 디자인 푸시 시 "Figma plugin is NOT connected" 오류

**원인:** Figma 플러그인이 실행 중이 아니거나 WebSocket 연결이 끊어졌습니다.

**해결:**
1. Figma에서 플러그인 실행: **Plugins > Development > Figma Bridge**.
2. 초록색 "Connected" 점이 나타날 때까지 기다리세요.
3. 노란색/빨간색 상태가 계속되면, 포트 9876을 다른 프로세스가 사용 중이 아닌지 확인하세요.

### 디자인을 푸시했는데 Figma에 아무것도 안 보임

**가능한 원인:**
- 화면 밖에 생성되었을 수 있습니다. Figma에서 `Cmd+Shift+1` (전체 보기)을 사용하세요.
- 플러그인 로그 패널에서 오류 메시지를 확인하세요.
- JSON 구조가 잘못되었을 수 있습니다. 루트 노드에 `type` 필드가 있는지 확인하세요.

### 폰트가 제대로 렌더링되지 않음

요청한 폰트를 사용할 수 없으면 플러그인이 **Inter Regular**로 폴백합니다. 커스텀 폰트를 사용하려면:
1. 시스템에 해당 폰트가 설치되어 있는지 확인하세요.
2. 정확한 Figma 스타일 이름을 사용하세요 (예: `"Semi Bold"`가 아닌 `"SemiBold"`).

---

## 알려진 제한 사항

- **단방향 전용:** 브릿지는 Figma *로* 디자인을 푸시만 합니다. 기존 Figma 노드를 읽거나 수정할 수 없습니다.
- **이미지 채우기 미지원:** 현재 단색 채우기만 지원합니다. 이미지 채우기, 그라디언트, 이펙트(그림자, 블러)는 아직 지원되지 않습니다.
- **단일 연결:** 한 번에 하나의 Figma 플러그인 인스턴스만 연결할 수 있습니다. 여러 Figma 파일이 열려 있어도 플러그인을 실행한 파일만 디자인을 받습니다.
- **로컬 전용:** WebSocket이 `localhost`에서 실행됩니다. Claude Code와 Figma가 다른 컴퓨터에 있으면 작동하지 않습니다.
- **개발용 플러그인:** `devAllowedDomains`를 사용하므로 (`allowedDomains` 아님), 개발 플러그인으로 임포트했을 때만 작동합니다. 현재 형태로는 Figma Community에 게시할 수 없습니다.
- **30초 타임아웃:** Figma 플러그인이 30초 내에 푸시된 디자인을 확인하지 않으면 요청이 타임아웃됩니다. 노드가 많거나 폰트 로딩이 무거운 복잡한 디자인은 가끔 이 제한에 걸릴 수 있습니다.

---

## 빠른 참조

| 항목 | 위치 |
|------|------|
| MCP 서버 설정 | `.mcp.json` |
| MCP 서버 코드 | `figma-bridge-mcp/server.js` |
| MCP 서버 의존성 | `figma-bridge-mcp/package.json` |
| Figma 플러그인 manifest | `figma-bridge-plugin/manifest.json` |
| Figma 플러그인 로직 | `figma-bridge-plugin/code.js` |
| Figma 플러그인 UI/네트워크 | `figma-bridge-plugin/ui.html` |
| WebSocket 포트 | `9876` |
| 지원 노드 타입 | FRAME, TEXT, RECTANGLE, ELLIPSE, SVG |
