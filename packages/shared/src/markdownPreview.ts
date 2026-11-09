import type { Element, ElementContent, Root, RootContent } from "hast";
import { raw } from "hast-util-raw";
import { defaultSchema, sanitize, type Schema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import type { Root as MdastRoot } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type RichPreviewKind = "svg" | "html";

export type RichMarkdownSegment =
  | { readonly kind: "markdown"; readonly markdown: string; readonly sourceOffset: number }
  | {
      readonly kind: RichPreviewKind;
      readonly source: string;
      readonly markdown: string;
      readonly sourceOffset: number;
    };

const PREVIEW_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

const DATA_IMAGE = /^data:image\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/=\s]+$/i;

const SVG_TAGS = [
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "symbol",
  "marker",
  "pattern",
  "use",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
] as const;

const SVG_ATTRIBUTES = [
  "viewBox",
  "preserveAspectRatio",
  "xmlns",
  "xmlnsXlink",
  "xlinkHref",
  "xlink:href",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "dx",
  "dy",
  "points",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "opacity",
  "fillOpacity",
  "strokeOpacity",
  "transform",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "textAnchor",
  "dominantBaseline",
  "letterSpacing",
  "clipPath",
  "clipRule",
  "fillRule",
  "display",
  "visibility",
  "overflow",
  "offset",
  "stopColor",
  "stopOpacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "fx",
  "fy",
  "markerStart",
  "markerEnd",
  "markerMid",
  "orient",
  "refX",
  "refY",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "mask",
  "maskUnits",
  "maskContentUnits",
  "pathLength",
  "textLength",
  "lengthAdjust",
  "rotate",
  "href",
  "vectorEffect",
  "paintOrder",
  "colorInterpolation",
  "colorInterpolationFilters",
  "filter",
  "stdDeviation",
  "result",
  "in",
  "in2",
  "values",
  "type",
  "mode",
  "operator",
  "k1",
  "k2",
  "k3",
  "k4",
  "specularExponent",
  "lightingColor",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "limitingConeAngle",
  "diffuseConstant",
  "specularConstant",
  "surfaceScale",
  "kernelMatrix",
  "edgeMode",
  "preserveAlpha",
  "numOctaves",
  "baseFrequency",
  "seed",
  "stitchTiles",
  "scale",
  "xChannelSelector",
  "yChannelSelector",
  "radius",
  "targetX",
  "targetY",
  "exponent",
  "intercept",
  "amplitude",
  "tableValues",
  "azimuth",
  "elevation",
  "bias",
  "divisor",
  "order",
  "kernelUnitLength",
  "filterUnits",
  "primitiveUnits",
] as const;

const FRAGMENT_HREF_TAGS = new Set(["use", "textPath"]);
const HREF_PROPERTIES = ["href", "xlinkHref", "xlink:href"] as const;

const STRIPPED_TAGS = [
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "foreignObject",
  "noscript",
  "template",
  "title",
  "desc",
  "noembed",
  "noframes",
  "frame",
  "frameset",
  "applet",
  "feImage",
  "image",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "script",
];

function previewSchema(): Schema {
  const attributes: NonNullable<Schema["attributes"]> = { ...defaultSchema.attributes };
  attributes["*"] = [...(attributes["*"] ?? []), "className", "style"];
  for (const tag of SVG_TAGS) {
    attributes[tag] = [...(attributes[tag] ?? []), ...SVG_ATTRIBUTES];
  }
  // Anchors keep their text. An href would navigate this preview's frame, including to this app.
  attributes.a = (attributes.a ?? []).filter((attribute) => attribute !== "href");
  attributes.style = [];
  return {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), ...SVG_TAGS, "style"],
    attributes,
    strip: [...(defaultSchema.strip ?? []), ...STRIPPED_TAGS],
    clobber: [],
    protocols: {
      ...defaultSchema.protocols,
      src: ["data"],
    },
  };
}

const PREVIEW_SCHEMA = previewSchema();

