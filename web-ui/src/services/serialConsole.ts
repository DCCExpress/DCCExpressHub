export type SerialConsoleStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export type SerialConsoleMessageListener =
  (message: string) => void;

export type SerialConsoleStatusListener =
  (status: SerialConsoleStatus) => void;

/*
 * Minimal Web Serial typings.
 *
 * Így akkor is fordul a projekt, ha a TypeScript
 * DOM definícióban nincs benne a Web Serial API.
 */

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;

  open(options: {
    baudRate: number;
  }): Promise<void>;

  close(): Promise<void>;
};

type SerialApiLike = {
  requestPort(): Promise<SerialPortLike>;

  getPorts(): Promise<
    SerialPortLike[]
  >;
};

type NavigatorWithSerial =
  Navigator & {
    serial?: SerialApiLike;
  };

const DEFAULT_BAUD_RATE = 115200;

class SerialConsoleService {
  private port:
    | SerialPortLike
    | null = null;

  private reader:
    | ReadableStreamDefaultReader<Uint8Array>
    | null = null;

  private readLoopPromise:
    | Promise<void>
    | null = null;

  private status:
    SerialConsoleStatus =
      "disconnected";

  private readonly messageListeners =
    new Set<SerialConsoleMessageListener>();

  private readonly statusListeners =
    new Set<SerialConsoleStatusListener>();

  /*
   * --------------------------------------------------
   * SUPPORT
   * --------------------------------------------------
   */

  isSupported(): boolean {
    if (
      typeof navigator ===
      "undefined"
    ) {
      return false;
    }

    return Boolean(
      (
        navigator as NavigatorWithSerial
      ).serial
    );
  }

  isSecureContext(): boolean {
    return (
      typeof window !==
        "undefined" &&
      window.isSecureContext
    );
  }

  getStatus():
    SerialConsoleStatus {
    return this.status;
  }

  isConnected(): boolean {
    return (
      this.status ===
        "connected" &&
      this.port !== null
    );
  }

  getBaudRate(): number {
    return DEFAULT_BAUD_RATE;
  }

  /*
   * --------------------------------------------------
   * EVENTS
   * --------------------------------------------------
   */

  subscribeMessages(
    listener:
      SerialConsoleMessageListener
  ): () => void {
    this.messageListeners.add(
      listener
    );

    return () => {
      this.messageListeners.delete(
        listener
      );
    };
  }

  subscribeStatus(
    listener:
      SerialConsoleStatusListener
  ): () => void {
    this.statusListeners.add(
      listener
    );

    /*
     * Az új subscriber azonnal
     * megkapja a jelenlegi állapotot.
     */

    listener(this.status);

    return () => {
      this.statusListeners.delete(
        listener
      );
    };
  }

  private setStatus(
    status: SerialConsoleStatus
  ): void {
    if (
      this.status === status
    ) {
      return;
    }

    this.status = status;

    for (
      const listener of
      this.statusListeners
    ) {
      listener(status);
    }
  }

  private emitMessage(
    message: string
  ): void {
    for (
      const listener of
      this.messageListeners
    ) {
      listener(message);
    }
  }

  /*
   * --------------------------------------------------
   * CONNECT
   * --------------------------------------------------
   */

  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (!this.isSupported()) {
      this.setStatus("error");

      throw new Error(
        "Web Serial API is not available."
      );
    }

    const serial =
      (
        navigator as NavigatorWithSerial
      ).serial;

    if (!serial) {
      this.setStatus("error");

      throw new Error(
        "Web Serial API is not available."
      );
    }

    this.setStatus(
      "connecting"
    );

