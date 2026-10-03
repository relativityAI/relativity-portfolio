import { useMemo, type CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { useColorModeValue } from "@/components/ui/color-mode";
import { agentIdentity } from "@/lib/agentIdentity";
import { skillSeed, skillAvatarSvg, type SkillSeedLike } from "@/lib/skillIdentity";

export interface SkillAvatarProps {
    /** Skill object, or a raw id/name string. */
    skill: SkillSeedLike | string | null | undefined;
    /** Chip size in px. Default 24. */
    size?: number;
    /** Accessible label. Pass the skill name when the chip stands alone. */
    label?: string;
}

/**
 * A skill's identity chip: a DiceBear "identicon" portrait on the skill's
 * tint. Deterministic — same skill, same chip, everywhere. Color palette is
 * shared with agents.
 */
/**
 * Superellipse ("squircle") clip as an SVG mask: the native `corner-shape`
 * property isn't in this runtime's Chromium yet, so it never rendered — the
 * mask works everywhere. ponytail: swap for `corner-shape: squircle` once the
 * Electron runtime ships it (one property, drops this data-URI).
 */
const SQUIRCLE_MASK = `url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Cpath%20d='M0%2050C0%2012.5%2012.5%200%2050%200C87.5%200%20100%2012.5%20100%2050C100%2087.5%2087.5%20100%2050%20100C12.5%20100%200%2087.5%200%2050Z'%20fill='%23000'/%3E%3C/svg%3E")`;

export default function SkillAvatar({ skill, size = 24, label }: SkillAvatarProps) {
    const seed = useMemo(() => skillSeed(skill), [skill]);
    const identity = useMemo(() => agentIdentity(seed), [seed]);
    const svg = useMemo(() => skillAvatarSvg(seed), [seed]);

    const color = useColorModeValue(identity.color.light, identity.color.dark);
    const tint = useColorModeValue(identity.tint.light, identity.tint.dark);

    return (
        <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
            w={`${size}px`}
            h={`${size}px`}
            style={{
                WebkitMask: SQUIRCLE_MASK,
                mask: SQUIRCLE_MASK,
                WebkitMaskSize: "100% 100%",
                maskSize: "100% 100%",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
            } as CSSProperties}
            bg={tint}
            border="1px solid"
            borderColor={`color-mix(in srgb, ${color} 38%, transparent)`}
            overflow="hidden"
            role={label ? "img" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            <span
                style={{ width: "100%", height: "100%", display: "block" }}
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        </Box>
    );
}
