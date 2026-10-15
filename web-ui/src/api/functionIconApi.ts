const DIRECTORY = "/images";
const PREFIX = "fnicon-";
type FileEntry = { name: string; path?: string; type?: string };
export type CustomFunctionIcon = { name: string; value: string; url: string };

export function customFunctionIconUrl(value: string): string | null {
  if (!value.startsWith("custom:")) return null;
  const name = value.slice(7);
  if (!/^fnicon-[a-zA-Z0-9._-]+\.(png|webp|svg)$/i.test(name)) return null;
  return `/images/${name}`;
}

export async function listCustomFunctionIcons(): Promise<CustomFunctionIcon[]> {
  const response = await fetch(`/list?path=${encodeURIComponent(DIRECTORY)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot list custom icons (HTTP ${response.status})`);
  const data: FileEntry[] | { entries: FileEntry[] } = await response.json();
  const entries = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries)) throw new Error("Invalid icon directory response");
  return entries.filter(item => item.type !== "directory" &&
      /^fnicon-[a-zA-Z0-9._-]+\.(png|webp|svg)$/i.test(item.name))
    .map(item => ({ name: item.name, value: `custom:${item.name}`, url: `/images/${item.name}` }));
}

export async function uploadCustomFunctionIcon(file: File): Promise<CustomFunctionIcon> {
  if (!["image/png", "image/webp", "image/svg+xml"].includes(file.type) && !/\.svg$/i.test(file.name))
    throw new Error("Only PNG, WebP and SVG function icons are supported.");
  if (file.size > 256 * 1024) throw new Error("Function icon must be smaller than 256 KB.");
  const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "icon";
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const extension = isSvg ? "svg" : file.type === "image/png" ? "png" : "webp";
  const name = `${PREFIX}${stem}-${Date.now()}.${extension}`;
  const form = new FormData();
  const payload = isSvg ? await sanitizeUploadedSvg(file) : file;
  form.append("file", new File([payload], name, { type: isSvg ? "image/svg+xml" : file.type }), name);
  const response = await fetch(`/upload?path=${encodeURIComponent(DIRECTORY)}`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Icon upload failed (HTTP ${response.status})`);
  return { name, value: `custom:${name}`, url: `/images/${name}` };
}

/**
 * Reduce uploaded SVGs to a passive pictogram subset.
 * Untrusted links, stylesheets, event handlers and unsupported elements are
 * removed instead of rejecting the whole image. Never inline the raw upload.
 */
async function sanitizeUploadedSvg(file: File): Promise<Blob> {
  const source = await file.text();
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("SVG document declarations are not allowed.");
  const xml = new DOMParser().parseFromString(source, "image/svg+xml");
  if (xml.querySelector("parsererror")) throw new Error("Invalid SVG file.");
  const root = xml.documentElement;
  const ns = "http://www.w3.org/2000/svg";
  if (root.localName !== "svg" || root.namespaceURI !== ns) throw new Error("Not an SVG image.");

  const allowedTags = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line",
    "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop",
    "title", "desc", "clipPath", "mask", "use"]);
  const allowedAttrs = new Set(["xmlns", "viewBox", "width", "height", "d", "fill",
    "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
    "fill-rule", "clip-rule", "fill-opacity", "stroke-opacity", "opacity",
    "transform", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2",
    "points", "id", "offset", "stop-color", "stop-opacity", "gradientUnits",
    "gradientTransform", "clip-path", "mask", "href", "preserveAspectRatio"]);
  const paint = new Set(["fill", "stroke", "stop-color"]);
  const numericStyle = new Set(["stroke-width", "fill-opacity", "stroke-opacity", "opacity",
    "stroke-linecap", "stroke-linejoin", "fill-rule"]);
  const localRef = /^url\(\s*['"]?#[a-zA-Z_][\w.-]*['"]?\s*\)$/i;
  const safePaint = (v: string) => /^(none|currentColor|transparent|#[0-9a-f]{3,8}|[a-z]+)$/i.test(v) ||
    /^rgba?\([\d\s.,%]+\)$/i.test(v) || localRef.test(v);
  const safeStyle = (style: string) => style.split(";").map(declaration => {
    const separator = declaration.indexOf(":");
    if (separator < 0) return "";
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if ((paint.has(name) && safePaint(value)) ||
        (numericStyle.has(name) && /^[\w.\s%-]+$/.test(value)))
      return `${name}:${value}`;
    return "";
  }).filter(Boolean).join(";");

  const clean = (element: Element): void => {
    for (const child of Array.from(element.children)) {
      if (child.namespaceURI !== ns || !allowedTags.has(child.localName)) child.remove();
      else clean(child);
    }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name;
      const value = attr.value.trim();
      if (name === "style") {
        const filtered = safeStyle(value);
        element.removeAttribute(name);
        if (filtered) element.setAttribute("style", filtered);
        continue;
      }
      if (name === "xmlns" && value === ns) continue;
      // Refer only to definitions in this very SVG, never external resources.
      if (attr.localName === "href") {
        element.removeAttributeNode(attr);
        if (/^#[a-zA-Z_][\w.-]*$/.test(value)) element.setAttribute("href", value);
        continue;
      }
      const valid = allowedAttrs.has(name) && !/^on/i.test(name) &&
        !/(?:javascript:|data:|https?:|file:|@import)/i.test(value) &&
        (!/url\s*\(/i.test(value) || localRef.test(value)) &&
        (!paint.has(name) || safePaint(value));
      if (!valid) element.removeAttributeNode(attr);
    }
  };
  clean(root);
  return new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" });
}
