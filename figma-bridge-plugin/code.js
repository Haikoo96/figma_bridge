// Figma Bridge Plugin — Main Thread
// Receives design data from UI iframe, creates native Figma nodes.

figma.showUI(__html__, { width: 300, height: 300 });

// Track loaded fonts to avoid redundant loads
const loadedFonts = new Set();

async function loadFont(family, style) {
  const key = family + "::" + style;
  if (loadedFonts.has(key)) return;
  try {
    await figma.loadFontAsync({ family, style });
    loadedFonts.add(key);
  } catch (e) {
    // Fallback to Inter Regular if font not available
    const fallback = "Inter::Regular";
    if (!loadedFonts.has(fallback)) {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      loadedFonts.add(fallback);
    }
  }
}

function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return {
    r: parseInt(hex.substring(0, 2), 16) / 255,
    g: parseInt(hex.substring(2, 4), 16) / 255,
    b: parseInt(hex.substring(4, 6), 16) / 255,
  };
}

function applyFill(node, fill) {
  if (!fill) return;
  const rgb = hexToRgb(fill);
  node.fills = [{ type: "SOLID", color: rgb }];
}

function applyStroke(node, stroke) {
  if (!stroke) return;
  if (stroke.color) {
    const rgb = hexToRgb(stroke.color);
    node.strokes = [{ type: "SOLID", color: rgb }];
  }
  if (stroke.weight != null) {
    node.strokeWeight = stroke.weight;
  }
  if (stroke.align) {
    node.strokeAlign = stroke.align; // "INSIDE", "OUTSIDE", "CENTER"
  }
}

function applyStrokeDashes(node, dashes) {
  if (dashes && Array.isArray(dashes)) {
    node.dashPattern = dashes;
  }
}

function applySize(node, data, parent) {
  // Width
  if (data.width === "FILL") {
    node.layoutSizingHorizontal = "FILL";
  } else if (data.width === "HUG") {
    node.layoutSizingHorizontal = "HUG";
  } else if (typeof data.width === "number") {
    node.resize(data.width, node.height);
  }

  // Height
  if (data.height === "FILL") {
    node.layoutSizingVertical = "FILL";
  } else if (data.height === "HUG") {
    node.layoutSizingVertical = "HUG";
  } else if (typeof data.height === "number") {
    node.resize(node.width, data.height);
  }

  // Handle combined resize if both are numbers
  if (typeof data.width === "number" && typeof data.height === "number") {
    node.resize(data.width, data.height);
  }
}

function applyLayout(node, data) {
  if (data.layoutMode) {
    node.layoutMode = data.layoutMode; // "VERTICAL" or "HORIZONTAL"
  }

  if (data.layoutMode && data.layoutMode !== "NONE") {
    // Primary axis sizing
    if (data.primaryAxisSizingMode) {
      node.primaryAxisSizingMode = data.primaryAxisSizingMode; // "FIXED" or "AUTO"
    }
    // Counter axis sizing
    if (data.counterAxisSizingMode) {
      node.counterAxisSizingMode = data.counterAxisSizingMode; // "FIXED" or "AUTO"
    }

    // Alignment
    if (data.primaryAxisAlignItems) {
      node.primaryAxisAlignItems = data.primaryAxisAlignItems; // "MIN", "CENTER", "MAX", "SPACE_BETWEEN"
    }
    if (data.counterAxisAlignItems) {
      node.counterAxisAlignItems = data.counterAxisAlignItems; // "MIN", "CENTER", "MAX"
    }

    // Spacing
    if (data.itemSpacing != null) {
      node.itemSpacing = data.itemSpacing;
    }

    // Padding
    if (data.padding) {
      if (Array.isArray(data.padding)) {
        node.paddingTop = data.padding[0] || 0;
        node.paddingRight = data.padding[1] || 0;
        node.paddingBottom = data.padding[2] || 0;
        node.paddingLeft = data.padding[3] || 0;
      } else if (typeof data.padding === "number") {
        node.paddingTop = data.padding;
        node.paddingRight = data.padding;
        node.paddingBottom = data.padding;
        node.paddingLeft = data.padding;
      }
    }
  }

  if (data.clipsContent != null) {
    node.clipsContent = data.clipsContent;
  }
}

