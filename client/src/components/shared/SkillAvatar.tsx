import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { skillSeed, skillAvatarSvg, type SkillSeedLike } from "@/lib/skillIdentity";

export interface SkillAvatarProps {
    /** Skill object, or a raw id/name string. */
    skill: SkillSeedLike | string | null | undefined;
    /** Chip size in px. Default 24. */
    size?: number;
    /** Accessible label. Pass the skill name when the chip stands alone. */
    label?: string;
    /** Round crop instead of the default square. */
    round?: boolean;
}

/**
 * A skill's identity chip: a DiceBear "patchwork" portrait, unbordered
 * (square by default, round with `round`). Deterministic — same skill, same
 * chip, everywhere.
 */

export default function SkillAvatar({ skill, size = 24, label, round }: SkillAvatarProps) {
    const seed = useMemo(() => skillSeed(skill), [skill]);
    const svg = useMemo(() => skillAvatarSvg(seed), [seed]);

    return (
        <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
            w={`${size}px`}
            h={`${size}px`}
            borderRadius={round ? "9999px" : "0"}
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
