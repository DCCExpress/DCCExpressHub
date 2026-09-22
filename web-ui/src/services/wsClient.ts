import type {
    ClientWsMessage,
    ServerWsMessageType,
    ServerWsPayloadMap,
    TypedServerWsMessage,
} from "@domain/types";

export type WsConnectionStatus =
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "error";

type StatusListener =
    (status: WsConnectionStatus) => void;

type MessageListener =
    (message: TypedServerWsMessage) => void;

type OutgoingMessageListener =
    (message: ClientWsMessage) => void;

type TypedMessageListener<
    TType extends ServerWsMessageType
> = (
    data: ServerWsPayloadMap[TType],
    raw: Extract<TypedServerWsMessage, { type: TType }>
) => void;

type AnyTypedMessageListener =
    (
        data: ServerWsPayloadMap[ServerWsMessageType],
        raw: TypedServerWsMessage
    ) => void;

type ExplicitPayloadMessageListener<TData> =
    (
        data: TData,
        raw: TypedServerWsMessage
    ) => void;

const WS_DEBUG = false;

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 15000;

class WsClient {
    private socket: WebSocket | null = null;
    private status: WsConnectionStatus = "disconnected";

    private statusListeners =
        new Set<StatusListener>();

    private messageListeners =
        new Set<MessageListener>();

    private outgoingMessageListeners =
        new Set<OutgoingMessageListener>();

    private typedListeners =
        new Map<string, Set<AnyTypedMessageListener>>();

    /*
     * Sticky locomotive runtime cache.
     *
     * The backend sends locoState messages immediately after a WebSocket
     * connection is accepted. During a full browser refresh those messages
     * can arrive before the LocoPanel has mounted and registered its typed
     * listener.
     *
     * WebSocket messages are transient by nature, therefore without this cache
     * an authoritative desktop snapshot can be received correctly and still be
     * lost by the UI.
     *
     * Cache the latest state by DCC address at the transport boundary. A newly
     * registered locoState listener receives the current cached states once,
     * then continues to receive normal live events.
     */
    private readonly latestLocoStates =
        new Map<number, ServerWsPayloadMap["locoState"]>();

    private reconnectTimer: number | null = null;
    private heartbeatTimer: number | null = null;

    private manuallyClosed = false;

    private reconnectAttempts = 0;
    private readonly reconnectDelayMs = 3000;
    private readonly maxReconnectDelayMs = 10000;

    private lastMessageAt = 0;

    private url = "";

    public connect(url?: string) {
        if (url) {
            this.url = url;
        }

        if (!this.url) {
            console.error("WebSocket URL is missing.");
            return;
        }

        if (
            this.socket &&
            (
                this.socket.readyState === WebSocket.OPEN ||
                this.socket.readyState === WebSocket.CONNECTING
            )
        ) {
            return;
        }

        this.clearReconnectTimer();
        this.stopHeartbeat();

        this.manuallyClosed = false;

        this.setStatus(
            this.reconnectAttempts > 0
                ? "reconnecting"
                : "connecting"
        );

        const socket = new WebSocket(this.url);

        this.socket = socket;

        socket.onopen = () => {
            if (this.socket !== socket) {
                return;
            }

            this.reconnectAttempts = 0;
            this.lastMessageAt = Date.now();

            this.setStatus("connected");
            this.startHeartbeat();

            if (WS_DEBUG) {
                console.info("[WS] connected");
            }
        };

        socket.onmessage = event => {
            if (this.socket !== socket) {
                return;
            }

            this.lastMessageAt = Date.now();

            try {
                const message =
                    JSON.parse(event.data) as TypedServerWsMessage;

                if (message.type === "heartbeatAck") {
                    if (WS_DEBUG) {
                        console.debug("[WS] heartbeat response");
                    }

                    return;
                }

                /*
                 * Capture loco state BEFORE notifying any UI listener.
                 *
                 * This is deliberately owned by WsClient rather than a panel:
                 * panels may mount/unmount, two throttle panels may exist at
                 * once, and the server snapshot may arrive before either one
                 * subscribes.
                 */
                if (message.type === "locoState") {
                    const address =
                        message.data.loco?.address;

                    if (
                        Number.isInteger(address) &&
                        address > 0
                    ) {
                        this.latestLocoStates.set(
                            address,
                            message.data
                        );
                    }
                }

                this.messageListeners.forEach(listener =>
                    listener(message)
                );

                const typed =
                    this.typedListeners.get(message.type);

                if (typed) {
                    typed.forEach(listener =>
                        listener(
                            message.data as ServerWsPayloadMap[ServerWsMessageType],
                            message
                        )
                    );
                }
            } catch (error) {
                console.error(
                    "Invalid WebSocket message:",
                    event.data,
                    error
                );
            }
        };

        socket.onclose = event => {
            if (this.socket !== socket) {
                return;
            }

            if (WS_DEBUG) {
                console.warn(
                    "[WS] disconnected",
                    event.code,
                    event.reason
                );
            }

            this.handleConnectionLost(socket);
        };

        socket.onerror = event => {
            if (this.socket !== socket) {
                return;
            }

            if (WS_DEBUG) {
                console.warn(
                    "[WS] socket error",
                    event
                );
            }

            this.handleConnectionLost(socket);
        };
    }