    try {
      /*
       * Ez nyitja meg a Chrome / Edge
       * natív COM port választóját.
       */

      const port =
        await serial.requestPort();

      await port.open({
        baudRate:
          DEFAULT_BAUD_RATE,
      });

      this.port = port;

      this.setStatus(
        "connected"
      );

      /*
       * A read loop a service-ben él,
       * NEM a React komponensben.
       */

      this.readLoopPromise =
        this.startReadLoop(
          port
        );
    } catch (error) {
      this.port = null;

      this.setStatus("error");

      throw error;
    }
  }

  /*
   * --------------------------------------------------
   * DISCONNECT
   * --------------------------------------------------
   */

  async disconnect(): Promise<void> {
    const port = this.port;

    if (!port) {
      this.setStatus(
        "disconnected"
      );

      return;
    }

    this.setStatus(
      "disconnecting"
    );

    /*
     * Először a reader-t kell leállítani.
     * Utána várjuk meg, hogy valóban
     * releaseLock történjen.
     */

    const reader = this.reader;

    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Már megszakadhatott.
      }
    }

    /*
     * Megvárjuk a read loop végét.
     */

    if (
      this.readLoopPromise
    ) {
      try {
        await this.readLoopPromise;
      } catch {
        // Read loop hiba disconnect közben
        // nem akadályozhatja a port bezárását.
      }
    }

    this.reader = null;
    this.readLoopPromise =
      null;

    /*
     * Most már nincs readable lock,
     * biztonságosan zárható a port.
     */

    try {
      await port.close();
    } finally {
      this.port = null;

      this.setStatus(
        "disconnected"
      );
    }
  }

  /*
   * --------------------------------------------------
   * SEND
   * --------------------------------------------------
   */

  async send(
    command: string
  ): Promise<void> {
    const port = this.port;

    if (
      !port ||
      !port.writable ||
      !this.isConnected()
    ) {
      throw new Error(
        "Serial port is not connected."
      );
    }

    const writer =
      port.writable.getWriter();

    try {
      const encoder =
        new TextEncoder();

      /*
       * DCC-EX-nek maga a <...>
       * parancs számít.
       *
       * A newline a serial konzol
       * olvashatósága miatt kerül utána.
       */

      await writer.write(
        encoder.encode(
          `${command}\n`
        )
      );
    } finally {
      writer.releaseLock();
    }
  }

  /*
   * --------------------------------------------------
   * RECEIVE LOOP
   * --------------------------------------------------
   */

  private async startReadLoop(
    port: SerialPortLike
  ): Promise<void> {
    if (!port.readable) {
      this.setStatus("error");

      return;
    }

    const reader =
      port.readable.getReader();

    this.reader = reader;

    const decoder =
      new TextDecoder();

    let buffer = "";

    try {
      while (
        this.port === port &&
        this.status ===
          "connected"
      ) {
        const {
          value,
          done,
        } =
          await reader.read();

        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        buffer +=
          decoder.decode(
            value,
            {
              stream: true,
            }
          );

        /*
         * A DCC-EX output jellemzően
         * sorokra bontva érkezik.
         */

        const lines =
          buffer.split(
            /\r?\n/
          );

        buffer =
          lines.pop() ?? "";

        for (
          const line of lines
        ) {
          const clean =
            line.trimEnd();

          if (
            clean.length === 0
          ) {
            continue;
          }

          this.emitMessage(
            clean
          );
        }
      }

      /*
       * Ha maradt adat a bufferben.
       */

      const remaining =
        buffer.trim();

      if (
        remaining.length > 0
      ) {
        this.emitMessage(
          remaining
        );
      }
    } catch (error) {
      /*
       * reader.cancel() disconnect során
       * ide vezethet. Az nem valódi hiba.
       */

      if (
        this.status !==
        "disconnecting"
      ) {
        console.error(
          "Serial read error:",
          error
        );

        this.setStatus(
          "error"
        );
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Már feloldódhatott.
      }

      if (
        this.reader === reader
      ) {
        this.reader = null;
      }
    }
  }
}

/*
 * --------------------------------------------------
 * SINGLETON
 * --------------------------------------------------
 *
 * Ez a lényeg.
 *
 * A ConsolePanel mount/unmount NEM hoz létre
 * új SerialPort kapcsolatot.
 *
 * A service a teljes alkalmazás élettartamáig él.
 */

export const serialConsole =
  new SerialConsoleService();