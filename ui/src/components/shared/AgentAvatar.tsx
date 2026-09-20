import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { useColorModeValue } from "@/components/ui/color-mode";
import {
    agentAvatarSvg,
    agentIdentity,
    agentSeed,
    type AgentSeedLike,
} from "@/lib/agentIdentity";

export interface AgentAvatarProps {
    /** Agent object, or a raw id/name string. */
    agent: AgentSeedLike | string | null | undefined;
    /** Chip size in px. Default 24. */
    size?: number;
    /**
     * Accessible label. Pass the agent name when the chip stands alone;
     * omit when the agent name renders right beside it (the chip then
     * becomes decorative and aria-hidden).
     */
    label?: string;
}

/**
 * An agent's identity chip: a sepia Notionists portrait on a muted chip
 * in the agent's stable color. Deterministic — same agent, same chip,
 * everywhere it appears. Below 14px the portrait is dropped in favor of
 * a plain color swatch, which stays legible at tooltip sizes.
 */
export default function AgentAvatar({ agent, size = 24, label }: AgentAvatarProps) {
    const seed = useMemo(() => agentSeed(agent), [agent]);
    const identity = useMemo(() => agentIdentity(seed), [seed]);
    const svg = useMemo(() => agentAvatarSvg(seed), [seed]);

    const color = useColorModeValue(identity.color.light, identity.color.dark);
    const tint = useColorModeValue(identity.tint.light, identity.tint.dark);

    if (size < 14) {
        return (
            <Box
                as="span"
                display="inline-block"
                flexShrink={0}
                w={`${size}px`}
                h={`${size}px`}
                borderRadius="2px"
                bg={tint}
                border="1px solid"
                borderColor={`color-mix(in srgb, ${color} 45%, transparent)`}
                role={label ? "img" : undefined}
                aria-label={label}
                aria-hidden={label ? undefined : true}
            />
        );
    }

    return (
        <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
            w={`${size}px`}
            h={`${size}px`}
            borderRadius="2px"
            bg={tint}
            border="1px solid"
            borderColor={`color-mix(in srgb, ${color} 38%, transparent)`}
            overflow="hidden"
            role={label ? "img" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            <Box
                as="span"
                w="90%"
                h="90%"
                display="block"
                dangerouslySetInnerHTML={{ __html: svg }}
                css={{
                    "& > svg": {
                        width: "100%",
                        height: "100%",
                        display: "block",
                        // Sepia wash — engraved-ink portraits, not cartoons.
                        filter: "sepia(0.52) saturate(0.72) contrast(0.96)",
                    },
                }}
            />
        </Box>
    );
}
