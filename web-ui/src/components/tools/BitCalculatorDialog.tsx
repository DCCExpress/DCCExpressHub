import {
    Button,
    Group,
    Stack,
    Text,
} from "@mantine/core";

import {
    IconBinary,
    IconCheck,
    IconCopy,
} from "@tabler/icons-react";

import {
    useEffect,
    useState,
} from "react";
import AppModal from "../common/AppModal";
import BitCalculator from "./BitCalculator";


type BitCalculatorDialogProps = {
    opened: boolean;
    onClose: () => void;

    /*
     * Ha később egy mezőből nyitjuk meg,
     * átadható a kezdőérték.
     */
    initialValue?: number;

    /*
     * Opcionális Apply callback.
     *
     * Ha meg van adva, megjelenik
     * az Apply gomb.
     */
    onApply?: (
        value: number
    ) => void;
};

function clampByte(
    value: number
): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            255,
            Math.trunc(value)
        )
    );
}

export default function BitCalculatorDialog({
    opened,
    onClose,
    initialValue = 0,
    onApply,
}: BitCalculatorDialogProps) {
    const [
        value,
        setValue,
    ] = useState(
        clampByte(initialValue)
    );

    const [
        copied,
        setCopied,
    ] = useState(false);

    /*
     * Minden megnyitásnál
     * újra felvesszük a kezdőértéket.
     */

    useEffect(() => {
        if (!opened) {
            return;
        }

        setValue(
            clampByte(
                initialValue
            )
        );

        setCopied(false);
    }, [
        opened,
        initialValue,
    ]);

    useEffect(() => {
        if (!copied) {
            return;
        }

        const timer =
            window.setTimeout(
                () => {
                    setCopied(false);
                },
                1200
            );

        return () => {
            window.clearTimeout(
                timer
            );
        };
    }, [copied]);

    const copyDecimal =
        async () => {
            try {
                await navigator.clipboard.writeText(
                    String(value)
                );

                setCopied(true);
            } catch {
                setCopied(false);
            }
        };

    const apply = () => {
        onApply?.(value);

        onClose();
    };

    return (
        <AppModal
            opened={opened}
            onClose={onClose}
            title={
                <Group gap="xs">
                    <IconBinary
                        size={20}
                    />

                    <Text fw={700}>
                        8-bit Calculator
                    </Text>
                </Group>
            }
            size="md"
            centered
            draggable
            closeOnClickOutside={false}
        >
            <Stack gap="md">
                <BitCalculator
                    value={value}
                    onChange={
                        setValue
                    }
                />

                <Group
                    justify="space-between"
                    wrap="wrap"
                >
                    <Button
                        variant="default"
                        leftSection={
                            copied ? (
                                <IconCheck size={17} />
                            ) : (
                                <IconCopy size={17} />
                            )
                        }
                        onClick={() =>
                            void copyDecimal()
                        }
                    >
                        {copied
                            ? "Copied!"
                            : "Copy value"}
                    </Button>

                    <Group gap="xs">
                        <Button
                            variant="default"
                            onClick={
                                onClose
                            }
                        >
                            Close
                        </Button>

                        {onApply && (
                            <Button
                                onClick={
                                    apply
                                }
                            >
                                Apply
                            </Button>
                        )}
                    </Group>
                </Group>
            </Stack>
        </AppModal>
    );
}