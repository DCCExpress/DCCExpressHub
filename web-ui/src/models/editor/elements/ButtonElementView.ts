import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type { ButtonBehaviorDto, OutputCommandModeDto } from "@domain/layout/layoutDto";
import { generateId } from "../../../helpers";
import { ClickableBaseElementView } from "../core/ClickableBaseElementView";
import { DrawOptions, IButtonElement } from "../types/EditorTypes";
import { IEditableProperty } from "./PropertyDescriptor";
import {
    OUTPUT_COMMAND_MODE_OPTIONS,
    sendBinaryOutput,
} from "../../../services/layoutOutput";


export class ButtonElementView extends ClickableBaseElementView implements IButtonElement {
    override type = ELEMENT_TYPES.BUTTON;
    outputMode: OutputCommandModeDto = "accessory";
    behavior: ButtonBehaviorDto = "toggle";
    pulseDurationMs: number = 250;
    address: number = 0;
    activeValue: boolean = true;
    on: boolean = false;
    colorOn: string = "lime";
    colorOff: string = "green";
    textOn: string = "ON";
    textOff: string = "OFF";
    private momentaryPressed: boolean = false;
    private pulseTimer: number | null = null;

    private sendLogicalState(logicalOn: boolean): boolean {
        const physicalValue = logicalOn ? this.activeValue : !this.activeValue;
        return sendBinaryOutput(this.outputMode, this.address, physicalValue);
    }

    draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
        if (!this.visible) return;

        this.beginDraw(ctx, options);

         var w = this.GridSizeX - 10

        ctx.fillStyle = this.on ? this.colorOn : this.colorOff
        ctx.strokeStyle = "black";


        ctx.beginPath();
        ctx.roundRect(this.centerX - w / 2, this.centerY - w / 2, w, w, 5);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "white";
        ctx.fillStyle = this.on ? "black" : "white";
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.on ? this.textOn : this.textOff, this.centerX, this.centerY + 1);
        this.endDraw(ctx);
        super.drawSelection(ctx)

    }

    mouseDown(_event: MouseEvent): void {
        // The command station is the source of truth. The matching
        // accessoryChanged/vpinChanged broadcast updates this client and all
        // other connected clients in the same way.
        if (this.behavior === "toggle") {
            this.sendLogicalState(!this.on);
            return;
        }

        if (this.behavior === "momentary") {
            if (this.momentaryPressed) return;
            this.momentaryPressed = this.sendLogicalState(true);
            return;
        }

        this.sendLogicalState(true);
        if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
        this.pulseTimer = window.setTimeout(() => {
            this.pulseTimer = null;
            this.sendLogicalState(false);
        }, Math.max(50, Math.min(10000, this.pulseDurationMs)));
    }

    override mouseUp(_event: MouseEvent): void {
        if (this.behavior !== "momentary" || !this.momentaryPressed) return;
        this.momentaryPressed = false;
        this.sendLogicalState(false);
    }

    override toJSON(): IButtonElement {
        return {
            ...super.toJSON(),
            type: ELEMENT_TYPES.BUTTON,
            outputMode: this.outputMode,
            behavior: this.behavior,
            pulseDurationMs: this.pulseDurationMs,
            address: this.address,
            activeValue: this.activeValue,
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
        e.outputMode = data.outputMode === "vpin" ? "vpin" : "accessory";
        e.behavior = data.behavior === "push" || data.behavior === "momentary"
            ? data.behavior
            : "toggle";
        e.pulseDurationMs = Math.max(50, Math.min(10000, data.pulseDurationMs ?? 250));
        e.activeValue = data.activeValue ?? true;
        e.colorOn = data.colorOn;
        e.colorOff = data.colorOff;
        e.textOn = data.textOn;
        e.textOff = data.textOff;
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
                options: OUTPUT_COMMAND_MODE_OPTIONS,
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
            { label: "Push duration (ms)", key: "pulseDurationMs", type: "number", min: 50, max: 10000 },
            { label: "Accessory address / VPIN", key: "address", type: "number", min: 1, max: 32767 },
            { label: "ON value", key: "activeValue", type: "bittoggle" },
            { label: "ON text", key: "textOn", type: "string" },
            { label: "OFF text", key: "textOff", type: "string" },
            { label: "ON color", key: "colorOn", type: "colorpicker", readonly: false },
            { label: "OFF color", key: "colorOff", type: "colorpicker", readonly: false },
        ];
    }

}
