/*
 * Central timeout for quick, same-origin JSON/API reads.
 *
 * Scope is deliberately narrow:
 *   GET /api/...
 *   GET /list...
 *
 * Large uploads/downloads and write operations are not affected.
 */

export const API_JSON_TIMEOUT_MS =
  3000;

const INSTALL_FLAG =
  "__dccExpressApiFetchTimeoutInstalled";

type GlobalWithInstallFlag =
  typeof globalThis & {
    [INSTALL_FLAG]?: boolean;
  };

function requestMethod(
  input: RequestInfo | URL,
  init?: RequestInit
): string {
  const initMethod =
    init?.method;

  if (initMethod) {
    return initMethod.toUpperCase();
  }

  if (
    typeof Request !== "undefined" &&
    input instanceof Request
  ) {
    return input.method.toUpperCase();
  }

  return "GET";
}

function requestUrl(
  input: RequestInfo | URL
): URL | null {
  try {
    if (
      typeof Request !== "undefined" &&
      input instanceof Request
    ) {
      return new URL(
        input.url,
        globalThis.location?.href
      );
    }

    return new URL(
      String(input),
      globalThis.location?.href
    );
  } catch {
    return null;
  }
}

function isQuickJsonRead(
  input: RequestInfo | URL,
  init?: RequestInit
): boolean {
  if (
    requestMethod(
      input,
      init
    ) !== "GET"
  ) {
    return false;
  }

  const url =
    requestUrl(input);

  if (!url) {
    return false;
  }

  if (
    typeof globalThis.location !==
      "undefined" &&
    url.origin !==
      globalThis.location.origin
  ) {
    return false;
  }

  return (
    url.pathname === "/api" ||
    url.pathname.startsWith(
      "/api/"
    ) ||
    url.pathname === "/list"
  );
}

function originalSignal(
  input: RequestInfo | URL,
  init?: RequestInit
): AbortSignal | null {
  if (init?.signal) {
    return init.signal;
  }

  if (
    typeof Request !== "undefined" &&
    input instanceof Request
  ) {
    return input.signal;
  }

  return null;
}

function timeoutLabel(
  input: RequestInfo | URL
): string {
  const url =
    requestUrl(input);

  if (!url) {
    return "API request";
  }

  return (
    url.pathname +
    url.search
  );
}

export function installApiFetchTimeout(): void {
  const globalObject =
    globalThis as GlobalWithInstallFlag;

  if (
    globalObject[
      INSTALL_FLAG
    ]
  ) {
    return;
  }

  const baseFetch =
    globalThis.fetch.bind(
      globalThis
    );

  globalObject[
    INSTALL_FLAG
  ] = true;

  globalThis.fetch =
    async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      if (
        !isQuickJsonRead(
          input,
          init
        )
      ) {
        return baseFetch(
          input,
          init
        );
      }

      const controller =
        new AbortController();

      const sourceSignal =
        originalSignal(
          input,
          init
        );

      let timeoutTriggered =
        false;

      const forwardAbort =
        (): void => {
          if (
            controller.signal.aborted
          ) {
            return;
          }

          controller.abort(
            sourceSignal?.reason
          );
        };

      if (
        sourceSignal?.aborted
      ) {
        forwardAbort();
      } else {
        sourceSignal?.addEventListener(
          "abort",
          forwardAbort,
          {
            once: true,
          }
        );
      }

      const timeoutId =
        globalThis.setTimeout(
          () => {
            timeoutTriggered =
              true;

            if (
              !controller.signal
                .aborted
            ) {
              controller.abort();
            }
          },
          API_JSON_TIMEOUT_MS
        );

      try {
        return await baseFetch(
          input,
          {
            ...init,
            signal:
              controller.signal,
          }
        );
      } catch (error) {
        if (
          timeoutTriggered &&
          !sourceSignal?.aborted
        ) {
          throw new Error(
            `${timeoutLabel(input)} timed out after ${API_JSON_TIMEOUT_MS} ms.`
          );
        }

        throw error;
      } finally {
        globalThis.clearTimeout(
          timeoutId
        );

        sourceSignal
          ?.removeEventListener(
            "abort",
            forwardAbort
          );
      }
    };
}
