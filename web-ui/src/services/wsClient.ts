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

/*
 * WebSocket heartbeat
 *
 * A lightweight application-level heartbeat is sent periodically.
 * A heartbeat saját UUID-t használ, ezért a válaszát
 * nem továbbítjuk a normál alkalmazás-listenerekhez.
 *
 * Fontos:
 * Nem kizárólag a heartbeat válasz számít életjelnek.
 * BÁRMELY érvényes bejövő WS üzenet bizonyítja,
 * hogy a kapcsolat működik.
 */
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
            /*
             * Lehet, hogy közben már egy másik socket lett az aktív.
             * Ilyenkor ezt az eseményt ignoráljuk.
             */
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

            /*
             * Bármilyen bejövő WS üzenet azt jelenti,
             * hogy a szerver él és a kapcsolat kétirányú.
             */
            this.lastMessageAt = Date.now();

            try {
                const message =
                    JSON.parse(event.data) as TypedServerWsMessage;

                /*
                 * A heartbeat saját belső forgalom.
                 *
                 * Nem küldjük tovább:
                 * - ConsolePanelnek
                 * - subscribeMessages listenereknek
                 * - typed listenereknek
                 *
                 * Így a <#> heartbeat teljesen láthatatlan
                 * marad az alkalmazás többi része számára.
                 */
                if (message.type === "heartbeatAck") {
                    if (WS_DEBUG) {
                        console.debug("[WS] heartbeat response");
                    }

                    return;
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
            /*
             * Ha már nem ez az aktív socket,
             * akkor egy korábbi kapcsolat későn érkező
             * close eventjéről van szó.
             */
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

            /*
             * Nem várunk arra, hogy a böngésző valamikor
             * később close eseményt küldjön.
             *
             * Az error már elég ok arra, hogy ezt a
             * kapcsolatot halottnak tekintsük.
             */
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
            /*
             * Megakadályozzuk, hogy a close esemény
             * automatikus reconnectet indítson.
             */
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

            /*
             * Ha a státusz még connected volt, de maga
             * a socket már nem OPEN, akkor azonnal javítjuk
             * a státuszt és reconnectelünk.
             */
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

    /*
     * Heartbeat indul közvetlenül a WS kapcsolat
     * sikeres megnyitása után.
     */
    private startHeartbeat() {
        this.stopHeartbeat();

        /*
         * Már az elején küldünk egy heartbeatet.
         */
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

                /*
                 * Ha ennyi ideje SEMMILYEN válasz nem érkezett,
                 * akkor a kapcsolatot halottnak tekintjük.
                 */
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

    /*
     * Szándékosan NEM a public send()-et használjuk.
     *
     * Így:
     * - nem jelenik meg outgoing console eventként
     * - nem zavarja az alkalmazás normál WS forgalmát
     *
     * The dedicated heartbeat command does not enter the DCC-EX parser.
     */
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

    /*
     * Központi kapcsolatvesztés-kezelés.
     *
     * Ezt hívja:
     * - onclose
     * - onerror
     * - heartbeat timeout
     * - send() failure
     */
    private handleConnectionLost(
        socket: WebSocket
    ) {
        /*
         * Egy régi socket eseménye ne tudja
         * az új kapcsolatot lelőni.
         */
        if (this.socket !== socket) {
            return;
        }

        this.stopHeartbeat();

        this.socket = null;

        /*
         * Leszedjük a callbackeket, hogy a close()
         * ne generáljon még egyszer reconnect logikát.
         */
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

        /*
         * Egyszerre csak egy reconnect timer lehet.
         */
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