function sanitizeCss(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "")
    .replace(/url\(\s*(['"])?\s*(?!#)[^)]*\)/gi, "none")
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "blocked(")
    .replace(/javascript\s*:/gi, "")
    .replace(/</g, "\\3C ");
}

function scrubAttribute(tagName: string, name: string, value: string): string | null {
  if (FRAGMENT_HREF_TAGS.has(tagName) && (HREF_PROPERTIES as readonly string[]).includes(name)) {
    const fragment = value.trim();
    return fragment.startsWith("#") ? fragment : null;
  }
  if (tagName === "img" && name === "src") {
    return DATA_IMAGE.test(value.trim()) ? value.trim() : null;
  }
  if (name === "style") return sanitizeCss(value);
  if (/javascript\s*:/i.test(value)) return null;
  if (/url\(\s*(['"])?\s*(?!#)/i.test(value)) return null;
  return value;
}

function scrub(node: RootContent): ElementContent | null {
  if (node.type === "text") return node;
  if (node.type !== "element") return null;
  if (node.tagName === "style") {
    const css = node.children.map((child) => (child.type === "text" ? child.value : "")).join("");
    const text: ElementContent = { type: "text", value: sanitizeCss(css) };
    return { ...node, properties: {}, children: css.trim() ? [text] : [] };
  }
  const properties: Element["properties"] = {};
  for (const [name, value] of Object.entries(node.properties)) {
    if (typeof value !== "string") {
      if (value !== undefined && value !== null) properties[name] = value;
      continue;
    }
    const next = scrubAttribute(node.tagName, name, value);
    if (next !== null) properties[name] = next;
  }
  if (node.tagName === "svg" && properties.xmlns === undefined) {
    properties.xmlns = "http://www.w3.org/2000/svg";
  }
  if (node.tagName === "img" && typeof properties.src !== "string") return null;
  const children = node.children.flatMap((child) => {
    const next = scrub(child);
    return next ? [next] : [];
  });
  return { ...node, properties, children };
}

function parseHtml(source: string): Root {
  const parsed = raw({
    type: "root",
    children: [{ type: "raw", value: source } as never],
  });
  return parsed.type === "root" ? parsed : { type: "root", children: [] };
}

function visible(node: ElementContent): boolean {
  if (node.type === "text") return node.value.trim().length > 0;
  if (node.type !== "element" || node.tagName === "style") return false;
  return true;
}

function sanitizedTree(source: string): Root | null {
  const parsed = parseHtml(source);
  const clean = sanitize(parsed, PREVIEW_SCHEMA);
  if (clean.type !== "root") return null;
  const children = clean.children.flatMap((child) => {
    const next = scrub(child);
    return next ? [next] : [];
  });
  if (!children.some(visible)) return null;
  return { type: "root", children };
}

function serialized(tree: Root): string {
  return toHtml(tree);
}

/** Sanitized SVG document for a native renderer, or null when the fence is not an SVG. */
export function sanitizedSvgMarkup(source: string): string | null {
  const tree = sanitizedTree(source);
  if (!tree) return null;
  const svg = tree.children.filter(
    (child): child is Element => child.type === "element" && child.tagName === "svg",
  );
  if (svg.length === 0) return null;
  return serialized({ type: "root", children: svg });
}

/**
 * A document for a same-origin, scriptless frame. Remote URLs and scripts are removed so the
 * frame can be measured without letting the block reach the app or the network.
 */
export function richPreviewDocument(
  kind: RichPreviewKind,
  source: string,
  colorScheme: "light" | "dark",
): string | null {
  const tree = sanitizedTree(source);
  if (!tree) return null;
  const body = serialized(tree);
  if (kind === "svg" && !/<svg[\s>/]/i.test(body)) return null;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="color-scheme" content="${colorScheme}"><style>html,body{margin:0;background:transparent;color:CanvasText}body{padding:8px 2px 12px;font:14px/1.55 system-ui,sans-serif;overflow-wrap:anywhere}img,svg{max-width:100%;height:auto}svg{display:block;margin-inline:auto}table{border-collapse:collapse;max-width:100%}pre,code{white-space:pre-wrap}a{color:inherit;text-decoration:underline}</style></head><body>${body}</body></html>`;
}

export function richPreviewKind(language: string): RichPreviewKind | null {
  switch (language.toLowerCase()) {
    case "svg":
      return "svg";
    case "html":
    case "htm":
      return "html";
    default:
      return null;
  }
}

const fenceParser = unified().use(remarkParse).use(remarkGfm).freeze();

function fenceClosed(source: string): boolean {
  const trimmed = source.trimEnd();
  const opening = /^(?:`{3,}|~{3,})/.exec(trimmed)?.[0];
  const closing = /(?:^|\n)[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(trimmed)?.[1];
  return (
    opening !== undefined &&
    closing !== undefined &&
    opening[0] === closing[0] &&
    closing.length >= opening.length
  );
}

function hasRichFence(markdown: string): boolean {
  return /(?:^|\n)[ \t]{0,3}(?:`{3,}|~{3,})[^\n]*\b(?:svg|html|htm)\b/i.test(markdown);
}

/** Top-level closed `svg` and `html` fences, in source order. Nested fences stay markdown. */
export function splitMarkdownRichFences(markdown: string): readonly RichMarkdownSegment[] {
  if (!hasRichFence(markdown)) return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  const tree = fenceParser.parse(markdown) as MdastRoot;
  const segments: RichMarkdownSegment[] = [];
  let cursor = 0;
  for (const node of tree.children) {
    if (node.type !== "code" || !node.lang) continue;
    const kind = richPreviewKind(node.lang);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (!kind || start === undefined || end === undefined) continue;
    const authored = markdown.slice(start, end);
    if (!fenceClosed(authored)) continue;
    if (start > cursor) {
      segments.push({
        kind: "markdown",
        markdown: markdown.slice(cursor, start),
        sourceOffset: cursor,
      });
    }
    segments.push({ kind, source: node.value, markdown: authored, sourceOffset: start });
    cursor = end;
  }
  if (segments.length === 0) return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  if (cursor < markdown.length) {
    segments.push({ kind: "markdown", markdown: markdown.slice(cursor), sourceOffset: cursor });
  }
  return segments;
}
