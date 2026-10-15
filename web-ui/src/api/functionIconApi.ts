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

/** Strict SVG subset for user-uploaded icons. Active content and external references are rejected. */
async function sanitizeUploadedSvg(file: File): Promise<Blob> {
  const source = await file.text();
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("SVG document declarations are not allowed.");
  const xml = new DOMParser().parseFromString(source, "image/svg+xml");
  if (xml.querySelector("parsererror")) throw new Error("Invalid SVG file.");
  const root = xml.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg")
    throw new Error("Not an SVG image.");
  const tags = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop", "title", "desc", "clipPath", "mask", "use"]);
  const attributes = new Set(["xmlns", "viewBox", "width", "height", "d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "fill-rule", "clip-rule", "fill-opacity", "stroke-opacity", "opacity", "transform", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "points", "id", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "clip-path", "mask", "href", "xmlns:xlink"]);
  const visit = (element: Element): void => {
    if (!tags.has(element.localName) || element.namespaceURI !== "http://www.w3.org/2000/svg")
      throw new Error("SVG contains unsupported elements.");
    for (const attr of Array.from(element.attributes)) {
      if (!attributes.has(attr.name) || /^on/i.test(attr.name) || /url\s*\(/i.test(attr.value) && !/^url\(#[a-zA-Z0-9_-]+\)$/.test(attr.value.trim()))
        throw new Error("SVG contains unsafe attributes.");
      if ((attr.localName === "href" && !/^#[a-zA-Z0-9_-]+$/.test(attr.value)) ||
          /(?:javascript:|data:|https?:|file:)/i.test(attr.value))
        throw new Error("SVG external references are not allowed.");
    }
    Array.from(element.children).forEach(visit);
  };
  visit(root);
  return new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" });
}
