import {
  Modal,
  type ModalProps,
} from "@mantine/core";
import {
  useEffect,
  useRef,
  useState,
} from "react";

type AppModalProps = ModalProps & {
  draggable?: boolean;
  resetPositionOnOpen?: boolean;
};

export default function AppModal({
  draggable = false,
  resetPositionOnOpen = false,
  opened,
  onClose,
  title,
  children,
  styles,
  ...props
}: AppModalProps) {
  const [offset, setOffset] = useState({
    x: 0,
    y: 0,
  });

  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (opened && resetPositionOnOpen) {
      setOffset({ x: 0, y: 0 });
    }
  }, [opened, resetPositionOnOpen]);

  useEffect(() => {
    if (!draggable) return;

    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      setOffset({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      });
    };

    const handleUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = "";
    };
  }, [draggable]);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select")) return;

    event.preventDefault();

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };

    document.body.style.userSelect = "none";
  };

  const titleNode = draggable ? (
    <div
      style={{
        cursor: "move",
        width: "100%",
        touchAction: "none",
      }}
      onPointerDown={beginDrag}
    >
      {title}
    </div>
  ) : title;

  const objectStyles =
    styles && typeof styles === "object"
      ? styles
      : undefined;

  const existingContentStyle =
    objectStyles && "content" in objectStyles
      ? (objectStyles as Record<string, unknown>).content
      : undefined;

  return (
    <Modal
      {...props}
      opened={opened}
      onClose={onClose}
      title={titleNode}
      styles={{
        ...objectStyles,
        content: {
          ...(typeof existingContentStyle === "object" && existingContentStyle !== null
            ? existingContentStyle
            : {}),
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        },
      }}
    >
      {children}
    </Modal>
  );
}
