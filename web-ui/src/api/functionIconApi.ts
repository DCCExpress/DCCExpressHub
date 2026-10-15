const DIRECTORY = "/images";
const PREFIX = "fnicon-";
type FileEntry = { name: string; path?: string; type?: string };
export type CustomFunctionIcon = { name: string; value: string; url: string };

export function customFunctionIconUrl(value: string): string | null {
  if (!value.startsWith("custom:")) return null;
  const name = value.slice(7);
  if (!/^fnicon-[a-zA-Z0-9._-]+\.(png|webp)$/i.test(name)) return null;
  return `/images/${name}`;
}

export async function listCustomFunctionIcons(): Promise<CustomFunctionIcon[]> {
  const response = await fetch(`/list?path=${encodeURIComponent(DIRECTORY)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot list custom icons (HTTP ${response.status})`);
  const data: FileEntry[] | { entries: FileEntry[] } = await response.json();
  const entries = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries)) throw new Error("Invalid icon directory response");
  return entries.filter(item => item.type !== "directory" &&
      /^fnicon-[a-zA-Z0-9._-]+\.(png|webp)$/i.test(item.name))
    .map(item => ({ name: item.name, value: `custom:${item.name}`, url: `/images/${item.name}` }));
}

export async function uploadCustomFunctionIcon(file: File): Promise<CustomFunctionIcon> {
  if (!["image/png", "image/webp"].includes(file.type))
    throw new Error("Only PNG and WebP function icons are supported.");
  if (file.size > 256 * 1024) throw new Error("Function icon must be smaller than 256 KB.");
  const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "icon";
  const extension = file.type === "image/png" ? "png" : "webp";
  const name = `${PREFIX}${stem}-${Date.now()}.${extension}`;
  const form = new FormData();
  form.append("file", new File([file], name, { type: file.type }), name);
  const response = await fetch(`/upload?path=${encodeURIComponent(DIRECTORY)}`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Icon upload failed (HTTP ${response.status})`);
  return { name, value: `custom:${name}`, url: `/images/${name}` };
}
