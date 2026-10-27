import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button, CloseButton, FloatingWindow, FocusTrap, Group, Portal, Text, ThemeIcon } from "@mantine/core";
import { IconAlertTriangle, IconGripVertical } from "@tabler/icons-react";
import "./AppWindow.css";

type AppWindowProps = {
  opened: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  tone?: "blue" | "red";
  width?: number;
};

/** Centered, modal-like and draggable window; shared header/content/footer shell. */
export default function AppWindow({ opened, onClose, title, children, footer, tone = "blue", width = 440 }: AppWindowProps) {
  // Remount on each opening so FloatingWindow starts centered rather than reusing the prior drag position.
  const [session, setSession] = useState(0);
  useEffect(() => { if (opened) setSession(value => value + 1); }, [opened]);
  useEffect(() => {
    if (!opened) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; };
  }, [opened, onClose]);

  if (!opened) return null;
  const actualWidth = Math.min(width, Math.max(280, window.innerWidth - 32));
  const start = { left: Math.max(16, (window.innerWidth - actualWidth) / 2), top: Math.max(16, (window.innerHeight - 230) / 2) };
  return (
    <Portal>
      <div className="app-window-backdrop" aria-hidden="true" onClick={onClose} />
      <FocusTrap active>
        <FloatingWindow
          key={session}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          withBorder
          shadow="xl"
          radius="md"
          w={actualWidth}
          initialPosition={start}
          constrainToViewport
          constrainOffset={8}
          dragHandleSelector=".app-window-header"
          excludeDragHandleSelector="button"
          className="app-window"
        >
          <Group justify="space-between" gap="sm" className={"app-window-header app-window-header-" + tone} px="md" py="sm" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <ThemeIcon variant="transparent" color="white" size="sm">
                {tone === "red" ? <IconAlertTriangle size={18}/> : <IconGripVertical size={18}/>}
              </ThemeIcon>
              <Text c="white" fw={700} size="sm">{title}</Text>
            </Group>
            <CloseButton c="white" variant="transparent" onClick={onClose} aria-label="Close window"/>
          </Group>
          <div className="app-window-content">{children}</div>
          {footer && <Group justify="end" gap="xs" className="app-window-footer">{footer}</Group>}
        </FloatingWindow>
      </FocusTrap>
    </Portal>
  );
}

export function DeleteConfirmWindow({ opened, onClose, onConfirm, name, disabledReason }: {
  opened: boolean; onClose: () => void; onConfirm: () => void; name: string; disabledReason?: string;
}) {
  return (
    <AppWindow opened={opened} onClose={onClose} tone="red" title="Delete connection"
      footer={<>
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button color="red" disabled={!!disabledReason} onClick={onConfirm}>Delete connection</Button>
      </>}>
      <Text size="sm">Are you sure you want to delete <Text span fw={700}>{name}</Text>?</Text>
      {disabledReason && <Text size="sm" c="red" mt="sm">{disabledReason}</Text>}
      <Text size="xs" c="dimmed" mt="sm">This action cannot be undone.</Text>
    </AppWindow>
  );
}
