import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type {
    ButtonBehaviorDto,
    ButtonOutputModeDto,
} from "@domain/layout/layoutDto";
import { generateId } from "../../../helpers";
import { ClickableBaseElementView } from "../core/ClickableBaseElementView";
import { DrawOptions, IButtonElement } from "../types/EditorTypes";
import { IEditableProperty } from "./PropertyDescriptor";
import { wsApi } from "../../../services/wsApi";
import { wsClient } from "../../../services/wsClient";

const BUTTON_OUTPUT_MODE_OPTIONS = [
    { value: "accessory", label: "Basic accessory · <a address 0|1>" },
    { value: "extended", label: "Extended accessory · <A address aspect>" },
] satisfies Array<{ value: ButtonOutputModeDto; label: string }>;

function normalizeAspect(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;

    return Math.max(0, Math.min(255, Math.trunc(numeric)));
}

const buttonInstances = new Set<ButtonElementView>();

export class ButtonElementView extends ClickableBaseElementView implements IButtonElement {
    override type = ELEMENT_TYPES.BUTTON;

    outputMode: ButtonOutputModeDto = "accessory";
    behavior: ButtonBehaviorDto = "toggle";
    pulseDurationMs: number = 250;
    address: number = 0;

    /** Basic accessory values. */
    activeValue: boolean = true;
    offValue: boolean = false;

    /** Extended accessory aspects. */
    onAspect: number = 1;
    offAspect: number = 0;

    on: boolean = false;
    colorOn: string = "lime";
    colorOff: string = "green";
    textOn: string = "ON";
    textOff: string = "OFF";

    private momentaryPressed: boolean = false;
    private pulseTimer: number | null = null;

    constructor(x: number, y: number) {
        super(x, y);
        buttonInstances.add(this);
    }

    /**
     * Sends one of the two configured Button states.
     *
     * This is public intentionally: the property panel uses the same method
     * for its Test buttons as normal runtime Button operation.
     */
    sendConfiguredState(logicalOn: boolean): boolean {
        if (
            !Number.isInteger(this.address) ||
            this.address < 1 ||
            this.address > 2048
        ) {
            return false;
        }

        if (this.outputMode === "extended") {
            const aspect = logicalOn
                ? normalizeAspect(this.onAspect, 1)
                : normalizeAspect(this.offAspect, 0);

            return wsApi.setSignalAspect(this.address, aspect);
        }

        const physicalValue = logicalOn
            ? this.activeValue
            : this.offValue;

        const sent = wsApi.setBasicAccessory(
            this.address,
            physicalValue,
        );

        return sent;
    }

    draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
        if (!this.visible) return;

        this.beginDraw(ctx, options);

        const w = this.GridSizeX - 10;

        ctx.fillStyle = this.on ? this.colorOn : this.colorOff;
        ctx.strokeStyle = "black";

