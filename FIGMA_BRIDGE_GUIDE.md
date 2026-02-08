# Figma Bridge — Claude Code to Figma

A local bridge that lets Claude Code push designs directly into Figma as native, editable nodes. No copy-pasting, no exports — just describe what you want and it appears in your Figma file.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Architecture Overview](#architecture-overview)
3. [Directory Structure](#directory-structure)
4. [Prerequisites](#prerequisites)
5. [Setup — Step by Step](#setup--step-by-step)
6. [Starting a Session](#starting-a-session)
7. [Available Tools](#available-tools)
8. [Design JSON Schema](#design-json-schema)
9. [Examples](#examples)
10. [Troubleshooting](#troubleshooting)
11. [Known Limitations](#known-limitations)

---

## How It Works

```
You (in terminal)
    │
    │  "Create a card with a title and button"
    ▼
┌─────────────┐      stdio       ┌───────────────────┐     WebSocket     ┌──────────────────┐
│ Claude Code  │ ──────────────► │  MCP Server        │ ──────────────► │  Figma Plugin UI  │
│ (terminal)   │                 │  (Node.js)         │   port 9876     │  (ui.html)        │
│              │ ◄────────────── │  figma-bridge-mcp/ │ ◄────────────── │                   │
└─────────────┘   tool results   └───────────────────┘   ack messages   └────────┬──────────┘
                                                                                 │
                                                                        postMessage
                                                                                 │
                                                                                 ▼
                                                                        ┌──────────────────┐
                                                                        │  Figma Plugin     │
                                                                        │  Main Thread      │
                                                                        │  (code.js)        │
                                                                        │                   │
                                                                        │  Creates native   │
                                                                        │  Figma nodes      │
                                                                        └──────────────────┘
```

**The flow in plain English:**

1. You ask Claude Code to create a design.
2. Claude Code calls the `push_to_figma` MCP tool with a JSON design tree.
3. The **MCP server** (`server.js`) receives the call via stdio and forwards the design over a **WebSocket** on port `9876`.
4. The **Figma plugin UI** (`ui.html`) receives the WebSocket message and passes it to the **plugin main thread** (`code.js`) via `postMessage`.
5. The **plugin main thread** reads the JSON and creates real Figma nodes — frames, text, rectangles, ellipses — with auto-layout, fills, strokes, and all properties intact.
6. An acknowledgment travels back the same path to confirm success.

---

## Architecture Overview

The bridge consists of **two separate components** that talk to each other:

### Component 1: MCP Server (`figma-bridge-mcp/`)

- A Node.js process that Claude Code launches automatically.
- Communicates with Claude Code via **stdio** (standard MCP protocol).
- Opens a **WebSocket server on port 9876** that the Figma plugin connects to.
- Exposes three tools: `push_to_figma`, `push_svg_to_figma`, and `get_status`.

### Component 2: Figma Plugin (`figma-bridge-plugin/`)

- A local Figma development plugin you import into Figma Desktop.
- Has two parts:
  - **`ui.html`** — An iframe that opens a WebSocket connection to `ws://localhost:9876`. Acts as the network layer (Figma's main thread can't do network requests directly).
  - **`code.js`** — The plugin main thread that has access to the Figma API. Receives design data from the UI and creates native Figma nodes.

---

## Directory Structure

```
figma-bridge/
├── .mcp.json                        # Registers the MCP server with Claude Code
├── figma-bridge-mcp/                # The MCP server (Node.js)
│   ├── server.js                    # Main server — stdio + WebSocket
│   ├── package.json                 # Dependencies
│   └── node_modules/                # Installed packages
└── figma-bridge-plugin/             # The Figma plugin
    ├── manifest.json                # Plugin metadata & permissions
    ├── code.js                      # Main thread — creates Figma nodes
    └── ui.html                      # UI iframe — WebSocket connection
```

---

## Prerequisites

- **Node.js** (v18 or later)
- **Figma Desktop app** (the browser version cannot run local dev plugins)
- **Claude Code** CLI installed and working

---

## Setup — Step by Step

### Step 1: Install MCP Server Dependencies

```bash
cd figma-bridge/figma-bridge-mcp
npm install
```

This installs:
- `@modelcontextprotocol/sdk` — MCP protocol SDK
- `ws` — WebSocket library
- `zod` — Schema validation

### Step 2: Verify the MCP Configuration

The file `.mcp.json` (in the repo root) tells Claude Code to launch the MCP server. It should contain:

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

Claude Code reads this automatically when you start a session in the `figma-bridge/` directory. No manual server start needed.

### Step 3: Import the Figma Plugin

1. Open **Figma Desktop**.
2. Open any Figma file (or the one you want to work in).
3. Go to the menu: **Plugins > Development > Import plugin from manifest...**
4. Navigate to and select:
   ```
   figma-bridge/figma-bridge-plugin/manifest.json
   ```
5. The plugin "Figma Bridge" now appears under **Plugins > Development**.

> **Note:** You only need to import the manifest once. Figma remembers it across sessions. If you edit the plugin files, Figma picks up changes automatically when you re-run the plugin.

### Step 4: Verify the Plugin Manifest

The `manifest.json` must include network access permissions for the WebSocket connection:

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

**Critical details:**
- `devAllowedDomains` (not `allowedDomains`) is required for localhost access.
- The scheme `ws://` must be included — bare `localhost` will cause a manifest error.
- `allowedDomains` is set to `["none"]` since we only need local dev access.

---

## Starting a Session

Every time you want to use the bridge, follow this order:

### 1. Start Claude Code

```bash
cd figma-bridge
claude
```

Claude Code reads `.mcp.json` and automatically starts the MCP server (`server.js`). This also starts the WebSocket server on port `9876`.

### 2. Run the Figma Plugin

In Figma Desktop:
1. Open your target Figma file.
2. Navigate to the **page** where you want designs inserted.
3. Run the plugin: **Plugins > Development > Figma Bridge**
4. A small plugin window appears with a connection status indicator:
   - **Green dot** = Connected (ready to receive designs)
   - **Yellow dot** = Connecting...
   - **Red dot** = Disconnected (MCP server not running)

### 3. Verify the Connection

In Claude Code, you can check the connection:

```
> Check if the Figma bridge is connected
```

Claude will call `get_status` and report whether the plugin is connected.

### Order matters!

| Start Claude Code first | Then run the Figma plugin |
|---|---|
| The MCP server must be running so the WebSocket server on port 9876 is available. | The plugin's UI connects to `ws://localhost:9876` on launch. If the server isn't running, it retries every 3 seconds. |

---

## Available Tools

### `push_to_figma`

Pushes a structured JSON design tree to Figma. Creates **native, editable** Figma nodes (frames, text, rectangles, etc.) with full auto-layout support.

**Input:** A JSON string describing the design tree.

**What gets created:** Real Figma nodes that you can select, edit, resize, and inspect — exactly as if you built them by hand.

### `push_svg_to_figma`

Pushes raw SVG markup to Figma as a single vector node.

**Input:**
- `svg` — SVG markup string
- `name` (optional) — Name for the node in Figma

**Trade-off:** Quick and simple, but the result is a single flattened vector — not editable as individual layers.

### `get_status`

Checks whether the Figma plugin is currently connected.

**Returns:** "connected and ready" or "NOT connected."

---

## Design JSON Schema

The `push_to_figma` tool accepts a JSON tree of nodes. Every node has a `type` and optional properties.

### Node Types

| Type | Description | Figma Equivalent |
|------|-------------|-----------------|
| `FRAME` | Container with optional auto-layout | Frame |
| `TEXT` | Text layer | Text |
| `RECTANGLE` | Rectangle shape | Rectangle |
| `ELLIPSE` | Circle / oval shape | Ellipse |
| `SVG` | Inline SVG (within the tree) | Vector group |

### Common Properties (All Node Types)

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Layer name in Figma |
| `width` | number / `"FILL"` / `"HUG"` | Width in px, or fill-container, or fit-content |
| `height` | number / `"FILL"` / `"HUG"` | Height in px, or fill-container, or fit-content |
| `fill` | string | Hex color, e.g. `"#FF5500"` |
| `opacity` | number | 0 to 1 |
| `stroke` | object | `{ color: "#hex", weight: number, align: "INSIDE"/"OUTSIDE"/"CENTER" }` |
| `strokeDashes` | array | Dash pattern, e.g. `[4, 4]` |
| `x` | number | X position (only for absolute positioning) |
| `y` | number | Y position (only for absolute positioning) |

### FRAME Properties

| Property | Type | Description |
|----------|------|-------------|
| `layoutMode` | `"VERTICAL"` / `"HORIZONTAL"` | Auto-layout direction |
| `padding` | array or number | `[top, right, bottom, left]` or uniform padding |
| `itemSpacing` | number | Gap between children |
| `primaryAxisAlignItems` | `"MIN"` / `"CENTER"` / `"MAX"` / `"SPACE_BETWEEN"` | Main axis alignment |
| `counterAxisAlignItems` | `"MIN"` / `"CENTER"` / `"MAX"` | Cross axis alignment |
| `primaryAxisSizingMode` | `"FIXED"` / `"AUTO"` | Main axis sizing |
| `counterAxisSizingMode` | `"FIXED"` / `"AUTO"` | Cross axis sizing |
| `cornerRadius` | number | Border radius in px |
| `clipsContent` | boolean | Clip overflow |
| `children` | array | Child nodes |

### TEXT Properties

| Property | Type | Description |
|----------|------|-------------|
| `content` | string | The text string |
| `fontSize` | number | Font size in px |
| `fontFamily` | string | Font family name, e.g. `"Inter"` |
| `fontWeight` | string | Weight: `"Regular"`, `"Medium"`, `"SemiBold"`, `"Bold"`, or numeric `"400"`-`"900"` |
| `textAlignHorizontal` | `"LEFT"` / `"CENTER"` / `"RIGHT"` / `"JUSTIFIED"` | Horizontal alignment |
| `textAlignVertical` | `"TOP"` / `"CENTER"` / `"BOTTOM"` | Vertical alignment |
| `textAutoResize` | `"WIDTH_AND_HEIGHT"` / `"HEIGHT"` / `"NONE"` | How the text box resizes |
| `lineHeight` | number | Line height as a multiplier (e.g. `1.5` = 150%) |

### Size Values Explained

| Value | Meaning | Figma Equivalent |
|-------|---------|-----------------|
| `375` (number) | Fixed width/height in pixels | Fixed size |
| `"FILL"` | Stretch to fill parent | Fill container |
| `"HUG"` | Shrink to fit contents | Hug contents |

---

## Examples

### Simple Card

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
      "content": "Card Title",
      "fontSize": 18,
      "fontWeight": "Bold",
      "fill": "#1A1A1A",
      "textAutoResize": "WIDTH_AND_HEIGHT"
    },
    {
      "type": "TEXT",
      "content": "Some description text goes here.",
      "fontSize": 14,
      "fontWeight": "Regular",
      "fill": "#6B7280",
      "textAutoResize": "WIDTH_AND_HEIGHT"
    }
  ]
}
```

### Button

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
      "content": "Get Started",
      "fontSize": 14,
      "fontWeight": "SemiBold",
      "fill": "#FFFFFF",
      "textAutoResize": "WIDTH_AND_HEIGHT"
    }
  ]
}
```

### Mobile Screen Layout

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
      "content": "Screen Title",
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
          "content": "Card content here",
          "fontSize": 14,
          "fill": "#2D2D2D",
          "textAutoResize": "WIDTH_AND_HEIGHT"
        }
      ]
    }
  ]
}
```

### Pushing SVG

For quick vector graphics, use `push_svg_to_figma`:

```xml
<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" stroke="#333" stroke-width="2"/>
  <path d="M8 12l3 3 5-5" stroke="#333" stroke-width="2" stroke-linecap="round"/>
</svg>
```

---

## Troubleshooting

### Plugin shows "An error occurred while running this plugin"

**Likely cause:** Syntax error in `code.js`.

Figma's plugin sandbox uses an older JavaScript parser. Avoid modern syntax that may not be supported:
- Use `catch (e) {` instead of `catch {` (optional catch binding is not supported).
- Avoid optional chaining in some cases (`foo?.bar`).
- Check the browser console (right-click Figma > Inspect > Console) for the exact error.

### Plugin shows red dot / "Disconnected"

**Cause:** The MCP server isn't running, so the WebSocket on port 9876 isn't available.

**Fix:**
1. Make sure Claude Code is running from the `figma-bridge/` directory.
2. Check if the WebSocket server is listening:
   ```bash
   lsof -i :9876
   ```
3. If nothing is listening, restart Claude Code. The MCP server starts automatically.

### Manifest error: "Invalid value for allowedDomains"

**Cause:** The `networkAccess` field is misconfigured.

**Rules:**
- Localhost domains go in `devAllowedDomains`, not `allowedDomains`.
- A scheme is required: use `ws://localhost:9876`, not just `localhost`.
- Valid schemes: `http://`, `https://`, `ws://`, `wss://`.

### "Figma plugin is NOT connected" when pushing a design

**Cause:** The Figma plugin is not running, or the WebSocket connection dropped.

**Fix:**
1. In Figma, run the plugin: **Plugins > Development > Figma Bridge**.
2. Wait for the green "Connected" dot.
3. If it stays yellow/red, check that port 9876 is available (no other process using it).

### Design pushed but nothing appears in Figma

**Possible causes:**
- The design may have been created off-screen. Use `Cmd+Shift+1` (Zoom to Fit) in Figma.
- Check the plugin's log panel for error messages.
- The JSON may have an invalid structure. Ensure the root node has a `type` field.

### Fonts not rendering correctly

The plugin falls back to **Inter Regular** if a requested font isn't available in Figma. To use custom fonts:
1. Make sure the font is installed on your system.
2. Use the exact Figma style name (e.g. `"SemiBold"` not `"Semi Bold"`).

---

## Known Limitations

- **One-way only:** The bridge pushes designs *to* Figma. It cannot read or modify existing Figma nodes.
- **No image fills:** The current implementation supports solid color fills only. Image fills, gradients, and effects (shadows, blurs) are not yet supported.
- **Single connection:** Only one Figma plugin instance can connect at a time. If you have multiple Figma files open, only the one running the plugin receives designs.
- **Local only:** The WebSocket runs on `localhost`. This won't work if Claude Code and Figma are on different machines.
- **Dev plugin:** Since `devAllowedDomains` is used (not `allowedDomains`), the plugin works only when imported as a development plugin. It cannot be published to the Figma Community in this form.
- **30-second timeout:** If the Figma plugin doesn't acknowledge a pushed design within 30 seconds, the request times out. Complex designs with many nodes or heavy font loading may occasionally hit this limit.

---

## Quick Reference

| What | Where |
|------|-------|
| MCP server config | `.mcp.json` |
| MCP server code | `figma-bridge-mcp/server.js` |
| MCP server dependencies | `figma-bridge-mcp/package.json` |
| Figma plugin manifest | `figma-bridge-plugin/manifest.json` |
| Figma plugin logic | `figma-bridge-plugin/code.js` |
| Figma plugin UI/network | `figma-bridge-plugin/ui.html` |
| WebSocket port | `9876` |
| Supported node types | FRAME, TEXT, RECTANGLE, ELLIPSE, SVG |
