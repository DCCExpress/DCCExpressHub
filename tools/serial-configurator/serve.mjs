import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  spawn,
  spawnSync,
} from "node:child_process";
import {
  fileURLToPath,
} from "node:url";

const root =
  path.dirname(
    fileURLToPath(import.meta.url),
  );

const host = "127.0.0.1";
const port = 8765;

const MAX_FIRMWARE_BYTES =
  32 * 1024 * 1024;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function existingFile(candidate) {
  try {
    return (
      Boolean(candidate) &&
      fs.statSync(candidate).isFile()
    );
  } catch {
    return false;
  }
}

function commandWorks(command, args = ["--version"]) {
  try {
    const result =
      spawnSync(
        command,
        args,
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );

    return result.status === 0;
  } catch {
    return false;
  }
}

function findPlatformIO() {
  const home =
    process.env.USERPROFILE ??
    os.homedir();

  const candidates = [
    "pio",
    path.join(
      home,
      ".platformio",
      "penv",
      "Scripts",
      "pio.exe",
    ),
    path.join(
      home,
      ".platformio",
      "penv",
      "Scripts",
      "platformio.exe",
    ),
  ];

  for (const candidate of candidates) {
    if (
      candidate === "pio"
        ? commandWorks(candidate)
        : existingFile(candidate) &&
          commandWorks(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

function findPlatformIoPython() {
  const home =
    process.env.USERPROFILE ??
    os.homedir();

  const candidates = [
    path.join(
      home,
      ".platformio",
      "penv",
      "Scripts",
      "python.exe",
    ),
    path.join(
      home,
      ".platformio",
      "penv",
      "Scripts",
      "python3.exe",
    ),
  ];

  for (const candidate of candidates) {
    if (existingFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findEsptoolScript() {
  const home =
    process.env.USERPROFILE ??
    os.homedir();

  const packageRoot =
    path.join(
      home,
      ".platformio",
      "packages",
      "tool-esptoolpy",
    );

  const direct =
    path.join(
      packageRoot,
      "esptool.py",
    );

  if (existingFile(direct)) {
    return direct;
  }

  if (!fs.existsSync(packageRoot)) {
    return null;
  }

  const queue = [packageRoot];

  while (queue.length > 0) {
    const directory = queue.shift();

    let entries;

    try {
      entries =
        fs.readdirSync(
          directory,
          {
            withFileTypes: true,
          },
        );
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full =
        path.join(
          directory,
          entry.name,
        );

      if (
        entry.isFile() &&
        entry.name.toLowerCase() ===
          "esptool.py"
      ) {
        return full;
      }

      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".")
      ) {
        queue.push(full);
      }
    }
  }

  return null;
}

function sendJson(
  response,
  status,
  value,
) {
  response.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",
      "Cache-Control":
        "no-store",
    },
  );

  response.end(
    JSON.stringify(value),
  );
}

function staticFile(
  request,
  response,
  pathname,
) {
  const relative =
    pathname === "/"
      ? "index.html"
      : pathname.replace(/^\/+/, "");

  const target =
    path.resolve(
      root,
      relative,
    );

  if (
    target !== root &&
    !target.startsWith(
      root +
      path.sep,
    )
  ) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(
    target,
    (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(
        200,
        {
          "Content-Type":
            mime[
              path.extname(target)
            ] ??
            "application/octet-stream",
          "Cache-Control":
            "no-store",
        },
      );

      response.end(data);
    },
  );
}

function listSerialPorts(
  response,
) {
  const pio =
    findPlatformIO();

  if (!pio) {
    sendJson(
      response,
      503,
      {
        ok: false,
        message:
          "PlatformIO CLI not found. Open PlatformIO once in VS Code or install PlatformIO Core.",
      },
    );

    return;
  }

  const result =
    spawnSync(
      pio,
      [
        "device",
        "list",
        "--json-output",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    );

  if (result.status !== 0) {
    sendJson(
      response,
      500,
      {
        ok: false,
        message:
          (
            result.stderr ||
            result.stdout ||
            "PlatformIO device discovery failed"
          ).trim(),
      },
    );

    return;
  }

  try {
    const parsed =
      JSON.parse(
        result.stdout,
      );

    const ports =
      Array.isArray(parsed)
        ? parsed
            .filter(
              item =>
                typeof item?.port ===
                  "string",
            )
            .map(
              item => ({
                port:
                  item.port,
                description:
                  item.description ??
                  "",
                hwid:
                  item.hwid ??
                  "",
              }),
            )
        : [];

    sendJson(
      response,
      200,
      {
        ok: true,
        ports,
      },
    );
  } catch (error) {
    sendJson(
      response,
      500,
      {
        ok: false,
        message:
          `Could not parse PlatformIO port list: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
      },
    );
  }
}


function parseUsbIdFromHwid(hwid) {
  const match =
    String(hwid ?? "")
      .match(/VID:PID=([0-9A-F]{4}):([0-9A-F]{4})/i);

  if (!match) {
    return null;
  }

  return {
    vendorId:
      Number.parseInt(match[1], 16),
    productId:
      Number.parseInt(match[2], 16),
  };
}

function platformIoPortList() {
  const pio =
    findPlatformIO();

  if (!pio) {
    throw new Error(
      "PlatformIO CLI not found. Open PlatformIO once in VS Code or install PlatformIO Core.",
    );
  }

  const result =
    spawnSync(
      pio,
      [
        "device",
        "list",
        "--json-output",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    );

  if (result.status !== 0) {
    throw new Error(
      (
        result.stderr ||
        result.stdout ||
        "PlatformIO device discovery failed"
      ).trim(),
    );
  }

  const parsed =
    JSON.parse(
      result.stdout,
    );

  return Array.isArray(parsed)
    ? parsed
    : [];
}

function resolveSerialPort(
  response,
  url,
) {
  const vendorId =
    Number(
      url.searchParams.get(
        "vendorId",
      ),
    );

  const productId =
    Number(
      url.searchParams.get(
        "productId",
      ),
    );

  if (
    !Number.isInteger(vendorId) ||
    !Number.isInteger(productId) ||
    vendorId < 0 ||
    vendorId > 0xffff ||
    productId < 0 ||
    productId > 0xffff
  ) {
    sendJson(
      response,
      400,
      {
        ok: false,
        message:
          "USB vendorId/productId are required to resolve the Windows COM port.",
      },
    );

    return;
  }

  try {
    const allPorts =
      platformIoPortList();

    const matches =
      allPorts
        .map(
          item => ({
            ...item,
            usb:
              parseUsbIdFromHwid(
                item?.hwid,
              ),
          }),
        )
        .filter(
          item =>
            item.usb?.vendorId ===
              vendorId &&
            item.usb?.productId ===
              productId &&
            typeof item.port ===
              "string",
        );

    if (matches.length === 0) {
      sendJson(
        response,
        404,
        {
          ok: false,
          message:
            `No Windows COM port matched USB VID:PID ${vendorId.toString(16).padStart(4, "0")}:${productId.toString(16).padStart(4, "0")}.`,
        },
      );

      return;
    }

    if (matches.length > 1) {
      sendJson(
        response,
        409,
        {
          ok: false,
          ambiguous: true,
          message:
            "More than one connected serial device has the same USB VID/PID. Disconnect the other identical device and reconnect the Hub.",
          matches:
            matches.map(
              item => ({
                port:
                  item.port,
                description:
                  item.description ??
                  "",
                hwid:
                  item.hwid ??
                  "",
              }),
            ),
        },
      );

      return;
    }

    const selected =
      matches[0];

    sendJson(
      response,
      200,
      {
        ok: true,
        port:
          selected.port,
        description:
          selected.description ??
          "",
        hwid:
          selected.hwid ??
          "",
      },
    );
  } catch (error) {
    sendJson(
      response,
      500,
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );
  }
}

function streamProcess(
  command,
  args,
  response,
) {
  return new Promise(
    (resolve, reject) => {
      const child =
        spawn(
          command,
          args,
          {
            windowsHide: true,
            shell: false,
          },
        );

      const forward =
        chunk => {
          const text =
            chunk
              .toString()
              .replace(/\r/g, "\n");

          response.write(text);
        };

      child.stdout.on(
        "data",
        forward,
      );

      child.stderr.on(
        "data",
        forward,
      );

      child.once(
        "error",
        reject,
      );

      child.once(
        "close",
        code => {
          resolve(
            code ?? -1,
          );
        },
      );
    },
  );
}

async function flashFirmware(
  request,
  response,
  url,
) {
  const serialPort =
    (
      url.searchParams.get(
        "port",
      ) ??
      ""
    ).trim();

  const mode =
    url.searchParams.get(
      "mode",
    );

  const baud =
    Number(
      url.searchParams.get(
        "baud",
      ),
    );

  const erase =
    url.searchParams.get(
      "erase",
    ) === "1";

  if (
    !/^COM\d+$/i.test(
      serialPort,
    )
  ) {
    sendJson(
      response,
      400,
      {
        ok: false,
        message:
          "Invalid COM port",
      },
    );

    return;
  }

  if (
    mode !== "merged" &&
    mode !== "app"
  ) {
    sendJson(
      response,
      400,
      {
        ok: false,
        message:
          "Invalid flash mode",
      },
    );

    return;
  }

  if (
    ![
      115200,
      460800,
      921600,
    ].includes(baud)
  ) {
    sendJson(
      response,
      400,
      {
        ok: false,
        message:
          "Invalid baud rate",
      },
    );

    return;
  }

  const python =
    findPlatformIoPython();

  const esptool =
    findEsptoolScript();

  if (
    !python ||
    !esptool
  ) {
    sendJson(
      response,
      503,
      {
        ok: false,
        message:
          "PlatformIO esptool.py was not found. Build the ESP32 project once so PlatformIO installs tool-esptoolpy.",
      },
    );

    return;
  }

  const tempFile =
    path.join(
      os.tmpdir(),
      `dcc-express-hub-${
        process.pid
      }-${
        Date.now()
      }.bin`,
    );

  let received = 0;
  let failed = false;

  const output =
    fs.createWriteStream(
      tempFile,
      {
        flags: "wx",
      },
    );

  const cleanup =
    () => {
      try {
        fs.unlinkSync(
          tempFile,
        );
      } catch {
        // Ignore cleanup races.
      }
    };

  request.on(
    "data",
    chunk => {
      if (failed) {
        return;
      }

      received +=
        chunk.length;

      if (
        received >
        MAX_FIRMWARE_BYTES
      ) {
        failed = true;
        request.destroy();
        output.destroy();
        cleanup();
      } else {
        output.write(
          chunk,
        );
      }
    },
  );

  request.once(
    "error",
    () => {
      failed = true;
      output.destroy();
      cleanup();
    },
  );

  request.once(
    "end",
    async () => {
      output.end();

      await new Promise(
        resolve =>
          output.once(
            "close",
            resolve,
          ),
      );

      if (
        failed ||
        received === 0
      ) {
        cleanup();

        if (
          !response.headersSent
        ) {
          sendJson(
            response,
            400,
            {
              ok: false,
              message:
                "Firmware upload failed",
            },
          );
        }

        return;
      }

      response.writeHead(
        200,
        {
          "Content-Type":
            "text/plain; charset=utf-8",
          "Cache-Control":
            "no-store",
          "Transfer-Encoding":
            "chunked",
        },
      );

      response.write(
        `DCCExpressHub firmware flasher\n`,
      );

      response.write(
        `Port: ${serialPort}\n`,
      );

      response.write(
        `Mode: ${mode}\n`,
      );

      response.write(
        `Size: ${received} bytes\n`,
      );

      try {
        const commonArgs = [
          esptool,
          "--chip",
          "auto",
          "--port",
          serialPort,
          "--baud",
          String(baud),
          "--before",
          "default_reset",
          "--after",
          "hard_reset",
        ];

        if (erase) {
          response.write(
            "\n== Erasing flash ==\n",
          );

          const eraseCode =
            await streamProcess(
              python,
              [
                ...commonArgs,
                "erase_flash",
              ],
              response,
            );

          if (eraseCode !== 0) {
            response.write(
              `\n@FLASH_ERROR erase_flash exited with code ${eraseCode}\n`,
            );

            response.end();
            cleanup();
            return;
          }
        }

        const address =
          mode === "merged"
            ? "0x0"
            : "0x10000";

        response.write(
          `\n== Writing ${address} ==\n`,
        );

        const writeCode =
          await streamProcess(
            python,
            [
              ...commonArgs,
              "write_flash",
              address,
              tempFile,
            ],
            response,
          );

        if (writeCode !== 0) {
          response.write(
            `\n@FLASH_ERROR write_flash exited with code ${writeCode}\n`,
          );

          response.end();
          cleanup();
          return;
        }

        response.write(
          "\n@FLASH_OK\n",
        );

        response.end();
        cleanup();
      } catch (error) {
        response.write(
          `\n@FLASH_ERROR ${
            error instanceof Error
              ? error.message
              : String(error)
          }\n`,
        );

        response.end();
        cleanup();
      }
    },
  );
}

const server =
  http.createServer(
    async (
      request,
      response,
    ) => {
      const url =
        new URL(
          request.url ?? "/",
          `http://${host}:${port}`,
        );

      if (
        request.method === "GET" &&
        url.pathname ===
          "/api/resolve-port"
      ) {
        resolveSerialPort(
          response,
          url,
        );

        return;
      }

      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/flash"
      ) {
        await flashFirmware(
          request,
          response,
          url,
        );

        return;
      }

      if (
        request.method !== "GET"
      ) {
        response.writeHead(405);
        response.end(
          "Method not allowed",
        );
        return;
      }

      staticFile(
        request,
        response,
        url.pathname,
      );
    },
  );

server.listen(
  port,
  host,
  () => {
    console.log(
      "DCCExpressHub Serial Configurator",
    );

    console.log(
      `http://${host}:${port}/`,
    );

    const pio =
      findPlatformIO();

    console.log(
      pio
        ? `PlatformIO: ${pio}`
        : "PlatformIO: NOT FOUND",
    );

    const esptool =
      findEsptoolScript();

    console.log(
      esptool
        ? `esptool.py: ${esptool}`
        : "esptool.py: NOT FOUND",
    );
  },
);