        ctx.beginPath();
        ctx.roundRect(
            this.centerX - w / 2,
            this.centerY - w / 2,
            w,
            w,
            5,
        );
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = this.on ? "black" : "white";
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
            this.on ? this.textOn : this.textOff,
            this.centerX,
            this.centerY + 1,
        );

        this.endDraw(ctx);
        super.drawSelection(ctx);
    }

    mouseDown(_event: MouseEvent): void {
        if (this.behavior === "toggle") {
            this.sendConfiguredState(!this.on);
            return;
        }

        if (this.behavior === "momentary") {
            if (this.momentaryPressed) return;

            this.momentaryPressed =
                this.sendConfiguredState(true);

            return;
        }

        this.sendConfiguredState(true);

        if (this.pulseTimer !== null) {
            window.clearTimeout(this.pulseTimer);
        }

        this.pulseTimer = window.setTimeout(() => {
            this.pulseTimer = null;
            this.sendConfiguredState(false);
        }, Math.max(50, Math.min(10000, this.pulseDurationMs)));
    }

    override mouseUp(_event: MouseEvent): void {
        if (
            this.behavior !== "momentary" ||
            !this.momentaryPressed
        ) {
            return;
        }

        this.momentaryPressed = false;
        this.sendConfiguredState(false);
    }

    override toJSON(): IButtonElement {
        return {
            ...super.toJSON(),
            type: ELEMENT_TYPES.BUTTON,
            outputMode:
                this.outputMode === "extended"
                    ? "extended"
                    : "accessory",
            behavior: this.behavior,
            pulseDurationMs: this.pulseDurationMs,
            address: this.address,
            activeValue: this.activeValue,
            offValue:
                this.offValue === this.activeValue
                    ? !this.activeValue
                    : this.offValue,
            onAspect: normalizeAspect(this.onAspect, 1),
            offAspect: normalizeAspect(this.offAspect, 0),
            colorOn: this.colorOn,
            colorOff: this.colorOff,
            textOn: this.textOn,
            textOff: this.textOff,
        };
    }

    static fromJSON(data: IButtonElement): ButtonElementView {
        const e = new ButtonElementView(data.x, data.y);

        e.id = data.id;
        e.name = data.name;
        e.rotation = data.rotation;
        e.bg = data.bg;
        e.fg = data.fg;
        e.address = data.address;

        e.outputMode =
            data.outputMode === "extended"
                ? "extended"
                : "accessory";

        e.behavior =
            data.behavior === "push" ||
            data.behavior === "momentary"
                ? data.behavior
                : "toggle";

        e.pulseDurationMs = Math.max(
            50,
            Math.min(10000, data.pulseDurationMs ?? 250),
        );

        e.activeValue = data.activeValue ?? true;

        /*
         * Old Button files had only activeValue and OFF was implied inverse.
         * Preserve that behavior when offValue does not exist.
         */
        e.offValue =
            data.offValue ??
            !e.activeValue;

        if (e.offValue === e.activeValue) {
            e.offValue = !e.activeValue;
        }

        e.onAspect = normalizeAspect(data.onAspect, 1);
        e.offAspect = normalizeAspect(data.offAspect, 0);
        e.colorOn = data.colorOn ?? "lime";
        e.colorOff = data.colorOff ?? "green";
        e.textOn = data.textOn ?? "ON";
        e.textOff = data.textOff ?? "OFF";

        return e;
    }

    override clone(): ButtonElementView {
        const copy = new ButtonElementView(this.x, this.y);

        copy.id = generateId();
        copy.rotation = this.rotation;
        copy.rotationStep = this.rotationStep;
        copy.selected = this.selected;
        copy.address = this.address;
        copy.outputMode = this.outputMode;
        copy.behavior = this.behavior;
        copy.pulseDurationMs = this.pulseDurationMs;
        copy.activeValue = this.activeValue;
        copy.offValue = this.offValue;
        copy.onAspect = this.onAspect;
        copy.offAspect = this.offAspect;
        copy.colorOn = this.colorOn;
        copy.colorOff = this.colorOff;
        copy.textOn = this.textOn;
        copy.textOff = this.textOff;

        return copy;
    }

    override getEditableProperties(): IEditableProperty[] {
        return [
            ...super.getEditableProperties(),
            {
                label: "Output type",
                key: "outputMode",
                type: "select",
                readonly: false,
                options: BUTTON_OUTPUT_MODE_OPTIONS,
            },
            {
                label: "Button behavior",
                key: "behavior",
                type: "select",
                readonly: false,
                options: [
                    { value: "toggle", label: "Toggle · alternate ON / OFF" },
                    { value: "push", label: "Push · timed pulse" },
                    { value: "momentary", label: "Momentary · active while held" },
                ],
            },
            {
                label: "Push duration (ms)",
                key: "pulseDurationMs",
                type: "number",
                min: 50,
                max: 10000,
            },
            {
                label: "Accessory address",
                key: "address",
                type: "number",
                min: 1,
                max: 2048,
            },

            /*
             * TurnoutBitPropertyEditor recognizes ButtonElementView and renders
             * a compact two-row ON/OFF editor with test buttons.
             */
            {
                label: "Output states",
                key: "activeValue",
                type: "bittoggle",
            },

            { label: "ON text", key: "textOn", type: "string" },
            { label: "OFF text", key: "textOff", type: "string" },
            {
                label: "ON color",
                key: "colorOn",
                type: "colorpicker",
                readonly: false,
            },
            {
                label: "OFF color",
                key: "colorOff",
                type: "colorpicker",
                readonly: false,
            },
        ];
    }
}

/**
 * Keep every ButtonElementView instance synchronized with DCC-EX extended
 * accessory feedback.
 *
 * Both LiteLayoutPage and RuntimeLayoutOverlay already listen for
 * signalAspectChanged and invalidate their canvases, so updating the Button
 * instances here makes the new state visible in every connected client
 * without duplicating Button-specific feedback code in each view.
 */
wsClient.on("signalAspectChanged", data => {
    for (const button of buttonInstances) {
        if (
            button.outputMode !== "extended" ||
            button.address !== data.address
        ) {
            continue;
        }

        if (data.aspect === button.onAspect) {
            button.on = true;
        } else if (data.aspect === button.offAspect) {
            button.on = false;
        }
    }
});