    public disconnect() {
        this.manuallyClosed = true;

        this.clearReconnectTimer();
        this.stopHeartbeat();

        const socket = this.socket;

        this.socket = null;

        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;

            try {
                socket.close();
            } catch {
                // Nincs további teendő.
            }
        }

        this.setStatus("disconnected");
    }

    public isConnected(): boolean {
        return (
            this.status === "connected" &&
            this.socket?.readyState === WebSocket.OPEN
        );
    }

    public getStatus(): WsConnectionStatus {
        return this.status;
    }

    public send(message: ClientWsMessage): boolean {
        const socket = this.socket;

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN
        ) {
            console.warn(
                "WebSocket is not connected, message was not sent",
                message
            );

            if (
                this.status === "connected" &&
                !this.manuallyClosed
            ) {
                if (socket) {
                    this.handleConnectionLost(socket);
                } else {
                    this.setStatus("reconnecting");
                    this.scheduleReconnect();
                }
            }

            return false;
        }

        try {
            socket.send(JSON.stringify(message));

            this.outgoingMessageListeners.forEach(listener =>
                listener(message)
            );

            return true;
        } catch (error) {
            console.warn(
                "WebSocket send failed",
                error
            );

            this.handleConnectionLost(socket);

            return false;
        }
    }

    public subscribeStatus(
        listener: StatusListener
    ): () => void {
        this.statusListeners.add(listener);

        listener(this.status);

        return () => {
            this.statusListeners.delete(listener);
        };
    }

    public subscribeMessages(
        listener: MessageListener
    ): () => void {
        this.messageListeners.add(listener);

        return () => {
            this.messageListeners.delete(listener);
        };
    }

    public subscribeOutgoingMessages(
        listener: OutgoingMessageListener
    ): () => void {
        this.outgoingMessageListeners.add(listener);

        return () => {
            this.outgoingMessageListeners.delete(listener);
        };
    }

    public on<TType extends ServerWsMessageType>(
        type: TType,
        listener: TypedMessageListener<TType>
    ): () => void;

    public on<TData>(
        type: ServerWsMessageType,
        listener: ExplicitPayloadMessageListener<TData>
    ): () => void;

    public on(
        type: ServerWsMessageType,
        listener: AnyTypedMessageListener
    ): () => void {
        const listeners =
            this.typedListeners.get(type) ??
            new Set<AnyTypedMessageListener>();

        listeners.add(
            listener as AnyTypedMessageListener
        );

        this.typedListeners.set(
            type,
            listeners
        );

        /*
         * locoState is sticky.
         *
         * Replay the authoritative states already received during WebSocket
         * startup so a panel created after the server snapshot cannot start
         * with speed/direction/functions reset to defaults.
         */
        if (type === "locoState") {
            for (const data of this.latestLocoStates.values()) {
                const raw = {
                    type: "locoState",
                    data,
                } as TypedServerWsMessage;

                listener(
                    data as ServerWsPayloadMap[ServerWsMessageType],
                    raw
                );
            }
        }

        return () => {
            const current =
                this.typedListeners.get(type);

            if (!current) {
                return;
            }

            current.delete(
                listener as AnyTypedMessageListener
            );

            if (current.size === 0) {
                this.typedListeners.delete(type);
            }
        };
    }

    private setStatus(
        status: WsConnectionStatus
    ) {
        if (this.status === status) {
            return;
        }

        this.status = status;

        if (WS_DEBUG) {
            console.info(
                "[WS] status:",
                status
            );
        }

        this.statusListeners.forEach(listener =>
            listener(status)
        );
    }

    private startHeartbeat() {
        this.stopHeartbeat();

        this.sendHeartbeat();

        this.heartbeatTimer =
            window.setInterval(() => {
                const socket = this.socket;

                if (
                    !socket ||
                    socket.readyState !== WebSocket.OPEN
                ) {
                    return;
                }

                const elapsed =
                    Date.now() - this.lastMessageAt;

                if (
                    elapsed >= HEARTBEAT_TIMEOUT_MS
                ) {
                    if (WS_DEBUG) {
                        console.warn(
                            `[WS] heartbeat timeout after ${elapsed} ms`
                        );
                    }

                    this.handleConnectionLost(socket);

                    return;
                }

                this.sendHeartbeat();
            }, HEARTBEAT_INTERVAL_MS);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer !== null) {
            window.clearInterval(
                this.heartbeatTimer
            );

            this.heartbeatTimer = null;
        }
    }

    private sendHeartbeat() {
        const socket = this.socket;

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        const heartbeatMessage: ClientWsMessage = {
            type: "heartbeat",
            data: {},
        };

        try {
            socket.send(
                JSON.stringify(heartbeatMessage)
            );

            if (WS_DEBUG) {
                console.debug(
                    "[WS] heartbeat sent"
                );
            }
        } catch (error) {
            if (WS_DEBUG) {
                console.warn(
                    "[WS] heartbeat send failed",
                    error
                );
            }

            this.handleConnectionLost(socket);
        }
    }

    private handleConnectionLost(
        socket: WebSocket
    ) {
        if (this.socket !== socket) {
            return;
        }

        this.stopHeartbeat();

        this.socket = null;

        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;

        try {
            if (
                socket.readyState === WebSocket.OPEN ||
                socket.readyState === WebSocket.CONNECTING
            ) {
                socket.close();
            }
        } catch {
            // A kapcsolat már halott lehet.
        }

        if (this.manuallyClosed) {
            this.setStatus("disconnected");
            return;
        }

        this.setStatus("reconnecting");
        this.scheduleReconnect();
    }

    private scheduleReconnect() {
        if (this.manuallyClosed) {
            return;
        }

        if (this.reconnectTimer !== null) {
            return;
        }

        this.reconnectAttempts++;

        const delay = Math.min(
            this.reconnectDelayMs *
            this.reconnectAttempts,
            this.maxReconnectDelayMs
        );

        if (WS_DEBUG) {
            console.info(
                `[WS] reconnect in ${delay} ms`
            );
        }

        this.reconnectTimer =
            window.setTimeout(() => {
                this.reconnectTimer = null;

                if (this.manuallyClosed) {
                    return;
                }

                this.connect();
            }, delay);
    }

    private clearReconnectTimer() {
        if (
            this.reconnectTimer !== null
        ) {
            window.clearTimeout(
                this.reconnectTimer
            );

            this.reconnectTimer = null;
        }
    }

    public restartConnection(): void {
        this.manuallyClosed = false;

        this.clearReconnectTimer();
        this.stopHeartbeat();

        const socket = this.socket;
        this.socket = null;

        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;

            try {
                socket.close();
            } catch {
                // ignore
            }
        }

        this.setStatus("reconnecting");

        this.reconnectAttempts = 0;
        this.scheduleReconnect();
    }
}

export const wsClient = new WsClient();
