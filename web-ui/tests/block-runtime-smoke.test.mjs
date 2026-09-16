import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import WebSocket from "ws";

const ROOT = path.resolve(
  import.meta.dirname,
  ".."
);

function wait(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

async function waitForServer(
  port,
  child
) {
  const deadline =
    Date.now() + 8000;

  while (
    Date.now() < deadline
  ) {
    if (
      child.exitCode !== null
    ) {
      throw new Error(
        `mock-server exited early with code ${child.exitCode}`
      );
    }

    try {
      const response =
        await fetch(
          `http://127.0.0.1:${port}/api/layout`,
          {
            cache: "no-store",
          }
        );

      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await wait(50);
  }

  throw new Error(
    "mock-server startup timeout"
  );
}

function waitForMessage(
  socket,
  predicate,
  timeoutMs = 3000
) {
  return new Promise(
    (resolve, reject) => {
      const timer =
        setTimeout(
          () => {
            cleanup();

            reject(
              new Error(
                "WebSocket message timeout"
              )
            );
          },
          timeoutMs
        );

      const onMessage =
        data => {
          let message;

          try {
            message =
              JSON.parse(
                data.toString()
              );
          } catch {
            return;
          }

          if (
            !predicate(message)
          ) {
            return;
          }

          cleanup();
          resolve(message);
        };

      const onClose = () => {
        cleanup();

        reject(
          new Error(
            "WebSocket closed before expected message"
          )
        );
      };

      const cleanup = () => {
        clearTimeout(timer);
        socket.off(
          "message",
          onMessage
        );
        socket.off(
          "close",
          onClose
        );
      };

      socket.on(
        "message",
        onMessage
      );

      socket.on(
        "close",
        onClose
      );
    }
  );
}

function send(
  socket,
  type,
  data
) {
  socket.send(
    JSON.stringify({
      type,
      data,
    })
  );
}

test(
  "mock runtime assigns, snapshots and removes a locomotive from a block",
  {
    timeout: 15000,
  },
  async t => {
    const port =
      38000 +
      (
        process.pid %
        10000
      );

    const tempRoot =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "dccexpress-block-smoke-"
        )
      );

    const child =
      spawn(
        process.execPath,
        [
          "mock-server.mjs",
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            MOCK_HTTP_PORT:
              String(port),
            MOCK_LITTLEFS_ROOT:
              tempRoot,
          },
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      );

    t.after(
      async () => {
        if (
          child.exitCode === null
        ) {
          child.kill(
            "SIGTERM"
          );
        }

        await rm(
          tempRoot,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await waitForServer(
      port,
      child
    );

    const socket =
      new WebSocket(
        `ws://127.0.0.1:${port}/ws`
      );

    t.after(
      () => {
        socket.close();
      }
    );

    await once(
      socket,
      "open"
    );

    const blockId = "12";
    const locoId =
      "smoke-loco";
    const locoAddress =
      18;

    const assignment =
      waitForMessage(
        socket,
        message =>
          message.type ===
            "blockStateChanged" &&
          message.data?.[
            blockId
          ]?.locoAddress ===
            locoAddress
      );

    send(
      socket,
      "setBlock",
      {
        blockId,
        locoId,
        locoAddress,
      }
    );

    const assigned =
      await assignment;

    assert.equal(
      assigned.data[
        blockId
      ].locoId,
      locoId
    );

    assert.equal(
      assigned.data[
        blockId
      ].locoAddress,
      locoAddress
    );

    const snapshot =
      waitForMessage(
        socket,
        message =>
          message.type ===
            "blockStateChanged" &&
          message.data?.[
            blockId
          ]?.locoAddress ===
            locoAddress
      );

    send(
      socket,
      "getBlocks",
      {}
    );

    await snapshot;

    const removed =
      waitForMessage(
        socket,
        message =>
          message.type ===
            "blockStateChanged" &&
          !Object.prototype
            .hasOwnProperty
            .call(
              message.data ?? {},
              blockId
            )
      );

    send(
      socket,
      "setBlockRemove",
      {
        blockId,
        locoId: null,
      }
    );

    await removed;
  }
);