async function createNode(data, parent) {
  let node;

  switch (data.type) {
    case "FRAME": {
      node = figma.createFrame();
      node.name = data.name || "Frame";

      // Set initial size before layout
      if (typeof data.width === "number") {
        node.resize(data.width, typeof data.height === "number" ? data.height : 100);
      }

      applyFill(node, data.fill);
      applyStroke(node, data.stroke);
      applyStrokeDashes(node, data.strokeDashes);
      applyLayout(node, data);

      if (data.cornerRadius != null) {
        node.cornerRadius = data.cornerRadius;
      }
      if (data.opacity != null) {
        node.opacity = data.opacity;
      }

      // Append to parent first so sizing modes work
      parent.appendChild(node);

      // Apply sizing after layout is set
      applySize(node, data, parent);

      // Create children
      if (data.children && data.children.length > 0) {
        for (const childData of data.children) {
          await createNode(childData, node);
        }
      }

      // If height/width is HUG and we have layout, set auto sizing
      if (data.width === "HUG" && data.layoutMode) {
        node.primaryAxisSizingMode = data.layoutMode === "HORIZONTAL" ? "AUTO" : node.primaryAxisSizingMode;
        node.counterAxisSizingMode = data.layoutMode === "VERTICAL" ? "AUTO" : node.counterAxisSizingMode;
      }
      if (data.height === "HUG" && data.layoutMode) {
        node.primaryAxisSizingMode = data.layoutMode === "VERTICAL" ? "AUTO" : node.primaryAxisSizingMode;
        node.counterAxisSizingMode = data.layoutMode === "HORIZONTAL" ? "AUTO" : node.counterAxisSizingMode;
      }

      break;
    }

    case "TEXT": {
      node = figma.createText();
      node.name = data.name || data.content || "Text";

      const family = data.fontFamily || "Inter";
      const weight = data.fontWeight || "Regular";
      // Map common weight names to Figma style names
      const styleMap = {
        "100": "Thin", "200": "ExtraLight", "300": "Light",
        "400": "Regular", "normal": "Regular", "Regular": "Regular",
        "500": "Medium", "Medium": "Medium",
        "600": "SemiBold", "Semi Bold": "SemiBold", "SemiBold": "SemiBold",
        "700": "Bold", "bold": "Bold", "Bold": "Bold",
        "800": "ExtraBold", "Extra Bold": "ExtraBold", "ExtraBold": "ExtraBold",
        "900": "Black",
      };
      const style = styleMap[weight] || weight;

      await loadFont(family, style);

      try {
        node.fontName = { family, style };
      } catch (e) {
        await loadFont("Inter", "Regular");
        node.fontName = { family: "Inter", style: "Regular" };
      }

      if (data.fontSize) node.fontSize = data.fontSize;
      if (data.content) node.characters = data.content;

      applyFill(node, data.fill);

      if (data.textAlignHorizontal) {
        node.textAlignHorizontal = data.textAlignHorizontal; // "LEFT", "CENTER", "RIGHT", "JUSTIFIED"
      }
      if (data.textAlignVertical) {
        node.textAlignVertical = data.textAlignVertical; // "TOP", "CENTER", "BOTTOM"
      }
      if (data.textAutoResize) {
        node.textAutoResize = data.textAutoResize; // "WIDTH_AND_HEIGHT", "HEIGHT", "NONE"
      }
      if (data.lineHeight) {
        node.lineHeight = { value: data.lineHeight * 100, unit: "PERCENT" };
      }

      parent.appendChild(node);
      applySize(node, data, parent);

      if (data.opacity != null) {
        node.opacity = data.opacity;
      }

      break;
    }

    case "RECTANGLE": {
      node = figma.createRectangle();
      node.name = data.name || "Rectangle";

      if (typeof data.width === "number" && typeof data.height === "number") {
        node.resize(data.width, data.height);
      }

      applyFill(node, data.fill);
      applyStroke(node, data.stroke);
      applyStrokeDashes(node, data.strokeDashes);

      if (data.cornerRadius != null) {
        node.cornerRadius = data.cornerRadius;
      }
      if (data.opacity != null) {
        node.opacity = data.opacity;
      }

      parent.appendChild(node);
      applySize(node, data, parent);
      break;
    }

    case "ELLIPSE": {
      node = figma.createEllipse();
      node.name = data.name || "Ellipse";

      if (typeof data.width === "number" && typeof data.height === "number") {
        node.resize(data.width, data.height);
      }

      applyFill(node, data.fill);
      applyStroke(node, data.stroke);

      if (data.opacity != null) {
        node.opacity = data.opacity;
      }

      parent.appendChild(node);
      applySize(node, data, parent);
      break;
    }

    case "SVG": {
      node = figma.createNodeFromSvg(data.svg);
      node.name = data.name || "SVG";

      parent.appendChild(node);

      if (typeof data.width === "number" && typeof data.height === "number") {
        node.resize(data.width, data.height);
      }
      break;
    }

    default:
      console.log("Unknown node type:", data.type);
      return null;
  }

  // Position (only for absolute positioning, ignored in auto-layout parents)
  if (data.x != null) node.x = data.x;
  if (data.y != null) node.y = data.y;

  return node;
}

// Listen for messages from UI
figma.ui.onmessage = async (msg) => {
  const { type, requestId, payload } = msg;

  try {
    if (type === "push_design") {
      const node = await createNode(payload, figma.currentPage);
      if (node) {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
      }
      figma.ui.postMessage({
        type: "ack",
        requestId,
        message: "Design created with " + (node ? node.name : "unknown") + " as root node.",
      });
    } else if (type === "push_svg") {
      const node = figma.createNodeFromSvg(payload.svg);
      node.name = payload.name || "SVG Import";
      figma.currentPage.appendChild(node);
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
      figma.ui.postMessage({
        type: "ack",
        requestId,
        message: "SVG imported as " + node.name,
      });
    }
  } catch (e) {
    figma.ui.postMessage({
      type: "ack",
      requestId,
      message: "Error: " + e.message,
    });
  }
};
