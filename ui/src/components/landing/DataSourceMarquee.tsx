import { Box, Flex, Text } from "@chakra-ui/react";
import { SOURCES } from "@/lib/dataSources";
import { SOURCE_DEFS, SourceMark, type SourceKey } from "@/lib/sourceLogos";

const SOURCE_KEYS: SourceKey[] = ["sec", "nse", "voyager", "youtube", "reddit"];

function Chip({ children }: { children: React.ReactNode }) {
    return (
        <Flex align="center" gap={1.5} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-recessed)" px={3} py={1.5} flexShrink={0}>
            {children}
        </Flex>
    );
}

function Track() {
    return (
        <Flex align="center" gap={3} px={1.5}>
            {SOURCE_KEYS.map((k) => (
                <Chip key={k}>
                    <SourceMark source={k} size={19} />
                    <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={500} color="var(--ink-secondary)" whiteSpace="nowrap">
                        {SOURCE_DEFS[k].label}
                    </Text>
                </Chip>
            ))}
            {SOURCES.map((s) => (
                <Chip key={s.label}>
                    <s.icon size={12} color="var(--ink-tertiary)" />
                    <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={500} color="var(--ink-secondary)" whiteSpace="nowrap">
                        {s.label}
                    </Text>
                </Chip>
            ))}
        </Flex>
    );
}

export default function DataSourceMarquee() {
    return (
        <Box overflow="hidden" w="100%" aria-hidden="true">
            <Box className="marquee-track">
                <Track />
                <Track />
            </Box>
        </Box>
    );
}