import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WebSocketServer } from "ws";

// --- WebSocket Server (bridge to Figma plugin) ---

const WS_PORT = 9876;
let pluginSocket = null;
let pendingRequests = new Map();
let requestId = 0;

const wss = new WebSocketServer({ port: WS_PORT });

wss.on("connection", (ws) => {
  pluginSocket = ws;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ack" && msg.requestId != null) {
        const resolve = pendingRequests.get(msg.requestId);
        if (resolve) {
          resolve(msg);
          pendingRequests.delete(msg.requestId);
        }
      }
    } catch {}
  });

  ws.on("close", () => {
    pluginSocket = null;
  });
});

function sendToPlugin(type, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!pluginSocket || pluginSocket.readyState !== 1) {
      return reject(new Error("Figma plugin is not connected. Open the figma-bridge plugin in Figma first."));
    }

    const id = ++requestId;
    const msg = JSON.stringify({ type, requestId: id, payload });

    pendingRequests.set(id, resolve);
    pluginSocket.send(msg);

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Timeout: Figma plugin did not respond within " + timeoutMs + "ms"));
      }
    }, timeoutMs);
  });
}

// --- MCP Server ---

const server = new McpServer({
  name: "figma-bridge",
  version: "1.0.0",
});

server.tool(
  "push_to_figma",
  "Push a structured design JSON to Figma as native editable nodes (frames with auto-layout, text, rectangles, etc.)",
  {
    design: z.string().describe(
      'JSON string of the design tree. Root node should have type FRAME/TEXT/RECTANGLE/ELLIPSE. ' +
      'Each node can have: type, name, width, height, fill (hex color), layoutMode (VERTICAL/HORIZONTAL), ' +
      'padding [top,right,bottom,left], itemSpacing (gap), cornerRadius, clipsContent, ' +
      'primaryAxisAlignItems (MIN/CENTER/MAX/SPACE_BETWEEN), counterAxisAlignItems (MIN/CENTER/MAX), ' +
      'primaryAxisSizingMode (FIXED/AUTO), counterAxisSizingMode (FIXED/AUTO), ' +
      'stroke ({color, weight}), strokeDashes [dash, gap], opacity, ' +
      'children (array of child nodes). ' +
      'TEXT nodes also have: content, fontSize, fontFamily, fontWeight, textAlignHorizontal (LEFT/CENTER/RIGHT), ' +
      'textAutoResize (WIDTH_AND_HEIGHT/HEIGHT/NONE). ' +
      'Size values: number (px), "FILL" (fill_container), "HUG" (fit_content).'
    ),
  },
  async ({ design }) => {
    try {
      const parsed = JSON.parse(design);
      const result = await sendToPlugin("push_design", parsed);
      return { content: [{ type: "text", text: `Design pushed to Figma successfully. ${result.message || ""}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "push_svg_to_figma",
  "Push raw SVG code to Figma as a single vector node (quick but not editable as native nodes)",
  {
    svg: z.string().describe("The SVG markup string to insert into Figma"),
    name: z.string().optional().describe("Optional name for the SVG node in Figma"),
  },
  async ({ svg, name }) => {
    try {
      const result = await sendToPlugin("push_svg", { svg, name: name || "SVG Import" });
      return { content: [{ type: "text", text: `SVG pushed to Figma successfully. ${result.message || ""}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_status",
  "Check if the Figma bridge plugin is connected",
  {},
  async () => {
    const connected = pluginSocket && pluginSocket.readyState === 1;
    return {
      content: [{
        type: "text",
        text: connected
          ? "Figma plugin is connected and ready."
          : "Figma plugin is NOT connected. Open the figma-bridge plugin in Figma Desktop."
      }]
    };
  }
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
