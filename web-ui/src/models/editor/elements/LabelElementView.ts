import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { BaseElementView } from "../core/BaseElementView";
import { DrawOptions, ILabelElement } from "../types/EditorTypes";
import { IEditableProperty } from "./PropertyDescriptor";



export class LabelElementView extends BaseElementView implements ILabelElement {
    override type = ELEMENT_TYPES.LABEL;
    layerName = "buildings";
    text: string = "Label";
    fontSize: number = 12;
    color: string = "#ffffff";
    alignment: "left" | "center" | "right" = "center";
    offsetY: number = 0;
    offsetX: number = 0;

    constructor(x: number, y: number) {
        super(x, y);
        this.rotationStep = 45;
        //this.trackType = data.trackType;
        //this.length = data.length ?? 80;
    }

    draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
        if (!this.visible) return;

        this.beginDraw(ctx, options);

        if (!this.enabled) {
            ctx.globalAlpha = this.alpha;
        }

        ctx.font = this.fontSize + "px Arial";
        // Offsets are relative to the element's geometric center. The helper
        // centers both the background and the text around this anchor.
        const x = this.centerX + this.offsetX;
        const y = this.centerY + this.offsetY;

        drawTextWithRoundedBackground(ctx, x, y, this.text, this.color, this.bg, 2, 4);


        this.endDraw(ctx);
        super.drawSelection(ctx);
        super.draw(ctx)
    }




    override toJSON(): ILabelElement {
        return {
            ...super.toJSON(),
            type: ELEMENT_TYPES.LABEL,
            text: this.text,
            fontSize: this.fontSize,
            color: this.color,
            alignment: this.alignment,
            offsetY: this.offsetY,
            offsetX: this.offsetX,
        };
    }

    static fromJSON(data: ILabelElement) :LabelElementView {
        const e = new LabelElementView(data.x, data.y);
        e.id = data.id;
        e.text = data.text;
        e.fontSize = data.fontSize;
        e.color = data.color ?? "#ffffff";
        e.alignment = data.alignment;
        e.offsetY = data.offsetY ?? 0;
        e.offsetX = data.offsetX ?? 0;
        e.rotation = data.rotation;
        e.bg = data.bg;
        e.fg = data.fg;
        return e;
    }

    override clone(): LabelElementView {
        const copy = new LabelElementView(this.x, this.y);
        copy.id = generateId();
        copy.rotation = this.rotation;
        copy.rotationStep = this.rotationStep;
        copy.selected = this.selected;
        copy.text = this.text;
        copy.fontSize = this.fontSize;
        copy.color = this.color;
        copy.alignment = this.alignment;
        copy.offsetY = this.offsetY;
        copy.offsetX = this.offsetX;
        copy.bg = this.bg;
        copy.fg = this.fg;
        return copy;
    }

    override getEditableProperties(): IEditableProperty[] {
        return [
            // { label: "Név", key: "name", type: "string" },
            // { label: "Forgatás", key: "rotation", type: "number" },
            ...super.getEditableProperties(),
            { label: "Text", key: "text", type: "string", readonly: false },
            { label: "Color", key: "color", type: "colorpicker", readonly: false },
            { label: "Background", key: "bg", type: "colorpicker", readonly: false },
            { label: "Font Size", key: "fontSize", type: "number", readonly: false },
            { label: "Offset Y", key: "offsetY", type: "number", readonly: false },
            { label: "Offset X", key: "offsetX", type: "number", readonly: false },
        ];
    }

    getHelp(): string {
        return `
  `;
    }

}
