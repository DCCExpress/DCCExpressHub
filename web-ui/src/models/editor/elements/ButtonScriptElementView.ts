import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import { generateId } from "../../../helpers";
import { BaseElementView } from "../core/BaseElementView";
import type {
  DrawOptions,
  IButtonScriptElement,
} from "../types/EditorTypes";
import type {
  IEditableProperty,
} from "./PropertyDescriptor";

const DEFAULT_SCRIPT = `// Script Button
// Available helpers:
// dcc.power(true)
// dcc.turnout(12, true)
// dcc.accessory(100, true)
// dcc.signal(100, 16)
// dcc.loco(3, 30, "forward")
// dcc.locoFunction(3, 0, true)
// await delay(500)
// log("Hello from DCCExpressHub")
`;

export class ButtonScriptElementView
  extends BaseElementView
  implements IButtonScriptElement {

  override type = ELEMENT_TYPES.BUTTON_SCRIPT;

  colorOn = "#7048e8";
  colorOff = "#5f3dc4";
  textOn = "JS";
  textOff = "JS";
  script = DEFAULT_SCRIPT;

  draw(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);

    const size = this.GridSizeX - 8;
    const x = this.centerX - size / 2;
    const y = this.centerY - size / 2;

    ctx.fillStyle = this.colorOn || "#7048e8";
    ctx.strokeStyle = options?.darkMode ? "#d0bfff" : "#3b2b73";
    ctx.lineWidth = 1.25;

    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillText("</>", this.centerX, this.centerY - 2);

    if (this.name.trim()) {
      const label = this.name.trim().slice(0, 10);
      ctx.font = "bold 6px Arial";
      ctx.fillText(label, this.centerX, this.centerY + 8);
    }

    this.endDraw(ctx);
    super.drawSelection(ctx);
  }

  override toJSON(): IButtonScriptElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.BUTTON_SCRIPT,
      colorOn: this.colorOn,
      colorOff: this.colorOff,
      textOn: this.textOn,
      textOff: this.textOff,
      script: this.script,
    };
  }

  static fromJSON(
    data: IButtonScriptElement
  ): ButtonScriptElementView {
    const element =
      new ButtonScriptElementView(
        data.x,
        data.y
      );

    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.bg = data.bg;
    element.fg = data.fg;

    element.colorOn =
      data.colorOn || "#7048e8";

    element.colorOff =
      data.colorOff || "#5f3dc4";

    element.textOn =
      data.textOn || "JS";

    element.textOff =
      data.textOff || "JS";

    element.script =
      typeof data.script === "string"
        ? data.script
        : DEFAULT_SCRIPT;

    return element;
  }

  override clone():
    ButtonScriptElementView {
    const copy =
      new ButtonScriptElementView(
        this.x,
        this.y
      );

    copy.id = generateId();
    copy.name = this.name;
    copy.layerName = this.layerName;
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.bg = this.bg;
    copy.fg = this.fg;
    copy.colorOn = this.colorOn;
    copy.colorOff = this.colorOff;
    copy.textOn = this.textOn;
    copy.textOff = this.textOff;
    copy.script = this.script;

    return copy;
  }

  override getEditableProperties():
    IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: "Button color",
        key: "colorOn",
        type: "colorpicker",
        readonly: false,
      },
      {
        label: "JavaScript",
        key: "script",
        type: "scriptEditor",
        readonly: false,
      },
    ];
  }
}
