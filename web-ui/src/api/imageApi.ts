function sanitizeFileName(name: string): string {
  const leaf = name.replace(/\\/g, "/").split("/").pop() || "loco-image";
  return leaf.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export type LocoImageBackup = {
  name: string;
  contentType: string;
  dataBase64: string;
};

type ImageListItem = {
  name: string;
  path?: string;
  type?: "file" | "directory";
  size: number;
};

type ImageDirectoryListing = {
  path: string;
  entries: ImageListItem[];
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("Image backup could not be encoded."));
    reader.readAsDataURL(blob);
  });
}

function base64ToFile(image: LocoImageBackup): File {
  const binary = atob(image.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], sanitizeFileName(image.name), { type: image.contentType || "application/octet-stream" });
}

export async function uploadLocoImage(file: File): Promise<string> {
  const safeName = sanitizeFileName(file.name);
  const uploadFile = safeName === file.name
    ? file
    : new File([file], safeName, { type: file.type });

  const formData = new FormData();
  formData.append("file", uploadFile, safeName);

  const response = await fetch("/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Image upload failed: HTTP ${response.status}`);
  }

  // Store a relative path in locos.json. From both the ESP32 UI and
  // Vite dev server this resolves to /images/<name>.
  return `images/${safeName}`;
}

export async function exportLocoImages(): Promise<LocoImageBackup[]> {
  const listResponse = await fetch("/list?path=%2Fimages", { cache: "no-store" });
  if (!listResponse.ok) throw new Error(`Image list could not be loaded: HTTP ${listResponse.status}`);

  const payload = await listResponse.json() as ImageListItem[] | ImageDirectoryListing;
  const entries = Array.isArray(payload) ? payload : payload.entries;
  if (!Array.isArray(entries)) throw new Error("Image list response has an invalid format.");
  const items = entries.filter(item => item.type !== "directory");
  return Promise.all(items.map(async item => {
    const path = item.path || `/images/${item.name.replace(/^\/+/, "")}`;
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Image could not be backed up (${item.name}): HTTP ${response.status}`);
    const blob = await response.blob();
    return {
      name: sanitizeFileName(item.name),
      contentType: blob.type || "application/octet-stream",
      dataBase64: await blobToBase64(blob),
    };
  }));
}

export async function importLocoImages(images: LocoImageBackup[]): Promise<void> {
  // The ESP32 upload handler owns one temporary file handle, so restore images
  // sequentially rather than opening multiple uploads in parallel.
  for (const image of images) await uploadLocoImage(base64ToFile(image));
}
