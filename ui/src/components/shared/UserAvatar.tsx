import { useMemo } from "react";
import { Avatar, Style } from "@dicebear/core";
import shapesDefinition from "@dicebear/styles/shapes.json";

const shapes = new Style(shapesDefinition);
import { Box } from "@/compat/ui";

/**
 * User avatar — square, DiceBear-generated from the signed-in identity.
 * Uses geometric/glyph-like shapes style for distinctive avatars.
 * ponytail: minimal change; reuse existing DiceBear deps.
 */
export default function UserAvatar({
    seed,
    size = 32,
    alert = false,
}: {
    seed: string;
    size?: number | { base: number; md: number };
    /** Show the system-issue dot (matching the account menu's signal). */
    alert?: boolean;
}) {
    const seedValue = seed || "relativity-user";

    const svg = useMemo(
        () =>
            new Avatar(shapes, {
                seed: seedValue,
                // v10 renamed the global `radius` option to `borderRadius`.
                borderRadius: 0,
            }).toString()
                // DiceBear emits no width/height; without them the portrait
                // has no size and collapses inside the clipped chip.
                .replace("<svg ", '<svg width="100%" height="100%" '),
        [seedValue],
    );

    const w = typeof size === "number" ? { base: size, md: size } : size;

    return (
        <Box
            as="span"
            display="inline-block"
            position="relative"
            w={{ base: `${w.base}px`, md: `${w.md}px` }}
            h={{ base: `${w.base}px`, md: `${w.md}px` }}
            flexShrink={0}
            borderRadius="2px"
            overflow="visible"
            border="var(--hairline-w) solid var(--hairline)"
            bg="var(--surface-recessed)"
            lineHeight={0}
        >
            <Box
                role="img"
                aria-label={`${seedValue} avatar`}
                w="100%"
                h="100%"
                borderRadius="1px"
                overflow="hidden"
                dangerouslySetInnerHTML={{ __html: svg }}
            />
            {alert && (
                <Box
                    position="absolute"
                    top="-2px"
                    right="-2px"
                    w="9px"
                    h="9px"
                    borderRadius="full"
                    bg="red.solid"
                    border="2px solid var(--surface-panel)"
                    aria-label="System issue detected"
                />
            )}
        </Box>
    );
}
