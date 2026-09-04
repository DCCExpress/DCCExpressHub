let installed = false;

function prettyJson(
  content: string
): string {
  try {
    return JSON.stringify(
      JSON.parse(content),
      null,
      2
    );
  } catch {
    return content;
  }
}

function prettyJsonl(
  content: string
): string {
  const parts: string[] = [];
  let rowNumber = 0;

  for (
    const rawLine of
      content.split(/\r?\n/u)
  ) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    rowNumber += 1;

    try {
      const parsed =
        JSON.parse(line);

      parts.push(
        `// row ${rowNumber}\n` +
        JSON.stringify(
          parsed,
          null,
          2
        )
      );
    } catch {
      parts.push(
        `// row ${rowNumber} · invalid JSON\n` +
        line
      );
    }
  }

  return parts.join("\n\n");
}

function createViewer(
  title: string,
  content: string
): void {
  document
    .getElementById(
      "dcc-lite-json-viewer"
    )
    ?.remove();

  const overlay =
    document.createElement("div");

  overlay.id =
    "dcc-lite-json-viewer";

  Object.assign(
    overlay.style,
    {
      position: "fixed",
      inset: "0",
      zIndex: "10000",
      background:
        "rgba(0, 0, 0, 0.72)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }
  );

  const panel =
    document.createElement("div");

  Object.assign(
    panel.style,
    {
      width: "min(1100px, 95vw)",
      height: "min(820px, 90vh)",
      background:
        "var(--mantine-color-body)",
      color:
        "var(--mantine-color-text)",
      border:
        "1px solid var(--mantine-color-dark-4)",
      borderRadius: "8px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      boxShadow:
        "0 20px 60px rgba(0,0,0,.45)",
    }
  );

  const header =
    document.createElement("div");

  Object.assign(
    header.style,
    {
      display: "flex",
      alignItems: "center",
      justifyContent:
        "space-between",
      gap: "12px",
      padding: "10px 14px",
      borderBottom:
        "1px solid var(--mantine-color-dark-4)",
    }
  );

  const caption =
    document.createElement("strong");

  caption.textContent = title;

  const close =
    document.createElement("button");

  close.type = "button";
  close.textContent = "×";
  close.title = "Close";

  Object.assign(
    close.style,
    {
      border: "0",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      fontSize: "26px",
      lineHeight: "1",
    }
  );

  const pre =
    document.createElement("pre");

  pre.textContent = content;

  Object.assign(
    pre.style,
    {
      margin: "0",
      padding: "14px",
      overflow: "auto",
      flex: "1",
      whiteSpace: "pre",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "13px",
      lineHeight: "1.45",
      tabSize: "2",
    }
  );

  const destroy = () =>
    overlay.remove();

  close.addEventListener(
    "click",
    destroy
  );

  overlay.addEventListener(
    "mousedown",
    event => {
      if (event.target === overlay) {
        destroy();
      }
    }
  );

  header.append(
    caption,
    close
  );

  panel.append(
    header,
    pre
  );

  overlay.append(panel);
  document.body.append(overlay);
}

async function openJsonl(
  path: string
): Promise<void> {
  try {
    const response =
      await fetch(
        `/api/files/text?path=${encodeURIComponent(path)}`,
        {
          cache: "no-store",
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const content =
      await response.text();

    createViewer(
      path.split("/").pop() ??
        "JSONL",
      prettyJsonl(content)
    );
  } catch (error) {
    createViewer(
      "JSONL",
      error instanceof Error
        ? error.message
        : String(error)
    );
  }
}

function enhanceJsonModal(): void {
  const dialogs =
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="dialog"]'
      )
    );

  for (const dialog of dialogs) {
    const titleText =
      dialog
        .querySelector(
          ".mantine-Modal-title"
        )
        ?.textContent
        ?.trim() ?? "";

    if (
      !titleText
        .toLowerCase()
        .endsWith(".json")
    ) {
      continue;
    }

    const pre =
      dialog.querySelector(
        "pre"
      );

    if (
      !pre ||
      pre.dataset
        .dccLiteFormatted ===
        "true"
    ) {
      continue;
    }

    const original =
      pre.textContent ?? "";

    const formatted =
      prettyJson(original);

    if (
      formatted !== original
    ) {
      pre.textContent =
        formatted;
    }

    pre.dataset
      .dccLiteFormatted =
      "true";
  }
}

export function
installFileViewerEnhancer(): void {
  if (installed) {
    return;
  }

  installed = true;

  /*
   * IMPORTANT:
   * Never monkey-patch window.fetch here.
   *
   * Signal automation also reads /api/files/text for signal-rules.jsonl.
   * Formatting that response globally would inject viewer comments such as
   * "// row 1" into runtime data and make JSONL parsing fail.
   *
   * Formatting is presentation-only.
   */

  const observer =
    new MutationObserver(() => {
      enhanceJsonModal();
    });

  observer.observe(
    document.body,
    {
      childList: true,
      subtree: true,
      characterData: true,
    }
  );

  document.addEventListener(
    "click",
    event => {
      const target =
        event.target as
          HTMLElement | null;

      const anchor =
        target?.closest(
          "a"
        ) as
          HTMLAnchorElement | null;

      if (!anchor) {
        return;
      }

      let url: URL;

      try {
        url =
          new URL(anchor.href);
      } catch {
        return;
      }

      if (
        !url.pathname
          .toLowerCase()
          .endsWith(".jsonl")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void openJsonl(
        url.pathname
      );
    },
    true
  );

  enhanceJsonModal();
}
